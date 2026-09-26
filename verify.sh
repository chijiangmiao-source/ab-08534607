#!/bin/sh
# verify 服务入口：构建检查 → 代码测试 → 页面 HTTP 冒烟。
# 任一环节失败即以非零退出码结束；全部通过则以 0 退出。
set -eu

WEB_URL="${WEB_URL:-http://web:8080}"

echo "== [1/3] 构建检查：前端 JS 语法（ES 模块） =="
node --check src/coloring.js
node --check src/worker.js
node --check src/main.js
node --check test/coloring.test.js
echo "构建检查通过"

echo "== [2/3] 代码测试：精确 DSATUR（三角冲突 / 输入重排一致性 / 校验定位等） =="
node --test test/
echo "代码测试通过"

echo "== [3/3] 页面 HTTP 冒烟：${WEB_URL} =="
html=$(wget -q -O - "${WEB_URL}/")
main_js=$(wget -q -O - "${WEB_URL}/src/main.js")
coloring_js=$(wget -q -O - "${WEB_URL}/src/coloring.js")
worker_js=$(wget -q -O - "${WEB_URL}/src/worker.js")
health=$(wget -q -O - "${WEB_URL}/healthz")

case "$html" in
  *"频段分配"*) ;;
  *) echo "冒烟失败：首页未包含预期标题" >&2; exit 1 ;;
esac
case "$html" in
  *'type="module"'*) ;;
  *) echo "冒烟失败：首页未以 ES 模块方式加载脚本" >&2; exit 1 ;;
esac
case "$main_js" in
  *"new Worker"*) ;;
  *) echo "冒烟失败：main.js 未包含 Worker 调用" >&2; exit 1 ;;
esac
case "$coloring_js" in
  *"solveColoring"*) ;;
  *) echo "冒烟失败：coloring.js 内容不符合预期" >&2; exit 1 ;;
esac
case "$worker_js" in
  *"onmessage"*) ;;
  *) echo "冒烟失败：worker.js 内容不符合预期" >&2; exit 1 ;;
esac
case "$health" in
  *ok*) ;;
  *) echo "冒烟失败：健康检查端点响应异常" >&2; exit 1 ;;
esac

echo "全部验证通过（构建检查 + 代码测试 + HTTP 冒烟）"
