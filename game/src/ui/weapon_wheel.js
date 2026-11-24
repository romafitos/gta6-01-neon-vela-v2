// Weapon wheel: hold Q (or tap Tab to toggle) to open a radial menu of every weapon. Time slows
// to a quarter while it is open; the mouse picks a slice (moving the mouse points at it, or hover
// and click), and releasing Q / tapping Tab again equips it. Number keys 1-6 and the mouse wheel
// switch weapons directly without opening it.
const SLOW = 0.25;

export function createWeaponWheel(game) {
  const { weapons, input } = game;
  const root = document.getElementById('wheel');
  const n = weapons.arsenal.length;
  const state = { open: false, toggled: false, hover: weapons.state.index, aimX: 0, aimY: 0, opens: 0, picks: 0 };

  // build the slices once: each is placed around a circle by angle
  root.innerHTML = '';
  const center = document.createElement('div');
  center.className = 'wheel-center';
  root.appendChild(center);
  const slices = weapons.arsenal.map((slot, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wheel-slice';
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    el.style.left = `${50 + Math.cos(a) * 36}%`;
    el.style.top = `${50 + Math.sin(a) * 36}%`;
    el.innerHTML = `<span class="wheel-icon">${slot.def.icon}</span><span class="wheel-name">${slot.def.name}</span><span class="wheel-ammo"></span>`;
    el.addEventListener('mouseenter', () => { state.hover = i; render(); });
    el.addEventListener('click', () => { state.hover = i; close(); });
    root.appendChild(el);
    return el;
  });

  function render() {
    slices.forEach((el, i) => {
      const s = weapons.arsenal[i];
      el.classList.toggle('active', i === state.hover);
      el.classList.toggle('equipped', i === weapons.state.index);
      el.querySelector('.wheel-ammo').textContent = s.def.melee ? 'melee' : `${s.clip + s.reserve}`;
    });
    const d = weapons.arsenal[state.hover].def;
    center.innerHTML = `<b>${d.name}</b><small>${d.melee ? `Damage ${d.damage}` : `Damage ${d.damage}${d.pellets > 1 ? '×' + d.pellets : ''} · ${d.rate}/s · ${d.range} m`}</small>`;
  }

  function open(toggled) {
    if (state.open || game.respawning) return;
    state.open = true;
    state.toggled = toggled;
    state.hover = weapons.state.index;
    state.aimX = state.aimY = 0;
    state.opens++;
    game.timeScale = SLOW;
    game.blockFire = true;
    root.classList.remove('hidden');
    render();
    game.emit('wheel', { open: true });
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    game.timeScale = 1;
    game.blockFire = false;
    root.classList.add('hidden');
    if (weapons.select(state.hover)) state.picks++;
    game.emit('wheel', { open: false });
  }

  /** Called every step with the raw mouse movement; returns true when it consumed the look. */
  function step(look) {
    if (input.take('wheelToggle')) { if (state.open) close(); else open(true); }
    const qHeld = input.held('wheel');
    if (qHeld && !state.open) open(false);
    if (!qHeld && state.open && !state.toggled) close();
    for (let i = 0; i < n; i++) if (input.take(`slot${i + 1}`)) { if (state.open) { state.hover = i; close(); } else weapons.select(i); }
    const cyc = input.takeCycle();
    if (cyc && !state.open) weapons.cycle(cyc);
    if (!state.open) return false;
    // mouse movement steers the selection like a stick
    state.aimX += look.x; state.aimY += look.y;
    const len = Math.hypot(state.aimX, state.aimY);
    if (len > 40) {
      const a = Math.atan2(state.aimY, state.aimX) + Math.PI / 2;
      const idx = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
      if (idx !== state.hover) { state.hover = idx; render(); }
      if (len > 140) { state.aimX *= 140 / len; state.aimY *= 140 / len; }
    }
    return true;
  }

  return { state, open, close, step, render };
}
