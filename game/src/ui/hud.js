// The DOM HUD: health bar, cash, wanted stars, vehicle readout, notices, the objective line, the
// context prompt ("E  Steal car") and the key-help panel. DOM writes happen only when a value
// changes, so the HUD costs nothing on frames where nothing moved.

/** Bindings that work right now. Later systems append theirs with addHelp(). */
const BASE_HELP = [
  ['W A S D', 'Move / drive'],
  ['Mouse', 'Look (click to lock)'],
  ['Shift', 'Sprint'],
  ['E / F', 'Enter / exit car'],
  ['Space', 'Handbrake'],
  ['M', 'Map'],
  ['H', 'Hide help'],
  ['Esc', 'Pause'],
];

export function createHud() {
  const el = (id) => document.getElementById(id);
  const hud = el('hud');
  const hpFill = el('hp-fill');
  const cash = el('cash');
  const stars = el('stars');
  const vehicle = el('vehicle-info');
  const notice = el('notice');
  const objective = el('objective');
  const prompt = el('prompt');
  const help = el('help');
  const district = el('district-name');
  const status = el('status');
  const helpRows = [...BASE_HELP];
  const last = {};
  let noticeTimer = 0;

  stars.innerHTML = Array.from({ length: 5 }, () => '<span class="star">&#9733;</span>').join('');
  const starEls = [...stars.children];

  function renderHelp() {
    const html = helpRows.map(([k, v]) => `<div><span class="key">${k}</span>${v}</div>`).join('');
    help.innerHTML = html;
    const pause = el('pause-help');
    if (pause) pause.innerHTML = html;
  }
  renderHelp();

  const set = (key, value, apply) => { if (last[key] !== value) { last[key] = value; apply(value); } };

  return {
    show(on) { hud.classList.toggle('hidden', !on); },
    setHealth(v, max) { set('hp', Math.round((v / max) * 100), (p) => { hpFill.style.width = `${p}%`; }); },
    setCash(v) { set('cash', v, (c) => { cash.textContent = `$${c.toLocaleString('en-US')}`; }); },
    setWanted(n) { set('wanted', n, (w) => starEls.forEach((s, i) => s.classList.toggle('on', i < w))); },
    setVehicle(text) { set('veh', text, (t) => { vehicle.textContent = t; }); },
    setDistrict(name) { set('district', name, (d) => { district.textContent = d; }); },
    setPrompt(text) { set('prompt', text, (t) => { prompt.textContent = t; }); },
    setObjective(text) { set('obj', text, (t) => { objective.textContent = t; }); },
    toggleHelp() { help.classList.toggle('hidden'); return !help.classList.contains('hidden'); },
    addHelp(key, label) { helpRows.splice(helpRows.length - 2, 0, [key, label]); renderHelp(); },
    helpRows,
    notify(text, seconds = 3) {
      notice.textContent = text;
      notice.classList.add('show');
      noticeTimer = seconds;
      status.textContent = text;
    },
    announce(text) { status.textContent = text; },
    update(dt) {
      if (noticeTimer > 0) {
        noticeTimer -= dt;
        if (noticeTimer <= 0) notice.classList.remove('show');
      }
    },
  };
}
