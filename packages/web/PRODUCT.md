# CIF Editor

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

基于 AtomWorks Studio 开源源码二次开发，编辑 PDB/CIF 结构，并允许 Agent 通过 MCP 编辑网页中的同一份文档。用户明确要求中英文、可切换主题、shenji 部署与 `/mcp` 可视化管理入口。

## Operating Context

现有应用使用 FastAPI、原生 TypeScript 和 Vite。MCP 使用官方 Python SDK 的 stdio 传输，通过编辑器 HTTP API 共享会话与版本。

## Capabilities and Constraints

保留显式会话 ID、版本冲突检测、撤销和科学校验。管理页展示实际注册的工具与参数、当前身份可见的会话、服务状态及可复制的连接配置。不把管理页描述为 HTTP MCP 端点。

推断，待用户进一步确认：管理页主要服务于连接和检查此编辑器的用户；首版聚焦查看与连接，页面内工具试调用未确定。这些范围来自实现提议，用户尚未单独确认。

## Brand Commitments

延续现有编辑器界面、中文与英文、深浅色和蓝/青/紫主题，不重新设计编辑器。

## Evidence on Hand

工具定义来自 `../mcp/cifeditor_mcp/server.py`；会话与健康状态来自现有服务。不得编造在线 Agent 数量或调用日志。
