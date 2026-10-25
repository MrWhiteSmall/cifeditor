# 中文分支验证记录

验证日期：2026-10-25。基于上游 v0.0.1，源码快照提交详见 [中文说明](../README.zh-CN.md)。

## 自动检查

- Rust/WASM：`wasm-pack build packages/core --target web --out-dir ../web/src/wasm --no-opt -- --locked` 构建成功。
- 前端：TypeScript 类型检查与 Vite 生产构建通过；生成版本化 API 类型。
- 前端单元测试：`node --test packages/web/tests/*.test.ts`，39 项通过。
- 后端：`pytest -q tests/test_pdb_import.py tests/test_import_options.py tests/test_api.py`，39 项通过。
- Python 变更：Ruff 检查通过；Git diff 空白检查通过。

PDB 测试涵盖大小写扩展名、ENT、多模型、原子身份和坐标、非法/空文件、错误编码、不支持的后缀、API 转换、直接导入、标注、CIF 导出重读及撤销。已有 CIF 自定义类别保持原样。

语言测试涵盖保存偏好、不可用存储、浏览器语言回退、英文回退、科学字段和插值内容保留，以及示例链接切换语言后恢复编辑会话。

本机使用 Python 3.12、Node 26.9.0、pnpm 11.16.0、Rust 1.97.1、wasm-pack 0.15.0。Node/wasm-pack 与上游建议版本有所不同。Vite 报告已有 Mol* 大文件及视频编码依赖的浏览器外置模块警告；未观察到本次查看/标注流程失败。

## 浏览器检查

使用 Edge，访问本机 7864 端口：

1. 加载 inverse folding 示例，Mol* 显示结构。
2. 选择第一个残基并应用序列条件，显示 1 个残基的条件与 1/10 撤销记录。
3. 切换 English，恢复相同文档、989 个原子、标注与 1/10 撤销记录；切回中文仍保留。
4. 浅色/青绿色和深色/紫色设置生效；切换语言后主题偏好保留。
5. 390 × 844 下偏好面板可见，页面宽度与文档宽度均为 390；恢复默认桌面视口。
6. 当前浏览器页面没有捕获到警告或错误日志。

浏览器文件选择上传未完成：Edge 扩展没有启用“允许访问文件网址”，文件选择 API 拒绝上传。未更改扩展权限。PDB 上传路径通过进程内 HTTP TestClient 覆盖；不将其描述为浏览器上传端到端测试。

未运行全部 PyMOL、VS Code、WebGPU、视频导出或模型生成验收。内置样例存在上游已记录的未定位原子；测试通过不代表输入满足全部科学设计约束。
