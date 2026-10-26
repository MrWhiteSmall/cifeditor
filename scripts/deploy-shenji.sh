#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f packages/web/dist/index.html || { echo '请先构建 packages/web/dist' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo '请先提交源码与部署配置' >&2; exit 1; }
revision=$(git rev-parse HEAD)
release="/mnt/slurm-data/lusj/cifeditor/releases/${revision}"
ssh shenji "mkdir -p '${release}' /mnt/slurm-data/lusj/cifeditor/shared/{sessions,uv-cache}"
rsync -az --exclude=.git --exclude=.cache --exclude=node_modules --exclude=target \
  --exclude=.venv --exclude=artifacts --exclude=__pycache__ --exclude=.pytest_cache \
  --exclude=.ruff_cache --exclude=external ./ "shenji:${release}/"
ssh shenji bash -s -- "$revision" <<'REMOTE'
set -euo pipefail
root=/mnt/slurm-data/lusj/cifeditor
release="$root/releases/$1"
export UV_CACHE_DIR="$root/shared/uv-cache"
uv=/home/lusj/.local/bin/uv
python="$root/shared/venv/bin/python"
if [ ! -x "$python" ]; then
  "$uv" venv --python /home/lusj/.local/bin/python3.12 "$root/shared/venv"
fi
# CPU-only wheels avoid downloading CUDA libraries on this editor-only service.
"$uv" pip install --python "$python" 'torch==2.7.1+cpu' --no-deps --index-url https://download.pytorch.org/whl/cpu
if [ -d "$root/shared/wheels" ] && "$uv" pip install --python "$python" --no-index \
    --find-links "$root/shared/wheels" -e "${release}[mcp]"; then
  echo '已使用服务器本地依赖包完成安装'
elif ! "$uv" pip install --python "$python" -e "${release}[mcp]" --index-url https://mirrors.aliyun.com/pypi/simple/; then
  echo '镜像安装失败，使用官方 PyPI 重试' >&2
  "$uv" pip install --python "$python" -e "${release}[mcp]" --index-url https://pypi.org/simple
fi
"$uv" pip check --python "$python"
"$python" -c 'from annotation_studio.main import app; print(app.title)'
printf 'ANNOTATION_STUDIO_REVISION=%s\n' "$1" > "$root/shared/release.env"
ln -sfn "$release" "$root/current"
mkdir -p "$HOME/.config/systemd/user"
cp "$release/ops/shenji/cifeditor.service" "$HOME/.config/systemd/user/cifeditor.service"
systemctl --user daemon-reload
systemctl --user enable cifeditor.service
systemctl --user restart cifeditor.service
for attempt in {1..30}; do
  if curl --fail --silent http://192.168.22.7:7864/api/v1/health; then
    printf '\nhttp://192.168.22.7:7864/?lang=zh-CN\n'
    exit 0
  fi
  sleep 1
done
journalctl --user -u cifeditor.service -n 40 --no-pager
exit 1
REMOTE
