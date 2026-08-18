############################
# 构建阶段：装依赖 + 编译 TS + 编译原生模块
############################
FROM node:22-bookworm AS builder

WORKDIR /app/server

# npm 用国内镜像（无外网/慢网友好）
# 注意：npm(node22 自带的 npm10+) 已移除 disturl 配置项，改用环境变量供 node-gyp 读取
ENV npm_config_registry=https://registry.npmmirror.com \
    npm_config_disturl=https://npmmirror.com/mirrors/node
RUN npm config set registry https://registry.npmmirror.com

# 先拷贝依赖清单，利用层缓存
COPY server/package.json server/package-lock.json ./

# 装全部依赖（含 devDependencies，编译 TS 需要）
# better-sqlite3 / sharp 会在此阶段用 bookworm 自带工具链本地编译
RUN npm install

# 拷贝源码 + 编译
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# 剪枝：只保留 production 依赖（原生 .node 已编译好，保留）
RUN npm prune --omit=dev


############################
# 运行阶段：精简镜像
############################
FROM node:22-bookworm-slim AS runtime

# sharp 运行期依赖（libvips 由 sharp 0.33 自带预编译二进制，无需额外 apt）
# 时区数据 + ca 证书（HTTPS 音源）
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    RO_SERVER_HOST=0.0.0.0 \
    RO_SERVER_PORT=23330 \
    RO_DB_DIR=/app/data/db

WORKDIR /app/server

# 从构建阶段拷贝已编译产物与 production 依赖
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./package.json

# 静态前端（相对 ROOT_DIR=/app 解析）
COPY web /app/web

# 容器内 /app 布局对齐代码里的 ROOT_DIR(=server/../..)：
#   /app/config/config.yaml  /app/data/{downloads,sources,db}  /app/web
# config/ 与 data/ 通过 volume 从宿主机映射进来（见 compose）
# 复制默认配置（用户可挂载覆盖）
COPY config.example.yaml /app/config/config.yaml
RUN mkdir -p /app/data/downloads /app/data/sources /app/data/db

EXPOSE 23330

# 健康检查：status 接口（鉴权开启时返回 401 也算存活，用 000/连接失败判定宕机）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RO_SERVER_PORT||23330)+'/api/v1/status').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
