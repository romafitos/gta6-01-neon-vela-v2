// Automated audit for Neon Vela (run outside the game; not shipped in game/).
//   node tools/audit.mjs            serves game/ on a free localhost port and drives headless Chromium
// Env: PW_PATH = path to the playwright package (default /tmp/pw/node_modules/playwright),
//      PLAY_SECONDS = length of the scripted free-play soak (default 30).
// Asserts: no request leaves localhost, zero console errors, Play works on the first click,
// movement / sprint / look / enter / drive / steer / exit / pause / map all change state, and a
// wall-and-corner bot (on foot and in a car) never ends up inside geometry or stuck.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../game', import.meta.url)));
const PW = process.env.PW_PATH ?? '/tmp/pw/node_modules/playwright/index.js';
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 30);
const pwModule = await import(PW.endsWith('.js') ? PW : join(PW, 'index.js'));
const chromium = pwModule.chromium ?? pwModule.default.chromium;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, normalize(p)));
  if (!file.startsWith(root + sep) && file !== root) return res.writeHead(403).end();
  try { statSync(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const external = [];
const errors = [];
await page.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
  external.push(u.href);
  return route.abort();
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/?audit=1`);
await page.waitForFunction(() => window.__game && window.__game.screen === 'title', null, { timeout: 30000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const pstate = () => G(() => { const p = window.__game.game.player.state; return { x: p.x, z: p.z, inCar: !!p.car, speed: p.car ? p.car.speed : Math.hypot(p.vx, p.vz), heading: p.heading, rescues: p.stuckRescues }; });
const insideGeometry = () => G(() => { const g = window.__game.game; const p = g.player.state; return g.world.collision.overlaps(p.x, p.z, 0.3); });

// 1. Play responds to the first click
check('title screen shown on load', await page.isVisible('#play-btn'));
check('spawn is clear of geometry', !(await insideGeometry()));
await page.click('#play-btn');
await page.waitForTimeout(300);
check('Play starts gameplay on the FIRST click', (await G(() => window.__game.screen)) === 'play');
check('HUD visible in play', await page.isVisible('#hud'));

// 2. on-foot controls
let a = await pstate();
await hold(['KeyW'], 1500);
let b = await pstate();
const walked = Math.hypot(b.x - a.x, b.z - a.z);
check('W moves the player', walked > 3, `${walked.toFixed(2)} m in 1.5 s`);
a = await pstate();
await hold(['ArrowLeft'], 800);
b = await pstate();
check('Arrow keys move the player', Math.hypot(b.x - a.x, b.z - a.z) > 1);
await page.keyboard.down('KeyW');
await page.waitForTimeout(400);
const walkSpeed = (await pstate()).speed;
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(600);
const sprintSpeed = (await pstate()).speed;
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
check('Shift sprint is faster than walking', sprintSpeed > walkSpeed + 2, `walk ${walkSpeed.toFixed(1)} vs sprint ${sprintSpeed.toFixed(1)} m/s`);
const yaw0 = await G(() => window.__game.game.cam.state.yaw);
await page.mouse.move(640, 360);
await page.mouse.move(840, 360, { steps: 8 });
await page.waitForTimeout(100);
const yaw1 = await G(() => window.__game.game.cam.state.yaw);
check('mouse turns the camera', Math.abs(yaw1 - yaw0) > 0.2, `yaw Δ ${(yaw1 - yaw0).toFixed(2)} rad`);

// 3. enter / drive / steer / exit
await G(() => { const g = window.__game.game; const c = g.spawnCar; g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4); });
await page.waitForTimeout(100);
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
check('E enters a nearby car', (await pstate()).inCar);
// point the car down an open road before driving
await G(() => { const g = window.__game.game; const c = g.player.state.car; const L = g.world.layout; c.x = L.roadX[2]; c.z = L.roadZ[3] + 4.5; c.heading = Math.PI / 2; c.vx = c.vz = 0; });
a = await pstate();
await hold(['KeyW'], 2200);
b = await pstate();
check('W accelerates the car', b.speed > 8 && Math.hypot(b.x - a.x, b.z - a.z) > 10, `${(b.speed * 3.6).toFixed(0)} km/h, ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} m`);
const h0 = b.heading;
await hold(['KeyW', 'KeyA'], 700);
const h1 = (await pstate()).heading;
check('A/D steer the car', Math.abs(h1 - h0) > 0.3, `heading Δ ${(h1 - h0).toFixed(2)} rad`);
await hold(['KeyS'], 2500);
await page.keyboard.press('KeyF');
await page.waitForTimeout(250);
const out = await pstate();
check('F exits the car', !out.inCar, `speed before exit ${Math.abs(b.speed).toFixed(1)}`);
check('exit position is clear of geometry', !(await insideGeometry()));

// carjack a traffic car
const jacked = await G(() => {
  const g = window.__game.game;
  const c = g.vehicles.cars.find((x) => x.driver === 'ai');
  if (!c) return null;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4);
  c.vx = c.vz = 0;
  const before = g.stats.carjacks;
  g.input.clear();
  return before;
});
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
const afterJack = await G(() => window.__game.game.stats.carjacks);
check('E carjacks a traffic car (driver ejected)', jacked !== null && afterJack === jacked + 1 && (await pstate()).inCar);
await hold(['KeyS'], 800);
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);

// 4. pause and map
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Esc pauses', (await G(() => window.__game.screen)) === 'paused' && (await page.isVisible('#pause')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Esc resumes', (await G(() => window.__game.screen)) === 'play');
await page.keyboard.press('KeyM');
await page.waitForTimeout(150);
const big = await G(() => window.__game.game.minimap.isBig());
await page.keyboard.press('KeyM');
check('M toggles the big map', big && !(await G(() => window.__game.game.minimap.isBig())));

// 5. wall + corner bot on foot: 12 building corners, push diagonally into each, then walk away
const corners = await G(() => {
  const L = window.__game.game.world.layout;
  return L.buildings.filter((_, i) => i % Math.max(1, Math.floor(L.buildings.length / 12)) === 0).slice(0, 12)
    .map((bd) => ({ x: bd.maxX + 1.2, z: bd.maxZ + 1.2 }));
});
let footInside = 0;
let footStuck = 0;
for (const c of corners) {
  await G((c) => { const g = window.__game.game; g.player.placeAt(c.x, c.z); g.cam.state.yaw = Math.PI * 1.25; }, c);
  // camera yaw 1.25π looks toward -x,-z: W drives the player into the corner, A/D scrape the walls
  for (const keys of [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'ShiftLeft']]) {
    await hold(keys, 350);
    if (await insideGeometry()) footInside++;
  }
  const before = await pstate();
  await hold(['KeyS'], 700);
  const after = await pstate();
  if (Math.hypot(after.x - before.x, after.z - before.z) < 1.5) footStuck++;
}
check('corner bot (foot): never inside geometry', footInside === 0, `${corners.length} corners × 4 pushes, ${footInside} inside`);
check('corner bot (foot): always walks free', footStuck === 0, `${footStuck} stuck`);

// 6. car into walls: ram 6 buildings, then reverse away
let carInside = 0;
let carStuck = 0;
const rams = corners.slice(0, 6);
await G(() => { const g = window.__game.game; const c = g.spawnCar; g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4); });
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
for (const c of rams) {
  await G((c) => { const g = window.__game.game; const car = g.player.state.car; car.x = c.x + 8; car.z = c.z + 8; car.heading = Math.PI * 1.25; car.vx = car.vz = 0; }, c);
  await hold(['KeyW'], 1600);
  const inside = await G(() => {
    const g = window.__game.game; const car = g.player.state.car; const col = g.world.collision;
    const fx = Math.sin(car.heading); const fz = Math.cos(car.heading);
    return [1, 0, -1].some((s) => col.overlaps(car.x + fx * 1.25 * s, car.z + fz * 1.25 * s, 0.7));
  });
  if (inside) carInside++;
  const before = await pstate();
  await hold(['KeyS'], 1500);
  const after = await pstate();
  if (Math.hypot(after.x - before.x, after.z - before.z) < 1.5) carStuck++;
}
check('car ram bot: body never inside a building', carInside === 0, `${rams.length} rams, ${carInside} inside`);
check('car ram bot: always reverses free', carStuck === 0, `${carStuck} stuck`);
await hold(['KeyS'], 600);
await page.keyboard.press('KeyE');

// 7. scripted free play soak: random held keys and mouse sweeps
await G(() => { window.__game.perf.frameMs.length = 0; });
const errorsBefore = errors.length;
const keysPool = [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'ShiftLeft'], ['KeyS'], ['KeyE'], ['KeyW', 'Space']];
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const t0 = Date.now();
let maxInside = 0;
while (Date.now() - t0 < PLAY_SECONDS * 1000) {
  const keys = keysPool[Math.floor(rnd() * keysPool.length)];
  if (keys[0] === 'KeyE') await page.keyboard.press('KeyE');
  else await hold(keys, 400 + rnd() * 900);
  await page.mouse.move(400 + rnd() * 480, 300 + rnd() * 120, { steps: 4 });
  const st = await pstate();
  if (!st.inCar && (await insideGeometry())) maxInside++;
}
const perf = await G(() => {
  const a = [...window.__game.perf.frameMs].sort((x, y) => x - y);
  return { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)], info: window.__game.renderInfo() };
});
check(`free-play soak ${PLAY_SECONDS}s: zero new console errors`, errors.length === errorsBefore);
check('free-play soak: never inside geometry', maxInside === 0);
console.log(`PERF frames=${perf.n} median=${perf.median?.toFixed(1)}ms p95=${perf.p95?.toFixed(1)}ms drawCalls=${perf.info.calls} tris=${perf.info.triangles}`);

check('no request left localhost', external.length === 0, external.slice(0, 3).join(', '));
check('zero console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
