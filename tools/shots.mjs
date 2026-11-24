// Renders the screenshots listed in shots.json from the game's staged ?shot= scenes
// (headless Chromium, software GL is fine) into screenshots/ as JPEGs under 256 KiB.
//   node tools/shots.mjs     (playwright devDependency; see tools/audit.mjs)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(join(here, 'game'));
const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));

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

const dir = join(here, 'screenshots');
const wanted = new Set(shots.map((s) => s.name));
// ONLY=1-chase.jpg renders just that one (while iterating on a scene); a full run prunes strays
const only = process.env.ONLY ?? null;
if (!only) for (const f of readdirSync(dir)) if (!wanted.has(f)) unlinkSync(join(dir, f));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of shots.filter((x) => !only || x.name === only)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror', s.name, String(e)));
  await page.goto(`http://127.0.0.1:${port}/${s.query}`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 240000 });
  for (const quality of [88, 80, 72, 64]) {
    await page.screenshot({ path: join(dir, s.name), type: 'jpeg', quality });
    const size = statSync(join(dir, s.name)).size;
    if (size <= 250 * 1024) { console.log(`${s.name} ${size} B (q${quality})`); break; }
  }
  await page.close();
}
await browser.close();
server.close();
