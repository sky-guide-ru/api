# Образ сервера Sky Guide. Собранный сайт (web/dist) подключает deploy в WEB_DIST
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data ICONS_DIR=/app/db/icons PACKS_DIR=/app/packs WEB_DIST=/app/web AUTH_LOCAL=0
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p data packs db/icons web && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
