'use strict';

const hud = document.getElementById('hud');
const ICONS = {
  mic:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><path d="M12 19v3"/></svg>',
  micOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><path d="M12 19v3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
  monitor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  leave:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 13.3a1 1 0 0 0 1.2.2 15 15 0 0 1 4.1-1.5 1 1 0 0 1 1 .4l2.2 2.7a2 2 0 0 1 .2 2.2l-1.5 2.3a2 2 0 0 1-2.4.8 19 19 0 0 1-5.6-3.3 19 19 0 0 1-3.3-5.6 2 2 0 0 1 .8-2.4L9.7 7.6a2 2 0 0 1 2.2.2l2.7 2.2a1 1 0 0 1 .4 1 15 15 0 0 1-1.5 4.1 1 1 0 0 0 .2 1.2Z" transform="rotate(135 12 12)"/></svg>',
};

let state = null;
let interactive = false;
let hovered = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

function elapsedLabel() {
  if (!state) return '';
  const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function avatarFor(participant) {
  const wrapper = el('span', 'hud-person');
  wrapper.title = participant.name;
  if (participant.avatarUrl) {
    const img = document.createElement('img');
    img.src = participant.avatarUrl;
    img.alt = participant.name;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.replaceWith(el('span', 'hud-initials', initials(participant.name)));
    });
    wrapper.appendChild(img);
  } else {
    wrapper.appendChild(el('span', 'hud-initials', initials(participant.name)));
  }
  if (participant.muted) {
    const badge = el('span', 'hud-muted');
    badge.innerHTML = ICONS.micOff;
    wrapper.appendChild(badge);
  }
  return wrapper;
}

function button(action, label, icon, className) {
  const node = el('button', `hud-btn${className ? ` ${className}` : ''}`);
  node.type = 'button';
  node.innerHTML = icon;
  node.appendChild(document.createTextNode(label));
  node.addEventListener('click', () => {
    window.unisonOverlay.command(action);
  });
  return node;
}

function render() {
  hud.textContent = '';
  if (!state) {
    hud.appendChild(el('div', 'hud-empty', 'Sem canal de voz'));
    return;
  }

  const head = el('div', 'hud-head');
  head.appendChild(el('span', 'hud-live'));
  const copy = el('div', 'hud-copy');
  copy.appendChild(el('span', 'hud-kicker', 'UNISON · Voz'));
  copy.appendChild(el('strong', 'hud-title', state.title || 'Canal de voz'));
  head.appendChild(copy);
  const time = el('span', 'hud-time', elapsedLabel());
  head.appendChild(time);
  hud.appendChild(head);

  const people = el('div', 'hud-people');
  const list = Array.isArray(state.participants) ? state.participants : [];
  list.slice(0, 8).forEach((participant) => people.appendChild(avatarFor(participant)));
  people.appendChild(
    el('span', 'hud-count', `${list.length} ${list.length === 1 ? 'conectado' : 'conectados'}`),
  );
  hud.appendChild(people);

  const controls = el('div', 'hud-controls');
  controls.appendChild(
    button(
      'toggle-mic',
      state.micEnabled ? 'Mic' : 'Mudo',
      state.micEnabled ? ICONS.mic : ICONS.micOff,
      state.micEnabled ? '' : 'off',
    ),
  );
  controls.appendChild(button('open', 'Abrir', ICONS.open));
  controls.appendChild(button('leave', 'Sair', ICONS.leave, 'leave'));
  hud.appendChild(controls);

  hud.appendChild(
    el(
      'p',
      'hud-hint',
      interactive
        ? 'Clique nos controles. Tire o mouse do widget para voltar ao jogo.'
        : 'Ctrl+Shift+U para interagir · o mouse atravessa o widget',
    ),
  );
}

window.unisonOverlay.onState((next) => {
  state = next;
  render();
});

window.unisonOverlay.onInteractive((value) => {
  interactive = value;
  document.body.classList.toggle('interactive', value);
  render();
});

document.addEventListener('mouseenter', () => {
  hovered = true;
});

document.addEventListener('mouseleave', () => {
  const wasHovered = hovered;
  hovered = false;
  if (interactive && wasHovered) window.unisonOverlay.setInteractive(false);
});

window.setInterval(() => {
  const node = document.querySelector('.hud-time');
  if (node && state) node.textContent = elapsedLabel();
}, 1000);

render();
