// Smooth low-poly building blocks made from three's core geometry only (no add-ons): bevelled
// boxes, the car body and glasshouse profiles, a curved palm, a beach umbrella, and a tiny merge
// helper so a whole prop becomes one geometry and can be drawn as a single instanced mesh.
import * as THREE from 'three';

/** Joins non-indexed copies of several geometries into one (positions, normals, uvs). */
export function merge(geos) {
  // keep each part's tint: toNonIndexed() returns a fresh geometry without our userData
  const parts = geos.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    flat.userData.tint = g.userData.tint;
    return flat;
  });
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    const tint = g.userData.tint || [1, 1, 1];
    for (let i = 0; i < c; i++) col.set(tint, (o + i) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Marks a geometry with a vertex tint used by merge() (multiplied with the material colour). */
export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  geo.userData.tint = [c.r, c.g, c.b];
  return geo;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A unit box (1×1×1, centred) with softly rounded edges; scale it per instance. */
export function softBox(r = 0.12, seg = 2) {
  const inner = 1 - r * 2;
  const g = new THREE.ExtrudeGeometry(roundedRect(1, 1, r), {
    depth: inner, bevelEnabled: true, bevelThickness: r, bevelSize: 0.0001, bevelSegments: seg, curveSegments: 2,
  });
  g.translate(0, 0, -inner / 2);
  g.computeVertexNormals();
  return g;
}

// Extrudes a side profile (x = along the car, y = up) across the width, then turns it so the
// profile's x runs along +z (the car's nose). Result spans x −0.5..0.5, z −0.5..0.5.
function sideProfile(points, bevel) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const depth = 1 - bevel * 2;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Lower body: wedge nose, rounded tail, wheel-arch shoulders. Unit length/width, height 1. */
export function carBodyGeo() {
  const pts = [];
  // bottom from tail to nose
  pts.push([-0.5, 0.18], [-0.47, 0.0], [0.47, 0.0]);
  // nose: a short rounded bumper rising to a low bonnet
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 0.5;
    pts.push([0.47 + Math.sin(a) * 0.035, 0.0 + (1 - Math.cos(a)) * 0.45]);
  }
  pts.push([0.46, 0.62], [0.32, 0.82], [0.1, 0.92]);
  // roofline of the lower body (the glasshouse sits on top), then the rounded tail
  pts.push([-0.28, 0.95], [-0.44, 0.9]);
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * Math.PI * 0.5;
    pts.push([-0.44 - Math.sin(a) * 0.06, 0.9 - (1 - Math.cos(a)) * 0.6]);
  }
  return sideProfile(pts, 0.12);
}

/** Glasshouse: raked windscreen, flat roof, sloped rear glass. Unit size, base at y 0. */
export function cabinGeo() {
  const pts = [[-0.5, 0], [0.5, 0], [0.18, 0.92], [0.12, 1.0], [-0.3, 1.0], [-0.36, 0.92]];
  const g = sideProfile(pts, 0.14);
  return g;
}

/** Tyre (dark) and rim (bright alloy) as two separate geometries, axle along x. */
export function wheelGeos() {
  const tyre = new THREE.TorusGeometry(0.27, 0.12, 5, 12);
  tyre.rotateY(Math.PI / 2);
  const side = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12, 1, true);
  side.rotateZ(Math.PI / 2);
  const tyreAll = merge([tyre, side]);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.26, 8);
  rim.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 5);
  hub.rotateZ(Math.PI / 2);
  const spokes = [];
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.BoxGeometry(0.28, 0.05, 0.36);
    sp.rotateX((i / 3) * Math.PI);
    spokes.push(sp);
  }
  return { tyre: tyreAll, rim: merge([rim, hub, ...spokes]) };
}

/** A 9 m palm: a curved, ringed trunk and a crown of drooping fronds, vertex-tinted, one geometry. */
export function palmGeo(rnd = Math.random) {
  const parts = [];
  const lean = 1.4;
  const top = new THREE.Vector3(lean, 9, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 5, 0), top);
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a = curve.getPoint(i / segs);
    const b = curve.getPoint((i + 1) / segs);
    const len = a.distanceTo(b);
    const r0 = 0.3 - (i / segs) * 0.14;
    const cyl = new THREE.CylinderGeometry(r0 * 0.86, r0, len * 1.02, 6, 1, true);
    cyl.translate(0, len / 2, 0);
    const dir = b.clone().sub(a).normalize();
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    cyl.translate(a.x, a.y, a.z);
    parts.push(tint(cyl, i % 2 ? 0x8a6440 : 0x74512f));
  }
  // coconuts
  for (let i = 0; i < 3; i++) {
    const c = new THREE.TetrahedronGeometry(0.22, 0);
    c.translate(top.x + Math.cos(i * 2.1) * 0.25, top.y - 0.25, Math.sin(i * 2.1) * 0.25);
    parts.push(tint(c, 0x5a4020));
  }
  const fronds = 12;
  for (let f = 0; f < fronds; f++) {
    const len = 4.2 + rnd() * 1.3;
    const g = new THREE.PlaneGeometry(1, len, 2, 5);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + len / 2) / len; // 0 at the crown, 1 at the tip
      const half = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.55 + 0.05;
      const x = p.getX(i) * half * 2;
      // arc up a little, then droop toward the tip; leaflets fold into a shallow V
      const y = Math.sin(t * Math.PI * 0.55) * 1.0 - t * t * 2.4 - Math.abs(x) * 0.35;
      p.setXYZ(i, x, y, t * len);
    }
    g.computeVertexNormals();
    const rise = 0.25 - rnd() * 0.35;
    g.rotateX(-rise);
    g.rotateY((f / fronds) * Math.PI * 2 + rnd() * 0.3);
    g.translate(top.x, top.y, top.z);
    parts.push(tint(g, [0x3f8f3a, 0x2f7a33, 0x4f9e3c, 0x5aa646][f % 4]));
  }
  return merge(parts);
}

/** Beach umbrella: pole + eight-panel canopy, canopy stripes tinted white/colour. */
export function umbrellaGeo() {
  const pole = tint(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), 0xeeeeee);
  pole.translate(0, 1.2, 0);
  const parts = [pole];
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.ConeGeometry(1.5, 0.55, 2, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4);
    seg.translate(0, 2.45, 0);
    parts.push(tint(seg, i % 2 ? 0xffffff : 0xbbbbbb));
  }
  return merge(parts);
}
