# KG Sidecar（SillyTavern 动态语义知识图谱插件）

面向 SillyTavern 的侧车式知识图谱插件。目标是让“人物关系 + 关键事件”在多轮对话中持续可检索、可注入、可审计、可回放。

## 项目定位

本插件采用**侧车总线编排（推荐）**：
- 主聊天仍由 SillyTavern 现有聊天链路负责（Actor 不在插件里单独配置）。
- KG Sidecar 在每轮前后完成检索、记忆注入、关系审计与图谱写入。
- 支持强一致模式，提交失败会回滚并返回失败阶段与原因码。

## 核心思路

1. 检索：从 Neo4j（或内存仓库）召回焦点人物、关系与关键事件。
2. 注入：把召回结果重构为混合视角记忆包（你 / 他人关系 / 中立背景 / 事件证据）。
3. 主聊：主模型基于注入后的上下文生成回复。
4. 审计更新：Extractor 执行 Evolve / Replace / Delete，Judge 做身份一致性裁决，Historian 产出剧情里程碑。
5. 图谱同步：写入 Neo4j 并保留时序信息，支持后续检索与可视化。

## 当前实现特性

- 六槽位流水线：Retriever / Injector / Actor / Extractor / Judge / Historian。
- 强一致提交门：任一关键槽位输出无效会回滚，不做本地语义兜底。
- 关系三动作：
  - Evolve：同关系累加强度。
  - Replace：关系类型质变替换。
  - Delete：关系删除（阈值与衰减协同）。
- 事件图模型：
  - 人物节点（KGEntity）：`id/name=人物名`，带 `bio` 简介。
  - 关系边（KG_REL）：`label/status/name` 表示关系，`weight` 表示强度。
  - 事件节点（KGEvent）：`event_key` 唯一，`event_id/id/name=事件名`。
  - 参与关系（INVOLVES）：一个事件可关联多人物，一个人物可关联多事件。
- 近期修复：
  - 事件名归一化：自动将模板名（如 `事件:EVOLVE:A→B`）纠偏为真实事件名（如“霜火协定”）。
  - 人物/事件分离约束：问“哪些人”时抑制把事件名当人物。

## 实现方法与技术细节

### 1) 槽位路由与模型
- 模型路由来自插件配置，支持与 SillyTavern API 提供商/模型列表同步。
- 严格模式下，信息提取相关步骤必须走 LLM（OpenRouter）；不使用本地语义规则兜底。

### 2) 提取器（Extractor）
- 输入：当前轮消息、对话窗口、已有关系、关系提示、焦点实体。
- 输出：结构化 `actions + global_audit`。
- 内置事件名标准化逻辑：优先保留显式事件名；若是模板事件名则从证据文本抽取真实事件标题。

### 3) 注入器（Injector）
- 输出固定四段：
  - `second_person_psychology`
  - `third_person_relations`
  - `neutral_background`
  - `event_evidence_context`
- 事件证据上下文显式分为“人物实体 / 事件实体 / 证据行”，降低实体混淆。

### 4) 图存储（Neo4j）
- 关系与事件分层建模，支持按人物回查关键事件。
- 事件节点写入 `id/name=事件名`，便于图上直读。
- 提供清库接口、会话绑定数据库配置与可切换 profile。

### 5) 事务与回滚
- 提交门会校验 Extractor/Judge/Historian 输出合法性。
- 任一阶段失败返回 `ROLLED_BACK`，包含 `failed_stage` 与 `reason_code`。

## 目录结构

- `public/scripts/extensions/kg-sidecar/`：前端扩展（设置页、样式、模型刷新等）
- `src/sidecar/kg/`：侧车服务与槽位实现
- `src/endpoints/kg-sidecar.js`：服务端接入端点
- `docs/architecture/`：运行架构说明
- `docs/operations/`：运维与回归脚本说明

## 安装与接入（源码方式）

将本仓库内容覆盖到你的 SillyTavern 同名路径后重启 SillyTavern。

最少需要确保以下路径存在于 ST 根目录：
- `public/scripts/extensions/kg-sidecar/*`
- `src/sidecar/kg/*`
- `src/endpoints/kg-sidecar.js`

## 配置建议

- 主聊天模型：在 SillyTavern API 页面正常配置（不在插件里重复配置 Actor）。
- 槽位模型：建议先统一同一模型做稳定性验证，再分槽位调优。
- 图存储：优先 Neo4j；开发联调可用 memory。
- 强一致：建议开启；超时/格式错误直接报错并回滚。

## 验证清单

1. 连续对话 10~20 轮，观察关系权重是否连续演进。
2. 明确命名事件后，检查 KGEvent 是否写入 `event_id/id/name=事件名`。
3. 提问“涉及哪些人”，确认回复不把事件名当人物。
4. 检查 sidecar 返回是否包含 `milestones`、`global_audit`、`graph_delta`。

## License

AGPL-3.0
