// Sound for Neon Vela, every bit of it synthesized with the Web Audio API: no audio files at all.
// The AudioContext is created only inside the first user gesture (the Play / Continue click), so
// browsers never block it and nothing touches audio on page load.
//
//   master ─┬─ sfx bus    gunshots per weapon, explosions, tyre screech, UI clicks, stings, beeps
//           ├─ loop bus   engine (pitched by speed), police sirens (two-tone, doppler-ish), rotor
//           └─ radio bus  three synthesized car-radio stations (see radio.js)
//
// `state.events` counts every sound that was actually started, so tests can tell a sound fired
// rather than a label changed. N toggles mute.
import { createRadio } from './radio.js';

const SHOT_VOICES = {
  fists: { noise: 0.05, tone: 140, toneEnd: 60, filter: 900, gain: 0.35 },
  bat: { noise: 0.07, tone: 210, toneEnd: 90, filter: 1400, gain: 0.4 },
  pistol: { noise: 0.16, tone: 420, toneEnd: 90, filter: 3200, gain: 0.55 },
  smg: { noise: 0.09, tone: 520, toneEnd: 140, filter: 4200, gain: 0.38 },
  shotgun: { noise: 0.34, tone: 180, toneEnd: 45, filter: 1700, gain: 0.8 },
  rifle: { noise: 0.2, tone: 640, toneEnd: 110, filter: 5200, gain: 0.6 },
};

export function createAudio(game) {
  const state = {
    ctx: null, muted: false, volume: 0.8,
    sirenActive: false, rotorActive: false, engineActive: false, screechActive: false,
    enginePitch: 0, sirenPitch: 0,
    events: { gunshot: {}, explosion: 0, siren: 0, rotor: 0, engine: 0, screech: 0, ui: 0, sting: 0, beep: 0, ident: 0 },
    errors: 0,
  };
  let master = null; let sfx = null; let loops = null; let noiseBuf = null;
  let engine = null; let siren = null; let rotor = null; let screech = null;
  let lastCount = -1;
  const radio = createRadio(game, state);

  /** Called from inside the Play / Continue click handler: the one place audio may start. */
  function unlock() {
    if (state.ctx) { if (state.ctx.state !== 'running') state.ctx.resume().catch(() => {}); return true; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      const ctx = new Ctx();
      state.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = state.muted ? 0 : state.volume; master.connect(comp);
      sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
      loops = ctx.createGain(); loops.gain.value = 0.6; loops.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
      radio.attach(ctx, master, noiseBuf);
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return true;
    } catch (e) { state.errors++; state.ctx = null; return false; }
  }

  function setMuted(m) {
    state.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : state.volume, state.ctx.currentTime, 0.02);
    game.hud.notify(m ? 'Sound muted (N)' : 'Sound on (N)', 1.2);
  }

  const now = () => state.ctx.currentTime;
  function noise(dest, t, dur, freq, type = 'bandpass', q = 0.8) {
    const src = state.ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = state.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    return { src, f };
  }
  function env(t, peak, attack, decay) {
    const g = state.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  /** Distance falloff from the listener (the player). */
  function near(x, z, range = 140) {
    if (x == null) return 1;
    const p = game.player.state;
    const d = Math.hypot(x - p.x, z - p.z);
    return Math.max(0, 1 - d / range) ** 1.5;
  }

  function gunshot(id, x, z) {
    if (!state.ctx) return;
    const v = SHOT_VOICES[id] ?? SHOT_VOICES.pistol;
    const vol = v.gain * near(x, z, 160);
    if (vol < 0.01) return;
    const t = now();
    const g = env(t, vol, 0.002, v.noise); g.connect(sfx);
    noise(g, t, v.noise, v.filter, 'lowpass', 0.7);
    const o = state.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(v.tone, t); o.frequency.exponentialRampToValueAtTime(v.toneEnd, t + v.noise);
    const og = env(t, vol * 0.6, 0.002, v.noise * 0.8); o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + v.noise + 0.05);
    state.events.gunshot[id] = (state.events.gunshot[id] ?? 0) + 1;
  }

  function explosion(x, z) {
    if (!state.ctx) return;
    const vol = 1.1 * near(x, z, 260);
    const t = now();
    const g = env(t, Math.max(0.02, vol), 0.01, 1.6); g.connect(sfx);
    const n = noise(g, t, 1.7, 900, 'lowpass', 0.5);
    n.f.frequency.setValueAtTime(1800, t); n.f.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const o = state.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const og = env(t, Math.max(0.02, vol * 0.9), 0.005, 0.9); o.connect(og); og.connect(sfx);
    o.start(t); o.stop(t + 1);
    state.events.explosion++;
  }

  function click() {
    if (!state.ctx) return;
    const t = now();
    const o = state.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1800;
    const g = env(t, 0.08, 0.001, 0.035); o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.05);
    state.events.ui++;
  }

  function sting() {
    if (!state.ctx) return;
    const t = now();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = state.ctx.createOscillator(); o.type = i === 3 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      const lp = state.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const g = env(t + i * 0.11, 0.12, 0.01, i === 3 ? 1.2 : 0.3);
      o.connect(lp); lp.connect(g); g.connect(sfx);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 1.4);
    });
    state.events.sting++;
  }

  function beep(high) {
    if (!state.ctx) return;
    const t = now();
    const o = state.ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 1320 : 660;
    const g = env(t, 0.12, 0.004, high ? 0.5 : 0.18); o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.6);
    state.events.beep++;
  }

  // ---- looping voices: built once on demand, faded in/out ----
  function makeEngine() {
    const ctx = state.ctx;
    const a = ctx.createOscillator(); a.type = 'sawtooth';
    const b = ctx.createOscillator(); b.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0;
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(loops);
    a.start(); b.start();
    return { a, b, lp, g };
  }
  function makeSiren() {
    const ctx = state.ctx;
    const o = ctx.createOscillator(); o.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(lp); lp.connect(g); g.connect(loops);
    o.start();
    return { o, g };
  }
  function makeRotor() {
    const ctx = state.ctx;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 380;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11;
    const depth = ctx.createGain(); depth.gain.value = 0.5;
    lfo.connect(depth); depth.connect(chop.gain);
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(chop); chop.connect(g); g.connect(loops);
    src.start(); lfo.start();
    return { g };
  }
  function makeScreech() {
    const ctx = state.ctx;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(loops);
    src.start();
    return { g };
  }
  const fade = (node, v, tc = 0.08) => node.gain.setTargetAtTime(v, now(), tc);

  function step(dt) {
    if (!state.ctx) return;
    try {
      const p = game.player.state;
      // engine: on while you drive, pitch follows road speed
      const car = p.car && !p.car.wrecked ? p.car : null;
      if (car) {
        if (!engine) engine = makeEngine();
        const sp = Math.abs(car.speed);
        const f = 42 + sp * 3.1 + (car.controls.throttle > 0 ? 8 : 0);
        engine.a.frequency.setTargetAtTime(f, now(), 0.05);
        engine.b.frequency.setTargetAtTime(f * 0.501, now(), 0.05);
        engine.lp.frequency.setTargetAtTime(500 + sp * 40, now(), 0.05);
        state.enginePitch = f;
        if (!state.engineActive) { state.engineActive = true; state.events.engine++; fade(engine.g, 0.16); }
        // tyre screech: handbrake at speed
        const slide = car.controls.handbrake && sp > 7;
        if (slide && !state.screechActive) { if (!screech) screech = makeScreech(); state.screechActive = true; state.events.screech++; fade(screech.g, 0.18, 0.03); }
        if (!slide && state.screechActive) { state.screechActive = false; fade(screech.g, 0, 0.06); }
      } else {
        if (state.engineActive) { state.engineActive = false; fade(engine.g, 0); }
        if (state.screechActive) { state.screechActive = false; fade(screech.g, 0, 0.06); }
      }
      // sirens: the nearest chasing cruiser, two-tone, pitch shifted by closing speed
      let best = null; let bd = 220;
      if (game.wanted >= 1) {
        for (const c of game.vehicles.cars) {
          if (c.kind !== 'police' || c.disabled || c.wrecked || c.driver !== 'police') continue;
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < bd) { bd = d; best = c; }
        }
      }
      if (best) {
        if (!siren) siren = makeSiren();
        const dx = p.x - best.x; const dz = p.z - best.z; const d = Math.max(1, Math.hypot(dx, dz));
        const pv = car ? { x: car.vx, z: car.vz } : { x: p.vx ?? 0, z: p.vz ?? 0 };
        const closing = ((best.vx - pv.x) * dx + (best.vz - pv.z) * dz) / d; // + when approaching
        const doppler = Math.max(0.8, Math.min(1.25, 343 / (343 - closing)));
        const tone = Math.floor(game.time * 1.6) % 2 ? 960 : 720;
        state.sirenPitch = tone * doppler;
        siren.o.frequency.setTargetAtTime(state.sirenPitch, now(), 0.01);
        fade(siren.g, 0.11 * Math.max(0.08, 1 - bd / 220), 0.1);
        if (!state.sirenActive) { state.sirenActive = true; state.events.siren++; }
      } else if (state.sirenActive) { state.sirenActive = false; fade(siren.g, 0, 0.2); }
      // helicopter rotor at 4+ stars
      const heli = game.police.heli;
      const air = heli && heli.active;
      if (air) {
        if (!rotor) rotor = makeRotor();
        const d = Math.hypot((heli.x ?? heli.lightX) - p.x, (heli.z ?? heli.lightZ) - p.z);
        fade(rotor.g, 0.35 * Math.max(0.15, 1 - d / 260), 0.2);
        if (!state.rotorActive) { state.rotorActive = true; state.events.rotor++; }
      } else if (state.rotorActive) { state.rotorActive = false; fade(rotor.g, 0, 0.5); }
      // race countdown beeps (3, 2, 1, GO)
      const a = game.races.active;
      if (a && a.countdown > -0.5) {
        const c = Math.ceil(a.countdown);
        if (c !== lastCount && c <= 3) { if (c >= 1) beep(false); else if (c === 0) beep(true); lastCount = c; }
      } else lastCount = -1;
      radio.step(dt);
    } catch (e) { state.errors++; }
  }

  function onEvent(name, data) {
    if (!state.ctx) return;
    try {
      if (name === 'gunfire') {
        gunshot(data.weapon ?? 'pistol', data.x, data.z);
      } else if (name === 'melee') gunshot(data.weapon ?? 'fists', data.x, data.z);
      else if (name === 'explosion') explosion(data.x, data.z);
      else if (name === 'missionComplete' || name === 'raceFinish') sting();
      else if (name === 'wheel' || name === 'weapon' || name === 'garage' || name === 'garageOpen') click();
      else if (name === 'enterCar') radio.enterCar();
      else if (name === 'exitCar') radio.exitCar();
    } catch (e) { state.errors++; }
  }

  // every button in the game gives a click
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('button')) click(); }, true);

  return { state, radio, unlock, setMuted, gunshot, explosion, click, sting, beep, step, onEvent };
}
