![KG Sidecar Cover](assets/cover.svg)

# KG Sidecar

[![Release](https://img.shields.io/github/v/release/ZUENS2020/kg-sidecar?label=release)](https://github.com/ZUENS2020/kg-sidecar/releases)
[![License](https://img.shields.io/github/license/ZUENS2020/kg-sidecar)](LICENSE)
[![Repository](https://img.shields.io/badge/repo-GitHub-181717?logo=github)](https://github.com/ZUENS2020/kg-sidecar)

KG Sidecar 是一个给 SillyTavern 使用的“动态语义知识图谱”插件实现。  
它的目标不是简单记日志，而是把多轮对话中的人物关系、状态变化和关键事件，转成可追踪、可回滚、可持续注入的结构化记忆层。

## 设计思路

这个插件围绕一个核心问题来设计：  
“如何让角色在长对话里既能记住关系演进，又不产生逻辑污染”。

为此采用了三条原则：

1. 强一致优先：每轮要么完整提交，要么整体回滚，不允许半成功状态。
2. 关系演进优先：把关系变化视为一等公民，避免“有记忆但不连贯”。
3. 可验证优先：每次更新都能解释来源，能追溯到对话证据。

## 实现方法

### 1. 六槽位流水线

每轮对话按固定顺序执行：

- Retriever：识别当前关键实体并召回相关子图。
- Injector：把图谱记忆转换成可注入上下文。
- Actor：由 SillyTavern 主模型负责生成回复。
- Extractor：判定关系动作（演进 / 重塑 / 清除）。
- Judge：做身份对齐与冲突判断。
- Historian：生成里程碑与时间线记录。

### 2. 提交门与回滚机制

每轮在进入写入阶段前都会过“提交门”校验。  
若任一关键条件不满足，结果直接回滚并给出失败原因，不写入图。

### 3. 图谱数据组织

图谱以“人物 + 关系 + 事件”组织：

- 人物节点保存可辨识信息（用于防重名和身份稳定）。
- 关系边保存关系类型与强度（权重表示强烈程度）。
- 事件节点可附着多个角色，支持多角色同事件与单角色多事件。

### 4. 前后端协作

- 前端扩展负责配置、状态展示、里程碑回溯和会话绑定数据库。
- 后端 sidecar 负责流水线编排、模型调用、一致性控制和图谱写入。

## 技术细节

### 技术栈

- Node.js + Express
- SillyTavern 扩展机制
- Neo4j（可选 memory 存储）
- OpenRouter（可配置为多槽位模型来源）

### 关键能力

- 会话级数据库绑定（新建 / 删除 / 切换 / 解绑 / 清空）
- 模型列表动态拉取与槽位模型独立配置
- 槽位级超时控制（支持全局与分槽位配置）
- 关系动作审计与里程碑时间线
- 身份冲突阻断与 Bio 同步补丁

### 接口概览

- `POST /api/kg-sidecar/turn/commit`
- `GET /api/kg-sidecar/turn/status/:turnId`
- `POST /api/kg-sidecar/turn/retry`
- `POST /api/kg-sidecar/db/clear`
- `GET /api/kg-sidecar/health/pipeline`
- `GET /api/kg-sidecar/models`

## 安装到 SillyTavern

将本仓库内容合并到你的 SillyTavern 根目录后，确认 `src/server-startup.js` 里已注册路由：

```js
import { router as kgSidecarRouter } from './endpoints/kg-sidecar.js';
app.use('/api/kg-sidecar', kgSidecarRouter);
```

然后重启 SillyTavern。

## 仓库说明

当前仓库是发布版，不包含测试工具与测试数据。  
如果你要做开发和回归，建议在你的开发仓库里保留测试目录与回归脚本。

## License

AGPL-3.0（见 `LICENSE`）。
