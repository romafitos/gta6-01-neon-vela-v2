// Garages: drive-in body shops (minimap "G" icons). Roll the car onto the pad slowly and the shop
// menu opens; drive off and it closes. Every service costs cash and changes the car itself:
//   1 Repair    health back to 100, smoke and fire put out
//   2 Respray   next of 8 colours; a respray while the cops can't see you loses the wanted level
//   3 Engine    3 tiers: more acceleration, less drag, higher top speed
//   4 Handling  3 tiers: more lateral grip and sharper steering
//   5 Armour    3 tiers: the car takes 20 / 40 / 60 % less damage from bullets, blasts and crashes
// Upgrades live on that car (car.mods / car.perf), so a tuned car stays tuned until it's a wreck.
import * as THREE from 'three';
import { softBox } from '../core/shapes.js';

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
    g.mesh = buildShop(x, z, s.along, s.name);
    return g;
  });

  function buildShop(x, z, along, shopName) {
    const grp = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.RingGeometry(PAD_R - 0.6, PAD_R, 40), new THREE.MeshBasicMaterial({ color: 0x2de2e6, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.07;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2733, roughness: 0.6 });
    // slatted canopy: a dark teal roof tilted toward the street, held by four posts, pink neon
    // edge strips so the shop reads at dusk — no more flat pink slab
    const canopy = new THREE.Group();
    const roof = new THREE.Mesh(softBox(0.12, 1), new THREE.MeshStandardMaterial({ color: 0x1f3a44, roughness: 0.55, metalness: 0.25 }));
    roof.scale.set(10.5, 0.4, 8);
    roof.position.y = 5.2;
    roof.rotation.x = 0.1;
    canopy.add(roof);
    for (const [px, pz] of [[-4.8, -3.4], [4.8, -3.4], [-4.8, 3.4], [4.8, 3.4]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.2, 0.45), frameMat);
      post.position.set(px, 2.6, pz);
      canopy.add(post);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a3646, roughness: 0.7 }));
      foot.position.set(px, 0.12, pz);
      canopy.add(foot);
    }
    const neonEdge = new THREE.MeshBasicMaterial({ color: 0xff3d8b, toneMapped: false });
    for (const ez of [-3.9, 3.9]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.14, 0.14), neonEdge);
      strip.position.set(0, 5.05, ez);
      strip.rotation.x = 0.1;
      canopy.add(strip);
    }
    // shop sign: the name drawn on a canvas texture, pink neon letters on a dark board
    const signTex = shopSignTexture(shopName);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.1, 0.25), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 6.15, 0);
    canopy.add(sign);
    // props: a tyre stack, a red toolbox and two oil drums at the back of the pad
    const tyreGeo = new THREE.TorusGeometry(0.42, 0.17, 6, 12);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.92 });
    for (let t = 0; t < 3; t++) {
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(-4.2, 0.2 + t * 0.36, 3.2);
      canopy.add(tyre);
    }
    const toolbox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.5), new THREE.MeshStandardMaterial({ color: 0xd7263d, roughness: 0.5, metalness: 0.3 }));
    toolbox.position.set(4.3, 0.28, 3.1);
    canopy.add(toolbox);
    for (const [dx, col] of [[-3.6, 0x12b5a5], [-2.8, 0x8a8a92]]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.3 }));
      drum.position.set(dx, 0.48, 3.3);
      canopy.add(drum);
    }
    if (along === 'x') canopy.rotation.y = Math.PI / 2;
    grp.add(pad, canopy);
    grp.position.set(x, 0, z);
    scene.add(grp);
    return grp;
  }

/** Shop sign: the garage name in bold pink letters on a dark board, drawn once on a canvas. */
function shopSignTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 88;
  const g = c.getContext('2d');
  g.fillStyle = '#14081a';
  g.fillRect(0, 0, 512, 88);
  g.strokeStyle = '#ff3d8b';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 504, 80);
  g.fillStyle = '#ff5e9c';
  g.font = '800 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 256, 46);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
