/* UI-Grundbausteine: Toasts, Dialoge, Menüs. */

import { esc, icon, errorMessage } from './utils.js';

/* ---------- Toasts ---------- */

export function toast(message, { type = 'info', duration = 3800, action = null } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>`;
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm btn-ghost';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      close();
      action.onClick();
    });
    el.appendChild(b);
  }
  const x = document.createElement('button');
  x.className = 'icon-btn toast-x';
  x.setAttribute('aria-label', 'Schließen');
  x.innerHTML = icon('x');
  x.addEventListener('click', close);
  el.appendChild(x);
  host.appendChild(el);
  if (duration > 0) setTimeout(close, type === 'error' ? Math.max(duration, 6000) : duration);
  return close;
}

export function showError(e, prefix = '') {
  console.error(e);
  toast(`${prefix}${errorMessage(e)}`, { type: 'error' });
}

/* ---------- Dialoge ---------- */

let modalDepth = 0;

/**
 * Öffnet einen modalen Dialog.
 * actions: [{label, kind:'primary'|'danger'|'ghost'|'default', align:'left'|'right', value, onClick(handle)}]
 * onClick darf `false` (bzw. ein Promise darauf) zurückgeben, um den Dialog offen zu lassen.
 */
export function openModal({ title, content, actions = [], size = 'md', dismissible = true, onBeforeClose = null, className = '' }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal modal-${size} ${className}`;
  dlg.innerHTML = `
    <div class="modal-box">
      <header class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        ${dismissible ? `<button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button>` : ''}
      </header>
      <div class="modal-body"></div>
      <footer class="modal-foot"><div class="foot-left"></div><div class="foot-right"></div></footer>
    </div>`;
  const body = dlg.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);

  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  let done = false;

  const handle = {
    el: dlg,
    body,
    closed,
    setBusy(b) {
      dlg.classList.toggle('busy', b);
      dlg.querySelectorAll('.modal-foot button').forEach((x) => { x.disabled = b; });
    },
    async close(value = null, force = false) {
      if (done) return;
      if (!force && onBeforeClose) {
        const ok = await onBeforeClose(value);
        if (ok === false) return;
      }
      done = true;
      dlg.classList.add('closing');
      modalDepth = Math.max(0, modalDepth - 1);
      if (!modalDepth) document.documentElement.classList.remove('modal-open');
      setTimeout(() => {
        try { dlg.close(); } catch { /* bereits geschlossen */ }
        dlg.remove();
        resolveClosed(value);
      }, 120);
    },
  };

  const footL = dlg.querySelector('.foot-left');
  const footR = dlg.querySelector('.foot-right');
  if (!actions.length) dlg.querySelector('.modal-foot').remove();
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${a.kind || 'default'}`;
    b.innerHTML = `${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span>`;
    if (a.id) b.dataset.action = a.id;
    b.addEventListener('click', async () => {
      if (a.onClick) {
        const r = await a.onClick(handle);
        if (r === false) return;
      }
      handle.close(a.value ?? null, a.force);
    });
    (a.align === 'left' ? footL : footR).appendChild(b);
  });

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (dismissible) handle.close(null);
  });
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg && dismissible) handle.close(null);
  });
  dlg.querySelector('[data-close]')?.addEventListener('click', () => handle.close(null));

  document.body.appendChild(dlg);
  dlg.showModal();
  modalDepth += 1;
  document.documentElement.classList.add('modal-open');
  return handle;
}

export function confirmDialog({ title = 'Bist du sicher?', message, confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false, extra = '' }) {
  const h = openModal({
    title,
    size: 'sm',
    content: `<p class="modal-text">${message}</p>${extra}`,
    actions: [
      { label: cancelLabel, kind: 'ghost', value: false },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true, id: 'confirm' },
    ],
  });
  h.el.querySelector('[data-action="confirm"]')?.focus();
  return h.closed.then((v) => v === true);
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Speichern', description = '' }) {
  const wrap = document.createElement('form');
  wrap.innerHTML = `
    ${description ? `<p class="modal-text">${description}</p>` : ''}
    <label class="field">
      <span class="field-label">${esc(label)}</span>
      <input class="input" type="text" maxlength="80" autocomplete="off" value="${esc(value)}" placeholder="${esc(placeholder)}">
    </label>
    <p class="field-error" hidden></p>`;
  const input = wrap.querySelector('input');
  const err = wrap.querySelector('.field-error');
  const h = openModal({
    title,
    size: 'sm',
    content: wrap,
    actions: [
      { label: 'Abbrechen', kind: 'ghost', value: null },
      {
        label: confirmLabel, kind: 'primary', value: null, id: 'ok',
        onClick: (hd) => {
          const v = input.value.trim();
          if (!v) {
            err.textContent = 'Bitte gib einen Namen ein.';
            err.hidden = false;
            input.focus();
            return false;
          }
          hd.result = v;
          return true;
        },
      },
    ],
  });
  wrap.addEventListener('submit', (e) => {
    e.preventDefault();
    h.el.querySelector('[data-action="ok"]').click();
  });
  input.focus();
  input.select();
  return h.closed.then(() => h.result ?? null);
}

/* ---------- Menü ---------- */

export function openMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it.separator) {
      menu.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>');
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = `menu-item${it.danger ? ' danger' : ''}`;
    b.innerHTML = `${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>`;
    b.addEventListener('click', () => {
      close();
      it.onClick();
    });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button')?.focus();

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
  }
  function onDown(e) {
    if (!menu.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus?.();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...menu.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
    }
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  });
  return close;
}

/** Einfaches Popover, das unter einem Auslöser erscheint. */
export function createPopover(trigger, panel) {
  panel.classList.add('popover');
  panel.hidden = true;
  const wrap = trigger.parentElement;
  wrap.classList.add('popover-wrap');
  wrap.appendChild(panel);
  const onDoc = (e) => {
    if (!wrap.contains(e.target)) hide();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      hide();
      trigger.focus();
    }
  };
  function show() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  }
  function hide() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  }
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => (panel.hidden ? show() : hide()));
  return { show, hide, destroy: hide };
}
