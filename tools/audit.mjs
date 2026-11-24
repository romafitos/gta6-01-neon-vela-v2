// Automated audit for Neon Vela (run outside the game; not shipped in game/).
//   node tools/audit.mjs            serves game/ on a free localhost port and drives headless Chromium
// Env: PLAY_SECONDS = length of the scripted free-play soak (default 30).
// Playwright is a devDependency (package.json): `npm install` once, browsers resolve
// from the standard Playwright cache. No program is ever loaded from an env path.
// Asserts: no request leaves localhost, zero console errors, Play works on the first click,
// movement / sprint / look / enter / drive / steer / exit / pause / map all change state, and a
// wall-and-corner bot (on foot and in a car) never ends up inside geometry or stuck.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../game', import.meta.url)));
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 30);

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

// count AudioContexts the page makes: sound may only start inside the Play gesture (checkpoint 5)
await page.addInitScript(() => {
  const C = window.AudioContext; window.__ctxMade = 0;
  if (C) window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ctxMade++; } };
});
await page.goto(`http://127.0.0.1:${port}/?audit=1`);
await page.waitForFunction(() => window.__game && window.__game.screen === 'title', null, { timeout: 30000 });
const G = (fn, arg) => page.evaluate(fn, arg);
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const pstate = () => G(() => { const p = window.__game.game.player.state; const c = p.car; return { x: c ? c.x : p.x, z: c ? c.z : p.z, inCar: !!p.car, speed: p.car ? p.car.speed : Math.hypot(p.vx, p.vz), heading: p.heading, rescues: p.stuckRescues }; });
const insideGeometry = () => G(() => { const g = window.__game.game; const p = g.player.state; return g.world.collision.overlaps(p.x, p.z, 0.3); });

// 1. Play responds to the first click
check('title screen shown on load', await page.isVisible('#play-btn'));
check('spawn is clear of geometry', !(await insideGeometry()));
await page.waitForTimeout(1500); // the title runs a while: still no audio before the gesture
const audioBefore = await G(() => ({ made: window.__ctxMade, ctx: !!window.__game.game.audio.state.ctx }));
check('no AudioContext exists before the first gesture', audioBefore.made === 0 && !audioBefore.ctx, JSON.stringify(audioBefore));
await page.click('#play-btn');
await page.waitForTimeout(150);
check('Play starts gameplay on the FIRST click', (await G(() => window.__game.screen)) === 'play');
check('HUD visible in play', await page.isVisible('#hud'));
// software GL compiles shaders on the first play frames: let the simulation get going first
await page.waitForFunction(() => window.__game.game.stats.steps > 30, null, { timeout: 30000 });
const waitFor = (fn, ms = 4000, arg = null) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);

// 1b. Respect Ranks gate the arsenal and the crew slots (checkpoint 4)
await G(() => { const g = window.__game.game; window.__unlocks = []; g.addSystem({ onEvent(n, d) { if (n === 'unlock' || n === 'rankUp') window.__unlocks.push({ n, ...d }); } }); });
const lock0 = await G(() => { const g = window.__game.game; const w = g.weapons; return { shotgun: w.arsenal[4].owned, rifle: w.arsenal[5].owned, pick: w.select(4), slots: g.progression.state.crewSlots, rank: g.progression.state.rank }; });
check('start: Breaker 12 and Marlin Carbine are locked, 1 crew slot', !lock0.shotgun && !lock0.rifle && !lock0.pick && lock0.slots === 1, `rank ${lock0.rank}, select(shotgun) refused`);
const home0 = await G(() => { const p = window.__game.game.player.state; return { x: p.x, z: p.z, h: p.heading }; });
// slot cap: at Nobody only one hire
await G(() => { const g = window.__game.game; const m = g.crew.members[0]; g.player.placeAt(m.x + 1.5, m.z, 0); });
await page.keyboard.press('KeyC');
const hired1 = await waitFor(() => window.__game.game.crew.crew().length === 1, 9000);
await G(() => { const g = window.__game.game; const m = g.crew.members[1]; g.player.placeAt(m.x + 1.5, m.z, 0); });
await page.keyboard.press('KeyC');
await page.waitForTimeout(400);
const capped = await G(() => window.__game.game.crew.crew().length);
check('C recruits a crew member; the rank\'s slot cap refuses a second hire', hired1 && capped === 1, `crew ${capped}/1`);
// rank up through real respect: unlocks fire
await G(() => window.__game.game.progression.addRespect(95, 'audit'));
await waitFor(() => window.__game.game.progression.state.crewSlots === 3, 3000);
const lock1 = await G(() => { const g = window.__game.game; const w = g.weapons; const pick = w.select(4); w.select(2); return { shotgun: w.arsenal[4].owned, rifle: w.arsenal[5].owned, pick, slots: g.progression.state.crewSlots, rank: g.progression.state.rank, ev: window.__unlocks.map((u) => u.kind ? `${u.kind}:${u.id ?? u.slots}` : `rank:${u.rank}`) }; });
check('rank-up unlocks the locked weapons and crew slots (events fired)', lock1.shotgun && lock1.rifle && lock1.pick && lock1.slots === 3 && lock1.ev.includes('weapon:shotgun') && lock1.ev.includes('weapon:rifle') && lock1.ev.includes('crewSlot:3'), `${lock1.rank}: ${lock1.ev.join(', ')}`);
await G((h) => { const g = window.__game.game; g.crew.dismiss(g.crew.members[0]); g.player.placeAt(h.x, h.z, h.h); g.input.clear(); g.wantedSystem.clear(); g.police.standDown(); }, home0);
await page.waitForTimeout(300);

// 2. on-foot controls
let a = await pstate();
await page.keyboard.down('KeyW');
const tW = Date.now();
const movedW = await waitFor((s) => { const p = window.__game.game.player.state; return Math.hypot(p.x - s.x, p.z - s.z) > 3; }, 6000, a);
await page.keyboard.up('KeyW');
let b = await pstate();
check('W moves the player', movedW, `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m in ${((Date.now() - tW) / 1000).toFixed(1)} s`);
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
check('E enters a nearby car', await waitFor(() => !!window.__game.game.player.state.car));
// point the car down an open road before driving
await G(() => { const g = window.__game.game; const c = g.player.state.car; const L = g.world.layout; c.x = L.roadX[2]; c.z = L.roadZ[3] + 4.5; c.heading = Math.PI / 2; c.vx = c.vz = 0; });
a = await pstate();
await page.keyboard.down('KeyW');
await waitFor((s) => { const c = window.__game.game.player.state.car; return c.speed > 8 && Math.hypot(c.x - s.x, c.z - s.z) > 10; }, 8000, a);
await page.keyboard.up('KeyW');
b = await pstate();
check('W accelerates the car', b.speed > 8 && Math.hypot(b.x - a.x, b.z - a.z) > 10, `${(b.speed * 3.6).toFixed(0)} km/h, ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} m`);
const h0 = b.heading;
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
await waitFor((h) => Math.abs(window.__game.game.player.state.car.heading - h) > 0.3, 6000, h0);
await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
const h1 = (await pstate()).heading;
check('A/D steer the car', Math.abs(h1 - h0) > 0.3, `heading Δ ${(h1 - h0).toFixed(2)} rad`);
await hold(['KeyS'], 2500);
await page.keyboard.press('KeyF');
await waitFor(() => !window.__game.game.player.state.car);
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
await waitFor(() => !!window.__game.game.player.state.car);
const afterJack = await G(() => window.__game.game.stats.carjacks);
check('E carjacks a traffic car (driver ejected)', jacked !== null && afterJack === jacked + 1 && (await pstate()).inCar);
await hold(['KeyS'], 800);

// 4. pause and map
await page.keyboard.press('Escape');
check('Esc pauses', (await waitFor(() => window.__game.screen === 'paused')) && (await page.isVisible('#pause')));
// pause menu: six tabs, each renders its own panel; Q/E switch; the STATS tab has the ring + checklist
const tabs = await G(() => [...document.querySelectorAll('#pause .pm-tab')].map((b) => b.textContent));
check('pause menu shows MAP/STORY/STATS/CREW/CONTROLS/SAVE tabs', tabs.join(',') === 'MAP,STORY,STATS,CREW,CONTROLS,SAVE', tabs.join(','));
const statsTab = await G(() => ({ ring: !!document.querySelector('#pause .ring b'), pct: document.querySelector('#pause .ring b')?.textContent, rows: document.querySelectorAll('#pause .check li').length, career: document.querySelectorAll('#pause .career > div').length }));
check('STATS tab: completion % ring, 6-row checklist, career numbers', statsTab.ring && /%$/.test(statsTab.pct) && statsTab.rows === 6 && statsTab.career === 8, JSON.stringify(statsTab));
await page.keyboard.press('KeyE');
const storyRows = await G(() => document.querySelectorAll('#pause .story li').length);
check('E switches STATS to CREW', (await G(() => document.querySelector('#pause .pm-tab.on')?.textContent)) === 'CREW');
await page.keyboard.press('KeyQ');
await page.keyboard.press('KeyQ');
const story = await G(() => ({ tab: document.querySelector('#pause .pm-tab.on')?.textContent, rows: document.querySelectorAll('#pause .story li').length }));
check('STORY tab lists all 10 jobs', story.tab === 'STORY' && story.rows === 10, JSON.stringify(story));
void storyRows;
await page.click('#pause .pm-tab[data-tab="0"]');
const box = await page.locator('#pm-map').boundingBox();
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
const wp = await G(() => ({ marker: window.__game.game.minimap.markers.get('waypoint'), menu: window.__game.pauseMenu.state.waypoint }));
check('MAP tab: clicking the city map sets a waypoint on the minimap', !!wp.marker && !!wp.menu && Math.abs(wp.marker.x - wp.menu.x) < 0.01, wp.marker ? `x ${wp.marker.x.toFixed(0)} z ${wp.marker.z.toFixed(0)}` : 'none');
await page.click('#pause .pm-tab[data-tab="5"]');
await page.click('#pm-save');
const menuSaved = await G(() => { try { return !!JSON.parse(localStorage.getItem('neon-vela-save-v1')).savedAt; } catch { return false; } });
check('SAVE tab: Save now writes the save slot', menuSaved);
await page.keyboard.press('Escape');
check('Esc resumes', await waitFor(() => window.__game.screen === 'play'));
await page.waitForTimeout(400);
const cards = await G(() => ({ rank: document.getElementById('card-rank')?.textContent ?? '', cash: document.getElementById('hud-cash')?.textContent ?? '', vitals: document.querySelectorAll('#card-vitals .vrow').length, district: document.querySelector('#card-district .dname')?.textContent ?? '', speed: !document.getElementById('card-speed').classList.contains('hidden') && /KM\/H/.test(document.getElementById('card-speed').textContent) }));
check('card HUD: rank card, cash, vitals, district card, speedometer in a car', /RANK \d/.test(cards.rank) && /^\$/.test(cards.cash) && cards.vitals === 2 && cards.district.length > 3 && cards.speed, JSON.stringify(cards));
await page.keyboard.press('KeyM');
const big = await waitFor(() => window.__game.game.minimap.isBig());
await page.keyboard.press('KeyM');
check('M toggles the big map', big && (await waitFor(() => !window.__game.game.minimap.isBig())));

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
  await page.keyboard.down('KeyS');
  const freed = await waitFor((b) => { const p = window.__game.game.player.state; return Math.hypot(p.x - b.x, p.z - b.z) > 1.5; }, 4000, before);
  await page.keyboard.up('KeyS');
  if (!freed) footStuck++;
}
check('corner bot (foot): never inside geometry', footInside === 0, `${corners.length} corners × 4 pushes, ${footInside} inside`);
check('corner bot (foot): always walks free', footStuck === 0, `${footStuck} stuck`);

// 6. car into walls: ram 6 buildings, then reverse away
let carInside = 0;
let carStuck = 0;
const rams = corners.slice(0, 6);
// make sure we start on foot (a queued exit can fail while the jacked car is still rolling)
await G(() => { const g = window.__game.game; const c = g.player.state.car; if (c) { c.vx = c.vz = 0; c.speed = 0; g.exitCar(); } g.input.clear(); });
await G(() => { const g = window.__game.game; const c = g.spawnCar; g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4); });
await page.keyboard.press('KeyE');
check('ram bot boards its car', await waitFor(() => !!window.__game.game.player.state.car));
for (const c of rams) {
  await G((c) => { const g = window.__game.game; const car = g.player.state.car; const spot = g.world.layout.findClear(c.x + 8, c.z + 8, 2.6); car.x = spot.x; car.z = spot.z; car.heading = Math.PI * 1.25; car.vx = car.vz = 0; }, c);
  await page.keyboard.down('KeyW');
  await waitFor(() => window.__game.game.player.state.car.impacts > 0 || window.__game.game.player.state.car.lastImpact > 2, 5000);
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await G(() => { window.__game.game.player.state.car.impacts = 0; window.__game.game.player.state.car.lastImpact = 0; });
  const inside = await G(() => {
    const g = window.__game.game; const car = g.player.state.car; const col = g.world.collision;
    const fx = Math.sin(car.heading); const fz = Math.cos(car.heading);
    return [1, 0, -1].some((s) => col.overlaps(car.x + fx * 1.25 * s, car.z + fz * 1.25 * s, 0.7)) ? `car@${car.x.toFixed(1)},${car.z.toFixed(1)} h${car.heading.toFixed(2)}` : '';
  });
  if (inside) { carInside++; console.log('  inside:', inside); }
  const before = await pstate();
  await page.keyboard.down('KeyS');
  const freed = await waitFor((b) => { const c = window.__game.game.player.state.car; return Math.hypot(c.x - b.x, c.z - b.z) > 1.5; }, 5000, before);
  await page.keyboard.up('KeyS');
  if (!freed) carStuck++;
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


// 8. combat and police (checkpoint 2). Every check reads simulation state, not the HUD.
const reset = () => G(() => {
  const g = window.__game.game;
  const c = g.player.state.car; if (c) { c.vx = c.vz = 0; c.speed = 0; g.forceExit(c); }
  g.wantedSystem.clear(); g.police.standDown(); g.input.clear();
  g.player.state.health = 100;
  g.weapons.arsenal.forEach((_, i) => g.weapons.refill(i));
  if (g.wheel.state.open) g.wheel.close();
});
// an open stretch of beach: no traffic, a clear line of fire toward +x
const beach = await G(() => {
  const g = window.__game.game; const L = g.world.layout; const col = g.world.collision;
  for (let x = L.roadX[1]; x < L.roadX[7]; x += 7) {
    const z = L.bounds.beachStart + 34;
    if (!col.overlaps(x, z, 1) && col.clearLine(x, z, x + 16, z, 0.8)) return { x, z };
  }
  return { x: L.roadX[3], z: L.bounds.beachStart + 34 };
});
await reset();
const setupTarget = (dist) => G(({ beach, dist }) => {
  const g = window.__game.game;
  g.player.placeAt(beach.x, beach.z, Math.PI / 2);
  g.player.state.x = beach.x; g.player.state.z = beach.z;
  g.cam.state.yaw = Math.PI / 2; // looking toward +x
  const ped = g.peds.peds[0];
  Object.assign(ped, { x: beach.x + dist, z: beach.z, vx: 0, vz: 0, mode: 'down', timer: 999, health: 1000, loop: -1 });
  return ped.health;
}, { beach, dist });
const WEAPON_IDS = await G(() => window.__game.game.weapons.arsenal.map((s) => s.def.id));
for (let i = 0; i < WEAPON_IDS.length; i++) {
  await reset();
  const melee = i < 2;
  const before = await setupTarget(melee ? 1.3 : 7);
  await page.keyboard.press(`Digit${i + 1}`);
  await waitFor((i) => window.__game.game.weapons.state.index === i, 2000, i);
  await page.waitForTimeout(300); // weapon swap delay
  // a last round of the previous weapon can land during the swap: measure from here
  await G(() => { window.__game.game.peds.peds[0].health = 1000; });
  const shots0 = await G((id) => window.__game.game.weapons.stats.byWeapon[id].shots, WEAPON_IDS[i]);
  await G(({ beach, d }) => { const g = window.__game.game; const ped = g.peds.peds[0]; ped.x = beach.x + d; ped.z = beach.z; g.cam.state.yaw = Math.PI / 2; }, { beach, d: melee ? 1.3 : 7 });
  await page.mouse.move(480, 270);
  await page.mouse.down();
  const hit = await waitFor(({ before, beach, d }) => { const g = window.__game.game; const ped = g.peds.peds[0]; ped.x = beach.x + d; ped.z = beach.z; g.cam.state.yaw = Math.PI / 2; return ped.health < before; }, 4000, { before, beach, d: melee ? 1.3 : 7 });
  await page.mouse.up();
  const r = await G((id) => { const g = window.__game.game; return { hp: g.peds.peds[0].health, shots: g.weapons.stats.byWeapon[id].shots, name: g.weapons.current().def.name }; }, WEAPON_IDS[i]);
  check(`weapon ${i + 1} (${r.name}) fires and damages a target`, hit && r.shots > shots0, `target hp ${before} → ${r.hp.toFixed(0)}, ${r.shots - shots0} shots`);
}
// distinct weapon stats
const distinct = await G(() => new Set(window.__game.game.weapons.arsenal.map((s) => `${s.def.damage}/${s.def.rate}/${s.def.spread ?? 0}`)).size);
check('weapons have distinct damage / rate / spread', distinct === WEAPON_IDS.length, `${distinct} distinct profiles`);

// weapon wheel: hold Q, steer with the mouse, release to equip
await reset();
await page.keyboard.press('Digit1');
await waitFor(() => window.__game.game.weapons.state.index === 0, 2000);
await page.keyboard.down('KeyQ');
const wheelOpen = await waitFor(() => window.__game.game.wheel.state.open && window.__game.game.timeScale < 0.5, 8000);
const slowed = await G(() => window.__game.game.timeScale);
// slice 3 (index 3) sits down-right of centre: push the mouse that way
await page.mouse.move(480, 270);
await page.mouse.move(480 + 90, 270 + 60, { steps: 6 });
await page.waitForTimeout(150);
await page.keyboard.up('KeyQ');
await waitFor(() => !window.__game.game.wheel.state.open, 8000);
const afterQ = await G(() => ({ open: window.__game.game.wheel.state.open, index: window.__game.game.weapons.state.index, ts: window.__game.game.timeScale }));
check('Q opens the weapon wheel and slows time', wheelOpen, `timeScale ${slowed}`);
check('releasing Q equips the selected weapon', !afterQ.open && afterQ.index !== 0 && afterQ.ts === 1, `now weapon ${afterQ.index + 1}`);
await page.keyboard.press('Tab');
const tabOpen = await waitFor(() => window.__game.game.wheel.state.open, 8000);
await page.click('.wheel-slice:nth-of-type(5)'); // fifth slice button = Shotgun
await waitFor(() => !window.__game.game.wheel.state.open, 8000);
const tabPick = await G(() => ({ open: window.__game.game.wheel.state.open, index: window.__game.game.weapons.state.index }));
check('Tab toggles the wheel; clicking a slice equips it', tabOpen && !tabPick.open && tabPick.index === 4, `weapon ${tabPick.index + 1}`);
await page.keyboard.press('Digit3');
const d3 = await waitFor(() => window.__game.game.weapons.state.index === 2, 6000);
await page.mouse.wheel(0, 120);
const wheeled = await waitFor(() => window.__game.game.weapons.state.index === 3, 6000);
check('number keys and mouse wheel switch weapons', d3 && wheeled);

// wanted: crime raises stars, hiding lets them decay
await reset();
await setupTarget(7);
await page.keyboard.press('Digit3');
await page.waitForTimeout(350);
await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
const starsShot = await waitFor(() => window.__game.game.wanted >= 1, 8000);
const s1 = await G(() => window.__game.game.wanted);
await G(() => { const ped = window.__game.game.peds.peds[0]; ped.health = 5; });
// the pistol is semi-automatic: one pull per click, keep the panicking bystander in the line of fire
let killed = false;
for (let k = 0; k < 12 && !killed; k++) {
  await G((beach) => { const g = window.__game.game; const ped = g.peds.peds[0]; if (ped.mode !== 'dead') { ped.x = beach.x + 7; ped.z = beach.z; ped.vx = ped.vz = 0; } g.player.placeAt(beach.x, beach.z, Math.PI / 2); g.cam.state.yaw = Math.PI / 2; }, beach);
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  killed = await waitFor(() => window.__game.game.peds.peds[0].mode === 'dead', 600);
}
await page.waitForTimeout(200);
const heat = await G(() => ({ heat: window.__game.game.wantedSystem.state.heat, stars: window.__game.game.wanted, dead: window.__game.game.peds.peds[0].mode }));
check('gunfire raises the wanted level', starsShot, `${s1}★`);
check('killing a bystander raises the heat further', heat.dead === 'dead' && heat.heat > s1 + 0.5, `heat ${heat.heat.toFixed(2)}, ${heat.stars}★`);
// escape: teleport far from every unit and the last sighting, then wait out the cooldown
await G(() => { const g = window.__game.game; g.police.standDown(); g.wantedSystem.force(1); g.wantedSystem.state.knownFor = 0; g.wantedSystem.state.lastSeen = { x: g.player.state.x, z: g.player.state.z }; const L = g.world.layout; g.player.placeAt(L.roadX[0] + 13, L.roadZ[0] + 13); });
// units dispatched for the forced star may still have eyes on the player for a while: watch the
// whole hiding period for the flashing (unseen) state, then for the decay
// (sampled inside the simulation every step, so a short unseen spell between two polls still counts)
await G(() => { window.__sawFlash = false; window.__game.game.addSystem({ step(dt, g) { if (g.wantedFlash && g.wanted > 0) window.__sawFlash = true; } }); });
const decayed = await waitFor(() => window.__game.game.wanted === 0, 50000);
const flashing = await G(() => !!window.__sawFlash);
check('stars flash while the player is unseen', flashing);
check('stars decay to zero after hiding', decayed, `cooldown ${await G(() => window.__game.game.wantedSystem.cooldownFor(1))} s at 1★`);

// forced 3 stars in a car: a roadblock on a road ahead, and a RAM/PIT contact
await reset();
await G(() => {
  const g = window.__game.game; const L = g.world.layout; const c = g.spawnCar;
  if (c.wrecked) { c.wrecked = false; c.health = 100; }
  c.x = L.roadX[4]; c.z = L.roadZ[2] + 4.5; c.heading = Math.PI / 2; c.vx = c.vz = 0; c.health = 100;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.4, c.z - Math.sin(c.heading) * 2.4);
  g.input.clear();
});
await G(() => window.__game.game.enterNearestCar());
await G(() => { const g = window.__game.game; const c = g.player.state.car; const L = g.world.layout; c.x = L.roadX[4]; c.z = L.roadZ[2] + 4.5; c.heading = Math.PI / 2; g.wantedSystem.force(3); });
const rb = await waitFor(() => window.__game.game.police.roadblocks.length > 0, 15000);
const rbInfo = await G(() => {
  const g = window.__game.game; const b = g.police.roadblocks[0]; if (!b) return null; const L = g.world.layout; const p = g.player.state.car;
  const r = L.nearestRoadPoint(b.x, b.z);
  return { onRoad: Math.hypot(r.x - b.x, r.z - b.z) < 8, dist: Math.hypot(b.x - p.x, b.z - p.z), cars: b.cars.length, barriers: b.barriers.length, street: b.street };
});
check('3★: a roadblock is set on a road near the player', rb && rbInfo && rbInfo.onRoad && rbInfo.dist < 200 && rbInfo.cars >= 1, rbInfo ? `${rbInfo.street}, ${rbInfo.dist.toFixed(0)} m, ${rbInfo.cars} cruisers + ${rbInfo.barriers} barriers` : 'none');
const contact = await waitFor(() => { const g = window.__game.game; const c = g.player.state.car; if (c) { c.health = Math.max(c.health, 60); } g.player.state.health = 100; if (g.wanted < 3) g.wantedSystem.force(3); return g.police.stats.rams + g.police.stats.pits > 0; }, 40000);
const cst = await G(() => window.__game.game.police.stats);
check('3★: a cruiser makes RAM/PIT contact with the player car', contact, `rams ${cst.rams}, PITs ${cst.pits}, cruisers spawned ${cst.carsSpawned}`);

// PIT on purpose: the player drives straight down an avenue at speed, an even-numbered (PIT)
// cruiser comes up on the rear quarter; the manoeuvre must register and spin the car
const pitBase = await G(() => window.__game.game.police.stats.pits);
await G(() => {
  const g = window.__game.game; const L = g.world.layout; const c = g.player.state.car;
  g.police.standDown(); g.wantedSystem.force(3);
  // the open avenue along roadZ[1], heading +x
  c.x = L.roadX[0] + 20; c.z = L.roadZ[1] + 4.5; c.heading = Math.PI / 2; c.vx = 16; c.vz = 0; c.speed = 16; c.health = 100;
});
await page.keyboard.down('KeyW');
let pitHeading = null;
const pitDone = await waitFor((base) => {
  const g = window.__game.game; const c = g.player.state.car; if (!c) return false;
  g.player.state.health = 100; c.health = Math.max(c.health, 60); if (g.wanted < 3) g.wantedSystem.force(3);
  // keep the run straight and on the avenue until contact
  if (g.police.stats.pits === base) { c.heading = Math.PI / 2; c.z = g.world.layout.roadZ[1] + 4.5; c.vz = 0; if (c.x > g.world.layout.roadX[7]) { c.x = g.world.layout.roadX[0] + 20; } }
  // bring a PIT unit up behind on the left rear quarter
  let u = g.police.cruisers.find((k) => k.unit % 2 === 0);
  for (let n = 0; n < 4 && !u; n++) { g.police.spawnCruiser('pit'); u = g.police.cruisers.find((k) => k.unit % 2 === 0); }
  if (u && (u.disabled || u.wrecked || u.driver !== 'police')) {
    g.vehicles.revive(u, c.x - 9, c.z - 1.6, Math.PI / 2);
    Object.assign(u, { driver: 'police', role: 'pit', route: null, routeTimer: 0, stuck: 0, reverse: 0, contactCd: 0, fireCd: 3 });
  }
  if (u && g.police.stats.pits === base && Math.hypot(u.x - c.x, u.z - c.z) > 14) {
    u.x = c.x - 9; u.z = c.z - 1.6; u.heading = Math.PI / 2; u.vx = c.vx + 3; u.vz = 0; u.speed = Math.hypot(u.vx, u.vz); u.contactCd = 0;
  }
  return g.police.stats.pits > base;
}, 40000, pitBase);
await page.keyboard.up('KeyW');
const pitInfo = await G(() => { const g = window.__game.game; return { pits: g.police.stats.pits, heading: g.player.state.car?.heading }; });
pitHeading = pitInfo.heading;
check('3★: a cruiser performs a PIT manoeuvre on the speeding player car', pitDone, `PITs ${pitInfo.pits - pitBase}, car heading after ${pitHeading?.toFixed(2)} rad (was 1.57)`);

// forced 4 stars: the air unit arrives and its searchlight tracks the player
await G(() => window.__game.game.wantedSystem.force(4));
const heliUp = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); return g.police.heli.active; }, 15000);
const locked = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); if (g.wanted < 4) g.wantedSystem.force(4); return g.police.heli.lightError < 6; }, 30000);
let maxErr = 0;
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(250);
  const e = await G(() => { const g = window.__game.game; g.player.state.health = 100; const c = g.player.state.car; if (c) c.health = Math.max(c.health, 60); if (g.wanted < 4) g.wantedSystem.force(4); return g.police.heli.lightError; });
  maxErr = Math.max(maxErr, e);
}
check('4★: the police helicopter is deployed', heliUp);
check('4★: its searchlight stays on the player for 5 s', locked && maxErr < 8, `max error ${maxErr.toFixed(1)} m (pool radius 6.5 m)`);

// a car shot to pieces burns, explodes, leaves a wreck and the blast hurts bystanders
await reset();
const victim = await G(({ beach }) => {
  const g = window.__game.game;
  const car = g.vehicles.cars.find((c) => c.kind === 'parked' && !c.wrecked && c !== g.spawnCar);
  car.x = beach.x + 13; car.z = beach.z; car.heading = 0; car.vx = car.vz = 0; car.health = 100;
  const ped = g.peds.peds[1];
  Object.assign(ped, { x: beach.x + 13, z: beach.z + 4, mode: 'down', timer: 999, health: 1000, loop: -1, vx: 0, vz: 0 });
  g.player.placeAt(beach.x, beach.z, Math.PI / 2);
  g.cam.state.yaw = Math.PI / 2;
  return { id: car.id, booms: g.fx.stats.explosions };
}, { beach });
await page.keyboard.press('Digit6');
await page.waitForTimeout(350);
await page.mouse.down();
const smoked = await waitFor((id) => { const g = window.__game.game; g.cam.state.yaw = Math.PI / 2; g.player.state.health = 100; return g.vehicles.cars[id].health < 45; }, 6000, victim.id);
// keep firing: below 18 hp the engine catches fire and burns down to the explosion
const exploded = await waitFor((id) => { const g = window.__game.game; g.cam.state.yaw = Math.PI / 2; g.player.state.health = 100; return g.vehicles.cars[id].wrecked; }, 15000, victim.id);
await page.mouse.up();
const boom = await G((v) => { const g = window.__game.game; const car = g.vehicles.cars[v.id]; return { wrecked: car.wrecked, burn: car.burn, booms: g.fx.stats.explosions - v.booms, pedHp: g.peds.peds[1].health, enter: g.vehicles.nearest(car.x, car.z, 3) === car }; }, victim);
check('gunfire damages a car to smoking', smoked);
check('a burning car explodes into a lingering wreck', exploded && boom.wrecked && boom.burn > 0 && boom.booms >= 1 && !boom.enter, `burn ${boom.burn?.toFixed(1)} s left, wreck not enterable`);
check('the explosion damages nearby people', boom.pedHp < 1000, `bystander hp 1000 → ${boom.pedHp.toFixed(0)}`);

// Wasted → hospital, Busted → precinct, wanted cleared both times
await reset();
await G(() => { const g = window.__game.game; g.player.state.cash = 1000; g.wantedSystem.force(2); g.combat.hurtPlayer(999, 'test'); });
const wastedCard = await waitFor(() => window.__game.game.respawn.state.mode === 'wasted' && document.getElementById('death-card').textContent === 'WASTED', 2000);
const wastedDone = await waitFor(() => { const g = window.__game.game; return !g.respawning && g.respawn.state.wasted > 0; }, 8000);
const w = await G(() => { const g = window.__game.game; const h = g.respawn.hospital; const p = g.player.state; return { d: Math.hypot(p.x - h.x, p.z - h.z), hp: p.health, wanted: g.wanted, cash: p.cash }; });
check('Wasted: respawn at the hospital with full health, wanted cleared, bill paid', wastedCard && wastedDone && w.d < 3 && w.hp === 100 && w.wanted === 0 && w.cash < 1000, `bill $${1000 - w.cash}`);
const bustBase = await G(() => window.__game.game.respawn.state.busted);
await G(() => { const g = window.__game.game; g.wantedSystem.force(1); const p = g.player.state; g.police.spawnCop({ x: p.x + 1.2, z: p.z }); g.input.clear(); });
const bustedDone = await waitFor((b0) => { const g = window.__game.game; g.player.state.health = 100; return g.respawn.state.busted > b0 && !g.respawning; }, 30000, bustBase);
const bz = await G(() => { const g = window.__game.game; const h = g.respawn.precinct; const p = g.player.state; return { d: Math.hypot(p.x - h.x, p.z - h.z), wanted: g.wanted, cops: g.police.cops.filter((c) => c.active).length }; });
check('Busted: an officer arrests a still suspect, respawn at the precinct, wanted cleared', bustedDone && bz.d < 3 && bz.wanted === 0 && bz.cops === 0, `${bz.d.toFixed(1)} m from precinct`);
const fxCounts = await G(() => window.__game.game.fx.stats);
check('combat effects fired (muzzle flashes, tracers, sparks)', fxCounts.flashes > 5 && fxCounts.tracers > 5 && fxCounts.sparks > 0, JSON.stringify(fxCounts));

// 9. story missions (checkpoint 3): every mission starts from its giver beacon, every stage has a
// minimap marker and a GPS route, stages advance on world state, rewards and unlocks land.
await reset();
const missionRows = [];
const nMissions = await G(() => window.__game.game.missions.MISSIONS.length);
check('10 story missions are defined', nMissions === 10, `${nMissions} missions`);
const types = await G(() => [...new Set(window.__game.game.missions.MISSIONS.flatMap((m) => m.stages.map((s) => s.type)))]);
check('missions use varied stage types', ['goto', 'grab', 'kill', 'waves', 'chase', 'tail', 'convoy', 'evade'].every((t) => types.includes(t)), types.join(', '));
let allStagesMarked = true; let allRoutes = true; let allAdvanced = true; let allRewards = true; let allUnlocks = true;
for (let k = 0; k < nMissions; k++) {
  await G(() => { const g = window.__game.game; g.wantedSystem.clear(); g.police.standDown(); g.player.state.health = 100; g.input.clear(); });
  await waitFor(() => window.__game.game.minimap.markers.has('giver'), 4000);
  const info = await G(() => { const g = window.__game.game; const m = g.missions.nextMission(); g.missions.debugGoToGiver(); const p = g.player.state; return { id: m.id, name: m.name, district: m.district, type: m.type, stages: m.stages.length, cash: p.cash, respect: p.respect, giverMarker: g.minimap.markers.has('giver') }; });
  // the real trigger: standing in the giver's beacon starts the mission
  const started = await waitFor((id) => window.__game.game.missions.state.active?.def.id === id, 8000, info.id);
  let stagesOk = 0;
  for (let s = 0; s < info.stages && started; s++) {
    const seen = await waitFor((s) => { const g = window.__game.game; g.player.state.health = 100; const a = g.missions.state.active; return !a || a.si > s || (a.si === s && g.minimap.markers.has('mission') && (g.minimap.getRoute()?.length ?? 0) >= 2); }, 6000, s);
    const already = await G((s) => { const a = window.__game.game.missions.state.active; return !a || a.si > s; }, s);
    if (already) { stagesOk++; continue; }
    const mk = await G(() => { const g = window.__game.game; return { marker: g.minimap.markers.has('mission'), route: g.minimap.getRoute()?.length ?? 0, beacon: g.missions.beacons.objective.visible, obj: document.getElementById('objective').textContent }; });
    if (!mk.marker || !mk.beacon) allStagesMarked = false;
    if (mk.route < 2) allRoutes = false;
    // solve through world state; waves need one solve per wave
    let advanced = false;
    for (let tries = 0; tries < 6 && !advanced; tries++) {
      await G(() => window.__game.game.missions.debugSolve());
      advanced = await waitFor(({ s, id }) => { const g = window.__game.game; g.player.state.health = 100; if (g.player.state.car) g.player.state.car.health = Math.max(g.player.state.car.health, 80); const a = g.missions.state.active; return !a ? g.missions.state.done.includes(id) : a.si > s; }, 5000, { s, id: info.id });
    }
    if (advanced && seen) stagesOk++;
    else { allAdvanced = false; console.log(`  ${info.id} stage ${s + 1} stuck: ${mk.obj} failed=${JSON.stringify(await G(() => window.__game.game.missions.state.failed))}`); break; }
  }
  const after = await G((id) => { const g = window.__game.game; const p = g.player.state; const nm = g.missions.nextMission(); return { done: g.missions.state.done.includes(id), cash: p.cash, respect: p.respect, next: nm ? nm.id : null }; }, info.id);
  if (!(after.cash > info.cash && after.respect > info.respect)) allRewards = false;
  if (k < nMissions - 1 && after.next === info.id) allUnlocks = false;
  missionRows.push(`${info.id} ${info.name} [${info.district}, ${info.type}] stages ${stagesOk}/${info.stages} cash +${after.cash - info.cash} respect +${after.respect - info.respect} next ${after.next}`);
  check(`mission ${k + 1} "${info.name}": starts at its giver, all ${info.stages} stages advance, reward paid`, started && info.giverMarker && stagesOk === info.stages && after.done && after.cash > info.cash && after.respect > info.respect, `+$${after.cash - info.cash}, +${after.respect - info.respect} respect, next ${after.next ?? 'none (story complete)'}`);
}
check('every mission stage shows a minimap marker and a world beacon', allStagesMarked);
check('every mission stage draws a GPS route along the roads', allRoutes);
check('every stage advances through world state (moves, kills, wrecks, wanted)', allAdvanced);
check('each completion pays cash + respect and unlocks the next mission', allRewards && allUnlocks);
const rankNow = await G(() => document.getElementById('respect').textContent);
check('respect rank shown on the HUD', /RESPECT \d+ · /.test(rankNow), rankNow);
// fail + retry: replay mission 6 (timed delivery) and let the clock run out
await G(() => { const g = window.__game.game; g.wantedSystem.clear(); g.police.standDown(); g.missions.startMission(g.missions.MISSIONS[5]); });
await G(() => window.__game.game.missions.debugSolve()); // board a car
await waitFor(() => window.__game.game.missions.state.active?.si === 1, 5000);
await G(() => { window.__game.game.missions.state.active.stage.timer = 0.05; });
const timedOut = await waitFor(() => window.__game.game.missions.state.failed?.reason === 'out of time', 5000);
await page.keyboard.press('Enter');
const retried = await waitFor(() => window.__game.game.missions.state.active?.def.id === 'm6' && window.__game.game.missions.state.active.si <= 1, 5000);
check('a mission fails when its timer runs out and Enter retries it', timedOut && retried);
await G(() => { const g = window.__game.game; if (g.missions.state.active) g.missions.fail('test over'); g.missions.state.failed = null; g.wantedSystem.clear(); g.police.standDown(); });
// gang members shoot back
await reset();
const gangFight = await G(({ beach }) => { const g = window.__game.game; g.player.placeAt(beach.x, beach.z, 0); const m = g.gang.spawn('ember', beach.x + 12, beach.z, { tag: 'audit', alert: true }); return { shots: g.gang.stats.shots, hp: g.player.state.health + g.player.state.armor, ok: !!m }; }, { beach });
const shotBack = await waitFor((s) => window.__game.game.gang.stats.shots > s, 10000, gangFight.shots);
await G(() => { const g = window.__game.game; g.gang.clear('audit'); g.player.state.health = 100; });
check('rival gang members open fire on the player', gangFight.ok && shotBack);
await page.keyboard.press('KeyJ');
const logOpen = await waitFor(() => window.__game.game.missions.isLogOpen() && document.getElementById('mission-log').textContent.includes('10/10'), 4000);
await page.keyboard.press('KeyJ');
check('J opens the mission log with progress', logOpen && (await waitFor(() => !window.__game.game.missions.isLogOpen(), 3000)));
for (const r of missionRows) console.log('  MISSION ' + r);

// ================= checkpoint 4: crew, districts, races, garages =================
await reset();
await G(() => { const g = window.__game.game; if (g.missions.state.active) g.missions.fail('audit'); g.missions.state.failed = null; g.gang.clear(); });
// crew: hire all three with the real key
for (let k = 0; k < 3; k++) {
  await G((k) => { const g = window.__game.game; const m = g.crew.members[k]; g.player.placeAt(m.x + 1.5, m.z, 0); }, k);
  await page.keyboard.press('KeyC');
  await waitFor((k) => window.__game.game.crew.crew().length === k + 1, 3000, k);
}
const nCrew = await G(() => window.__game.game.crew.crew().length);
check('crew: three recruits hired (3 slots at this rank)', nCrew === 3, `${nCrew}/3`);
// call them over and walk: they follow
await G(({ beach }) => { const g = window.__game.game; g.player.placeAt(beach.x, beach.z, Math.PI / 2); g.cam.state.yaw = Math.PI / 2; }, { beach });
await page.keyboard.press('KeyC');
await page.waitForTimeout(300);
await hold(['KeyW'], 2500);
await page.waitForTimeout(1200);
const follow = await G(() => { const g = window.__game.game; const p = g.player.state; return g.crew.crew().map((m) => Math.hypot(m.x - p.x, m.z - p.z)); });
check('crew follow the player on foot', follow.every((d) => d < 12), follow.map((d) => d.toFixed(1) + ' m').join(', '));
// board together, drive, get out together
await G(() => { const g = window.__game.game; const p = g.player.state; const c = g.spawnCar; if (c.wrecked || c.disabled) g.vehicles.revive(c, p.x + 3, p.z, 0); const s = g.world.layout.findClear(p.x + 4, p.z, 2.4); c.x = s.x; c.z = s.z; c.vx = c.vz = 0; c.health = 100; c.driver = null; g.player.placeAt(c.x + Math.cos(c.heading) * 2.3, c.z - Math.sin(c.heading) * 2.3, 0); });
await page.keyboard.press('KeyE');
await waitFor(() => !!window.__game.game.player.state.car, 3000);
const seated = await G(() => window.__game.game.crew.crew().map((m) => m.seat));
await hold(['KeyW'], 1200);
await hold(['KeyS'], 900);
await page.waitForTimeout(500);
await G(() => { const c = window.__game.game.player.state.car; c.vx = c.vz = 0; c.speed = 0; });
await page.keyboard.press('KeyF');
await waitFor(() => !window.__game.game.player.state.car, 3000);
const outside = await G(() => { const g = window.__game.game; const p = g.player.state; return g.crew.crew().map((m) => ({ seat: m.seat, d: Math.hypot(m.x - p.x, m.z - p.z), vis: m.mesh.root.visible })); });
check('crew climb into the player\'s car (passenger seats)', seated.every((s) => s != null) && new Set(seated).size === 3, `seats ${seated.join(',')}`);
check('crew get out with the player', outside.every((o) => o.seat == null && o.d < 8 && o.vis), outside.map((o) => o.d.toFixed(1)).join(', ') + ' m');
// crew shoot rival gang members; a crew kill moves district control
const fight = await G(({ beach }) => {
  const g = window.__game.game; const p = g.player.state;
  g.player.state.health = 100; g.player.state.armor = 100;
  const m = g.gang.spawn('saltjaw', p.x + 9, p.z + 2, { tag: 'audit4', alert: false, health: 70 });
  const d = g.progression.districtAt(m.x, m.z);
  return { hits: g.crew.stats.hits, district: d.name, control: d.control, id: m.id };
}, { beach });
const crewHit = await waitFor((f) => window.__game.game.crew.stats.hits > f.hits, 12000, fight);
const crewKill = await waitFor((f) => window.__game.game.gang.members[f.id].health <= 0, 15000, fight);
const after4 = await G((f) => { const g = window.__game.game; const d = g.progression.districts.find((x) => x.name === f.district); return { hits: g.crew.stats.hits, shots: g.crew.stats.shots, control: d.control, log: g.progression.state.log.slice(-1)[0] }; }, fight);
check('crew shoot and damage a rival gang member', crewHit && crewKill, `${after4.shots} crew shots, ${after4.hits} hits`);
check('a gang kill raises that district\'s control', after4.control > fight.control, `${fight.district} ${fight.control}% → ${after4.control}% (${after4.log?.why})`);
await G(() => { const g = window.__game.game; g.gang.clear(); g.player.state.health = 100; });
// G: shock grenade — blast hurts the gang, EMP kills a cruiser's engine, cooldown starts
await reset();
const abil = await G(() => {
  const g = window.__game.game; const p = g.player.state;
  g.crew.ability.cooldown = 0;
  const yaw = g.cam.state.yaw;
  const tx = p.x + Math.sin(yaw) * 12; const tz = p.z + Math.cos(yaw) * 12;
  const m = g.gang.spawn('ember', tx, tz, { tag: 'audit4', health: 200 });
  const car = g.police.spawnCruiser('chase');
  if (car) { const s = g.world.layout.findClear(m.x + 3, m.z, 2.4); car.x = s.x; car.z = s.z; car.vx = car.vz = 0; }
  g.wantedSystem.force(1);
  return { hp: m.health, id: m.id, car: car ? car.id : null, uses: g.crew.stats.abilities };
});
await page.keyboard.press('KeyG');
const used = await waitFor((a) => window.__game.game.crew.stats.abilities > a.uses, 3000, abil);
await page.waitForTimeout(900);
const ab = await G((a) => { const g = window.__game.game; const m = g.gang.members[a.id]; const car = a.car != null ? g.vehicles.cars[a.car] : null; return { hp: m.health, emp: car ? car.emp : null, thr: car ? car.controls.throttle : null, speed: car ? Math.abs(car.speed) : null, cd: g.crew.ability.cooldown, last: g.crew.ability.last }; }, abil);
await page.keyboard.press('KeyG');
await page.waitForTimeout(300);
const reuse = await G(() => window.__game.game.crew.stats.abilities);
check('G shock grenade: the blast hurts the targeted gang member', used && ab.hp < abil.hp, `hp ${abil.hp} → ${ab.hp}`);
check('G shock grenade: EMP kills a police cruiser\'s engine', ab.emp > 0 && ab.thr === 0 && ab.speed < 1.5, `emp ${ab.emp?.toFixed(1)} s left, throttle ${ab.thr}, ${ab.speed?.toFixed(2)} m/s`);
check('G ability goes on cooldown (second press refused)', ab.cd > 10 && reuse === abil.uses + 1, `cooldown ${ab.cd.toFixed(1)} s`);
await G(() => { const g = window.__game.game; g.gang.clear(); g.wantedSystem.clear(); g.police.standDown(); g.crew.ability.cooldown = 0; });
// district control: a mission completed in a district raises it; the big map tints by control
await reset();
const mDist = await G(() => { const g = window.__game.game; const d = g.progression.districts.find((x) => x.name === 'PALMA HEIGHTS'); d.control = Math.min(d.control, 60); g.missions.startMission(g.missions.MISSIONS[3]); return d.control; });
for (let k = 0; k < 10; k++) {
  const st = await G(() => { const g = window.__game.game; if (!g.missions.state.active) return 'done'; g.missions.debugSolve(); return g.missions.state.active.si; });
  if (st === 'done') break;
  await page.waitForTimeout(1500);
}
await waitFor(() => !window.__game.game.missions.state.active, 8000);
const mAfter = await G(() => window.__game.game.progression.districts.find((x) => x.name === 'PALMA HEIGHTS').control);
check('completing a mission raises its district\'s control', mAfter > mDist, `PALMA HEIGHTS ${mDist}% → ${mAfter}%`);
await page.keyboard.press('KeyM');
await waitFor(() => window.__game.game.minimap.isBig(), 3000);
const tints = await G(() => { const g = window.__game.game; return { big: g.minimap.isBig(), t: g.minimap.getTints().map((t) => t.label + ' ' + t.color), icons: g.minimap.getIcons().map((i) => i.glyph).join('') }; });
await page.keyboard.press('KeyM');
await waitFor(() => !window.__game.game.minimap.isBig(), 3000);
check('big map tints the 4 districts by control', tints.big && tints.t.length === 4 && new Set(tints.t.map((x) => x.split(' rgba')[1])).size > 1, tints.t.join(' | '));
check('HUD shows the current district and its control %', /CONTROL \d+%/.test(await G(() => document.getElementById('district-name').textContent)));
// races
const raceRows = [];
for (let r = 0; r < 3; r++) {
  await reset();
  const info = await G((r) => {
    const g = window.__game.game; const p = g.player.state; const race = g.races.RACES[r]; const s = g.races.starts[r];
    g.missions.state.failed = null;
    const c = g.spawnCar; if (c.wrecked || c.disabled) g.vehicles.revive(c, s.x, s.z, 0);
    c.health = 100; c.driver = null;
    g.player.placeAt(s.x + 30, s.z + 3, 0);
    const q = g.world.layout.findClear(s.x + 26, s.z, 2.4); c.x = q.x; c.z = q.z; c.vx = c.vz = 0;
    g.player.placeAt(c.x + Math.cos(c.heading) * 2.3, c.z - Math.sin(c.heading) * 2.3, 0);
    g.enterNearestCar();
    return { id: race.id, name: race.name, cash: p.cash, respect: p.respect, cps: race.cps.length, laps: race.laps, done: g.races.stats.finished };
  }, r);
  await page.waitForTimeout(500); // the car is clear of every start line for a few steps
  await G((r) => { const g = window.__game.game; const s = g.races.starts[r]; const c = g.player.state.car; c.x = s.x; c.z = s.z; c.vx = c.vz = 0; c.speed = 0; }, r);
  const started = await waitFor((i) => window.__game.game.races.active?.race.id === i.id, 4000, info);
  const marked = await G(() => { const g = window.__game.game; return !!g.minimap.markers.get('race') && !!g.minimap.getRoute() && g.races.ring.visible; });
  const go = await waitFor(() => window.__game.game.races.active && window.__game.game.races.active.countdown <= 0, 15000);
  const r0 = await G(() => ({ t: window.__game.game.time, w: performance.now(), r: window.__game.game.races.active?.racers.map((x) => ({ x: x.car.x, z: x.car.z })) ?? [] }));
  // 3.5 s of simulated race time (wall-clock waits undercount when software GL stalls a frame)
  await waitFor((t0) => window.__game.game.time >= t0 + 3.5 || !window.__game.game.races.active, 20000, r0.t);
  const r1 = await G(() => window.__game.game.races.active?.racers.map((x) => ({ x: x.car.x, z: x.car.z, idx: x.idx, sp: x.car.speed })) ?? []);
  const simWall = await G((a) => `sim ${(window.__game.game.time - a.t).toFixed(2)} s in ${((performance.now() - a.w) / 1000).toFixed(2)} s wall`, r0);
  r0.go = go;
  const lostWhy = await G(() => window.__game.game.races.stats.lastLost ?? null);
  const moved = r1.filter((x, k) => r0.r[k] && Math.hypot(x.x - r0.r[k].x, x.z - r0.r[k].z) > 15).length;
  let cpOk = 0;
  for (let k = 0; k < info.cps * info.laps; k++) {
    const before = await G(() => window.__game.game.races.stats.checkpoints);
    await G(() => window.__game.game.races.debugReachCheckpoint());
    if (await waitFor((b) => window.__game.game.races.stats.checkpoints > b, 3000, before)) cpOk++;
  }
  const fin = await waitFor((i) => window.__game.game.races.stats.finished > i.done, 4000, info);
  const res = await G(() => { const g = window.__game.game; const p = g.player.state; return { ...g.races.results[g.races.results.length - 1], cashNow: p.cash, respectNow: p.respect }; });
  raceRows.push(`${info.name} [${res.district}] ${info.laps} lap(s) × ${info.cps} cps, pos ${res.position}/4, ${res.time?.toFixed(1)} s, +$${res.cash}, +${res.respect} respect, AI moved ${moved}/3`);
  check(`race ${r + 1} "${info.name}": starts on its marker with ring + GPS, 3 AI racers drive the route`, started && marked && r0.go && moved >= 2, `started ${started}, ring+marker+GPS ${marked}, GO ${r0.go}, AI moved ${moved}/3 (>15 m, ${simWall})${lostWhy ? ', lost: ' + lostWhy : ''}`);
  check(`race ${r + 1} "${info.name}": all ${info.cps * info.laps} checkpoints register, finish pays cash + respect`, cpOk === info.cps * info.laps && fin && res.cashNow > info.cash && res.respectNow > info.respect && res.position >= 1, `pos ${res.position}, +$${res.cashNow - info.cash}, +${res.respectNow - info.respect} respect, best ${res.best?.toFixed(1)} s`);
  await G(() => { const c = window.__game.game.player.state.car; if (c) { c.x += 40; c.vx = c.vz = 0; } });
  await page.waitForTimeout(300);
}
// garage: repair, respray (and lose the cops), 3 tiers of engine / handling / armour
await reset();
const dyno = (perf) => G((perf) => {
  const m = window.__game.carPhysics; // the game's own car-physics module, via its test hooks
  const stub = { resolveCircle: () => ({ hit: false }) };
  const b = m.createCarBody(0, 0, 0); b.perf = perf; b.controls.throttle = 1;
  let t20 = null;
  for (let i = 0; i < 60 * 25; i++) { m.stepCarBody(b, 1 / 60, stub); if (t20 == null && b.speed >= 20) t20 = i / 60; }
  const c = m.createCarBody(0, 0, 0); c.perf = perf; c.vx = 10;
  for (let i = 0; i < 15; i++) m.stepCarBody(c, 1 / 60, stub);
  return { top: b.speed, t20, lat: Math.abs(c.vx) };
}, perf);
const gar = await G(() => {
  const g = window.__game.game; const p = g.player.state; const gg = g.garages.garages[0];
  const c = g.spawnCar; if (c.wrecked || c.disabled) g.vehicles.revive(c, gg.x + 20, gg.z, 0);
  c.driver = null; c.mods = null; c.perf = null;
  const q = g.world.layout.findClear(gg.x - 25, gg.z, 2.4); c.x = q.x; c.z = q.z; c.vx = c.vz = 0;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.3, c.z - Math.sin(c.heading) * 2.3, 0);
  g.enterNearestCar();
  p.cash = 40000;
  g.combat.hurtCar(c, 62, 'audit');
  c.x = gg.x; c.z = gg.z; c.vx = c.vz = 0; c.speed = 0;
  return { hp: c.health, cash: p.cash, color: c.color ?? null, name: gg.name };
});
const opened = await waitFor(() => !!window.__game.game.garages.state.open && window.__game.game.menuOpen && !document.getElementById('garage-menu').classList.contains('hidden'), 3000);
check('driving onto a garage pad opens the shop', opened, gar.name);
const smoking = await G(() => window.__game.game.player.state.car.health);
await page.keyboard.press('Digit1');
await waitFor(() => window.__game.game.player.state.car?.health === 100, 3000);
const rep = await G(() => { const g = window.__game.game; const c = g.player.state.car; return { hp: c.health, fire: !!c.onFire, cash: g.player.state.cash }; });
check('garage repair restores the car (smoke/fire out) and costs cash', rep.hp === 100 && !rep.fire && rep.cash < gar.cash, `hp ${smoking.toFixed(0)} → ${rep.hp}, -$${gar.cash - rep.cash}`);
const sprays0 = await G(() => window.__game.game.garages.stats.resprays);
await page.click('#garage-menu button[data-act="respray"]');
await waitFor((n) => window.__game.game.garages.stats.resprays > n, 3000, sprays0);
const sp = await G(() => { const g = window.__game.game; const c = g.player.state.car; return { color: c.color, cash: g.player.state.cash }; });
check('respray changes the car colour (button click) and costs cash', sp.color != null && sp.color !== gar.color && sp.cash === rep.cash - 250, `0x${(sp.color ?? 0).toString(16)}, -$${rep.cash - sp.cash}`);
// respray while unseen loses the wanted level. Setup: with every unit stood down, wait for the
// stars to flash (unseen) before pressing respray; police re-dispatched by the forced stars can
// spot the car on a slow software-GL frame first, so the setup retries (up to 3 tries) until a
// respray lands while unseen. The assertion below is unchanged.
for (let attempt = 0; attempt < 3; attempt++) {
  await G(() => { const g = window.__game.game; g.police.standDown(); g.wantedSystem.force(2); g.wantedSystem.state.knownFor = 0; });
  const unseen = await waitFor(() => window.__game.game.wantedFlash === true, 12000);
  if (!unseen) continue;
  const before = await G(() => window.__game.game.garages.stats.resprays);
  await page.keyboard.press('Digit2');
  await waitFor((n) => window.__game.game.garages.stats.wantedLost >= 1 || window.__game.game.garages.stats.resprays > n, 4000, before);
  if (await G(() => window.__game.game.garages.stats.wantedLost >= 1)) break;
}
await page.waitForTimeout(100);
const lost = await G(() => ({ wanted: window.__game.game.wanted, lost: window.__game.game.garages.stats.wantedLost }));
check('a respray the cops did not see clears the wanted level', lost.wanted === 0 && lost.lost >= 1, `wanted ${lost.wanted}`);
await G(() => { const g = window.__game.game; g.wantedSystem.clear(); g.police.standDown(); });
const base = await dyno({ accel: 1, speed: 1, drag: 1, grip: 1, steer: 1, armor: 1 });
const tierRows = [];
let engOk = true; let hanOk = true; let armOk = true; let costOk = true;
let prev = base;
for (let t = 1; t <= 3; t++) {
  const c0 = await G(() => window.__game.game.player.state.cash);
  await page.keyboard.press('Digit3');
  await waitFor((t) => window.__game.game.player.state.car?.mods?.engine >= t, 3000, t);
  const st = await G(() => { const g = window.__game.game; const c = g.player.state.car; return { tier: c.mods.engine, perf: c.perf, cash: g.player.state.cash }; });
  const d = await dyno(st.perf);
  if (!(st.tier === t && d.top > prev.top + 0.3 && st.cash < c0)) engOk = false;
  if (st.cash >= c0) costOk = false;
  tierRows.push(`engine ${t}: top ${(d.top * 3.6).toFixed(1)} km/h, 0-72 ${d.t20?.toFixed(2)} s, -$${c0 - st.cash}`);
  prev = d;
}
prev = base;
for (let t = 1; t <= 3; t++) {
  const c0 = await G(() => window.__game.game.player.state.cash);
  await page.keyboard.press('Digit4');
  await waitFor((t) => window.__game.game.player.state.car?.mods?.handling >= t, 3000, t);
  const st = await G(() => { const g = window.__game.game; const c = g.player.state.car; return { tier: c.mods.handling, perf: c.perf, cash: g.player.state.cash }; });
  const d = await dyno(st.perf);
  if (!(st.tier === t && d.lat < prev.lat * 0.9 && st.cash < c0)) hanOk = false;
  if (st.cash >= c0) costOk = false;
  tierRows.push(`handling ${t}: slide left after 0.25 s ${d.lat.toFixed(2)} m/s (stock ${base.lat.toFixed(2)}), -$${c0 - st.cash}`);
  prev = d;
}
let prevDmg = null;
{
  const d0 = await G(() => { const g = window.__game.game; const c = g.player.state.car; c.health = 100; g.combat.hurtCar(c, 20, 'audit'); const t = 100 - c.health; c.health = 100; return t; });
  prevDmg = d0;
  tierRows.push(`armour 0: a 20-pt hit takes ${d0.toFixed(1)}`);
}
for (let t = 1; t <= 3; t++) {
  const c0 = await G(() => window.__game.game.player.state.cash);
  await page.keyboard.press('Digit5');
  await waitFor((t) => window.__game.game.player.state.car?.mods?.armor >= t, 3000, t);
  const st = await G(() => { const g = window.__game.game; const c = g.player.state.car; const cash = g.player.state.cash; c.health = 100; g.combat.hurtCar(c, 20, 'audit'); const taken = 100 - c.health; c.health = 100; return { tier: c.mods.armor, taken, cash }; });
  if (!(st.tier === t && st.taken < prevDmg - 0.5 && st.cash < c0)) armOk = false;
  if (st.cash >= c0) costOk = false;
  tierRows.push(`armour ${t}: a 20-pt hit takes ${st.taken.toFixed(1)}, -$${c0 - st.cash}`);
  prevDmg = st.taken;
}
check('engine tiers 1-3 each raise top speed (dyno)', engOk, `stock ${(base.top * 3.6).toFixed(1)} km/h → ${tierRows[2]}`);
check('handling tiers 1-3 each add grip (dyno slide test)', hanOk, tierRows[5]);
check('armour tiers 1-3 each cut damage taken', armOk, tierRows[9]);
check('every upgrade deducts cash', costOk);
await G(() => { const c = window.__game.game.player.state.car; c.x += 18; c.vx = c.vz = 0; });
const closed = await waitFor(() => !window.__game.game.garages.state.open && !window.__game.game.menuOpen, 3000);
const keeps = await G(() => { const c = window.__game.game.player.state.car; return c.mods.engine + c.mods.handling + c.mods.armor; });
check('driving off closes the shop; upgrades stay on the car', closed && keeps === 9, `tiers kept ${keeps}/9`);
const icons = await G(() => window.__game.game.minimap.getIcons().map((i) => i.glyph).join(''));
check('minimap shows garage (G) and race (R) icons', (icons.match(/G/g) ?? []).length >= 2 && (icons.match(/R/g) ?? []).length >= 3, icons);
for (const r of raceRows) console.log('  RACE ' + r);
for (const r of tierRows) console.log('  GARAGE ' + r);
console.log('  CREW ' + JSON.stringify(await G(() => window.__game.game.crew.stats)));
console.log('  DISTRICTS ' + (await G(() => window.__game.game.progression.districts.map((d) => `${d.name} ${Math.round(d.control)}%`).join(', '))));

// ================= checkpoint 5: sound, car radio, autosave =================
await reset();
const A = () => G(() => {
  const a = window.__game.game.audio;
  return { st: a.state.ctx?.state ?? null, ev: JSON.parse(JSON.stringify(a.state.events)), radio: { ...a.radio.state }, engine: a.state.enginePitch, siren: a.state.sirenActive, rotor: a.state.rotorActive, err: a.state.errors, hud: document.getElementById('station').textContent, made: window.__ctxMade };
});
const a0 = await A();
check('the Play click created exactly one AudioContext and it is running', a0.made === 1 && a0.st === 'running', `contexts ${a0.made}, state ${a0.st}`);
check('earlier play fired synthesized SFX: race countdown beeps, mission/race stings, UI clicks, explosions', a0.ev.beep >= 12 && a0.ev.sting >= 3 && a0.ev.ui >= 2 && a0.ev.explosion >= 1, `beeps ${a0.ev.beep}, stings ${a0.ev.sting}, clicks ${a0.ev.ui}, explosions ${a0.ev.explosion}`);
// R on foot does nothing
await page.keyboard.press('KeyR');
await page.waitForTimeout(700);
const aFoot = await A();
check('R on foot does nothing (no station change, radio silent)', aFoot.radio.switches === a0.radio.switches && !aFoot.radio.playing && aFoot.hud === '', `switches ${a0.radio.switches} → ${aFoot.radio.switches}`);
// into a car: the radio comes on, R cycles 3 stations and Off, HUD names the station
// the open beach strip (clear toward +x), so the drive below never meets a wall
const beachSpot = await G(({ beach }) => {
  const g = window.__game.game; const c = g.spawnCar; const L = g.world.layout; const col = g.world.collision;
  // a lane of the beach strip that stays clear for 160 m toward +x, so the car reaches speed
  let s = null;
  for (let dz = 20; dz <= 50 && !s; dz += 3) for (let x = L.roadX[0]; x < L.roadX[5] && !s; x += 9) {
    const z = L.bounds.beachStart + dz;
    if (!col.overlaps(x, z, 2.4) && col.clearLine(x, z, x + 160, z, 2.2)) s = { x, z };
  }
  if (!s) s = g.world.layout.findClear(beach.x, beach.z, 2.4);
  if (c.wrecked || c.disabled) g.vehicles.revive(c, s.x, s.z, Math.PI / 2);
  c.x = s.x; c.z = s.z; c.heading = Math.PI / 2; c.vx = c.vz = 0; c.speed = 0; c.health = 100; c.driver = null;
  g.player.placeAt(c.x + Math.cos(c.heading) * 2.3, c.z - Math.sin(c.heading) * 2.3, 0);
  return g.enterNearestCar();
}, { beach });
const radioOn = await waitFor(() => window.__game.game.audio.radio.state.playing, 4000);
const seen = [];
for (let k = 0; k < 4; k++) {
  const before = await G(() => window.__game.game.audio.radio.state.switches);
  await page.keyboard.press('KeyR');
  await waitFor((b) => window.__game.game.audio.radio.state.switches > b, 4000, before);
  const r = await A();
  const names = await G(() => window.__game.game.audio.radio.STATIONS.map((s) => s.name));
  seen.push({ i: r.radio.index, hud: r.hud, ok: r.radio.index < 0 ? r.hud === 'RADIO OFF' && !r.radio.playing : r.hud === names[r.radio.index] && r.radio.playing });
}
check('in a car R cycles the 3 stations and Off; the HUD shows each station name', beachSpot && radioOn && seen.every((x) => x.ok) && new Set(seen.filter((x) => x.i >= 0).map((x) => x.i)).size === 3 && seen.some((x) => x.i < 0), seen.map((x) => `${x.i}:${x.hud}`).join(' | '));
// music really plays: the sequencer keeps scheduling notes on every station
const notes = [];
for (let k = 0; k < 3; k++) {
  const tuned = await G((k) => { const r = window.__game.game.audio.radio; r.tune(k); return r.state.notes; }, k);
  await page.waitForTimeout(3000);
  notes.push((await G(() => window.__game.game.audio.radio.state.notes)) - tuned);
}
check('each station\'s sequencer schedules music beyond its ident', notes.every((n) => n >= 5), `notes in 3 s after the ident: ${notes.join(', ')}`);
// engine pitch follows speed; handbrake at speed screeches
const e0 = await A();
await page.keyboard.down('KeyW');
await page.waitForTimeout(600);
const eLow = await G(() => ({ p: window.__game.game.audio.state.enginePitch, v: Math.abs(window.__game.game.player.state.car.speed) }));
await waitFor(() => Math.abs(window.__game.game.player.state.car.speed) > 18, 10000);
const eHigh = await G(() => ({ p: window.__game.game.audio.state.enginePitch, v: Math.abs(window.__game.game.player.state.car.speed) }));
await page.keyboard.down('Space');
await waitFor((n) => window.__game.game.audio.state.events.screech > n, 3000, e0.ev.screech);
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
const e1 = await A();
check('engine loop runs in the car and its pitch rises with speed', e1.ev.engine >= 1 && eHigh.p > eLow.p + 8 && eHigh.v > eLow.v + 4, `${eLow.v.toFixed(1)} m/s → ${eLow.p.toFixed(0)} Hz, ${eHigh.v.toFixed(1)} m/s → ${eHigh.p.toFixed(0)} Hz`);
check('handbrake at speed plays a tyre screech', e1.ev.screech > e0.ev.screech, `screeches ${e0.ev.screech} → ${e1.ev.screech}`);
await G(() => { const c = window.__game.game.player.state.car; if (c) { c.vx = c.vz = 0; c.speed = 0; } });
await page.waitForTimeout(300);
await page.keyboard.press('KeyF');
const radioOff = await waitFor(() => !window.__game.game.player.state.car && !window.__game.game.audio.radio.state.playing && document.getElementById('station').textContent === '', 4000);
check('leaving the car stops the radio', radioOff);
// a distinct gunshot per weapon (all six), an explosion
const shots = await G(() => {
  const g = window.__game.game; const p = g.player.state; const before = { ...g.audio.state.events.gunshot };
  for (const s of g.weapons.arsenal) g.weapons.fireFrom(s.def, p.x, p.z, 0, null, 1);
  const after = g.audio.state.events.gunshot;
  return g.weapons.arsenal.map((s) => [s.def.id, (after[s.def.id] ?? 0) - (before[s.def.id] ?? 0)]);
});
check('each of the 6 weapons plays its own synthesized shot', shots.every(([, n]) => n >= 1), shots.map(([id, n]) => `${id}+${n}`).join(' '));
const boomSfx = await G(() => {
  const g = window.__game.game; const p = g.player.state; const n = g.audio.state.events.explosion;
  let car = g.vehicles.cars.find((c) => !c.disabled && !c.wrecked && c.driver !== 'player' && Math.hypot(c.x - p.x, c.z - p.z) > 30 && Math.hypot(c.x - p.x, c.z - p.z) < 120);
  // the beach strip can be empty of traffic: bring a spare car 40 m off instead of skipping the check
  if (!car) { car = g.vehicles.cars.find((c) => !c.disabled && !c.wrecked && c.driver !== 'player' && c !== g.spawnCar); if (car) { const q = g.world.layout.findClear(p.x + 40, p.z, 2.4); car.x = q.x; car.z = q.z; car.vx = car.vz = 0; car.speed = 0; } }
  if (!car) return null;
  g.combat.explodeCar(car);
  return { before: n, after: g.audio.state.events.explosion };
});
check('an explosion plays the synthesized blast', boomSfx && boomSfx.after > boomSfx.before, JSON.stringify(boomSfx));
await G(() => { window.__game.game.player.state.health = 100; });
// sirens at 1+ stars, rotor at 4 stars
await G(() => window.__game.game.wantedSystem.force(2));
const sirenOn = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; return g.audio.state.sirenActive; }, 20000);
const sirenP = await G(() => window.__game.game.audio.state.sirenPitch);
check('police siren sounds at 2 stars (two-tone, doppler-shifted pitch)', sirenOn && sirenP > 500, `pitch ${sirenP.toFixed(0)} Hz`);
await G(() => window.__game.game.wantedSystem.force(4));
const rotorOn = await waitFor(() => { const g = window.__game.game; g.player.state.health = 100; return g.audio.state.rotorActive; }, 25000);
check('helicopter rotor sounds at 4 stars', rotorOn);
await reset();
const rotorOff = await waitFor(() => !window.__game.game.audio.state.sirenActive, 8000);
check('sirens stop when the police stand down', rotorOff);
// mute
await page.keyboard.press('KeyN');
const muted = await waitFor(() => window.__game.game.audio.state.muted, 3000);
await page.keyboard.press('KeyN');
const unmuted = await waitFor(() => !window.__game.game.audio.state.muted, 3000);
check('N mutes and unmutes the master bus', muted && unmuted);
check('audio engine reported no errors', (await A()).err === 0);

// ---- autosave ----
await G(() => localStorage.clear());
const ms = await G(() => { const g = window.__game.game; g.missions.state.failed = null; g.missions.startMission(g.missions.MISSIONS[0]); return g.saves.state.saves; });
for (let k = 0; k < 30; k++) {
  const st = await G(() => { const g = window.__game.game; if (!g.missions.state.active) return 'done'; g.player.state.health = 100; g.missions.debugSolve(); return g.missions.state.active?.si ?? 'done'; });
  if (st === 'done') break;
  await page.waitForTimeout(350);
}
await waitFor((n) => window.__game.game.saves.state.saves > n, 5000, ms);
const saved = await G(() => { const g = window.__game.game; const raw = localStorage.getItem(g.saves.SAVE_KEY); let d = null; try { d = JSON.parse(raw); } catch { /* reported below */ } return { key: g.saves.SAVE_KEY, reason: g.saves.state.lastSave?.reason, d }; });
check('a mission win writes the autosave (versioned key + version field)', saved.reason === 'mission' && saved.d && saved.d.version === 1 && saved.key === 'neon-vela-save-v1', `key ${saved.key}, reason ${saved.reason}, version ${saved.d?.version}`);
const sv0 = await G(() => { const g = window.__game.game; g.saves.state.timer = 59.4; return g.saves.state.saves; });
const timed = await waitFor((n) => window.__game.game.saves.state.saves > n && window.__game.game.saves.state.lastSave.reason === "timer", 6000, sv0);
check('autosave also runs every 60 s of play', timed);
const gBefore = await G(() => window.__game.game.saves.state.saves);
await G(() => window.__game.game.emit('garage', { act: 'repair', cost: 120, car: window.__game.game.spawnCar, garage: 'audit' }));
const gSaved = await G((n) => window.__game.game.saves.state.saves > n && window.__game.game.saves.state.lastSave.reason === 'garage', gBefore);
check('a garage purchase triggers an autosave', gSaved);
// storage full: caught, reported, no throw
const quota = await G(() => {
  const g = window.__game.game; const orig = Storage.prototype.setItem; let threw = false; let ok = null;
  Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
  try { ok = g.saves.save('quota-test'); } catch { threw = true; }
  Storage.prototype.setItem = orig;
  return { ok, threw, failures: g.saves.state.failures, notice: document.getElementById('notice').textContent };
});
check('a full storage quota is caught and reported, never thrown', quota.ok === false && !quota.threw && /storage is full/.test(quota.notice), `${quota.notice}`);
// the exact state to come back to
const snap = await G(() => { const g = window.__game.game; g.saves.save('snapshot'); return JSON.parse(localStorage.getItem(g.saves.SAVE_KEY)); });
const pick = (d) => JSON.stringify({ cash: d.cash, respect: d.respect, rank: d.rank, unlocked: d.unlocked, crewSlots: d.crewSlots, weapons: d.weapons.map((w) => [w.id, w.owned]), missions: d.missions, districts: d.districts, crew: d.crew, raceBest: d.raceBest, mods: d.ride?.mods, color: d.ride?.color });
await page.reload();
await page.waitForFunction(() => window.__game && window.__game.screen === 'title', null, { timeout: 30000 });
const offer = { cont: await page.isVisible('#continue-btn'), play: await page.textContent('#play-btn'), note: await page.textContent('#save-note') };
check('with a save, the title offers CONTINUE (and NEW GAME)', offer.cont && offer.play === 'NEW GAME', `${offer.note}`);
await page.click('#continue-btn');
await page.waitForFunction(() => window.__game.game.stats.steps > 30, null, { timeout: 30000 });
const back = await G(() => window.__game.game.saves.collect());
check('Continue restores cash, respect/rank, unlocks, weapons, missions, districts, crew, race bests and car upgrades exactly', pick(back) === pick(snap), pick(back) === pick(snap) ? `$${back.cash}, ${back.rank}, ${back.missions.length}/10 jobs, crew ${back.crew.length}, mods ${JSON.stringify(back.ride?.mods)}` : `saved ${pick(snap).slice(0, 220)} | loaded ${pick(back).slice(0, 220)}`);
check('Continue also starts the sound in the click gesture', (await G(() => ({ m: window.__ctxMade, s: window.__game.game.audio.state.ctx?.state }))).s === 'running');
// broken saves: fresh game, a notice, no crash
const fresh = async (label, raw) => {
  await G((raw) => localStorage.setItem('neon-vela-save-v1', raw), raw);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.screen === 'title', null, { timeout: 30000 });
  const t = { cont: await page.isVisible('#continue-btn'), note: await page.textContent('#save-note') };
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__game.game.stats.steps > 10, null, { timeout: 30000 });
  const s = await G(() => { const g = window.__game.game; return { screen: window.__game.screen, cash: g.player.state.cash, done: g.missions.state.done.length, respect: g.player.state.respect, notice: document.getElementById('notice').textContent }; });
  check(`${label} save: boots to a fresh game with a notice, no Continue`, !t.cont && /could not be loaded/.test(t.note) && s.screen === 'play' && s.cash === 0 && s.done === 0 && s.respect === 0 && /could not be loaded/.test(s.notice), `${t.note}`);
};
await fresh('corrupted (bad JSON)', '{"version":1,"cash":12');
await fresh('wrong-version', JSON.stringify({ ...snap, version: 99 }));

check('no request left localhost', external.length === 0, external.slice(0, 3).join(', '));
check('zero console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
