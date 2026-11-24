// The pause menu (Esc): a full-screen tabbed menu over the frozen city.
//   MAP       the whole city drawn from the layout: blocks tinted by district standing, district
//             names with control %, mission giver / garage / race icons, your position; click
//             anywhere to drop a waypoint (shown on the minimap with a GPS line)
//   STORY     the ten jobs with their giver, district and status
//   STATS     completion ring (jobs, races, districts, crew, garage upgrades), a checklist with
//             progress bars, and career numbers taken from every system's own counters
//   CREW      the three recruits, their weapon, status and the shock-grenade ability
//   CONTROLS  every key binding
//   SAVE      the autosave slot and a Save now button
// Q / E (or the tab buttons) switch tabs; Esc or Resume closes it.
import { portrait } from './cards.js';
import { RANKS } from '../missions/mission_data.js';

const TABS = ['MAP', 'STORY', 'STATS', 'CREW', 'CONTROLS', 'SAVE'];
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function createPauseMenu(game) {
  const pauseEl = document.getElementById('pause');
  pauseEl.classList.add('menu-on');
  pauseEl.innerHTML = `
    <div class="pm">
      <header class="pm-head">
        <div class="pm-logo">NEON<span>VELA</span></div>
        <nav class="pm-tabs">${TABS.map((t, i) => `<button type="button" data-tab="${i}" class="pm-tab">${t}</button>`).join('')}</nav>
        <div class="pm-cash" id="pm-cash"></div>
      </header>
      <main class="pm-body" id="pm-body"></main>
      <footer class="pm-foot">ESC resume · Q / E switch tab · click the map to set a waypoint <button id="resume-btn" type="button" class="pm-resume">RESUME</button></footer>
    </div>`;
  const body = pauseEl.querySelector('#pm-body');
  const tabBtns = [...pauseEl.querySelectorAll('.pm-tab')];
  const state = { tab: 2, waypoint: null, saves: 0 };

  function completion() {
    const m = game.missions.state.done.length;
    const racesWon = Object.keys(game.races.best ?? {}).length;
    const dists = game.progression.districts;
    const friendly = dists.filter((d) => d.control >= 70).length;
    const crew = game.crew.crew().length;
    const mods = game.garages?.garages ? Math.min(9, (() => {
      const car = game.player.state.car ?? game.spawnCar;
      const md = car?.mods ?? {};
      return (md.engine ?? 0) + (md.handling ?? 0) + (md.armor ?? 0);
    })()) : 0;
    const items = [
      ['Story missions', m, 10],
      ['Street races won', racesWon, 3],
      ['Districts FRIENDLY', friendly, 4],
      ['Crew recruited', crew, 3],
      ['Garage upgrades', mods, 9],
      ['Respect ranks', Math.max(0, RANKS.findIndex((r) => r.name === game.progression.state.rank)), RANKS.length - 1],
    ];
    const weights = [50, 12, 14, 8, 8, 8];
    const pct = items.reduce((a, [, v, max], i) => a + (weights[i] * Math.min(v, max)) / max, 0);
    return { items, pct };
  }

  function drawMap(canvas) {
    const L = game.world.layout;
    const b = L.bounds;
    const W = canvas.width;
    const H = canvas.height;
    const g = canvas.getContext('2d');
    const sx = W / (b.maxX - b.minX);
    const sz = H / (b.maxZ + 40 - b.minZ);
    const s = Math.min(sx, sz);
    const ox = (W - (b.maxX - b.minX) * s) / 2;
    const oz = (H - (b.maxZ + 40 - b.minZ) * s) / 2;
    const X = (x) => ox + (x - b.minX) * s;
    const Z = (z) => oz + (z - b.minZ) * s;
    g.fillStyle = '#2b6f8a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3d4048'; g.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * s, (b.beachStart - b.minZ) * s);
    g.fillStyle = '#e8cf9a'; g.fillRect(X(b.minX), Z(b.beachStart), (b.maxX - b.minX) * s, (b.beachEnd - b.beachStart) * s);
    const dcol = (d) => (d.control >= 70 ? [88, 150, 96] : d.control >= 40 ? [128, 120, 112] : [150, 82, 86]);
    for (const blk of L.blocks) {
      const d = game.progression.districtAt((blk.minX + blk.maxX) / 2, (blk.minZ + blk.maxZ) / 2);
      const [r, gg, bb] = dcol(d);
      g.fillStyle = `rgb(${r + 40},${gg + 40},${bb + 40})`;
      g.fillRect(X(blk.minX) + 1, Z(blk.minZ) + 1, (blk.maxX - blk.minX) * s - 2, (blk.maxZ - blk.minZ) * s - 2);
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      g.fillRect(X(blk.minX) + 4, Z(blk.minZ) + 4, (blk.maxX - blk.minX) * s - 8, (blk.maxZ - blk.minZ) * s - 8);
    }
    for (const bl of L.buildings) {
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fillRect(X(bl.minX), Z(bl.minZ), (bl.maxX - bl.minX) * s, (bl.maxZ - bl.minZ) * s);
    }
    // icons: garages, races, next mission giver
    const icons = game.minimap.getIcons?.() ?? [];
    g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const ic of icons) {
      g.fillStyle = ic.color ?? '#fff';
      g.beginPath(); g.roundRect?.(X(ic.x) - 8, Z(ic.z) - 8, 16, 16, 4); g.fill();
      g.fillStyle = '#111'; g.fillText(ic.glyph ?? '?', X(ic.x), Z(ic.z) + 0.5);
    }
    for (const [id, mk] of game.minimap.markers) {
      g.fillStyle = mk.color ?? '#ffd23f';
      g.beginPath(); g.arc(X(mk.x), Z(mk.z), id === 'waypoint' ? 7 : 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
    }
    // district labels
    g.font = 'italic 900 17px system-ui, sans-serif';
    for (const d of game.progression.districts) {
      const cx = X((d.minX + d.maxX) / 2);
      const cz = Z((d.minZ + Math.min(d.maxZ, b.beachStart)) / 2);
      g.lineWidth = 4; g.strokeStyle = 'rgba(10,12,20,0.85)';
      g.strokeText(d.name, cx, cz - 8);
      g.fillStyle = '#ffc65a'; g.fillText(d.name, cx, cz - 8);
      g.font = '800 11px system-ui, sans-serif';
      const word = d.control >= 70 ? 'FRIENDLY' : d.control >= 40 ? 'NEUTRAL' : 'HOSTILE';
      g.strokeText(`${word} · ${Math.round(d.control)}`, cx, cz + 9);
      g.fillStyle = d.control >= 70 ? '#7ff0c8' : d.control >= 40 ? '#f3efe8' : '#ff8d97';
      g.fillText(`${word} · ${Math.round(d.control)}`, cx, cz + 9);
      g.font = 'italic 900 17px system-ui, sans-serif';
    }
    // the player
    const p = game.player.state;
    g.save(); g.translate(X(p.x), Z(p.z)); g.rotate(-p.heading + Math.PI);
    g.fillStyle = '#ff5f6d'; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); g.restore();
    return { toWorld: (px, pz) => ({ x: b.minX + (px - ox) / s, z: b.minZ + (pz - oz) / s }) };
  }

  function careerStats() {
    const w = game.weapons.stats;
    const pol = game.police.stats;
    const dmg = game.combat?.stats ?? {};
    const st = game.stats;
    return [
      [st.carjacks + st.carEntries, 'CARS DRIVEN'],
      [pol.rams + pol.pits, 'POLICE TAKEDOWNS ON YOU'],
      [`${w.shots}`, 'SHOTS FIRED'],
      [w.shots ? `${Math.round((w.hits / w.shots) * 100)}%` : '0%', 'ACCURACY'],
      [w.kills, 'TAKEDOWNS'],
      [dmg.explosions ?? 0, 'EXPLOSIONS'],
      [game.races.stats.finished, 'RACES FINISHED'],
      [game.crew.stats.abilities, 'CREW ABILITIES USED'],
    ];
  }

  function render() {
    tabBtns.forEach((b, i) => b.classList.toggle('on', i === state.tab));
    pauseEl.querySelector('#pm-cash').textContent = `$${game.player.state.cash.toLocaleString('en-US')}`;
    const tab = TABS[state.tab];
    const p = game.player.state;
    const ri = RANKS.findIndex((r) => r.name === game.progression.state.rank);
    const nxt = RANKS[ri + 1];
    const rankCard = `<section class="pm-card"><h3>RANK ${ri + 1} · ${esc(game.progression.state.rank.toUpperCase())}</h3>
      <div class="bar"><i style="width:${nxt ? Math.min(100, ((p.respect - RANKS[ri].at) / (nxt.at - RANKS[ri].at)) * 100).toFixed(0) : 100}%"></i></div>
      <p>${p.respect} respect${nxt ? ` · ${nxt.at - p.respect} to ${esc(nxt.name)}` : ' · top rank'}</p></section>`;
    if (tab === 'STATS' || tab === 'MAP') {
      const { items, pct } = completion();
      const left = tab === 'STATS'
        ? `<section class="pm-card ring-card"><div class="ring" style="--p:${pct.toFixed(1)}"><div><b>${pct.toFixed(1)}%</b><span>COMPLETE</span></div></div>
            <ul class="check">${items.map(([n, v, max]) => `<li class="${v >= max ? 'full' : ''}"><i></i><span>${n}</span><div class="bar"><i style="width:${(Math.min(v, max) / max) * 100}%"></i></div><b>${Math.min(v, max)}/${max}</b></li>`).join('')}</ul></section>`
        : `<section class="pm-card"><h3>LEGEND</h3><ul class="legend"><li><i style="background:#58a060"></i>Friendly turf</li><li><i style="background:#807870"></i>Neutral</li><li><i style="background:#965256"></i>Hostile</li><li><i style="background:#ffd23f"></i>Job giver</li><li><i style="background:#3cf0ff"></i>Objective</li><li><i style="background:#ff5f6d"></i>You</li></ul>
            <p class="hint">${state.waypoint ? `Waypoint set · ${Math.round(Math.hypot(state.waypoint.x - p.x, state.waypoint.z - p.z))} m` : 'Click the map to set a waypoint'}</p></section>`;
      const right = tab === 'STATS'
        ? `${rankCard}<section class="pm-card"><h3>CAREER</h3><div class="career">${careerStats().map(([v, k]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div></section>`
        : `${rankCard}<section class="pm-card"><h3>DISTRICTS</h3>${game.progression.districts.map((d) => `<div class="drow"><span>${esc(d.name)}</span><div class="bar"><i style="width:${d.control}%"></i></div><b>${Math.round(d.control)}%</b></div>`).join('')}</section>`;
      body.innerHTML = `<div class="pm-left">${left}</div><div class="pm-map"><canvas id="pm-map" width="620" height="440"></canvas></div><div class="pm-right">${right}</div>`;
      const canvas = body.querySelector('#pm-map');
      const map = drawMap(canvas);
      canvas.addEventListener('click', (ev) => {
        const r = canvas.getBoundingClientRect();
        const pt = map.toWorld(((ev.clientX - r.left) / r.width) * canvas.width, ((ev.clientY - r.top) / r.height) * canvas.height);
        setWaypoint(pt.x, pt.z);
      });
    } else if (tab === 'STORY') {
      const done = game.missions.state.done;
      const act = game.missions.state.active?.def?.id;
      body.innerHTML = `<section class="pm-card wide"><h3>THE STORY SO FAR · ${done.length}/10 JOBS</h3><ol class="story">${game.missions.MISSIONS.map((m, i) => {
        const status = done.includes(m.id) ? 'DONE' : act === m.id ? 'ACTIVE' : game.missions.nextMission()?.id === m.id ? 'NEXT' : 'LOCKED';
        return `<li class="${status.toLowerCase()}"><span class="num">${i + 1}</span><img src="${portrait(m.giver, '#c0392b')}" alt=""><div><b>${esc(m.name)}</b><span>${esc(m.giver)} · ${esc(m.district)} · ${esc(m.type)}</span></div><em>${status}</em></li>`;
      }).join('')}</ol></section>`;
    } else if (tab === 'CREW') {
      body.innerHTML = `<section class="pm-card wide"><h3>CREW · ${game.crew.crew().length}/${game.progression.state.crewSlots} SLOTS</h3><div class="crew">${game.crew.members.map((m) => `<div class="cm ${m.recruited ? 'in' : ''}"><img src="${portrait(m.name, '#8338ec')}" alt=""><b>${esc(m.name)}</b><span>${m.def.name ?? ''}</span><em>${m.recruited ? 'IN YOUR CREW' : 'NOT HIRED · C near them'}</em></div>`).join('')}</div>
        <p class="hint">G · Shock Grenade: 70 damage in 7 m and an EMP that stops police and traffic engines within 16 m for 6 s (18 s cooldown).</p></section>`;
    } else if (tab === 'CONTROLS') {
      body.innerHTML = `<section class="pm-card wide"><h3>CONTROLS</h3><div class="keys">${game.hud.helpRows.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div></section>`;
    } else if (tab === 'SAVE') {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(game.saves.SAVE_KEY) || 'null'); } catch { saved = null; }
      const when = saved?.savedAt ? new Date(saved.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
      body.innerHTML = `<section class="pm-card wide"><h3>SAVE</h3><div class="slot-row"><div><b>AUTOSAVE · ${saved ? `${saved.missions?.length ?? 0}/10 jobs · $${(saved.cash ?? 0).toLocaleString('en-US')}` : 'empty'}</b><span>${saved ? `${esc(saved.rank ?? '')} · saved ${when}` : 'Saves after every job, race, garage visit and each minute'}</span></div>
        <button type="button" id="pm-save" class="pm-btn">SAVE NOW</button></div><p class="hint" id="pm-save-note">${state.saves ? 'Saved.' : ''}</p></section>`;
      body.querySelector('#pm-save').addEventListener('click', () => {
        game.saves.save('menu');
        state.saves++;
        render();
      });
    }
  }

  function setWaypoint(x, z) {
    state.waypoint = { x, z };
    game.minimap.setMarker('waypoint', { x, z, color: '#ff5fd2' });
    if (!game.missions.state.active) game.minimap.setRoute?.(game.missions.gpsRoute?.(game.player.state, { x, z }) ?? null);
    game.emit?.('waypoint', { x, z });
    render();
  }

  tabBtns.forEach((b) => b.addEventListener('click', () => { state.tab = Number(b.dataset.tab); render(); }));
  window.addEventListener('keydown', (e) => {
    if (pauseEl.classList.contains('hidden')) return;
    if (e.code === 'KeyQ') { state.tab = (state.tab + TABS.length - 1) % TABS.length; render(); }
    if (e.code === 'KeyE') { state.tab = (state.tab + 1) % TABS.length; render(); }
  });

  return { state, render, setTab: (i) => { state.tab = i; render(); }, setWaypoint, TABS, completion };
}
