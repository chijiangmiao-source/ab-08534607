# 束流诊断柜 · 读出通道频段分配

束流诊断柜改接后，为相互干扰的读出通道分配**尽可能少**的频段。问题建模为图着色：
通道为顶点、干扰关系为无向边，最少频段数即图色数 χ。

## 功能

- 录入 **2~26 个**唯一通道标识（单个大写字母 A-Z）与**至多 120 条**无向干扰关系；
- 提交后在浏览器 **Web Worker** 中以**确定性 DSATUR 分支定界**精确判定色数：
  - 已知可行上界：贪心 DSATUR 染色；
  - 可证明下界：最大团尺寸的贪心下界；
  - 剪枝：标准 Brelaz 新色截断 + 未染色子图团下界剪枝；上界等于下界即判定最优；
  - 不使用贪心充数、随机搜索或全量枚举；
- 展示最少频段数、按通道标识升序裁决的**规范频段编号**（频段按其最小组员升序编号），
  以及各频段内不存在干扰边的通道清单，并提供**复算校验**按钮；
- 结果与录入顺序无关：三角冲突 → 3，四通道完全冲突 → 4，二分链式 → 2；
- 编辑、取消或再次提交时，任务代际（epoch）机制使迟到的旧任务回包被丢弃，
  不覆盖当前草稿或新结论；
- 自环、重复关系、不存在端点、数量越界等输入错误**定位到行/项**提示，并清除既有成功证据。

## 本地运行测试

```bash
node --test test/
```

测试覆盖：规格基准情形（三角形/K4/链式）、录入重排一致性、Grötzsch 图（无三角形 χ=4）、
K16（恰 120 边）、400 个随机图与独立朴素精确解交叉验证、全部输入校验分支、复算校验。

## Docker 构建与 Compose 运行

```bash
# 构建镜像（构建阶段会对全部前端 JS 做语法检查，失败即构建失败）
docker build -t band-assignment .

# 运行（端口可配，默认 8080；容器内健康检查 /healthz）
PORT=9000 docker compose up web
# 访问 http://localhost:9000
```

## 验证服务（verify）

`verify` 服务依次执行：构建检查（JS 语法）→ 代码测试（围绕三角冲突、输入重排等）→
页面 HTTP 冒烟（首页、三个 JS 模块、健康检查端点），完成后退出并以退出码报告结果：

```bash
docker compose up --exit-code-from verify verify
echo $?   # 0 = 全部通过
```

## 文件结构

```
index.html            页面
src/main.js           主线程：录入校验、Worker 生命周期、任务代际与渲染
src/worker.js         Web Worker 入口
src/coloring.js       核心：解析校验 + 确定性 DSATUR 分支定界 + 复算校验（页面与测试共用）
test/coloring.test.js node:test 测试套件
verify.sh             verify 服务入口脚本
Dockerfile            多阶段：assets（构建检查）→ nginx 运行镜像
nginx.conf.template   nginx 模板（监听 ${PORT}，含 /healthz）
docker-compose.yml    web（端口可配 + 健康检查）与 verify 服务
```
