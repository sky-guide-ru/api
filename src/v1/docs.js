// Страница Swagger: /api/docs. Файлы swagger-ui-dist отдаём сами (без внешних CDN — не зависим от блокировок),
// описание — openapi.yaml из корня репо (/api/docs/openapi.yaml).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const SPEC_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'openapi.yaml');
const UI_DIR = path.dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
const UI_FILES = new Set(['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'favicon-32x32.png', 'favicon-16x16.png']);

const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sky Guide API · Swagger</title>
<link rel="icon" type="image/png" href="/api/docs/favicon-32x32.png">
<link rel="stylesheet" href="/api/docs/swagger-ui.css">
<style>body{margin:0;background:#fafafa}.topbar{display:none}</style>
</head><body><div id="swagger-ui"></div>
<script src="/api/docs/swagger-ui-bundle.js"></script>
<script src="/api/docs/init.js"></script>
</body></html>`;

// Без встроенных скриптов в странице: так она работает и при строгой политике CSP
const INIT = `window.ui = SwaggerUIBundle({
  url: '/api/docs/openapi.yaml', dom_id: '#swagger-ui', deepLinking: true,
  persistAuthorization: true, tryItOutEnabled: false, displayRequestDuration: true,
  presets: [SwaggerUIBundle.presets.apis], layout: 'BaseLayout',
});`;

export function mountDocs(app) {
  const r = express.Router();
  const day = res => res.set('Cache-Control', 'public, max-age=3600');
  r.get('/', (req, res) => {
    if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/api/docs/');
    day(res).type('html').send(PAGE);
  });
  r.get('/init.js', (req, res) => day(res).type('application/javascript').send(INIT));
  r.get('/openapi.yaml', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300').set('Access-Control-Allow-Origin', '*');
    res.type('application/yaml; charset=utf-8').send(fs.readFileSync(SPEC_FILE, 'utf8'));
  });
  r.get('/:file', (req, res, next) => {
    if (!UI_FILES.has(req.params.file)) return next();
    res.set('Cache-Control', 'public, max-age=86400').sendFile(path.join(UI_DIR, req.params.file));
  });
  app.use('/api/docs', r);
}
