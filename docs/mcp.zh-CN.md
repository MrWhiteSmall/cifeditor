# CIF Editor MCP

MCP 适配层位于 `packages/mcp/cifeditor_mcp`，通过 HTTP 调用现有编辑器，不建立第二份文档状态。官方 Python MCP SDK 版本由 `uv.lock` 锁定，运行时使用 stdio。

## 可视化管理

打开编辑器同源的 `/mcp`（例如 `http://192.168.22.7:7864/mcp?lang=zh-CN`），也可以从编辑器 **Agent / MCP → MCP 管理** 进入。

管理页包含服务健康状态、实际注册的工具和输入 JSON Schema、当前身份可见的共享会话，以及本机/SSH 两种 stdio 客户端配置生成与复制。支持中文/英文、深浅色与主题色；每 15 秒刷新状态和会话，隐藏页面时暂停。

`GET /api/v1/mcp` 从官方 SDK 读取工具定义；`GET /api/v1/sessions` 仅列出当前身份拥有的会话元数据，兼容重启后的持久化会话。列表不会加载完整结构、刷新会话有效期或暴露其他身份的文档。未启用身份代理时，沿用编辑器原有的单用户 `local` 模式。

`/mcp` 是网页管理入口，**不是 HTTP MCP 协议端点**。状态显示编辑器 API 和适配器安装情况；当前不提供 Agent 进程管理、在线连接数量、调用历史或页面内工具执行。JSON 配置适用于采用 `mcpServers` 的客户端；其他客户端需按其配置格式转换。页面不会写入任何 Agent 客户端设置。

## 连接

源码环境安装：

```bash
uv sync --python 3.12 --frozen --extra mcp
# 终端一：编辑器
uv run --python 3.12 --frozen --extra mcp atomworks-studio --host 127.0.0.1 --port 7864
# MCP 客户端会自动启动以下进程，通过 stdin/stdout 通信
uv run --python 3.12 --frozen --extra mcp atomworks-studio-mcp --editor-url http://127.0.0.1:7864
```

常见 MCP 客户端的 JSON 配置（将可执行文件路径替换为实际环境）：

```json
{
  "mcpServers": {
    "cifeditor": {
      "command": "/absolute/path/to/venv/bin/atomworks-studio-mcp",
      "args": ["--editor-url", "http://192.168.22.7:7864"]
    }
  }
}
```

也可以让 MCP 客户端通过 SSH 在 shenji 上启动 stdio 适配器，无需开放额外监听端口：

```json
{
  "mcpServers": {
    "cifeditor": {
      "command": "ssh",
      "args": [
        "-T", "shenji",
        "/mnt/slurm-data/lusj/cifeditor/shared/venv/bin/atomworks-studio-mcp",
        "--editor-url", "http://192.168.22.7:7864"
      ]
    }
  }
}
```

`CIFEDITOR_URL` 可替代命令行地址；默认值为 `http://127.0.0.1:7864`。如果现有反向代理需要 Bearer Token，可通过进程环境 `CIFEDITOR_API_TOKEN` 提供。它不替代后端的鉴权配置，不要把代理信任的身份头交给工具参数。编辑器地址由启动配置固定，Agent 工具不能修改请求目标。此版本没有新增公开 HTTP MCP 服务。

## 使用同一个文档

1. 在网页打开 PDB/CIF，展开右上角 **Agent / MCP**，复制会话 ID；也可以从页面地址的 `session=` 获取。
2. 告诉 Agent：“使用会话 `<session_id>`，先检查链和残基，再把 A 链第 10–20 号残基设为热点，校验并导出 CIF。”
3. Agent 调用 `inspect_session`、`editor_schema`，确认实际链名、残基编号及条件。摘要的 `chain_identifiers` 返回显示链名、原始链名和准确查询条件。例如显示的 `A_1` 对应 `chain_iid == 'A_1'`，原始 `chain_id` 可能是 `A`。直接用返回的 `query` 再加残基条件进行预览，避免选到其他组装体副本。
4. 用选择返回的原子索引和 `revision` 调用 `set_condition`。网页约两秒内更新。
5. 调用 `validate_structure`、`export_cif`。导出结果包含实际 CIF、校验问题和对应版本，Agent 应报告问题并通过客户端自身的文件能力保存结果。

也可用 `open_structure(filename, content)` 直接导入文件文本，返回新会话和 `editor_url`。打开这个链接即可查看 Agent 编辑的同一份文档。第一版不直接读取任意本地路径，也不写任意服务器文件；由 Agent 所在客户端负责读取输入文本和保存导出的 CIF。

## 工具

| 工具 | 用途 |
|---|---|
| `editor_schema` | 查看条件、值类型、键类型和导入设置 |
| `open_structure` | 导入 PDB/ENT/CIF/mmCIF 文本，新建文档 |
| `inspect_session` | 查看/绑定已有文档、实际链名、序列和版本 |
| `query_selection` | 使用 AtomWorks 表达式或路径预览原子选择及版本 |
| `set_condition` | 设置或移除条件，例如 hotspot |
| `rename_chain` | 给选中原子分配链标识 |
| `set_charge` | 设置/增减形式电荷 |
| `edit_bond` | 添加或移除原子间的键 |
| `delete_atoms` | 删除预览选择的原子 |
| `edit_group` | 新建、调整或删除条件分组 |
| `undo` | 撤销该共享文档的最后一次修改 |
| `validate_structure` | 科学校验并返回问题 |
| `export_cif` | 校验并导出同一个冻结版本的 CIF |

## 一致性与限制

编辑工具必须显式指定 `session_id` 和 `expected_revision`，不维护易混淆的全局“当前文档”。工具通过 `If-Match: "<revision>"` 传递版本，后端在文档锁内检查并执行；冲突返回 `409 revision_conflict`，不做自动重试。临时选择对应特定版本，每次结构编辑后必须重新查询。

涉及丢弃保存的坐标目标时，原有 `target_discard_confirmation_required` 仍会返回。MCP 不自动确认；根据用户意图解释影响后，才能用返回的版本及 `allow_target_discard=true` 重试。

网页只在版本变化时获取同锁的 CIF/摘要快照，防止摘要和渲染内容来自不同版本。外部修改会清除临时原子选择、视图表示和高亮。可以手动暂停同步以准备表单草稿；同步不合并未应用的草稿，也不共享相机视角。

会话存储现在保存完整文档、版本及有界撤销栈。兼容旧 CIF 快照，旧版本服务仍能读取新文件中的当前 CIF，但旧版本服务不会保留新增的版本/撤销信息。会话过期、关闭或被数量限制清理后，旧 ID 返回 404。需要长期保留的结果请下载。

MCP 提供当前工具清单中的编辑能力；这不等于修改任意 CIF 分类、蛋白质生成或分子模拟。科学校验通过也不代表生物学功能已经得到验证。

## 验证

```bash
uv run --python 3.12 --frozen --extra mcp --with pytest --with httpx pytest -q \
  tests/test_mcp.py tests/test_shared_sessions.py tests/test_api.py
node --test packages/web/tests/*.test.ts
```

协议测试通过官方 SDK 的内存传输执行真实工具发现和调用，并另外启动 stdio 子进程验证初始化。覆盖导入、选择、标注、导出重读、撤销、GUI/Agent 冲突、非法会话与参数。后端测试覆盖并发只提交一次、快照一致性、重启保留版本和撤销、旧存储兼容；前端测试覆盖会话切换后的过期响应、暂停、重叠检查和网络恢复。
