![KG Sidecar Cover](assets/cover.svg)

# KG Sidecar

[![Release](https://img.shields.io/github/v/release/ZUENS2020/kg-sidecar?label=release)](https://github.com/ZUENS2020/kg-sidecar/releases)
[![License](https://img.shields.io/github/license/ZUENS2020/kg-sidecar)](LICENSE)
[![Repository](https://img.shields.io/badge/repo-GitHub-181717?logo=github)](https://github.com/ZUENS2020/kg-sidecar)

KG Sidecar 是一个给 SillyTavern 使用的“动态语义知识图谱”插件实现。  
它的目标不是简单记日志，而是把多轮对话中的人物关系、状态变化和关键事件，转成可追踪、可回滚、可持续注入的结构化记忆层。

## 核心思路

这个插件围绕一个核心问题：  
“如何让角色在长对话中持续保持记忆一致性，而不是只记住片段信息”。

为此采用三条原则：

1. 强一致优先：每轮要么完整提交，要么整体回滚，不允许半成功状态。
2. 关系演进优先：把关系变化视为一等公民，避免“有记忆但不连贯”。
3. 可追溯优先：每次更新都带证据来源与审计信息。

## 功能结构

### 六槽位流水线

每轮对话按固定顺序执行：

- Retriever：识别当前关键实体并召回相关子图。
- Injector：把图谱记忆转换成可注入上下文。
- Actor：由 SillyTavern 当前主模型负责生成回复（不在插件里单独配置）。
- Extractor：判定关系动作（演进 / 重塑 / 清除）。
- Judge：做身份对齐与冲突判断。
- Historian：生成里程碑与时间线记录。

### 三动作关系更新

- Evolve：关系类型不变，权重累积。
- Replace：关系类型发生质变，旧边替换为新边。
- Delete：关系消亡或衰减至阈值下，移除关系边。

### 图谱模型

图谱以“人物 + 关系 + 事件”组织：

- 人物节点：ID 为人物名，包含简介/Bio 用于防同名污染。
- 关系边：边名表示关系或状态，`weight` 表示强烈程度。
- 事件节点：可连接多个角色；角色也可连接多个事件。

### 一致性与回滚

每轮在写入前通过提交门校验。任一关键槽位失败、超时或审计不通过时，整轮回滚，不写入数据库，避免出现半更新状态。

## 与 SillyTavern API 同步

插件的模型配置始终跟随 SillyTavern API 面板：

- 提供商列表来自 ST 的 Chat Completion Source 实时配置。
- 模型列表通过 ST 状态接口动态拉取并按提供商刷新。
- 支持多提供商并存，槽位独立选择 provider/model。
- 模型 ID 保持原样（区分大小写），避免因大小写转换导致选型失效。

## 工程实现

### 技术栈

- Node.js + Express
- SillyTavern Extension API
- Neo4j（可切换 memory）
- Sidecar Orchestrator + Slot Pipeline

### 关键能力

- 会话级数据库绑定（新建 / 删除 / 切换 / 绑定 / 解绑 / 清空）
- Neo4j 配置可编辑（URI / Database / Username / Password）
- 槽位级模型路由（Retriever / Injector / Extractor / Judge / Historian）
- 时间线里程碑展示与回溯
- 强一致提交与失败回滚

### 接口

- `POST /api/kg-sidecar/turn/commit`
- `GET /api/kg-sidecar/turn/status/:turnId`
- `POST /api/kg-sidecar/db/clear`
- `GET /api/kg-sidecar/health/pipeline`

## 安装到 SillyTavern

将本仓库内容合并到你的 SillyTavern 根目录后，确认 `src/server-startup.js` 里已注册路由：

```js
import { router as kgSidecarRouter } from './endpoints/kg-sidecar.js';
app.use('/api/kg-sidecar', kgSidecarRouter);
```

然后重启 SillyTavern。

## 仓库说明

当前仓库是发布版，不包含测试工具和测试数据。  
如果你要做开发和回归，建议在你的开发仓库里保留测试目录与回归脚本。

## License

AGPL-3.0（见 `LICENSE`）。
