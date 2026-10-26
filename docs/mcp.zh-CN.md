# CIF Editor MCP

MCP 工具位于 `packages/mcp/cifeditor_mcp`，HTTP 接入位于 `packages/api/annotation_studio/mcp_http.py`。官方 Python MCP SDK 版本由 `uv.lock` 锁定，仅提供 **Streamable HTTP**。工具复用同一应用内的编辑器 API，不建立第二份文档状态。

## 可视化管理

打开编辑器同源的 `/mcp_manage`（例如 `http://192.168.22.7:7864/mcp_manage?lang=zh-CN`），也可以从编辑器 **Agent / MCP → MCP 管理** 进入。

管理页包含服务健康状态、实际注册的工具和输入 JSON Schema、当前身份可见的共享会话，以及 HTTP 客户端配置生成与复制。支持中文/英文、深浅色与主题色；每 15 秒刷新状态和会话，隐藏页面时暂停。

`GET /api/v1/mcp` 从官方 SDK 读取工具定义；`GET /api/v1/sessions` 仅列出当前身份拥有的会话元数据，兼容重启后的持久化会话。列表不会加载完整结构、刷新会话有效期或暴露其他身份的文档。未启用身份代理时，沿用编辑器原有的单用户 `local` 模式。

`/mcp` 是 Agent 协议端点，`/mcp_manage` 是管理网页。状态显示编辑器 API 和适配器安装情况；当前不提供 Agent 进程管理、在线连接数量、调用历史或页面内工具执行。页面不会写入任何 Agent 客户端设置。

## 连接

源码环境安装：

```bash
uv sync --python 3.12 --frozen --extra mcp
# 一个服务同时提供编辑器、管理页与 HTTP MCP
uv run --python 3.12 --frozen --extra mcp atomworks-studio --host 127.0.0.1 --port 7864
```

在 Agent 客户端选择 **Streamable HTTP**，填写 `http://192.168.22.7:7864/mcp`。客户端必须能够访问该内网地址。支持以下 `mcpServers` 格式的客户端可以使用：

```json
{
  "mcpServers": {
    "cifeditor": {
      "type": "http",
      "url": "http://192.168.22.7:7864/mcp"
    }
  }
}
```

不同客户端的配置格式可能不同，例如传输类型可能显示为 `http` 或 `streamable-http`；协议地址相同。无需本地 Python 进程或 SSH 启动命令，已移除原有 stdio CLI。直接用浏览器打开 `/mcp` 得到协议错误是正常的，应通过 MCP 客户端初始化。

HTTP 传输是无状态模式，文档仍通过显式 `session_id` 共享。工具在当前请求的身份下调用应用内 API，不访问由 Agent 指定的任意主机，也不会把某个用户的身份缓存给另一个用户。启用受信任代理身份时，代理需对 `/mcp` 和 `/api/` 同时鉴权并注入身份；不要让客户端自行提供受信任身份头。未启用时沿用编辑器原有的单用户 `local` 模式。

SDK 的 Host/Origin 检查保持开启。默认允许本机访问；部署其他地址时设置 `CIFEDITOR_MCP_ALLOWED_HOSTS`，以逗号分隔，例如 `192.168.22.7:7864,editor.example.com`。shenji 服务已配置其内网地址。代理必须保留或规范化 Host，允许的 Origin 使用这些主机的 HTTP(S) 地址。不新增任意跨域浏览器访问。

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
  tests/test_mcp_http.py tests/test_mcp.py tests/test_shared_sessions.py tests/test_api.py
node --test packages/web/tests/*.test.ts
```

协议测试通过官方 SDK 的 Streamable HTTP 客户端验证初始化、工具发现、导入、选择、标注、导出、撤销、GUI/Agent 版本冲突和不同身份隔离；同时校验 Host/Origin 与请求大小限制。保留工具层内存协议测试。后端测试覆盖并发只提交一次、快照一致性、重启保留版本和撤销、旧存储兼容；前端测试覆盖会话同步、HTTP 配置和协议请求绕过 Service Worker 缓存。
