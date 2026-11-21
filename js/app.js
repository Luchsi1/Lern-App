/* Einstiegspunkt: Datenbank öffnen, Router starten, globale Ereignisse. */

import * as db from './db.js';
import { load, state, subscribe, categoryCounts, loadDraft, clearDraft } from './store.js';
import { applyTheme } from './theme.js';
import { toast } from './ui.js';
import { session, hasOpenSession } from './session.js';
import { maybeAutoBackup } from './backup.js';
import { openCardEditor } from './components/cardEditor.js';
import * as dashboard from './views/dashboard.js';
import * as cards from './views/cards.js';
import * as study from './views/study.js';
import * as sessionView from './views/session.js';
import * as review from './views/review.js';
import * as categories from './views/categories.js';
import * as settings from './views/settings.js';

const ROUTES = {
  dashboard: { view: dashboard, title: 'Dashboard', nav: 'dashboard' },
  cards: { view: cards, title: 'Meine Karteikarten', nav: 'cards' },
  study: { view: study, title: 'Lernen', nav: 'study' },
  session: { view: sessionView, title: 'Lerneinheit', nav: 'study' },
  review: { view: review, title: 'Wiederholungen', nav: 'review' },
  categories: { view: categories, title: 'Fächer und Themengebiete', nav: 'categories' },
  settings: { view: settings, title: 'Einstellungen', nav: 'settings' },
};

const viewEl = document.getElementById('view');
let current = null;
let currentName = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { name: path || 'dashboard', params: new URLSearchParams(query) };
}

function route() {
  const { name, params } = parseHash();
  const def = ROUTES[name];
  if (!def) {
    location.replace('#/dashboard');
    return;
  }
  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { console.error(e); }
  }
  current = null;
  viewEl.className = `view view-${name}`;
  viewEl.innerHTML = '';
  try {
    current = def.view.mount(viewEl, params) || null;
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = '<div class="empty"><h3>Etwas ist schiefgelaufen</h3><p class="muted">Die Ansicht konnte nicht geladen werden. Deine Daten sind nicht betroffen.</p><a class="btn" href="#/dashboard">Zum Dashboard</a></div>';
  }
  currentName = name;
  let nav = def.nav;
  if (name === 'session' && session && session.mode === 'review') nav = 'review';
  document.querySelectorAll('.nav-link').forEach((a) => {
    const on = a.dataset.route === nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.getElementById('topbar-title').textContent = def.title;
  document.title = `${def.title} · Lernkarten`;
  document.body.classList.remove('nav-open');
  document.body.classList.toggle('in-session', name === 'session');
  window.scrollTo(0, 0);
}

function updateBadge() {
  const due = categoryCounts().total.due;
  const b = document.getElementById('badge-review');
  b.textContent = due > 99 ? '99+' : String(due);
  b.hidden = due === 0;
  const resume = document.getElementById('resume-dot');
  if (resume) resume.hidden = !hasOpenSession();
}

let refreshQueued = false;
function onStoreChange() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    updateBadge();
    if (current && current.refresh) {
      try { current.refresh(); } catch (e) { console.error(e); }
    }
  });
}

function setupShell() {
  const menuBtn = document.getElementById('menu-btn');
  menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  document.querySelectorAll('.nav-link').forEach((a) => a.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    if (a.dataset.route === 'cards') cards.resetFilter();
    // Ein Klick auf den aktiven Eintrag lädt die Ansicht neu (z. B. um Filter aus Links zu übernehmen)
    if (a.getAttribute('href') === location.hash) route();
  }));
  document.querySelectorAll('[data-global="new-card"]').forEach((b) => b.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    openCardEditor();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.classList.remove('nav-open');
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = document.activeElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (document.querySelector('dialog[open]') || currentName === 'session') return;
      e.preventDefault();
      openCardEditor();
    }
  });
  let lastErr = 0;
  const report = (msg) => {
    console.error(msg);
    if (Date.now() - lastErr < 4000) return;
    lastErr = Date.now();
    toast('Ein unerwarteter Fehler ist aufgetreten. Deine gespeicherten Daten sind sicher.', { type: 'error' });
  };
  window.addEventListener('error', (e) => report(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(state.settings.theme));
}

async function offerDraft() {
  try {
    const d = await loadDraft();
    if (!d) return;
    const age = Date.now() - (d.savedAt || 0);
    const empty = !((d.front || '').replace(/<[^>]*>/g, '').trim() || (d.back || '').replace(/<[^>]*>/g, '').trim() || /<img/.test((d.front || '') + (d.back || '')));
    if (empty || age > 30 * 86400000) {
      await clearDraft();
      return;
    }
    toast('Ein nicht gespeicherter Karteikarten-Entwurf wurde gefunden.', {
      duration: 20000,
      action: {
        label: 'Wiederherstellen',
        onClick: () => openCardEditor({
          cardId: d.cardId && state.cards.has(d.cardId) ? d.cardId : null,
          draft: { front: d.front || '', back: d.back || '', categoryIds: d.categoryIds || [] },
        }),
      },
    });
  } catch (e) {
    console.error(e);
  }
}

function showBootError(e) {
  const box = document.getElementById('boot-error');
  box.hidden = false;
  box.querySelector('.boot-msg').textContent = e && e.message ? e.message : String(e);
  document.getElementById('app').hidden = true;
}

async function boot() {
  setupShell();
  try {
    await db.openDB();
    await load();
  } catch (e) {
    console.error(e);
    showBootError(e);
    return;
  }
  applyTheme(state.settings.theme);
  subscribe(onStoreChange);
  window.addEventListener('hashchange', route);
  if (!location.hash) location.replace('#/dashboard');
  route();
  updateBadge();
  setInterval(updateBadge, 60000);
  document.getElementById('app').classList.add('ready');

  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* ignorieren */ }

  offerDraft();
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
  idle(() => maybeAutoBackup().catch((e) => console.error(e)));

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

boot();
