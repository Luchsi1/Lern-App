/* Lernen: Einrichtung einer freien Lerneinheit. */

import { state, queryCards, categoryLabel } from '../store.js';
import { esc, icon, plural } from '../utils.js';
import { createCategoryPicker } from '../components/categoryPicker.js';
import { startSession, selectCards, ORDERS, session, hasOpenSession } from '../session.js';
import { toast } from '../ui.js';

const FILTERS = {
  all: 'Alle Karten',
  new: 'Nur neue Karten',
  learning: 'Nur lernende Karten',
  due: 'Nur fällige Karten',
  difficult: 'Nur schwierige Karten',
  mastered: 'Nur gefestigte Karten',
};

const setup = { categoryIds: [], progress: 'all', order: null, limit: '', track: true };

export function mount(root, params) {
  if (params && params.get('cat')) {
    setup.categoryIds = params.get('cat').split(',').filter((id) => state.categories.has(id));
  }
  if (setup.order === null) setup.order = state.settings.studyOrder;
  if (setup.limit === '' && state.settings.sessionSize > 0) setup.limit = String(state.settings.sessionSize);

  const resume = hasOpenSession() ? session : null;

  root.innerHTML = `
    <div class="page-head"><div><h1>Lernen</h1><p class="page-sub">Stelle deine Lerneinheit zusammen.</p></div></div>
    ${resume ? `<div class="banner" role="note">${icon('play')}<div><strong>Laufende Lerneinheit</strong><br><span class="muted">${esc(resume.title)} – Karte ${resume.idx + 1} von ${resume.ids.length}</span></div>
      <a class="btn btn-sm btn-primary" href="#/session">Fortsetzen</a></div>` : ''}
    <div class="setup-grid">
      <section class="card">
        <h2>Kategorien</h2>
        <p class="muted small">Keine Auswahl = alle Karteikarten. Unterkategorien sind automatisch enthalten.</p>
        <div data-slot="picker"></div>
      </section>
      <section class="card setup-options">
        <h2>Einstellungen</h2>
        <label class="field"><span class="field-label">Welche Karten?</span>
          <select class="select" id="filter">${Object.entries(FILTERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Reihenfolge</span>
          <select class="select" id="order">${Object.entries(ORDERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Maximale Anzahl <span class="muted">(leer = alle)</span></span>
          <input class="input" type="number" id="limit" min="1" max="100000" inputmode="numeric" placeholder="alle"></label>
        <label class="switch"><input type="checkbox" id="track"><span class="switch-ui"></span><span>Lernfortschritt speichern<br><small class="muted">Antworten beeinflussen die Wiederholungstermine.</small></span></label>
        <div class="setup-summary">
          <div id="summary" class="summary-line"></div>
          <button type="button" class="btn btn-primary btn-lg" id="start">${icon('play')}<span>Lerneinheit starten</span></button>
        </div>
      </section>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const picker = createCategoryPicker({
    selected: setup.categoryIds, multi: true, showCounts: true, maxHeight: 420,
    onChange: (set) => { setup.categoryIds = [...set]; update(); },
  });
  $('[data-slot="picker"]').appendChild(picker.el);
  $('#filter').value = setup.progress;
  $('#order').value = setup.order;
  $('#limit').value = setup.limit;
  $('#track').checked = setup.track;

  function currentLimit() {
    const n = parseInt($('#limit').value, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function update() {
    const all = queryCards({ categoryIds: setup.categoryIds, catMode: 'any', progress: setup.progress });
    const lim = currentLimit();
    const n = lim ? Math.min(lim, all.length) : all.length;
    const scope = setup.categoryIds.length
      ? setup.categoryIds.map((id) => categoryLabel(id)).join(', ')
      : 'allen Kategorien';
    $('#summary').innerHTML = `<strong>${plural(n, 'Karteikarte', 'Karteikarten')}</strong> aus ${esc(scope)}`;
    $('#start').disabled = n === 0;
  }

  $('#filter').addEventListener('change', (e) => { setup.progress = e.target.value; update(); });
  $('#order').addEventListener('change', (e) => { setup.order = e.target.value; });
  $('#limit').addEventListener('input', (e) => { setup.limit = e.target.value; update(); });
  $('#track').addEventListener('change', (e) => { setup.track = e.target.checked; });
  $('#start').addEventListener('click', () => {
    const cards = selectCards({ categoryIds: setup.categoryIds, progress: setup.progress, order: setup.order, limit: currentLimit() });
    if (!cards.length) return toast('Keine Karten für diese Auswahl.', { type: 'error' });
    startSession({
      ids: cards.map((c) => c.id),
      title: setup.categoryIds.length === 1 ? categoryLabel(setup.categoryIds[0]) : 'Lerneinheit',
      mode: 'study',
      track: setup.track,
    });
  });

  update();
  return {
    refresh() { picker.refresh(); update(); },
    destroy() { picker.destroy(); },
  };
}
