// Garages: drive-in body shops (minimap "G" icons). Roll the car onto the pad slowly and the shop
// menu opens; drive off and it closes. Every service costs cash and changes the car itself:
//   1 Repair    health back to 100, smoke and fire put out
//   2 Respray   next of 8 colours; a respray while the cops can't see you loses the wanted level
//   3 Engine    3 tiers: more acceleration, less drag, higher top speed
//   4 Handling  3 tiers: more lateral grip and sharper steering
//   5 Armour    3 tiers: the car takes 20 / 40 / 60 % less damage from bullets, blasts and crashes
// Upgrades live on that car (car.mods / car.perf), so a tuned car stays tuned until it's a wreck.
import * as THREE from 'three';

export const PAINTS = [
  { name: 'Sunset Coral', hex: 0xff5e5b }, { name: 'Lagoon Teal', hex: 0x12b5a5 }, { name: 'Neon Orchid', hex: 0xb44dff },
  { name: 'Pearl White', hex: 0xf3f0ea }, { name: 'Midnight Ink', hex: 0x1d2140 }, { name: 'Mango Gold', hex: 0xffb703 },
  { name: 'Lime Rush', hex: 0x8ae234 }, { name: 'Hot Magenta', hex: 0xff2e88 },
];
export const UPGRADES = {
  engine: { label: 'Engine', costs: [1200, 2600, 5000], key: 3 },
  handling: { label: 'Handling', costs: [900, 2000, 4200], key: 4 },
  armor: { label: 'Armour', costs: [1000, 2400, 4800], key: 5 },
};
export const RESPRAY_COST = 250;
const PAD_R = 6;

/** Per-car performance multipliers from its upgrade tiers (read by car_physics and damage). */
export function perfFor(mods) {
  return {
    accel: 1 + 0.16 * mods.engine,
    speed: 1 + 0.1 * mods.engine,
    drag: 1 - 0.07 * mods.engine,
    grip: 1 + 0.22 * mods.handling,
    steer: 1 + 0.08 * mods.handling,
    armor: 1 - 0.2 * mods.armor,
  };
}

export function createGarages(game, scene) {
  const { player, hud, world, vehicles } = game;
  const L = world.layout;
  const half = 10;
  // three shops on the kerb, mid-block, one each in Vela Beach, Neon Mile and Old Harbor
  const SPOTS = [
    { name: 'Coral Coast Customs', i: 6, j: 5, along: 'z' },
    { name: 'Neon Mile Body Works', i: 5, j: 1, along: 'z' },
    { name: 'Harbor Hull & Paint', i: 2, j: 4, along: 'x' },
  ];
  const garages = SPOTS.map((s) => {
    const x = s.along === 'z' ? L.roadX[s.i] + half - 3 : L.roadX[s.i] + 50;
    const z = s.along === 'z' ? L.roadZ[s.j] + 50 : L.roadZ[s.j] + half - 3;
    const g = { name: s.name, x, z, district: L.districtAt(x, z).name, visits: 0 };
    g.mesh = buildShop(x, z, s.along);
    return g;
  });

  function buildShop(x, z, along) {
    const grp = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.RingGeometry(PAD_R - 0.6, PAD_R, 40), new THREE.MeshBasicMaterial({ color: 0x2de2e6, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.07;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2733, roughness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff3d8b });
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), frameMat);
    const postR = postL.clone();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 0.6), frameMat);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.1, 0.25), glow);
    postL.position.set(-4.5, 2.5, 0); postR.position.set(4.5, 2.5, 0);
    beam.position.set(0, 5, 0); sign.position.set(0, 6.0, 0);
    const arch = new THREE.Group();
    arch.add(postL, postR, beam, sign);
    if (along === 'x') arch.rotation.y = Math.PI / 2;
    grp.add(pad, arch);
    grp.position.set(x, 0, z);
    scene.add(grp);
    return grp;
  }

  // ---- shop panel ----
  const panel = document.createElement('div');
  panel.id = 'garage-menu';
  panel.className = 'hidden';
  panel.style.cssText = 'position:absolute;right:18px;top:50%;transform:translateY(-50%);width:300px;padding:14px 16px;background:rgba(14,8,26,0.92);border:1px solid #ff3d8b;border-radius:10px;color:#f4ecff;font:14px system-ui,sans-serif;z-index:30;pointer-events:auto';
  document.getElementById('hud')?.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) buy(b.dataset.act);
  });

  const state = { open: null, cooldownFrom: null, last: null };
  const stats = { repairs: 0, resprays: 0, upgrades: 0, spent: 0, wantedLost: 0 };

  function modsOf(car) {
    if (!car.mods) car.mods = { engine: 0, handling: 0, armor: 0 };
    return car.mods;
  }
  function applyPerf(car) { car.perf = perfFor(modsOf(car)); }

  function repairCost(car) { return Math.max(50, Math.round((100 - car.health) * 6)); }

  function render() {
    const g = state.open;
    const car = player.state.car;
    if (!g || !car) return;
    const m = modsOf(car);
    const cash = player.state.cash;
    const row = (act, key, label, cost, extra = '') => {
      const can = cost != null && cash >= cost;
      return `<button type="button" data-act="${act}" style="display:flex;justify-content:space-between;width:100%;margin:4px 0;padding:7px 9px;border-radius:6px;border:1px solid ${can ? '#2de2e6' : '#554a66'};background:${can ? 'rgba(45,226,230,0.12)' : 'rgba(255,255,255,0.04)'};color:${can ? '#f4ecff' : '#8f86a0'};font:600 13px system-ui;cursor:pointer"><span>${key} · ${label}${extra}</span><span>${cost == null ? 'MAX' : '$' + cost.toLocaleString('en-US')}</span></button>`;
    };
    const tier = (k) => (m[k] >= 3 ? null : UPGRADES[k].costs[m[k]]);
    const paintIdx = PAINTS.findIndex((p) => p.hex === car.color);
    const nextPaint = PAINTS[(paintIdx + 1) % PAINTS.length];
    panel.innerHTML = `<div style="font:800 17px system-ui;letter-spacing:.06em;color:#ff3d8b">${g.name.toUpperCase()}</div>
      <div style="color:#b9a9cc;margin:2px 0 8px">${car.mesh.variant.name} · body ${Math.round(car.health)}% · cash $${cash.toLocaleString('en-US')}</div>
      ${row('repair', 1, 'Repair', car.health >= 99.5 ? null : repairCost(car))}
      ${row('respray', 2, `Respray → ${nextPaint.name}`, RESPRAY_COST)}
      ${row('engine', 3, `Engine [${'#'.repeat(m.engine)}${'-'.repeat(3 - m.engine)}]`, tier('engine'))}
      ${row('handling', 4, `Handling [${'#'.repeat(m.handling)}${'-'.repeat(3 - m.handling)}]`, tier('handling'))}
      ${row('armor', 5, `Armour [${'#'.repeat(m.armor)}${'-'.repeat(3 - m.armor)}]`, tier('armor'))}
      <div style="color:#b9a9cc;font-size:12px;margin-top:6px">Keys 1-5 or click · drive off the pad to leave</div>`;
  }

  /** Buys one service for the car on the pad. Returns true when it was paid for. */
  function buy(act) {
    const g = state.open;
    const car = player.state.car;
    const p = player.state;
    if (!g || !car) return false;
    const m = modsOf(car);
    let cost = null;
    if (act === 'repair') cost = car.health >= 99.5 ? null : repairCost(car);
    else if (act === 'respray') cost = RESPRAY_COST;
    else if (UPGRADES[act]) cost = m[act] >= 3 ? null : UPGRADES[act].costs[m[act]];
    if (cost == null) { hud.notify('Nothing to do there.', 1.2); return false; }
    if (p.cash < cost) { hud.notify(`Not enough cash ($${cost.toLocaleString('en-US')})`, 1.5); return false; }
    p.cash -= cost;
    stats.spent += cost;
    if (act === 'repair') {
      car.health = 100; car.onFire = false; car.impacts = 0;
      stats.repairs++;
      hud.notify(`${g.name}: good as new`, 2);
    } else if (act === 'respray') {
      const idx = PAINTS.findIndex((c) => c.hex === car.color);
      const paint = PAINTS[(idx + 1) % PAINTS.length];
      vehicles.paint(car, paint.hex);
      stats.resprays++;
      // a fresh colour the cops never saw: they lose you
      if (game.wanted > 0 && game.wantedFlash) {
        game.wantedSystem.clear();
        game.police.standDown();
        stats.wantedLost++;
        hud.notify(`Resprayed ${paint.name} — the cops lost your plate`, 3);
      } else hud.notify(`Resprayed ${paint.name}${game.wanted > 0 ? ' (they watched you drive in — still wanted)' : ''}`, 2.5);
    } else {
      m[act]++;
      applyPerf(car);
      stats.upgrades++;
      hud.notify(`${UPGRADES[act].label} tier ${m[act]} fitted`, 2);
    }
    state.last = { act, cost, garage: g.name };
    game.emit('garage', { act, cost, car, garage: g.name });
    render();
    return true;
  }

  function open(g) {
    state.open = g;
    g.visits++;
    game.menuOpen = true;
    panel.classList.remove('hidden');
    game.input.releaseLock?.();
    render();
    game.emit('garageOpen', { garage: g.name });
  }
  function close() {
    if (!state.open) return;
    state.cooldownFrom = state.open;
    state.open = null;
    game.menuOpen = false;
    panel.classList.add('hidden');
  }

  function step() {
    const p = player.state;
    const car = p.car;
    if (car && !car.mods) applyPerf(car);
    if (state.open) {
      const g = state.open;
      if (!car || car.wrecked || Math.hypot(car.x - g.x, car.z - g.z) > PAD_R + 1.5 || game.respawning) { close(); return; }
      for (let k = 1; k <= 5; k++) {
        if (game.input.take(`slot${k}`)) buy(['repair', 'respray', 'engine', 'handling', 'armor'][k - 1]);
      }
      if (game.input.take('leave')) close();
      return;
    }
    if (!car || car.wrecked || game.respawning) { state.cooldownFrom = null; return; }
    for (const g of garages) {
      const d = Math.hypot(car.x - g.x, car.z - g.z);
      if (g === state.cooldownFrom) { if (d > PAD_R + 4) state.cooldownFrom = null; continue; }
      if (d < PAD_R && Math.abs(car.speed) < 4) { open(g); break; }
    }
  }

  game.hudIcons = game.hudIcons ?? [];
  for (const g of garages) game.hudIcons.push({ x: g.x, z: g.z, glyph: 'G', color: '#2de2e6' });

  return { garages, state, stats, buy, open, close, step, modsOf, applyPerf, PAINTS, UPGRADES, PAD_R };
}
