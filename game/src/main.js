// Boot and the one loop. The title screen sits over the live city; Play starts the game on the
// first click (pointer lock is requested but never required). Esc pauses. The simulation runs in
// fixed 1/60 s steps; rendering follows the display.
//
// URL options: ?seed=N fixes the city, ?shot=start|play|drive stages a screenshot scene and sets
// window.__shotReady, ?audit=1 enables free mouse look without pointer lock for automated tests.
import * as THREE from 'three';
import { MAX_FRAME, STEP } from './core/config.js';
import { createRandom } from './core/random.js';
import { createInput } from './core/input.js';
import { createGame } from './game.js';
import { stageShot } from './shots.js';
import { createPauseMenu } from './ui/pause_menu.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const audit = params.has('audit');
// lowfx: half resolution, no shadows (automated tests on software GL, or very weak machines)
const lowfx = params.has('lowfx') || audit;
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !audit, powerPreference: 'high-performance', preserveDrawingBuffer: !!shot });
renderer.setPixelRatio(lowfx ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = !lowfx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const input = createInput(canvas, { freeLook: audit });
const game = createGame({ scene, random: createRandom(seed), input, aspect: window.innerWidth / window.innerHeight });

const titleEl = document.getElementById('title');
const pauseEl = document.getElementById('pause');
const pauseMenu = createPauseMenu(game);
let screen = 'title';
const perf = { frames: 0, frameMs: [], lastFrame: performance.now() };

function setScreen(next) {
  screen = next;
  titleEl.classList.toggle('hidden', next !== 'title');
  pauseEl.classList.toggle('hidden', next !== 'paused');
  game.hud.show(next === 'play' || next === 'paused');
  if (next === 'play') game.hud.announce('Playing. Explore Vela City.');
  if (next === 'paused') { pauseMenu.render(); game.hud.announce('Paused.'); }
}

function startGame(mode = 'new') {
  if (screen !== 'title') return;
  // inside the click / key gesture: the only place sound may start
  game.audio.unlock();
  input.clear();
  let loaded = false;
  if (mode === 'continue') loaded = game.saves.continueGame();
  else if (bootSave.data) game.saves.clear(); // New Game over an existing save starts fresh
  setScreen('play');
  input.requestLock();
  if (loaded) game.hud.notify(`Welcome back. $${game.player.state.cash.toLocaleString('en-US')} · ${game.progression.state.rank} · ${game.missions.state.done.length}/10 jobs done.`, 5);
  else game.hud.notify('Welcome to Vela City. Grab the car at the kerb — press E.', 5);
  if (game.saves.state.notice) game.hud.notify(game.saves.state.notice, 6);
  game.emit('start', { loaded });
}

// what's in storage decides the title buttons: a good save offers Continue, a bad one a notice
const bootSave = game.saves.inspect();
const continueBtn = document.getElementById('continue-btn');
const playBtn = document.getElementById('play-btn');
const saveNote = document.getElementById('save-note');
if (bootSave.data) {
  continueBtn.classList.remove('hidden');
  playBtn.textContent = 'NEW GAME';
  saveNote.textContent = `Saved game: $${Number(bootSave.data.cash).toLocaleString('en-US')} · ${String(bootSave.data.rank ?? '').slice(0, 24)} · ${bootSave.data.missions.length}/10 jobs`;
  saveNote.classList.remove('hidden');
} else if (bootSave.error) {
  saveNote.textContent = game.saves.state.notice;
  saveNote.classList.remove('hidden');
}
continueBtn.addEventListener('click', () => startGame('continue'));

function pause() { if (screen === 'play') { setScreen('paused'); input.releaseLock(); } }
function resume() { if (screen === 'paused') { input.clear(); setScreen('play'); input.requestLock(); } }

playBtn.addEventListener('click', () => startGame('new'));
document.getElementById('resume-btn').addEventListener('click', resume);
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && screen === 'title') startGame(bootSave.data ? 'continue' : 'new'); });
canvas.addEventListener('click', () => { if (screen === 'play' && !document.pointerLockElement) input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
  // the browser drops the lock on Esc without delivering the key: treat that as pause
  if (!document.pointerLockElement && screen === 'play' && lockWasHeld) pause();
  lockWasHeld = !!document.pointerLockElement;
});
let lockWasHeld = false;
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  game.cam.camera.aspect = window.innerWidth / window.innerHeight;
  game.cam.camera.updateProjectionMatrix();
});

let accumulator = 0;
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  // performance.now(), not the rAF timestamp: some compositors hand slow frames a stale stamp
  const now = performance.now();
  // test mode catches up on long software-GL frames so scripted input sees real-time movement
  const dt = Math.min((now - last) / 1000, audit ? 1.0 : MAX_FRAME);
  last = now;
  if (input.take('pause')) { if (screen === 'play') pause(); else if (screen === 'paused') resume(); }
  if (screen === 'play') {
    accumulator += dt;
    let steps = 0;
    const cap = audit ? 70 : 8;
    while (accumulator >= STEP && steps < cap) { game.step(STEP); accumulator -= STEP; steps++; }
    if (steps === cap) accumulator = 0;
  } else if (screen === 'title') {
    // the city lives behind the title: traffic and people keep moving, the camera drifts
    game.vehicles.step(dt, game.player);
    game.peds.step(dt, game.player, game.vehicles.cars);
    game.cam.state.yaw += dt * 0.05;
    input.takeLook();
  }
  game.frame(dt);
  renderer.render(scene, game.cam.camera);
  const t = performance.now();
  perf.frames++;
  perf.frameMs.push(t - perf.lastFrame);
  if (perf.frameMs.length > 600) perf.frameMs.shift();
  perf.lastFrame = t;
}

// Test and screenshot hooks: read-only views of the state plus the renderer's draw stats.
window.__game = {
  get screen() { return screen; },
  pauseMenu,
  game,
  perf,
  renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  start: startGame,
  bootSave,
};

if (shot) {
  setScreen(shot === 'start' ? 'title' : 'play');
  stageShot(shot, game);
  let painted = 0;
  const paint = () => {
    game.frame(1 / 60);
    renderer.render(scene, game.cam.camera);
    painted++;
    if (painted < 40) requestAnimationFrame(paint);
    else window.__shotReady = true;
  };
  requestAnimationFrame(paint);
} else {
  setScreen('title');
  requestAnimationFrame(frame);
}
