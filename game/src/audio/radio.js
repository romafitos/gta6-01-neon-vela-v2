// Car radio: three original stations, all music generated live by a small step sequencer on the
// Web Audio clock (no samples, no files). Each station has its own tempo, scale and instruments
// and opens with a short station ident jingle (no DJ). R cycles station 1 → 2 → 3 → Off while you
// are in a car; on foot R does nothing. Leaving the car stops the radio; getting back in resumes
// the station you left it on.
export const STATIONS = [
  {
    name: 'SUNSET DRIVE 88.1', style: 'synthwave', bpm: 100, root: 45,
    // A minor: driving saw bass in 8ths, slow pad chords, gated snare on 2 and 4
    bass: [0, 0, 12, 0, 0, 0, 12, 0, -4, -4, 8, -4, -2, -2, 10, -2],
    chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]],
    lead: [12, null, 15, null, 19, null, 17, 15, 12, null, null, null, 10, null, 12, null],
    drums: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
    bassWave: 'sawtooth', padWave: 'sawtooth', leadWave: 'square', ident: [57, 64, 69],
  },
  {
    name: 'PALM TAPE FM 93.4', style: 'lo-fi', bpm: 78, root: 50,
    // D major 7ths, mellow triangle keys, swung hats, tape crackle
    bass: [0, null, null, null, null, null, 7, null, -3, null, null, null, null, null, 4, null],
    chords: [[0, 4, 7, 11], [0, 4, 7, 11], [-3, 0, 4, 7], [-5, -1, 2, 5]],
    lead: [null, null, 16, null, 14, null, null, 11, null, null, 12, null, null, 9, null, null],
    drums: { kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0] },
    bassWave: 'sine', padWave: 'triangle', leadWave: 'triangle', swing: 0.18, crackle: true, ident: [62, 66, 69, 73],
  },
  {
    name: 'RADIO CALOR 101.7', style: 'latin percussion', bpm: 112, root: 48,
    // C minor tumbao bass, piano-ish montuno stabs, 3-2 son clave, conga tones
    bass: [null, null, null, 7, null, null, 0, null, null, null, null, 7, null, null, 0, null],
    chords: [[0, 3, 7], [5, 8, 12], [7, 11, 14], [0, 3, 7]],
    lead: [12, null, 15, 12, null, 19, null, 15, 12, null, 15, 12, null, 17, null, 15],
    drums: { clave: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0], conga: [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0], kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
    bassWave: 'triangle', padWave: 'square', leadWave: 'square', montuno: true, ident: [60, 63, 67, 72],
  },
];

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export function createRadio(game, audioState) {
  const state = { index: 0, on: false, playing: false, step: 0, nextTime: 0, notes: 0, switches: 0, idents: 0 };
  let ctx = null; let bus = null; let noiseBuf = null; let station = null;
  const el = document.getElementById('station');

  function attach(c, master, nb) {
    ctx = c; noiseBuf = nb;
    bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
  }

  function show(text) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  function tone(midi, t, dur, wave, gain, cutoff = 2600) {
    const o = ctx.createOscillator(); o.type = wave; o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
    state.notes++;
  }
  function hit(t, kind) {
    if (kind === 'kick' || kind === 'conga') {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = kind === 'kick' ? 120 : 330; const f1 = kind === 'kick' ? 42 : 210;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(kind === 'kick' ? 0.5 : 0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'kick' ? 0.28 : 0.18));
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
      return;
    }
    if (kind === 'clave') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2500;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.06);
      return;
    }
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain(); const dur = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(kind === 'hat' ? 0.07 : 0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, Math.random(), dur + 0.02);
  }

  /** Short three/four-note station ident (a jingle, no DJ). */
  function ident(s, t) {
    s.ident.forEach((m, i) => tone(m + 12, t + i * 0.12, 0.28, 'triangle', 0.16, 5000));
    state.idents++;
    audioState.events.ident++;
    return t + s.ident.length * 0.12 + 0.2;
  }

  function schedule(s, k, t) {
    const sixteenth = 60 / s.bpm / 4;
    const bar = Math.floor(k / 16) % s.chords.length;
    const i = k % 16;
    const tt = t + (s.swing && i % 2 ? sixteenth * s.swing : 0);
    const b = s.bass[i];
    if (b != null) tone(s.root + b - 12, tt, sixteenth * 1.8, s.bassWave, 0.2, 900);
    if (i === 0) for (const c of s.chords[bar]) tone(s.root + 12 + c, tt, sixteenth * 15, s.padWave, 0.035, s.style === 'lo-fi' ? 1200 : 2000);
    if (s.montuno && i % 4 === 2) for (const c of s.chords[bar]) tone(s.root + 24 + c, tt, sixteenth * 0.9, s.padWave, 0.04, 3000);
    const l = s.lead[i];
    if (l != null && (bar % 2 === 1 || s.style !== 'synthwave')) tone(s.root + 12 + l, tt, sixteenth * 1.6, s.leadWave, 0.05, 3400);
    for (const [kind, pat] of Object.entries(s.drums)) if (pat[i]) hit(tt, kind);
    if (s.crackle && Math.random() < 0.35) hit(tt + Math.random() * sixteenth, 'hat');
    return sixteenth;
  }

  function tune(index) {
    state.index = index;
    state.switches++;
    if (!ctx) return;
    if (index < 0) { stop(); show('RADIO OFF'); return; }
    station = STATIONS[index];
    state.on = true; state.playing = true; state.step = 0;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.05);
    state.nextTime = ident(station, ctx.currentTime + 0.05);
    show(station.name);
  }
  function stop() {
    state.playing = false;
    station = null;
    if (bus) bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  function enterCar() { if (state.index >= 0) tune(state.index); else show('RADIO OFF'); }
  function exitCar() { stop(); show(''); }

  /** R in a car: next station, the last one goes Off. */
  function cycle() {
    if (!game.player.state.car) return false;
    const next = state.index >= STATIONS.length - 1 ? -1 : state.index + 1;
    tune(next);
    return true;
  }

  function step() {
    if (game.input.take('radio')) cycle();
    if (!ctx || !state.playing || !station) return;
    // keep ~0.25 s of music scheduled ahead of the audio clock
    if (state.nextTime < ctx.currentTime) state.nextTime = ctx.currentTime + 0.02;
    while (state.nextTime < ctx.currentTime + 0.25) {
      state.nextTime += schedule(station, state.step, state.nextTime);
      state.step++;
    }
  }

  const current = () => (state.playing && station ? station.name : '');
  return { state, STATIONS, attach, cycle, tune, enterCar, exitCar, step, current };
}
