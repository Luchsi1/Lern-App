/* Fächer und Themengebiete: Kategorien verwalten. */

import {
  state, rootCategories, childCategories, categoryDepth, levelName, countsFor, categoryLabel, createCategory,
  renameCategory, deleteCategory, moveCategory, mergeCategories, canMoveCategory, canMergeCategories,
  descendantIds, MAX_DEPTH, flatCategories, categoryCounts,
} from '../store.js';
import { esc, icon, plural, normalize } from '../utils.js';
import { openModal, confirmDialog, promptDialog, openMenu, toast, showError } from '../ui.js';
import { createCategoryPicker } from '../components/categoryPicker.js';
import { startSession, selectCards } from '../session.js';

const collapsed = new Set();
let filterText = '';

export function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Fächer und Themengebiete</h1><p class="page-sub">Fach → Themengebiet → Unterthema → Karteikarten</p></div>
      <button type="button" class="btn btn-primary" data-act="new-root">${icon('plus')}<span>Neues Fach</span></button>
    </div>
    <div class="toolbar-row"><label class="search-field">${icon('search')}<input id="cq" class="input" type="search" placeholder="Kategorien filtern …" aria-label="Kategorien filtern" autocomplete="off"></label></div>
    <div id="tree" class="cat-tree"></div>`;
  const treeEl = root.querySelector('#tree');
  const input = root.querySelector('#cq');
  input.value = filterText;

  function matchSet() {
    const tokens = normalize(filterText).split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const show = new Set();
    for (const { category } of flatCategories()) {
      const n = normalize(categoryLabel(category.id));
      if (tokens.every((t) => n.includes(t))) {
        let cur = category;
        show.add(cur.id);
        while (cur.parentId && state.categories.get(cur.parentId)) {
          cur = state.categories.get(cur.parentId);
          show.add(cur.id);
        }
      }
    }
    return show;
  }

  function node(cat, depth, show) {
    const kids = childCategories(cat.id);
    const isOpen = show ? true : !collapsed.has(cat.id);
    const c = countsFor(cat.id);
    let html = `<div class="cat-node" data-id="${cat.id}" style="--depth:${depth - 1}">
      <div class="cat-row">
        ${kids.length ? `<button type="button" class="tree-toggle ${isOpen ? 'open' : ''}" data-toggle="${cat.id}" aria-label="${isOpen ? 'Zuklappen' : 'Aufklappen'}" aria-expanded="${isOpen}">${icon('chevron-right')}</button>` : '<span class="tree-toggle spacer"></span>'}
        <a class="cat-name" href="#/cards?cat=${cat.id}" title="Karteikarten anzeigen">${esc(cat.name)}</a>
        <span class="tree-level">${levelName(depth)}</span>
        <span class="cat-count" title="Karteikarten inklusive Unterkategorien">${plural(c.total, 'Karte', 'Karten')}</span>
        <span class="cat-actions">
          ${depth < MAX_DEPTH ? `<button type="button" class="icon-btn" data-act="add" title="${levelName(depth + 1)} hinzufügen" aria-label="${levelName(depth + 1)} hinzufügen">${icon('plus')}</button>` : ''}
          <button type="button" class="icon-btn" data-act="study" title="Lernen" aria-label="Lernen" ${c.total ? '' : 'disabled'}>${icon('play')}</button>
          <button type="button" class="icon-btn" data-act="menu" title="Weitere Aktionen" aria-label="Weitere Aktionen" aria-haspopup="menu">${icon('more')}</button>
        </span>
      </div>`;
    if (kids.length && isOpen) {
      html += `<div class="cat-children">${kids.filter((k) => !show || show.has(k.id)).map((k) => node(k, depth + 1, show)).join('')}</div>`;
    }
    return html + '</div>';
  }

  function render() {
    const show = matchSet();
    const roots = rootCategories().filter((r) => !show || show.has(r.id));
    const { total } = categoryCounts();
    if (!state.categories.size) {
      treeEl.innerHTML = `<div class="empty">${icon('folder')}<h3>Noch keine Fächer</h3>
        <p class="muted">Lege dein erstes Fach an, z. B. „Physik“. Darin kannst du Themengebiete und Unterthemen erstellen.</p>
        <button type="button" class="btn btn-primary" data-act="new-root">${icon('plus')}<span>Erstes Fach anlegen</span></button></div>`;
      return;
    }
    treeEl.innerHTML = roots.length
      ? `<div class="card cat-card">${roots.map((r) => node(r, 1, show)).join('')}</div>`
      : '<div class="empty"><h3>Keine Treffer</h3></div>';
    if (total.uncategorized) {
      treeEl.insertAdjacentHTML('beforeend', `<p class="muted small cat-foot">${plural(total.uncategorized, 'Karteikarte hat', 'Karteikarten haben')} keine Kategorie. <a class="link" href="#/cards?none=1">Anzeigen</a></p>`);
    }
  }

  /* ---------- Aktionen ---------- */
  async function addChild(parentId) {
    const depth = parentId ? categoryDepth(parentId) + 1 : 1;
    const name = await promptDialog({
      title: `${levelName(depth)} hinzufügen`,
      label: `Name des ${depth === 1 ? 'Fachs' : depth === 2 ? 'Themengebiets' : 'Unterthemas'}`,
      description: parentId ? `Übergeordnet: <strong>${esc(categoryLabel(parentId))}</strong>` : '',
      confirmLabel: 'Anlegen',
    });
    if (!name) return;
    try {
      await createCategory(name, parentId);
      if (parentId) collapsed.delete(parentId);
      toast(`„${name}“ angelegt.`, { type: 'success', duration: 2000 });
    } catch (e) { showError(e); }
  }

  async function rename(id) {
    const cat = state.categories.get(id);
    const name = await promptDialog({ title: 'Umbenennen', label: 'Neuer Name', value: cat.name, confirmLabel: 'Umbenennen' });
    if (!name) return;
    try {
      await renameCategory(id, name);
      toast('Umbenannt.', { type: 'success', duration: 1800 });
    } catch (e) { showError(e); }
  }

  function pickTarget({ title, description, confirmLabel, allowRoot = false, disabled, selected = [] }) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.innerHTML = `<p class="modal-text">${description}</p><div data-slot="p"></div><p class="field-error" hidden></p>`;
      const pk = createCategoryPicker({ multi: false, selected, disabled, allowRoot, maxHeight: 300 });
      body.querySelector('[data-slot="p"]').appendChild(pk.el);
      const h = openModal({
        title, content: body, size: 'md',
        actions: [
          { label: 'Abbrechen', kind: 'ghost' },
          {
            label: confirmLabel, kind: 'primary',
            onClick: (hd) => {
              const sel = pk.getSelected();
              if (!sel.length) {
                const err = body.querySelector('.field-error');
                err.textContent = 'Bitte wähle ein Ziel.';
                err.hidden = false;
                return false;
              }
              hd.picked = sel[0];
              return true;
            },
          },
        ],
      });
      h.closed.then(() => resolve(h.picked === undefined ? undefined : h.picked));
    });
  }

  async function move(id) {
    const cat = state.categories.get(id);
    const target = await pickTarget({
      title: `„${cat.name}“ verschieben`,
      description: 'Wähle die neue übergeordnete Kategorie. Unterkategorien und Karten bleiben erhalten.',
      confirmLabel: 'Verschieben', allowRoot: true,
      disabled: (cid) => (canMoveCategory(id, cid) ? canMoveCategory(id, cid) : false),
    });
    if (target === undefined) return;
    try {
      await moveCategory(id, target || null);
      toast('Verschoben.', { type: 'success', duration: 1800 });
    } catch (e) { showError(e); }
  }

  async function merge(id) {
    const cat = state.categories.get(id);
    const target = await pickTarget({
      title: `„${cat.name}“ zusammenführen`,
      description: `Alle Karteikarten und Unterkategorien von <strong>${esc(cat.name)}</strong> werden in die gewählte Kategorie übernommen. „${esc(cat.name)}“ wird danach gelöscht.`,
      confirmLabel: 'Zusammenführen',
      disabled: (cid) => canMergeCategories(id, cid) || false,
    });
    if (!target) return;
    const ok = await confirmDialog({
      title: 'Kategorien zusammenführen?',
      message: `„${esc(categoryLabel(id))}“ wird in „${esc(categoryLabel(target))}“ zusammengeführt und danach entfernt.`,
      confirmLabel: 'Zusammenführen', danger: true,
    });
    if (!ok) return;
    try {
      const r = await mergeCategories(id, target);
      toast(`Zusammengeführt (${plural(r.movedCards, 'Karte', 'Karten')} umgehängt).`, { type: 'success' });
    } catch (e) { showError(e); }
  }

  async function remove(id) {
    const cat = state.categories.get(id);
    const ids = descendantIds(id);
    let exclusive = 0;
    let shared = 0;
    for (const card of state.cards.values()) {
      if (!card.categoryIds.some((c) => ids.has(c))) continue;
      if (card.categoryIds.every((c) => ids.has(c))) exclusive += 1;
      else shared += 1;
    }
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="modal-text">„<strong>${esc(cat.name)}</strong>“${ids.size > 1 ? ` und ${plural(ids.size - 1, 'Unterkategorie', 'Unterkategorien')}` : ''} wird gelöscht.</p>
      ${exclusive + shared ? `<div class="seg seg-block" role="radiogroup">
        <label><input type="radio" name="dm" value="keep" checked><span>Karteikarten behalten <small class="muted">(${plural(exclusive, 'Karte verliert', 'Karten verlieren')} ihre einzige Kategorie)</small></span></label>
        <label><input type="radio" name="dm" value="delete"><span>Karteikarten mitlöschen <small class="muted">(${plural(exclusive, 'Karte', 'Karten')}, die nur hier liegen${shared ? `; ${plural(shared, 'Karte', 'Karten')} mit weiteren Kategorien bleiben` : ''})</small></span></label>
      </div>` : '<p class="muted">Es sind keine Karteikarten betroffen.</p>'}`;
    const h = openModal({
      title: 'Kategorie löschen?', content: body, size: 'sm',
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        {
          label: 'Löschen', kind: 'danger',
          onClick: async (hd) => {
            const mode = body.querySelector('input[name="dm"]:checked')?.value || 'keep';
            hd.setBusy(true);
            try {
              const r = await deleteCategory(id, { deleteCards: mode === 'delete' });
              toast(r.deletedCards ? `Gelöscht, inklusive ${plural(r.deletedCards, 'Karte', 'Karten')}.` : 'Kategorie gelöscht.', { type: 'success' });
            } catch (e) {
              hd.setBusy(false);
              showError(e);
              return false;
            }
            return true;
          },
        },
      ],
    });
    return h.closed;
  }

  function study(id) {
    const cards = selectCards({ categoryIds: [id], order: state.settings.studyOrder, limit: state.settings.sessionSize });
    startSession({ ids: cards.map((c) => c.id), title: categoryLabel(id), mode: 'study' });
  }

  const onClick = (e) => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const id = tg.dataset.toggle;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      return render();
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const id = a.closest('.cat-node')?.dataset.id;
    switch (a.dataset.act) {
      case 'new-root': return addChild(null);
      case 'add': return addChild(id);
      case 'study': return study(id);
      case 'menu':
        return openMenu(a, [
          { label: 'Umbenennen', icon: 'pencil', onClick: () => rename(id) },
          { label: 'Verschieben …', icon: 'move', onClick: () => move(id) },
          { label: 'Zusammenführen …', icon: 'merge', onClick: () => merge(id) },
          { label: 'Karteikarten anzeigen', icon: 'layers', onClick: () => { location.hash = `#/cards?cat=${id}`; } },
          { separator: true },
          { label: 'Löschen …', icon: 'trash', danger: true, onClick: () => remove(id) },
        ]);
      default:
    }
  };
  root.addEventListener('click', onClick);
  input.addEventListener('input', () => { filterText = input.value; render(); });
  render();

  return {
    refresh: render,
    destroy() { root.removeEventListener('click', onClick); },
  };
}
