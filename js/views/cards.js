/* Meine Karteikarten: Liste mit Suche, Filtern, Sortierung und Sammelaktionen. */

import {
  state, queryCards, matchingCategories, categoryLabel, cardText, getReview, deleteCards, duplicateCard,
  assignCategories, resetProgress, SORTS, PROGRESS_FILTERS, getCategory,
} from '../store.js';
import { esc, icon, plural, debounce, formatDue, relativeTime, toDateInputValue } from '../utils.js';
import { openCardEditor } from '../components/cardEditor.js';
import { createCategoryPicker } from '../components/categoryPicker.js';
import { openModal, confirmDialog, createPopover, toast, showError } from '../ui.js';
import { cardStatus, isDue, isDifficult, STATUS_LABELS } from '../srs.js';
import { startSession, orderCards } from '../session.js';

const BATCH = 40;

const defaultFilter = () => ({
  text: '', categoryIds: [], catMode: 'any', uncategorized: false, progress: 'all', dateFrom: null, dateTo: null, sort: 'newest',
});
let F = defaultFilter();
let selection = new Set();

/** Setzt Filter und Auswahl zurück (z. B. beim Klick auf den Menüpunkt). */
export function resetFilter() {
  F = defaultFilter();
  selection = new Set();
}

export function mount(root, params) {
  if (params && [...params.keys()].length) {
    F = defaultFilter();
    if (params.get('cat')) F.categoryIds = params.get('cat').split(',').filter((id) => state.categories.has(id));
    if (params.has('none')) F.uncategorized = true;
    if (params.get('progress') && PROGRESS_FILTERS[params.get('progress')]) F.progress = params.get('progress');
    if (params.get('sort') && SORTS[params.get('sort')]) F.sort = params.get('sort');
    selection = new Set();
  }

  let results = [];
  let rendered = 0;
  let alive = true;
  let observer = null;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Meine Karteikarten</h1><p class="page-sub" id="count"></p></div>
      <button type="button" class="btn btn-primary" data-act="new">${icon('plus')}<span>Neue Karteikarte</span></button>
    </div>
    <section class="card toolbar">
      <div class="toolbar-row">
        <label class="search-field">${icon('search')}<input id="q" class="input" type="search" placeholder="Suche in Vorder- und Rückseiten, Fächern und Themen …" autocomplete="off" aria-label="Suche"></label>
        <div class="toolbar-group">
          <div class="popover-wrap" id="catWrap"><button type="button" class="btn" id="catBtn">${icon('folder')}<span id="catBtnLabel">Kategorien</span>${icon('chevron-down')}</button></div>
          <select class="select" id="progress" aria-label="Lernfortschritt">${Object.entries(PROGRESS_FILTERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <select class="select" id="sort" aria-label="Sortierung">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="toolbar-row toolbar-row-2">
        <label class="inline-field">Erstellt von <input type="date" class="input input-sm" id="dFrom"></label>
        <label class="inline-field">bis <input type="date" class="input input-sm" id="dTo"></label>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-ghost" data-act="reset">Filter zurücksetzen</button>
        <button type="button" class="btn btn-sm" data-act="study-filtered">${icon('play')}<span>Gefilterte lernen</span></button>
      </div>
      <div class="chips" id="catHits" hidden></div>
    </section>
    <div class="bulkbar" id="bulk" hidden></div>
    <div class="card-list" id="list" role="list"></div>
    <div id="sentinel" class="sentinel"></div>`;

  const $ = (s) => root.querySelector(s);
  const q = $('#q');
  const progressSel = $('#progress');
  const sortSel = $('#sort');
  const dFrom = $('#dFrom');
  const dTo = $('#dTo');
  const list = $('#list');

  /* Kategorie-Popover */
  const panel = document.createElement('div');
  panel.className = 'popover-panel';
  panel.innerHTML = `
    <div class="popover-head"><strong>Nach Kategorien filtern</strong></div>
    <div data-slot="picker"></div>
    <div class="popover-foot">
      <div class="seg" role="radiogroup" aria-label="Verknüpfung">
        <label><input type="radio" name="catmode" value="any"><span>Eine davon</span></label>
        <label><input type="radio" name="catmode" value="all"><span>Alle gleichzeitig</span></label>
      </div>
      <label class="check-inline"><input type="checkbox" id="uncat"> Nur Karten ohne Kategorie</label>
      <button type="button" class="btn btn-sm btn-ghost" data-act="clear-cats">Auswahl aufheben</button>
    </div>`;
  const pop = createPopover($('#catBtn'), panel);
  let picker = createCategoryPicker({ selected: F.categoryIds, multi: true, showCounts: true, maxHeight: 280, onChange: (set) => { F.categoryIds = [...set]; apply(); } });
  panel.querySelector('[data-slot="picker"]').appendChild(picker.el);
  panel.querySelectorAll('input[name="catmode"]').forEach((r) => r.addEventListener('change', () => { F.catMode = r.value; apply(); }));
  panel.querySelector('#uncat').addEventListener('change', (e) => { F.uncategorized = e.target.checked; apply(); });
  panel.querySelector('[data-act="clear-cats"]').addEventListener('click', () => {
    F.categoryIds = [];
    F.uncategorized = false;
    picker.setSelected([]);
    apply();
  });

  function syncControls() {
    q.value = F.text;
    progressSel.value = F.progress;
    sortSel.value = F.sort;
    dFrom.value = F.dateFrom ? toDateInputValue(F.dateFrom) : '';
    dTo.value = F.dateTo ? toDateInputValue(F.dateTo) : '';
    panel.querySelectorAll('input[name="catmode"]').forEach((r) => { r.checked = r.value === F.catMode; });
    panel.querySelector('#uncat').checked = F.uncategorized;
    picker.setSelected(F.categoryIds);
  }

  function updateCatButton() {
    const n = F.categoryIds.length + (F.uncategorized ? 1 : 0);
    $('#catBtnLabel').textContent = n ? `Kategorien (${n})` : 'Kategorien';
    $('#catBtn').classList.toggle('is-active', n > 0);
  }

  const parseDate = (v) => {
    if (!v) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };

  /* Ergebnis berechnen und neu zeichnen */
  function apply({ keepRendered = false } = {}) {
    if (!alive) return;
    results = queryCards(F);
    const ids = new Set(results.map((c) => c.id));
    for (const id of [...selection]) if (!ids.has(id)) selection.delete(id);
    updateCatButton();
    const total = state.cards.size;
    $('#count').textContent = results.length === total
      ? plural(total, 'Karteikarte', 'Karteikarten')
      : `${results.length.toLocaleString('de-DE')} von ${plural(total, 'Karteikarte', 'Karteikarten')}`;
    const hits = F.text.trim() ? matchingCategories(F.text) : [];
    const hitsEl = $('#catHits');
    hitsEl.hidden = !hits.length;
    hitsEl.innerHTML = hits.length
      ? `<span class="muted small">Passende Fächer &amp; Themen:</span>${hits.map((c) => `<button type="button" class="chip chip-btn" data-hit="${c.id}" title="${esc(categoryLabel(c.id))}">${icon('folder')}${esc(categoryLabel(c.id))}</button>`).join('')}`
      : '';
    const n = keepRendered ? Math.max(BATCH, rendered) : BATCH;
    list.innerHTML = '';
    rendered = 0;
    renderMore(n);
    renderBulk();
    if (!results.length) {
      const filtered = isFiltered();
      list.innerHTML = `<div class="empty">${icon('layers')}<h3>${filtered ? 'Keine Treffer' : 'Noch keine Karteikarten'}</h3>
        <p class="muted">${filtered ? 'Passe die Suche oder die Filter an.' : 'Erstelle deine erste Karteikarte.'}</p>
        ${filtered ? '<button type="button" class="btn" data-act="reset">Filter zurücksetzen</button>' : `<button type="button" class="btn btn-primary" data-act="new">${icon('plus')}<span>Neue Karteikarte</span></button>`}</div>`;
    }
  }

  const isFiltered = () => F.text || F.categoryIds.length || F.uncategorized || F.progress !== 'all' || F.dateFrom || F.dateTo;

  function rowHtml(card) {
    const t = cardText(card.id);
    const r = getReview(card.id);
    const st = cardStatus(r);
    const due = isDue(r);
    const cats = card.categoryIds;
    const shown = cats.slice(0, 3);
    const sel = selection.has(card.id);
    return `<div class="card-row ${sel ? 'is-selected' : ''}" role="listitem" data-id="${card.id}">
      <label class="check" title="Auswählen"><input type="checkbox" data-sel ${sel ? 'checked' : ''} aria-label="Karteikarte auswählen"></label>
      <button type="button" class="card-main" data-act="edit" aria-label="Karteikarte bearbeiten">
        <span class="cr-front">${t.img ? `<span class="cr-img">${icon('image')}</span>` : ''}${esc(t.front || '(leer)')}</span>
        <span class="cr-back">${esc(t.back || '(leer)')}</span>
        <span class="chips">${shown.map((id) => `<span class="chip chip-sm" title="${esc(categoryLabel(id))}">${esc(categoryLabel(id))}</span>`).join('')}${cats.length > 3 ? `<span class="chip chip-sm">+${cats.length - 3}</span>` : ''}${cats.length ? '' : '<span class="chip chip-sm chip-muted">Ohne Kategorie</span>'}</span>
      </button>
      <div class="cr-meta">
        <span class="badge badge-${st}">${STATUS_LABELS[st]}</span>
        ${due ? '<span class="badge badge-due">Fällig</span>' : r && r.totalReviews ? `<span class="muted small">${formatDue(r.due)}</span>` : `<span class="muted small">${relativeTime(card.createdAt)}</span>`}
        ${isDifficult(r) ? '<span class="badge badge-hard">Schwierig</span>' : ''}
      </div>
      <div class="cr-actions">
        <button type="button" class="icon-btn" data-act="edit" title="Bearbeiten" aria-label="Bearbeiten">${icon('pencil')}</button>
        <button type="button" class="icon-btn" data-act="dup" title="Duplizieren" aria-label="Duplizieren">${icon('copy')}</button>
        <button type="button" class="icon-btn danger" data-act="del" title="Löschen" aria-label="Löschen">${icon('trash')}</button>
      </div></div>`;
  }

  function renderMore(count = BATCH) {
    const end = Math.min(results.length, rendered + count);
    if (end <= rendered) return;
    list.insertAdjacentHTML('beforeend', results.slice(rendered, end).map(rowHtml).join(''));
    rendered = end;
  }

  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && rendered < results.length) renderMore();
  }, { rootMargin: '600px' });
  observer.observe($('#sentinel'));

  function renderBulk() {
    const bar = $('#bulk');
    const n = selection.size;
    bar.hidden = n === 0;
    if (!n) return;
    bar.innerHTML = `<span class="bulk-count">${n.toLocaleString('de-DE')} ausgewählt</span>
      ${n < results.length ? `<button type="button" class="btn btn-sm btn-ghost" data-bulk="all">Alle ${results.length.toLocaleString('de-DE')} auswählen</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" data-bulk="assign">${icon('folder')}<span>Kategorien zuweisen</span></button>
      <button type="button" class="btn btn-sm" data-bulk="study">${icon('play')}<span>Lernen</span></button>
      <button type="button" class="btn btn-sm" data-bulk="reset">${icon('refresh')}<span>Fortschritt zurücksetzen</span></button>
      <button type="button" class="btn btn-sm btn-danger-ghost" data-bulk="delete">${icon('trash')}<span>Löschen</span></button>
      <button type="button" class="icon-btn" data-bulk="clear" aria-label="Auswahl aufheben" title="Auswahl aufheben">${icon('x')}</button>`;
  }

  /* Sammelaktion: Kategorien zuweisen / verschieben */
  function openAssignDialog() {
    const ids = [...selection];
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="modal-text">${plural(ids.length, 'Karteikarte', 'Karteikarten')} bearbeiten:</p>
      <div class="seg seg-block" role="radiogroup">
        <label><input type="radio" name="am" value="add" checked><span>Zu Kategorien hinzufügen</span></label>
        <label><input type="radio" name="am" value="replace"><span>Verschieben (bisherige ersetzen)</span></label>
        <label><input type="radio" name="am" value="remove"><span>Aus Kategorien entfernen</span></label>
      </div>
      <div class="field"><span class="field-label">Kategorien</span><div data-slot="picker"></div></div>
      <p class="field-error" hidden></p>`;
    const pk = createCategoryPicker({ multi: true, allowCreate: true, maxHeight: 240 });
    body.querySelector('[data-slot="picker"]').appendChild(pk.el);
    const h = openModal({
      title: 'Kategorien zuweisen', content: body, size: 'md',
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        {
          label: 'Anwenden', kind: 'primary',
          onClick: async (hd) => {
            const mode = body.querySelector('input[name="am"]:checked').value;
            const cats = pk.getSelected();
            const err = body.querySelector('.field-error');
            if (!cats.length && mode !== 'replace') {
              err.textContent = 'Bitte wähle mindestens eine Kategorie.';
              err.hidden = false;
              return false;
            }
            if (mode === 'replace' && !cats.length) {
              const ok = await confirmDialog({ title: 'Alle Kategorien entfernen?', message: 'Die ausgewählten Karten haben danach keine Kategorie mehr.', confirmLabel: 'Fortfahren', danger: true });
              if (!ok) return false;
            }
            hd.setBusy(true);
            try {
              const n = await assignCategories(ids, cats, mode);
              toast(`${plural(n, 'Karteikarte', 'Karteikarten')} aktualisiert.`, { type: 'success' });
            } catch (e) {
              showError(e);
              hd.setBusy(false);
              return false;
            }
            return true;
          },
        },
      ],
    });
    return h;
  }

  /* Ereignisse */
  const onInput = debounce(() => { F.text = q.value; apply(); }, 160);
  q.addEventListener('input', onInput);
  progressSel.addEventListener('change', () => { F.progress = progressSel.value; apply(); });
  sortSel.addEventListener('change', () => { F.sort = sortSel.value; apply(); });
  dFrom.addEventListener('change', () => { F.dateFrom = parseDate(dFrom.value); apply(); });
  dTo.addEventListener('change', () => { F.dateTo = parseDate(dTo.value); apply(); });

  async function onClick(e) {
    const hit = e.target.closest('[data-hit]');
    if (hit) {
      const id = hit.dataset.hit;
      if (getCategory(id) && !F.categoryIds.includes(id)) F.categoryIds.push(id);
      F.text = '';
      syncControls();
      apply();
      return;
    }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) return onBulk(bulk.dataset.bulk);
    const actEl = e.target.closest('[data-act]');
    if (!actEl || !root.contains(actEl)) return;
    const act = actEl.dataset.act;
    if (act === 'new') return openCardEditor({ categoryIds: F.categoryIds.length === 1 ? F.categoryIds : [] });
    if (act === 'reset') {
      F = defaultFilter();
      syncControls();
      apply();
      return;
    }
    if (act === 'study-filtered') {
      if (!results.length) return toast('Keine Karten im aktuellen Filter.', { type: 'error' });
      const ids = orderCards(results, state.settings.studyOrder).map((c) => c.id);
      const n = state.settings.sessionSize > 0 ? ids.slice(0, state.settings.sessionSize) : ids;
      startSession({ ids: n, title: 'Gefilterte Karten', mode: 'study' });
      return;
    }
    const row = actEl.closest('.card-row');
    if (!row) return;
    const id = row.dataset.id;
    if (act === 'edit') openCardEditor({ cardId: id });
    else if (act === 'dup') {
      try {
        await duplicateCard(id);
        toast('Karte dupliziert.', { type: 'success' });
      } catch (err) { showError(err); }
    } else if (act === 'del') {
      const ok = await confirmDialog({ title: 'Karteikarte löschen?', message: 'Die Karte samt Lernfortschritt wird dauerhaft gelöscht.', confirmLabel: 'Löschen', danger: true });
      if (!ok) return;
      try {
        await deleteCards([id]);
        toast('Karte gelöscht.', { type: 'success' });
      } catch (err) { showError(err); }
    }
  }

  async function onBulk(kind) {
    const ids = [...selection];
    if (kind === 'clear') { selection.clear(); list.querySelectorAll('.card-row').forEach((r) => { r.classList.remove('is-selected'); r.querySelector('[data-sel]').checked = false; }); renderBulk(); return; }
    if (kind === 'all') {
      results.forEach((c) => selection.add(c.id));
      list.querySelectorAll('.card-row').forEach((r) => { r.classList.add('is-selected'); r.querySelector('[data-sel]').checked = true; });
      renderBulk();
      return;
    }
    if (kind === 'assign') return openAssignDialog();
    if (kind === 'study') {
      startSession({ ids: orderCards(ids.map((id) => state.cards.get(id)).filter(Boolean), state.settings.studyOrder).map((c) => c.id), title: 'Ausgewählte Karten', mode: 'study' });
      return;
    }
    if (kind === 'reset') {
      const ok = await confirmDialog({ title: 'Lernfortschritt zurücksetzen?', message: `Der Lernfortschritt von ${plural(ids.length, 'Karte', 'Karten')} wird gelöscht. Die Karten gelten danach wieder als neu.`, confirmLabel: 'Zurücksetzen', danger: true });
      if (!ok) return;
      try {
        const n = await resetProgress(ids);
        toast(`Fortschritt von ${plural(n, 'Karte', 'Karten')} zurückgesetzt.`, { type: 'success' });
      } catch (err) { showError(err); }
      return;
    }
    if (kind === 'delete') {
      const ok = await confirmDialog({ title: `${plural(ids.length, 'Karteikarte', 'Karteikarten')} löschen?`, message: 'Die Karten werden samt Lernfortschritt dauerhaft gelöscht. Das kann nicht rückgängig gemacht werden.', confirmLabel: 'Endgültig löschen', danger: true });
      if (!ok) return;
      try {
        const n = await deleteCards(ids);
        selection.clear();
        toast(`${plural(n, 'Karteikarte', 'Karteikarten')} gelöscht.`, { type: 'success' });
      } catch (err) { showError(err); }
    }
  }

  function onChange(e) {
    const cb = e.target.closest('[data-sel]');
    if (!cb) return;
    const row = cb.closest('.card-row');
    if (cb.checked) selection.add(row.dataset.id);
    else selection.delete(row.dataset.id);
    row.classList.toggle('is-selected', cb.checked);
    renderBulk();
  }

  const onKey = (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      q.focus();
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);

  syncControls();
  apply();

  return {
    refresh() {
      picker.refresh();
      apply({ keepRendered: true });
    },
    destroy() {
      alive = false;
      observer.disconnect();
      pop.destroy();
      picker.destroy();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      document.removeEventListener('keydown', onKey);
    },
  };
}
