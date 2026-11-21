/* Baumansicht zur Auswahl von Kategorien (einfach oder mehrfach). */

import {
  flatCategories, childCategories, getCategory, categoryDepth, levelName, ancestorIds,
  createCategory, rootCategories, countsFor, MAX_DEPTH, categoryLabel, subscribe,
} from '../store.js';
import { esc, icon, normalize, debounce } from '../utils.js';
import { showError } from '../ui.js';

/**
 * opts:
 *  selected: Iterable<string>   vorausgewählte IDs
 *  multi:    boolean            Mehrfachauswahl (Checkbox) oder Einzelauswahl (Radio)
 *  disabled: (id) => boolean|string   Eintrag nicht wählbar (String = Begründung)
 *  allowCreate: boolean         Formular „Neue Kategorie“ anzeigen
 *  showCounts: boolean          Kartenanzahl anzeigen
 *  allowRoot: boolean           (Einzelauswahl) Option „Hauptebene (kein Elternteil)“
 *  rootLabel: string
 *  onChange(set)
 */
export function createCategoryPicker(opts = {}) {
  const {
    multi = true, disabled = () => false, allowCreate = false, showCounts = false,
    allowRoot = false, rootLabel = 'Hauptebene (als neues Fach)', onChange = () => {}, maxHeight = 260,
  } = opts;
  const selected = new Set(opts.selected || []);
  const expanded = new Set();
  let filter = '';
  let initialised = false;

  const root = document.createElement('div');
  root.className = 'picker';
  root.innerHTML = `
    <div class="picker-search" hidden><input class="input input-sm" type="search" placeholder="Kategorien durchsuchen …" aria-label="Kategorien durchsuchen"></div>
    <div class="picker-tree" role="tree" style="max-height:${maxHeight}px"></div>
    ${allowCreate ? `
    <div class="picker-create">
      <button type="button" class="btn btn-sm btn-ghost" data-act="show-create">${icon('plus')}<span>Neue Kategorie</span></button>
      <form class="picker-create-form" hidden>
        <input class="input input-sm" type="text" maxlength="80" placeholder="Name" aria-label="Name der neuen Kategorie" required>
        <select class="select select-sm" aria-label="Übergeordnete Kategorie"></select>
        <button class="btn btn-sm btn-primary" type="submit">Anlegen</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="cancel-create">Abbrechen</button>
      </form>
    </div>` : ''}`;
  const tree = root.querySelector('.picker-tree');
  const searchWrap = root.querySelector('.picker-search');
  const searchInput = searchWrap.querySelector('input');

  function initExpanded() {
    if (initialised) return;
    initialised = true;
    const all = flatCategories();
    if (all.length <= 24) all.forEach(({ category }) => expanded.add(category.id));
    selected.forEach((id) => ancestorIds(id).forEach((a) => expanded.add(a)));
  }

  function visibleIds() {
    if (!filter) return null;
    const tokens = normalize(filter).split(/\s+/).filter(Boolean);
    const show = new Set();
    for (const { category } of flatCategories()) {
      const n = normalize(categoryLabel(category.id));
      if (tokens.every((t) => n.includes(t))) {
        show.add(category.id);
        ancestorIds(category.id).forEach((a) => show.add(a));
      }
    }
    return show;
  }

  function rowHtml(cat, depth, show) {
    const kids = childCategories(cat.id);
    const isOpen = show ? true : expanded.has(cat.id);
    const dis = disabled(cat.id);
    const checked = selected.has(cat.id);
    const type = multi ? 'checkbox' : 'radio';
    const c = showCounts ? countsFor(cat.id).total : null;
    let html = `<div class="tree-row" role="treeitem" aria-level="${depth}" ${kids.length ? `aria-expanded="${isOpen}"` : ''} style="--depth:${depth - 1}">
      ${kids.length
        ? `<button type="button" class="tree-toggle ${isOpen ? 'open' : ''}" data-toggle="${cat.id}" aria-label="${isOpen ? 'Zuklappen' : 'Aufklappen'}">${icon('chevron-right')}</button>`
        : '<span class="tree-toggle spacer"></span>'}
      <label class="tree-label ${dis ? 'is-disabled' : ''}" ${typeof dis === 'string' ? `title="${esc(dis)}"` : ''}>
        <input type="${type}" name="picker-${root.dataset.uid}" value="${cat.id}" ${checked ? 'checked' : ''} ${dis ? 'disabled' : ''}>
        <span class="tree-name">${esc(cat.name)}</span>
        <span class="tree-level">${levelName(depth)}</span>
        ${c !== null ? `<span class="tree-count">${c}</span>` : ''}
      </label>
    </div>`;
    if (kids.length && isOpen) {
      for (const k of kids) if (!show || show.has(k.id)) html += rowHtml(k, depth + 1, show);
    }
    return html;
  }

  function render() {
    initExpanded();
    const roots = rootCategories();
    searchWrap.hidden = flatCategories().length < 8;
    const show = visibleIds();
    let html = '';
    if (allowRoot) {
      html += `<div class="tree-row" style="--depth:0"><span class="tree-toggle spacer"></span>
        <label class="tree-label"><input type="radio" name="picker-${root.dataset.uid}" value="" ${selected.has('') ? 'checked' : ''}>
        <span class="tree-name"><em>${esc(rootLabel)}</em></span></label></div>`;
    }
    if (!roots.length && !allowRoot) {
      html += `<p class="picker-empty">Noch keine Kategorien vorhanden.${allowCreate ? ' Lege unten die erste an.' : ''}</p>`;
    }
    for (const r of roots) if (!show || show.has(r.id)) html += rowHtml(r, 1, show);
    if (show && !show.size) html += '<p class="picker-empty">Keine Treffer.</p>';
    tree.innerHTML = html;
    renderCreateParents();
  }

  function renderCreateParents() {
    const sel = root.querySelector('.picker-create-form select');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">Neues Fach (Hauptebene)</option>` +
      flatCategories()
        .filter(({ depth }) => depth < MAX_DEPTH)
        .map(({ category, depth }) => `<option value="${category.id}">${'– '.repeat(depth - 1)}${esc(category.name)} → ${levelName(depth + 1)}</option>`)
        .join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  root.dataset.uid = Math.random().toString(36).slice(2, 8);

  tree.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const id = t.dataset.toggle;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    render();
  });

  tree.addEventListener('change', (e) => {
    const input = e.target;
    if (input.tagName !== 'INPUT') return;
    if (multi) {
      if (input.checked) selected.add(input.value);
      else selected.delete(input.value);
    } else {
      selected.clear();
      selected.add(input.value);
    }
    onChange(new Set(selected));
  });

  searchInput.addEventListener('input', debounce(() => {
    filter = searchInput.value.trim();
    render();
  }, 120));

  if (allowCreate) {
    const form = root.querySelector('.picker-create-form');
    const showBtn = root.querySelector('[data-act="show-create"]');
    const nameInput = form.querySelector('input');
    showBtn.addEventListener('click', () => {
      form.hidden = false;
      showBtn.hidden = true;
      renderCreateParents();
      nameInput.focus();
    });
    root.querySelector('[data-act="cancel-create"]').addEventListener('click', () => {
      form.hidden = true;
      showBtn.hidden = false;
      nameInput.value = '';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const parentId = form.querySelector('select').value || null;
        const cat = await createCategory(nameInput.value, parentId);
        if (parentId) expanded.add(parentId);
        if (multi) selected.add(cat.id);
        nameInput.value = '';
        form.hidden = true;
        showBtn.hidden = false;
        render();
        onChange(new Set(selected));
      } catch (err) {
        showError(err);
      }
    });
  }

  // Bei Änderungen am Kategoriebaum von außen aktualisieren, solange das Element im DOM hängt
  let wasConnected = false;
  const unsub = subscribe(() => {
    if (!root.isConnected) {
      if (wasConnected) unsub();
      return;
    }
    wasConnected = true;
    for (const id of [...selected]) if (id && !getCategory(id)) selected.delete(id);
    render();
  });

  render();

  return {
    el: root,
    getSelected: () => [...selected],
    setSelected(ids) {
      selected.clear();
      for (const id of ids) selected.add(id);
      render();
    },
    refresh: render,
    destroy: unsub,
  };
}
