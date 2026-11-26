# Образ сервера Sky Guide. Собранный сайт (web/dist) подключает deploy в WEB_DIST
# Зависимости ставятся в полном node:22: в нём есть git, он нужен npm, чтобы поставить @sky-guide/core
# с GitHub по тегу (github:…#vX.Y.Z). В рабочий образ (slim, без git) копируется только готовый node_modules
FROM node:22 AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data ICONS_DIR=/app/db/icons PACKS_DIR=/app/packs WEB_DIST=/app/web AUTH_LOCAL=0
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY openapi.yaml ./
RUN mkdir -p data packs db/icons web && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
