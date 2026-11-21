/* Dialog zum Erstellen und Bearbeiten von Karteikarten (mit automatischem Entwurf). */

import {
  state, createCard, updateCard, duplicateCard, deleteCards, saveDraft, clearDraft, categoryLabel,
} from '../store.js';
import { openModal, confirmDialog, toast, showError } from '../ui.js';
import { createRichEditor } from './richEditor.js';
import { createCategoryPicker } from './categoryPicker.js';
import { esc, icon, debounce } from '../utils.js';

let active = false;

/**
 * @param {object} o
 * @param {string|null} o.cardId       vorhandene Karte bearbeiten
 * @param {string[]} o.categoryIds     Vorbelegung für neue Karten
 * @param {object} o.draft             wiederhergestellter Entwurf {cardId, front, back, categoryIds}
 */
export function openCardEditor({ cardId = null, categoryIds = [], draft = null, onSaved = null } = {}) {
  if (active) return;
  const existing = cardId ? state.cards.get(cardId) : null;
  if (cardId && !existing) {
    toast('Diese Karteikarte existiert nicht mehr.', { type: 'error' });
    return;
  }
  active = true;

  const initial = {
    front: draft ? draft.front : existing ? existing.front : '',
    back: draft ? draft.back : existing ? existing.back : '',
    categoryIds: draft ? draft.categoryIds : existing ? existing.categoryIds : categoryIds,
  };
  let currentCategories = initial.categoryIds.filter((id) => state.categories.has(id));
  let baseline = null; // Zustand zum Vergleich für „ungespeicherte Änderungen“

  const wrap = document.createElement('div');
  wrap.className = 'editor';
  wrap.innerHTML = `
    <div class="field"><span class="field-label" id="lbl-front">Vorderseite</span><div data-slot="front"></div></div>
    <div class="field"><span class="field-label" id="lbl-back">Rückseite</span><div data-slot="back"></div></div>
    <div class="field">
      <span class="field-label">Kategorien <span class="muted">(optional, Mehrfachauswahl)</span></span>
      <div class="chips editor-chips" data-slot="chips"></div>
      <div data-slot="picker"></div>
    </div>
    <p class="field-error" hidden></p>
    ${existing ? `<p class="muted small editor-meta">Erstellt am ${new Date(existing.createdAt).toLocaleString('de-DE')} · Zuletzt bearbeitet ${new Date(existing.updatedAt).toLocaleString('de-DE')}</p>` : ''}`;

  const persistDraft = debounce(() => {
    if (!isDirty() || (front.isEmpty() && back.isEmpty())) return;
    saveDraft({ cardId: existing ? existing.id : null, front: front.getHtml(), back: back.getHtml(), categoryIds: currentCategories }).catch(() => {});
  }, 700);

  const front = createRichEditor({ label: 'Vorderseite', placeholder: 'Frage, Begriff oder Aufgabe …', html: initial.front, onChange: () => persistDraft() });
  const back = createRichEditor({ label: 'Rückseite', placeholder: 'Antwort oder Erklärung …', html: initial.back, onChange: () => persistDraft() });
  wrap.querySelector('[data-slot="front"]').appendChild(front.el);
  wrap.querySelector('[data-slot="back"]').appendChild(back.el);

  const chipsEl = wrap.querySelector('[data-slot="chips"]');
  const errEl = wrap.querySelector('.field-error');

  const picker = createCategoryPicker({
    selected: currentCategories,
    multi: true,
    allowCreate: true,
    maxHeight: 200,
    onChange: (set) => {
      currentCategories = [...set];
      renderChips();
      persistDraft();
    },
  });
  wrap.querySelector('[data-slot="picker"]').appendChild(picker.el);

  function renderChips() {
    chipsEl.innerHTML = currentCategories.length
      ? currentCategories.filter((id) => state.categories.has(id)).map((id) => `<span class="chip" title="${esc(categoryLabel(id))}">${esc(categoryLabel(id))}<button type="button" class="chip-x" data-remove="${id}" aria-label="Kategorie entfernen">${icon('x')}</button></span>`).join('')
      : '<span class="muted small">Keine Kategorie gewählt</span>';
  }
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    currentCategories = currentCategories.filter((id) => id !== b.dataset.remove);
    picker.setSelected(currentCategories);
    renderChips();
    persistDraft();
  });
  renderChips();

  const snapshot = () => JSON.stringify([front.getHtml(), back.getHtml(), [...currentCategories].sort()]);
  function isDirty() {
    return baseline !== null && snapshot() !== baseline;
  }

  function showError2(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function validate() {
    if (front.isEmpty()) {
      showError2('Die Vorderseite ist leer.');
      front.focus();
      return false;
    }
    if (back.isEmpty()) {
      showError2('Die Rückseite ist leer.');
      back.focus();
      return false;
    }
    errEl.hidden = true;
    return true;
  }

  async function save(handle, again) {
    if (!validate()) return false;
    handle.setBusy(true);
    try {
      const payload = { front: front.getHtml(), back: back.getHtml(), categoryIds: currentCategories };
      let saved;
      if (existing) saved = await updateCard(existing.id, payload);
      else saved = await createCard(payload);
      persistDraft.cancel();
      await clearDraft().catch(() => {});
      if (onSaved) onSaved(saved);
      if (again) {
        front.setHtml('');
        back.setHtml('');
        baseline = snapshot();
        toast('Karteikarte gespeichert.', { type: 'success', duration: 1800 });
        handle.setBusy(false);
        front.focus();
        return false; // Dialog offen lassen
      }
      toast(existing ? 'Änderungen gespeichert.' : 'Karteikarte gespeichert.', { type: 'success', duration: 1800 });
      baseline = snapshot();
      handle.setBusy(false);
      return true;
    } catch (e) {
      handle.setBusy(false);
      showError(e, 'Speichern fehlgeschlagen: ');
      return false;
    }
  }

  const actions = [];
  if (existing) {
    actions.push({
      label: 'Duplizieren', kind: 'ghost', align: 'left', icon: 'copy',
      onClick: async (h) => {
        try {
          const copy = await duplicateCard(existing.id);
          toast('Karte dupliziert.', { type: 'success' });
          baseline = snapshot();
          h.closed.then(() => setTimeout(() => openCardEditor({ cardId: copy.id }), 0));
          h.close(null, true);
        } catch (e) { showError(e); }
        return false;
      },
    });
    actions.push({
      label: 'Löschen', kind: 'ghost', align: 'left', icon: 'trash',
      onClick: async (h) => {
        const ok = await confirmDialog({
          title: 'Karteikarte löschen?', message: 'Die Karte samt Lernfortschritt wird dauerhaft gelöscht.',
          confirmLabel: 'Löschen', danger: true,
        });
        if (!ok) return false;
        try {
          await deleteCards([existing.id]);
          await clearDraft().catch(() => {});
          toast('Karte gelöscht.', { type: 'success' });
          baseline = snapshot();
          h.close(null, true);
        } catch (e) { showError(e); }
        return false;
      },
    });
  }
  actions.push({ label: 'Abbrechen', kind: 'ghost', value: null });
  if (!existing) actions.push({ label: 'Speichern & weitere', kind: 'default', onClick: (h) => { save(h, true); return false; }, id: 'save-more' });
  actions.push({
    label: existing ? 'Speichern' : 'Speichern', kind: 'primary', id: 'save',
    onClick: async (h) => {
      const ok = await save(h, false);
      if (ok) h.close(null, true);
      return false;
    },
  });

  const handle = openModal({
    title: existing ? 'Karteikarte bearbeiten' : 'Neue Karteikarte',
    content: wrap,
    size: 'lg',
    actions,
    onBeforeClose: async () => {
      if (!isDirty()) return true;
      const ok = await confirmDialog({
        title: 'Änderungen verwerfen?', message: 'Deine Eingaben wurden noch nicht gespeichert.',
        confirmLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true,
      });
      if (ok) {
        persistDraft.cancel();
        await clearDraft().catch(() => {});
      }
      return ok;
    },
  });

  baseline = draft ? JSON.stringify(['', '', []]) : snapshot();
  if (draft) baseline = JSON.stringify([existing ? existing.front : '', existing ? existing.back : '', existing ? [...existing.categoryIds].sort() : []]);

  handle.el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handle.el.querySelector('[data-action="save"]').click();
    }
  });

  front.focus();
  handle.closed.then(() => { active = false; });
  return handle;
}
