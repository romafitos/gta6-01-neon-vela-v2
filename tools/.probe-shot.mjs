import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
const root = resolve('/home/hatch/workspace/coding/gta6-01-r2/repo/game');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, normalize(p)));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try { statSync(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/?shot=chase`);
const t0 = Date.now();
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  const ready = await page.evaluate(() => window.__shotReady === true).catch(() => 'eval-fail');
  console.log(`${Math.round((Date.now() - t0) / 1000)}s ready=${ready}`);
  if (ready === true) break;
}
await page.screenshot({ path: '/tmp/probe-chase.jpg', type: 'jpeg', quality: 80 });
await browser.close(); server.close();
console.log('done');
