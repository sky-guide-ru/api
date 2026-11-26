// Подключается к серверу в тесте маршрутов (node --import): запоминает каждый маршрут Express
// и, когда сервер начал слушать порт, пишет их список в файл ROUTES_OUT.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const Router = require('router');
const use = Router.prototype.use;
Router.prototype.use = function (...args) {
  const before = this.stack.length;
  const out = use.apply(this, args);
  const p = typeof args[0] === 'string' ? args[0] : '/';
  for (const l of this.stack.slice(before)) l.__mount = p;
  return out;
};

function walk(stack, prefix, out) {
  for (const l of stack) {
    if (l.route) {
      const paths = [].concat(l.route.path);
      const methods = Object.keys(l.route.methods).filter(m => m !== '_all').map(m => m.toUpperCase());
      if (l.route.methods._all) methods.push('ALL');
      for (const p of paths) for (const m of methods) out.add(`${m} ${p instanceof RegExp ? `${prefix === '/' ? '' : prefix}${p}` : join(prefix, p)}`);
    } else if (l.handle?.stack && l.__mount) walk(l.handle.stack, join(prefix, l.__mount), out);
  }
}
const join = (a, b) => (a === '/' ? '' : a) + (b === '/' && a !== '/' && a ? '' : b) || '/';

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const app = this.listeners('request')[0];
    const out = new Set();
    if (app?.router?.stack) walk(app.router.stack, '/', out);
    fs.writeFileSync(process.env.ROUTES_OUT, JSON.stringify([...out].sort(), null, 1));
  });
  return listen.apply(this, args);
};
