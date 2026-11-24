// The card HUD: everything the player needs, laid out as rounded glass cards that read at a glance.
//   top-left     MISSION card (job number + name, STAGE x/y progress bar, objective, NEXT stage)
//                POLICE RESPONSE card (each active unit: call sign, role, distance) under it
//   left         DISTRICT card (name, flavour line, standing word + control bar) over the minimap
//   top-right    clock, cash, wanted stars + status line, RANK card with respect bar,
//                weapon slots (icon, ammo), crew ability cards with portraits and hotkeys
//   bottom-right speedometer, car name, damage %, radio station
//   bottom       dialogue box: portrait + speaker + line, for mission givers and crew calls
// Cards are re-rendered from game state five times a second; DOM writes only on change.
import { RANKS } from '../missions/mission_data.js';
import { WEAPONS } from '../combat/weapons.js';

const DISTRICT_LINES = {
  'VELA BEACH': 'Boardwalk, surf shacks and the pier',
  'NEON MILE': 'Clubs, towers and all-night signs',
  'OLD HARBOR': 'Cranes, warehouses and the fish market',
  'PALMA HEIGHTS': 'Hillside villas behind the palms',
};
const ROLE_LABEL = { chase: 'PURSUIT', search: 'SEARCHING', ram: 'RAMMING', pit: 'PIT MANOEUVRE', roadblock: 'ROADBLOCK' };
const ROLE_HOT = { ram: 1, pit: 1 };

/** A small painted head-and-shoulders portrait, the same for a given name every time. */
const portraits = new Map();
export function portrait(name, shirt = '#8338ec') {
  const key = `${name}|${shirt}`;
  if (portraits.has(key)) return portraits.get(key);
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const pick = (arr) => arr[(h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0 % arr.length] ?? arr[0];
  const pickI = (arr) => arr[((h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0) % arr.length];
  void pick;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 64);
  bg.addColorStop(0, pickI(['#1f6f78', '#5b3c88', '#8a3b4a', '#2d5a8a', '#3c6e47']));
  bg.addColorStop(1, '#141824');
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 64);
  const skin = pickI(['#8d5524', '#c68642', '#e0ac69', '#6b4226', '#f1c27d']);
  const hair = pickI(['#1b1b1b', '#3b2414', '#5a3a1a', '#111111', '#7a5230']);
  // shoulders
  g.fillStyle = shirt;
  g.beginPath(); g.ellipse(32, 66, 26, 18, 0, Math.PI, 0); g.fill();
  // neck + head
  g.fillStyle = skin;
  g.fillRect(27, 38, 10, 10);
  g.beginPath(); g.ellipse(32, 29, 12, 14, 0, 0, Math.PI * 2); g.fill();
  // hair: one of a few cuts
  g.fillStyle = hair;
  const cut = pickI([0, 1, 2, 3]);
  g.beginPath(); g.ellipse(32, 21, 13, 8, 0, Math.PI, 0); g.fill();
  if (cut === 1) { g.fillRect(19, 20, 5, 22); g.fillRect(40, 20, 5, 22); }
  if (cut === 2) { g.beginPath(); g.ellipse(32, 18, 12, 6, 0, 0, Math.PI * 2); g.fill(); }
  if (cut === 3) { g.fillRect(20, 16, 24, 6); g.fillStyle = shirt; g.fillRect(19, 14, 26, 4); }
  // eyes, brows, mouth
  g.fillStyle = '#1a1a1a';
  g.fillRect(26, 28, 3, 3); g.fillRect(35, 28, 3, 3);
  g.fillRect(25, 25, 5, 1); g.fillRect(34, 25, 5, 1);
  g.fillStyle = 'rgba(80,30,30,0.8)';
  g.fillRect(29, 36, 6, 1.5);
  const url = c.toDataURL('image/png');
  portraits.set(key, url);
  return url;
}

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function createCards(game) {
  const hud = document.getElementById('hud');
  hud.classList.add('cards-on');
  const root = document.createElement('div');
  root.id = 'cards';
  root.innerHTML = `
    <div id="card-mission" class="card mission hidden"></div>
    <div id="card-police" class="card police hidden"></div>
    <div id="card-district" class="card district"></div>
    <div id="card-top-right">
      <div id="hud-clock"></div>
      <div id="hud-cash"></div>
      <div id="hud-wanted"></div>
      <div id="card-rank" class="card rank"></div>
      <div id="weapon-slots"></div>
      <div id="ability-cards"></div>
    </div>
    <div id="card-speed" class="hidden"></div>
    <div id="card-vitals" class="card vitals"></div>
    <div id="dialogue" class="card dialogue hidden"></div>`;
  hud.appendChild(root);
  const $ = (id) => document.getElementById(id);
  const els = {
    mission: $('card-mission'), police: $('card-police'), district: $('card-district'), clock: $('hud-clock'),
    cash: $('hud-cash'), wanted: $('hud-wanted'), rank: $('card-rank'), slots: $('weapon-slots'),
    abilities: $('ability-cards'), speed: $('card-speed'), vitals: $('card-vitals'), dialogue: $('dialogue'),
  };
  const last = {};
  const put = (key, html) => { if (last[key] !== html) { last[key] = html; els[key].innerHTML = html; } };
  const show = (key, on) => els[key].classList.toggle('hidden', !on);

  // dialogue: any notice spoken by someone ("Name: line") becomes a dialogue box for a few seconds
  let talk = null;
  const notify = game.hud.notify;
  game.hud.notify = (text, seconds = 3) => {
    notify(text, seconds);
    const m = /^(?:[A-Z0-9' —-]+ — )?([A-Z][\w"' .-]{1,30}?): "?(.+?)"?$/.exec(String(text));
    if (m && !/^(Dispatch|Unit \d+)$/.test(m[1])) talk = { who: m[1], line: m[2], t: Math.max(4, seconds) };
  };
  game.hud.say = (who, line, seconds = 5) => { talk = { who, line, t: seconds }; };

  let tick = 1;
  function frame(dt) {
    if (talk) { talk.t -= dt; if (talk.t <= 0) talk = null; }
    tick += dt;
    if (tick < 0.2) return;
    tick = 0;
    const p = game.player.state;

    // ---- mission card ----
    const act = game.missions.state.active;
    show('mission', !!act);
    if (act) {
      const def = act.def;
      const idx = game.missions.MISSIONS.indexOf(def) + 1;
      const n = def.stages.length;
      const si = Math.max(0, act.si);
      const next = def.stages[si + 1]?.label;
      const pips = def.stages.map((_, i) => `<i class="${i < si ? 'done' : i === si ? 'now' : ''}"></i>`).join('');
      put('mission', `<div class="kicker">MISSION ${idx} · ${esc(def.name.toUpperCase())}</div>
        <div class="stage-row"><span class="stage-tag">STAGE ${si + 1}/${n}</span><span class="stage-name">${esc((def.stages[si]?.label ?? 'Head to the marker').toUpperCase())}</span></div>
        <div class="pips">${pips}</div>
        <div class="obj">${esc(document.getElementById('objective')?.textContent || def.stages[si]?.label || '')}</div>
        ${next ? `<div class="next"><b>NEXT</b> ${esc(next)}</div>` : '<div class="next"><b>NEXT</b> Payday</div>'}`);
    }

    // ---- police response card ----
    const stars = game.wanted;
    const ox = p.car ? p.car.x : p.x;
    const oz = p.car ? p.car.z : p.z;
    const units = [];
    const heli = game.police.heli;
    if (heli && heli.active) units.push({ sign: 'KESTREL-7', role: 'AIR UNIT', d: Math.hypot(heli.x - ox, heli.z - oz), hot: 0, air: 1 });
    for (const c of game.police.cruisers) {
      if (c.disabled || c.wrecked) continue;
      units.push({ sign: `VCPD-${String(c.unit * 7 + 11).padStart(2, '0')}`, role: ROLE_LABEL[c.role] ?? 'PATROL', d: Math.hypot(c.x - ox, c.z - oz), hot: ROLE_HOT[c.role] ?? 0 });
    }
    const foot = game.police.cops.filter((c) => c.active && !(c.dead > 0)).length;
    if (foot) units.push({ sign: `FOOT ×${foot}`, role: 'FOOT CHASE', d: Math.min(...game.police.cops.filter((c) => c.active).map((c) => Math.hypot(c.x - ox, c.z - oz))), hot: 0 });
    units.sort((a, b) => a.d - b.d);
    show('police', stars > 0 && units.length > 0);
    if (stars > 0 && units.length) {
      const rows = units.slice(0, 5).map((u) => `<div class="unit ${u.hot ? 'hot' : ''} ${u.air ? 'air' : ''}"><span class="sign">${u.air ? '&#9650;' : '&#9632;'} ${u.sign}</span><span class="role">${u.role}</span><span class="dist">${Math.round(u.d)} m</span></div>`).join('');
      const more = units.length > 5 ? `<div class="more">+${units.length - 5} more</div>` : '';
      const lines = game.hud.radioLines;
      const feed = lines.length ? `<div class="feed">${esc(lines[lines.length - 1].div.textContent)}</div>` : '';
      put('police', `<div class="kicker red">VCPD RESPONSE <span>${units.length} UNIT${units.length > 1 ? 'S' : ''}</span></div>${rows.replace(/(<div class="unit[^"]*">)(?![\s\S]*<div class="unit)/, '$1')}${more}${feed}`);
    }

    // ---- district card ----
    const dist = game.progression.districtAt(ox, oz);
    if (dist) {
      const ctl = Math.round(dist.control);
      const word = ctl >= 70 ? 'FRIENDLY' : ctl >= 40 ? 'NEUTRAL' : 'HOSTILE';
      put('district', `<div class="dname">${esc(dist.name)}</div><div class="dline">${esc(DISTRICT_LINES[dist.name] ?? '')}</div>
        <div class="standing ${word.toLowerCase()}"><span>${word} · ${ctl}</span><div class="bar"><i style="width:${ctl}%"></i></div></div>`);
    }

    // ---- clock, cash, wanted ----
    const mins = (17 * 60 + 10 + Math.floor(game.time / 2)) % (24 * 60);
    put('clock', `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
    put('cash', `$${p.cash.toLocaleString('en-US')}`);
    const st = Array.from({ length: 5 }, (_, i) => `<b class="${i < stars ? 'on' : ''}">&#9733;</b>`).join('');
    const status = stars >= 4 ? 'AIR UNIT DEPLOYED' : stars >= 3 ? 'ROADBLOCKS UP' : stars >= 1 ? 'UNITS RESPONDING' : '';
    put('wanted', `<div class="stars ${game.wantedFlash ? 'flash' : ''}">${st}</div><div class="wstatus">${status}</div>`);

    // ---- rank card ----
    const ri = RANKS.findIndex((r) => r.name === game.progression.state.rank);
    const cur = RANKS[ri] ?? RANKS[0];
    const nxt = RANKS[ri + 1];
    const pct = nxt ? Math.min(100, ((p.respect - cur.at) / (nxt.at - cur.at)) * 100) : 100;
    put('rank', `<div class="rk"><span class="rk-tag">RANK ${ri + 1}</span><span class="rk-name">${esc(cur.name.toUpperCase())}</span></div>
      <div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div><div class="rk-sub">${p.respect} / ${nxt ? nxt.at : p.respect} RESPECT</div>`);

    // ---- weapon slots ----
    if (!p.car) {
      const wi = game.weapons.state.index;
      const slots = game.weapons.arsenal.map((a, i) => {
        const w = a.def;
        const ammo = w.melee ? '&infin;' : `${a.clip}/${a.reserve}`;
        return `<div class="slot ${i === wi ? 'sel' : ''} ${a.owned ? '' : 'locked'}"><span class="n">${w.slot}</span><span class="ico">${w.icon}</span><span class="am">${a.owned ? ammo : '—'}</span></div>`;
      }).join('');
      put('slots', slots);
    } else put('slots', '');

    // ---- crew ability cards ----
    const crew = game.crew.crew();
    const cd = game.crew.ability?.cooldown ?? 0;
    const cards = crew.slice(0, 3).map((m, i) => {
      const role = ['Hacker', 'Bodyguard', 'Mechanic'][m.id] ?? 'Crew';
      const key = i === 0 ? 'G' : 'C';
      const label = i === 0 ? 'SHOCK GRENADE' : i === 1 ? 'COVER FIRE' : 'FOLLOW ME';
      const ready = i === 0 ? cd <= 0 : true;
      return `<div class="ability ${ready ? 'ready' : ''}"><img src="${portrait(m.name, hex([0x8338ec, 0x6a2bd6, 0x9b5de5][m.id] ?? 0x8338ec))}" alt=""><div><b>${label}</b><span>${esc(m.name.split(' ')[0])} · ${role}</span></div><kbd>${ready ? key : Math.ceil(cd)}</kbd></div>`;
    }).join('');
    put('abilities', cards);

    // ---- speedometer + vitals ----
    show('speed', !!p.car);
    if (p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 3.6);
      const dent = Math.max(0, Math.round(100 - p.car.health));
      const station = document.getElementById('station');
      const radio = station && !station.classList.contains('hidden') ? station.textContent : 'RADIO OFF';
      put('speed', `<div class="kmh">${kmh}</div><div class="unit">KM/H</div><div class="car">${esc(p.car.mesh.variant.name.toUpperCase())}</div>
        <div class="dent ${dent > 50 ? 'bad' : ''}">${dent}% DENTED</div><div class="bar"><i style="width:${100 - dent}%"></i></div><div class="fm">&#9835; ${esc(radio)}</div>`);
    }
    put('vitals', `<div class="vrow"><span>HEALTH</span><div class="bar hp"><i style="width:${Math.max(0, Math.round(p.health))}%"></i></div><b>${Math.max(0, Math.round(p.health))}</b></div>
      <div class="vrow"><span>ARMOUR</span><div class="bar ar"><i style="width:${Math.round(p.armor)}%"></i></div><b>${Math.round(p.armor)}</b></div>`);

    // ---- dialogue ----
    show('dialogue', !!talk);
    if (talk) {
      const crewHit = game.crew.members.find((m) => m.name.startsWith(talk.who) || m.name.includes(`"${talk.who}"`));
      put('dialogue', `<img src="${portrait(talk.who, crewHit ? '#8338ec' : '#c0392b')}" alt=""><div><b>${esc(talk.who.toUpperCase())}</b><p>${esc(talk.line)}</p></div>`);
    }
  }

  return { frame, portrait, els };
}
