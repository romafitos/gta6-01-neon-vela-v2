// Keyboard and mouse input. Held keys are read every step; one-shot presses (enter car, pause,
// map, help) are queued and taken once, so a tap between two frames is never lost or doubled.
// Mouse look uses pointer lock when the browser grants it, and falls back to drag-to-look
// (or free look in ?audit=1 test mode) so the game never depends on the lock.

const HELD = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  wheel: ['KeyQ'],
};

const PRESS = {
  use: ['KeyE', 'KeyF'],
  pause: ['Escape', 'KeyP'],
  map: ['KeyM'],
  help: ['KeyH'],
  log: ['KeyJ'],
  confirm: ['Enter'],
  wheelToggle: ['Tab'],
  crew: ['KeyC'],
  ability: ['KeyG'],
  leave: ['Backspace'],
  radio: ['KeyR'],
  mute: ['KeyN'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
};

function invert(table) {
  const map = new Map();
  for (const [action, codes] of Object.entries(table)) for (const code of codes) map.set(code, action);
  return map;
}

export function createInput(canvas, { freeLook = false } = {}) {
  const heldByCode = invert(HELD);
  const pressByCode = invert(PRESS);
  const held = new Set();
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let dragging = false;
  let fire = false;
  let clicked = false; // a click shorter than one step still fires once
  let cycle = 0;

  window.addEventListener('keydown', (e) => {
    const h = heldByCode.get(e.code);
    const p = pressByCode.get(e.code);
    if (h) held.add(e.code);
    if (p && !e.repeat) pressed.add(p);
    if (h || p) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); dragging = false; fire = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { fire = true; clicked = true; }
    dragging = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) fire = false;
    dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    const locked = document.pointerLockElement === canvas;
    if (locked || dragging || freeLook) {
      lookX += e.movementX || 0;
      lookY += e.movementY || 0;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // mouse wheel cycles weapons (one notch = one weapon)
  window.addEventListener('wheel', (e) => { if (e.deltaY) cycle += e.deltaY > 0 ? 1 : -1; }, { passive: true });

  const isHeld = (action) => HELD[action].some((c) => held.has(c));

  return {
    /** Movement axes: x = right(+)/left(-), y = forward(+)/back(-). */
    axes() {
      return {
        x: (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0),
        y: (isHeld('forward') ? 1 : 0) - (isHeld('back') ? 1 : 0),
      };
    },
    held: isHeld,
    /** Trigger state for one step: held, or clicked since the last step. */
    firing() { const f = fire || clicked; clicked = false; return f; },
    /** True once per press of the action since the last call. */
    take(action) {
      if (!pressed.has(action)) return false;
      pressed.delete(action);
      return true;
    },
    /** Accumulated mouse movement since the last call, in pixels. */
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    /** Net mouse-wheel notches since the last call (+1 next weapon, -1 previous). */
    takeCycle() { const c = Math.sign(cycle); cycle = 0; return c; },
    clear() { held.clear(); pressed.clear(); lookX = 0; lookY = 0; fire = false; clicked = false; cycle = 0; },
    requestLock() {
      if (freeLook || !canvas.requestPointerLock) return;
      try {
        const result = canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // Pointer lock refused (iframe, headless): drag-to-look still works.
      }
    },
    releaseLock() {
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    },
  };
}
