// Minimap: the city pre-drawn once onto an offscreen canvas (roads, blocks, parks, beach, sea),
// then each frame a rotated, player-centred window of it with the player arrow, nearby cars and
// any objective markers. Off-map objectives are pinned to the rim so the player always has a
// direction. M toggles a big full-map view.
import { CITY } from '../core/config.js';

const SCALE = 1; // offscreen pixels per metre

export function createMinimap(canvas, layout) {
  const ctx = canvas.getContext('2d');
  const { bounds } = layout;
  const W = Math.ceil(bounds.maxX - bounds.minX + 40);
  const H = Math.ceil(bounds.maxZ - bounds.minZ + 120);
  const ox = bounds.minX - 20;
  const oz = bounds.minZ - 20;
  const base = document.createElement('canvas');
  base.width = W * SCALE;
  base.height = H * SCALE;
  const b = base.getContext('2d');
  b.fillStyle = '#3a3346';
  b.fillRect(0, 0, W, H);
  b.fillStyle = '#1b6f8a';
  b.fillRect(0, bounds.beachEnd - oz, W, H);
  b.fillStyle = '#e8c48e';
  b.fillRect(0, bounds.beachStart - oz, W, bounds.beachEnd - bounds.beachStart);
  for (const blk of layout.blocks) {
    b.fillStyle = blk.park ? '#4f7f35' : '#8d8494';
    b.fillRect(blk.minX - ox, blk.minZ - oz, blk.maxX - blk.minX, blk.maxZ - blk.minZ);
  }
  for (const bd of layout.buildings) {
    b.fillStyle = bd.district === 'NEON MILE' ? '#5d4b7a' : '#6a5f70';
    b.fillRect(bd.minX - ox, bd.minZ - oz, bd.maxX - bd.minX, bd.maxZ - bd.minZ);
  }
  b.strokeStyle = 'rgba(255,209,102,0.35)';
  b.lineWidth = 1;
  for (const x of layout.roadX) { b.beginPath(); b.moveTo(x - ox, layout.roadZ[0] - oz); b.lineTo(x - ox, layout.roadZ[layout.roadZ.length - 1] - oz); b.stroke(); }
  for (const z of layout.roadZ) { b.beginPath(); b.moveTo(layout.roadX[0] - ox, z - oz); b.lineTo(layout.roadX[layout.roadX.length - 1] - ox, z - oz); b.stroke(); }

  const markers = new Map(); // id -> {x, z, color, label}
  let big = false;
  let route = null; // GPS line: world points along the road graph

  function setMarker(id, marker) { if (marker) markers.set(id, marker); else markers.delete(id); }
  function setRoute(points) { route = points && points.length > 1 ? points : null; }
  let tintSource = null; // () => [{minX,maxX,minZ,maxZ,color,label}] district control tints
  function setTints(fn) { tintSource = fn; }
  let iconSource = null; // () => [{x,z,glyph,color}] fixed places (garages, races, recruits)
  function setIcons(fn) { iconSource = fn; }

  /** player = {x, z, heading}; yaw = camera yaw (map rotates with the camera). */
  function draw(player, yaw, cars, extras = []) {
    const size = canvas.width;
    const r = size / 2;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#120c1e';
    ctx.fillRect(0, 0, size, size);
    const zoom = big ? size / (Math.max(W, H) * 0.95) : 0.85;
    const rot = big ? 0 : yaw - Math.PI;
    ctx.translate(r, r);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    if (big) ctx.translate(-(W / 2), -(H / 2));
    else ctx.translate(-(player.x - ox), -(player.z - oz));
    ctx.drawImage(base, 0, 0, W, H);
    if (tintSource) {
      // district control: every district washed red→green by how much of it is yours
      for (const t of tintSource()) {
        ctx.fillStyle = big ? t.color : t.color.replace(/[\d.]+\)$/, '0.12)');
        ctx.fillRect(t.minX - ox, t.minZ - oz, t.maxX - t.minX, t.maxZ - t.minZ);
        if (big) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = `bold ${Math.round(14 / zoom)}px system-ui, sans-serif`;
          ctx.fillText(t.label, t.minX - ox + 12 / zoom, t.minZ - oz + 22 / zoom);
        }
      }
    }
    // cars
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const c of cars) {
      if (c.disabled) continue;
      ctx.fillStyle = c.kind === 'police' && !c.wrecked ? (blink ? '#ff3040' : '#3a7bff') : c.wrecked ? '#333' : 'rgba(255,255,255,0.75)';
      const s = c.kind === 'police' ? 6 : 3;
      ctx.fillRect(c.x - ox - s / 2, c.z - oz - s / 2, s, s);
    }
    for (const u of extras) { ctx.fillStyle = u.color; ctx.beginPath(); ctx.arc(u.x - ox, u.z - oz, u.r ?? 2.5, 0, Math.PI * 2); ctx.fill(); }
    if (route) {
      // GPS: a bright line along the roads to the objective
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = (big ? 9 : 7) / zoom;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((pt, k) => (k ? ctx.lineTo(pt.x - ox, pt.z - oz) : ctx.moveTo(pt.x - ox, pt.z - oz)));
      ctx.stroke();
      ctx.strokeStyle = '#c86bff';
      ctx.lineWidth = (big ? 5 : 4) / zoom;
      ctx.stroke();
    }
    ctx.restore();

    // markers: projected, then clamped to the rim
    const project = (x, z) => {
      let dx; let dz;
      if (big) { dx = (x - ox - W / 2) * zoom; dz = (z - oz - H / 2) * zoom; }
      else {
        const rx = (x - player.x) * zoom;
        const rz = (z - player.z) * zoom;
        dx = rx * Math.cos(rot) - rz * Math.sin(rot);
        dz = rx * Math.sin(rot) + rz * Math.cos(rot);
      }
      return { dx, dz };
    };
    if (iconSource) {
      for (const ic of iconSource()) {
        const { dx, dz } = project(ic.x, ic.z);
        if (!big && Math.hypot(dx, dz) > r - 8) continue;
        ctx.fillStyle = 'rgba(10,6,20,0.85)';
        ctx.fillRect(r + dx - 7, r + dz - 7, 14, 14);
        ctx.strokeStyle = ic.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r + dx - 7, r + dz - 7, 14, 14);
        ctx.fillStyle = ic.color;
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(ic.glyph, r + dx - 3.5, r + dz + 3.5);
      }
    }
    for (const m of markers.values()) {
      let { dx, dz } = project(m.x, m.z);
      const d = Math.hypot(dx, dz);
      const edge = r - 10;
      const pinned = d > edge;
      if (pinned && !big) { dx = (dx / d) * edge; dz = (dz / d) * edge; }
      ctx.fillStyle = m.color ?? '#ffd23f';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r + dx, r + dz, pinned ? 5 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // player arrow
    const p = project(player.x, player.z);
    ctx.save();
    ctx.translate(r + p.dx, r + p.dz);
    ctx.rotate(-(player.heading) + (big ? 0 : rot) + Math.PI);
    ctx.fillStyle = '#ffb347';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // north tick
    if (!big) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px system-ui, sans-serif';
      const n = { dx: Math.sin(rot) * (r - 12), dz: -Math.cos(rot) * (r - 12) };
      ctx.fillText('N', r + n.dx - 4, r + n.dz + 4);
    }
  }

  function toggleBig(force) {
    big = typeof force === 'boolean' ? force : !big;
    canvas.width = canvas.height = big ? 640 : 200;
    canvas.parentElement.classList.toggle('big', big);
    return big;
  }

  return { draw, setMarker, setRoute, setTints, setIcons, getTints: () => tintSource && tintSource(), getIcons: () => (iconSource ? iconSource() : []), getRoute: () => route, toggleBig, markers, isBig: () => big, cityCell: CITY.cell };
}
