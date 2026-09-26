# syntax=docker/dockerfile:1

# ---- 构建检查阶段：对全部前端 JS 做 ES 模块语法检查，并汇集静态产物 ----
# 源码存在语法错误时构建失败；最终镜像的静态文件全部来自本阶段，
# 因此构建主镜像即隐含执行构建检查。
FROM node:20-alpine AS assets
WORKDIR /app
COPY package.json index.html ./
COPY src/ ./src/
COPY test/ ./test/
RUN node --check src/coloring.js \
 && node --check src/worker.js \
 && node --check src/main.js \
 && node --check test/coloring.test.js \
 && mkdir -p /static \
 && cp index.html /static/ \
 && cp -r src /static/

# ---- 运行阶段：nginx 托管静态页面，端口由 PORT 环境变量配置 ----
FROM nginx:alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=assets /static/ /usr/share/nginx/html/
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
