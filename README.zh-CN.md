# CIF Editor 中文分支

基于 [RosettaCommons/atomworks-studio](https://github.com/RosettaCommons/atomworks-studio) **v0.0.1** 的独立开发分支，用于复现 NVIDIA RFD4 Space 内的 CIF 编辑器，并加入 PDB 导入、中文和主题设置。无需 RFD4 模型权重或 GPU 推理服务。

- 本仓库：`git@gitee.com:lushengjie/cifeditor.git`
- 开发分支：`feat/pdb-i18n-themes`
- 上游基线：`4b419ebd327405035c8cf6ccde7f333d0878888e`
- 原始快照分支：`upstream-v0.0.1`。通过对应提交的 GitHub 源码归档导入，不包含上游完整 Git 历史。
- Space 来源：`nvidia/rfd4-proteina-zerogpu`，提交 `7bc2ea4ce8d06dcda02941e30caa17829f3f26f2`。

## 已实现

**打开/合并结构**接受 `.pdb`、`.ent`、`.cif`、`.mmcif`。PDB 通过 AtomWorks 自带的解析器转为 CIF，然后进入原有的导入预设、查看、选择、标注、结构编辑和撤销流程。保存为带标注的 CIF，暂不提供导出 PDB。

**偏好设置**提供简体中文/English、深色/浅色/跟随系统，以及蓝色/青绿色/紫色主题。设置保存在浏览器中；也可使用 `?lang=zh-CN` 或 `?lang=en` 指定界面语言。

切换主题立即生效。切换语言会重新载入界面并恢复当前服务端文档、已应用的编辑和撤销记录；临时选择、视角和未应用的表单草稿不保留，请先应用草稿。

## 从源码构建和运行

需要 Python 3.12、uv、Node（上游推荐 `.node-version` 中的 22.22.0）、pnpm 11.16.0、Rust（`rust-toolchain.toml`）和 wasm-pack。前端依赖包含仓库内已有的 Patinae 包，不需重新下载其源码。

```bash
git clone --branch feat/pdb-i18n-themes git@gitee.com:lushengjie/cifeditor.git
cd cifeditor
uv sync --frozen
pnpm install --frozen-lockfile
wasm-pack build packages/core --target web --out-dir ../web/src/wasm --no-opt -- --locked
pnpm --dir packages/web exec tsc --noEmit
pnpm --dir packages/web exec vite build
ANNOTATION_STUDIO_PORT=7864 bash run.sh
```

打开 <http://127.0.0.1:7864/>。首次安装需要下载 Python 科学计算依赖。若使用镜像，请按本机网络设置 uv、pnpm、rustup 的镜像地址。

本次工作区还提供了外层 `../start.sh`，使用已锁定的本地 editable 源码环境，默认端口为 7864。前端改动后需重新构建 `packages/web/dist`，后端改动后重启服务。直接 `pip install atomworks-studio` 安装的是官方发行版，不含本分支改动。

## 验证

```bash
uv run --with pytest --with httpx pytest -q tests/test_pdb_import.py tests/test_import_options.py tests/test_api.py
node --test packages/web/tests/*.test.ts
pnpm --dir packages/web exec tsc --noEmit
```

PDB 回归覆盖原子身份/坐标、多模型转换、CIF 自定义字段原样保留、非法输入、版本化 API、标注、导出重读及撤销。浏览器检查覆盖 Mol* 渲染、主题和语言设置。

## 范围与许可

- PDB 转换遵循 AtomWorks 解析规则，可能规范化链标识和替代构象等信息；不承诺逐字保留 PDB 元数据。转换本身不补全缺失原子，后续是否补全由导入选项决定。
- 多模型在转换阶段保留；进入编辑器后遵循原有模型/组装体选择规则。
- 中文覆盖编辑器主界面及主要操作。Mol* / Patinae 的内部菜单、帮助文档、部分后端科学校验消息仍为英文。CIF 字段、残基代码、查询语法和提交参数保持原格式。
- 主题修改应用界面；三维画布背景继续由查看器的背景设置控制。
- 本分支未验证所有 PyMOL、VS Code、WebGPU 和模型生成流程。
- 保留原项目 [BSD-3-Clause 许可证](LICENSE.md) 和第三方声明。RFD4 随包定义的许可见 [其 LICENSE](providers/rfd4/atomworks_studio_rfd4/_upstream/LICENSE)。
