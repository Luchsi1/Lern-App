/* Einstellungen, Export/Import, Backups. */

import { state, updateSettings } from '../store.js';
import {
  downloadExport, validateImport, importData, createBackup, listBackups, restoreBackup, deleteBackup,
  downloadBackup, deleteAllData,
} from '../backup.js';
import { esc, icon, plural, formatDateTime, formatBytes, readFileAsText } from '../utils.js';
import { ORDERS } from '../session.js';
import { openModal, confirmDialog, toast, showError } from '../ui.js';
import { applyTheme } from '../theme.js';
import * as db from '../db.js';
import { resetProgress } from '../store.js';

export function mount(root) {
  let alive = true;

  async function render() {
    const s = state.settings;
    let storage = null;
    let persisted = null;
    try {
      if (navigator.storage?.estimate) storage = await navigator.storage.estimate();
      if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    } catch { /* ignorieren */ }
    const backups = await listBackups().catch(() => []);
    if (!alive) return;

    root.innerHTML = `
      <div class="page-head"><div><h1>Einstellungen</h1><p class="page-sub">Darstellung, Lernen und Datensicherheit</p></div></div>

      <section class="card settings-section">
        <h2>Darstellung</h2>
        <label class="field row"><span class="field-label">Farbschema</span>
          <select class="select" id="theme"><option value="system">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label>
      </section>

      <section class="card settings-section">
        <h2>Lernen</h2>
        <label class="field row"><span class="field-label">Standard-Reihenfolge</span>
          <select class="select" id="order">${Object.entries(ORDERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field row"><span class="field-label">Karten pro Lerneinheit <small class="muted">(0 = alle)</small></span>
          <input class="input input-sm" type="number" id="size" min="0" max="10000" value="${s.sessionSize}"></label>
        <label class="field row"><span class="field-label">Neue Karten pro Wiederholung <small class="muted">(0 = keine)</small></span>
          <input class="input input-sm" type="number" id="newper" min="0" max="500" value="${s.newPerReview}"></label>
        <p class="muted small">Die Änderungen werden automatisch gespeichert.</p>
      </section>

      <section class="card settings-section">
        <h2>Daten &amp; Backup</h2>
        <p class="muted">Alle Daten liegen ausschließlich in diesem Browser (IndexedDB). Exportiere sie regelmäßig als Datei – so bist du auch bei einem Gerätewechsel oder gelöschten Browserdaten abgesichert.</p>
        <div class="kv">
          <div><span class="muted">Karteikarten</span><strong>${state.cards.size.toLocaleString('de-DE')}</strong></div>
          <div><span class="muted">Kategorien</span><strong>${state.categories.size.toLocaleString('de-DE')}</strong></div>
          <div><span class="muted">Speicherbelegung</span><strong>${storage ? formatBytes(storage.usage) : '–'}</strong></div>
          <div><span class="muted">Letzter Export</span><strong>${s.lastExportAt ? formatDateTime(s.lastExportAt) : 'noch nie'}</strong></div>
          <div><span class="muted">Dauerhafter Speicher</span><strong>${persisted === null ? 'unbekannt' : persisted ? 'aktiv' : 'nicht garantiert'}</strong></div>
        </div>
        ${persisted === false ? `<div class="banner banner-warn" role="note">${icon('shield')}<div>Der Browser darf die Daten bei Speichermangel löschen. Fordere dauerhaften Speicher an und exportiere zusätzlich Backups.</div><button type="button" class="btn btn-sm" data-act="persist">Dauerhaft speichern</button></div>` : ''}
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-act="export">${icon('download')}<span>Alle Daten exportieren (JSON)</span></button>
          <button type="button" class="btn" data-act="import">${icon('upload')}<span>Import aus JSON-Datei</span></button>
          <button type="button" class="btn" data-act="backup">${icon('shield')}<span>Backup im Browser anlegen</span></button>
          <input type="file" id="file" accept=".json,application/json" hidden>
        </div>

        <h3>Backups im Browser</h3>
        <p class="muted small">Automatische tägliche Sicherungen sowie Sicherungen vor Import und Löschen. Sie liegen im selben Browser-Speicher – für echte Sicherheit zusätzlich exportieren.</p>
        ${backups.length ? `<ul class="list backup-list">${backups.map((b) => `
          <li class="backup-row" data-id="${b.id}">
            <div class="list-row-main"><span class="list-row-title">${formatDateTime(b.createdAt)} <span class="badge">${b.kind === 'auto' ? 'automatisch' : 'manuell'}</span></span>
            <span class="list-row-sub">${esc(b.reason)} · ${plural(b.counts.cards, 'Karte', 'Karten')}, ${plural(b.counts.categories, 'Kategorie', 'Kategorien')}</span></div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm" data-bk="restore">Wiederherstellen</button>
              <button type="button" class="icon-btn" data-bk="download" title="Als Datei herunterladen" aria-label="Als Datei herunterladen">${icon('download')}</button>
              <button type="button" class="icon-btn danger" data-bk="delete" title="Löschen" aria-label="Backup löschen">${icon('trash')}</button>
            </div></li>`).join('')}</ul>` : '<p class="muted">Noch keine Backups vorhanden.</p>'}
      </section>

      <section class="card settings-section danger-zone">
        <h2>Zurücksetzen</h2>
        <div class="row-between"><div><strong>Lernfortschritt zurücksetzen</strong><p class="muted small">Alle Karten gelten wieder als neu. Karten und Kategorien bleiben erhalten.</p></div>
          <button type="button" class="btn btn-danger-ghost" data-act="reset-progress">Fortschritt zurücksetzen</button></div>
        <div class="row-between"><div><strong>Alle Daten löschen</strong><p class="muted small">Entfernt sämtliche Karteikarten, Kategorien und den Lernfortschritt aus diesem Browser.</p></div>
          <button type="button" class="btn btn-danger" data-act="delete-all">Alle Daten löschen</button></div>
      </section>

      <section class="card settings-section">
        <h2>Tastenkürzel</h2>
        <div class="kv kv-wide">
          <div><span><kbd>N</kbd></span><span>Neue Karteikarte</span></div>
          <div><span><kbd>/</kbd></span><span>Suche in „Meine Karteikarten“</span></div>
          <div><span><kbd>Leertaste</kbd></span><span>Antwort aufdecken</span></div>
          <div><span><kbd>1</kbd> / <kbd>2</kbd></span><span>Nicht gewusst / Gewusst</span></div>
          <div><span><kbd>←</kbd> <kbd>→</kbd></span><span>Vorherige / nächste Karte</span></div>
          <div><span><kbd>Strg</kbd>+<kbd>Enter</kbd></span><span>Karteikarte speichern (im Editor)</span></div>
        </div>
      </section>`;

    root.querySelector('#theme').value = s.theme;
    root.querySelector('#order').value = s.studyOrder;
  }

  /* Import-Ablauf */
  async function runImport(file) {
    let json;
    try {
      json = JSON.parse(await readFileAsText(file));
    } catch {
      return showError(new Error('Die Datei ist kein gültiges JSON.'));
    }
    const v = validateImport(json);
    if (!v.ok) return showError(new Error(v.error));
    const { summary } = v;
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="modal-text">Die Datei enthält <strong>${plural(summary.cards, 'Karteikarte', 'Karteikarten')}</strong> und <strong>${plural(summary.categories, 'Kategorie', 'Kategorien')}</strong>${summary.exportedAt ? ` (exportiert am ${formatDateTime(summary.exportedAt)})` : ''}.
      ${v.warnings ? `<br><span class="text-warn">${plural(v.warnings, 'fehlerhafter Eintrag wurde', 'fehlerhafte Einträge wurden')} übersprungen bzw. repariert.</span>` : ''}</p>
      <div class="seg seg-block" role="radiogroup">
        <label><input type="radio" name="im" value="merge" checked><span><strong>Zusammenführen</strong><br><small class="muted">Vorhandene Daten bleiben, neuere Versionen aus der Datei überschreiben gleiche Karten.</small></span></label>
        <label><input type="radio" name="im" value="replace"><span><strong>Alles ersetzen</strong><br><small class="muted">Löscht alle aktuellen Daten und übernimmt ausschließlich die Datei.</small></span></label>
      </div>
      <p class="muted small">Vor dem Import wird automatisch ein Backup im Browser angelegt.</p>`;
    openModal({
      title: 'Import bestätigen', content: body, size: 'md',
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        {
          label: 'Importieren', kind: 'primary',
          onClick: async (hd) => {
            const mode = body.querySelector('input[name="im"]:checked').value;
            if (mode === 'replace' && (state.cards.size || state.categories.size)) {
              const ok = await confirmDialog({
                title: 'Alle aktuellen Daten ersetzen?',
                message: `Deine ${plural(state.cards.size, 'aktuelle Karteikarte', 'aktuellen Karteikarten')} werden überschrieben. Ein automatisches Backup wird vorher angelegt.`,
                confirmLabel: 'Ersetzen', danger: true,
              });
              if (!ok) return false;
            }
            hd.setBusy(true);
            try {
              await importData(v.data, mode);
              applyTheme(state.settings.theme);
              toast('Import abgeschlossen.', { type: 'success' });
            } catch (e) {
              hd.setBusy(false);
              showError(e, 'Import fehlgeschlagen: ');
              return false;
            }
            return true;
          },
        },
      ],
    });
  }

  const onClick = async (e) => {
    const bk = e.target.closest('[data-bk]');
    if (bk) {
      const id = bk.closest('.backup-row').dataset.id;
      try {
        if (bk.dataset.bk === 'download') await downloadBackup(id);
        else if (bk.dataset.bk === 'delete') {
          if (await confirmDialog({ title: 'Backup löschen?', message: 'Dieses Backup wird aus dem Browser entfernt.', confirmLabel: 'Löschen', danger: true })) {
            await deleteBackup(id);
            render();
          }
        } else if (bk.dataset.bk === 'restore') {
          const ok = await confirmDialog({
            title: 'Backup wiederherstellen?',
            message: 'Alle aktuellen Daten werden durch den Stand des Backups ersetzt. Vorher wird automatisch ein weiteres Backup angelegt.',
            confirmLabel: 'Wiederherstellen', danger: true,
          });
          if (ok) {
            await restoreBackup(id);
            applyTheme(state.settings.theme);
            toast('Backup wiederhergestellt.', { type: 'success' });
            render();
          }
        }
      } catch (err) { showError(err); }
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    try {
      switch (a.dataset.act) {
        case 'export': {
          const data = await downloadExport();
          toast(`Export erstellt (${plural(data.cards.length, 'Karte', 'Karten')}).`, { type: 'success' });
          render();
          break;
        }
        case 'import': root.querySelector('#file').click(); break;
        case 'backup': {
          const rec = await createBackup('Manuell erstellt', 'manual');
          toast(rec ? 'Backup im Browser angelegt.' : 'Es gibt noch keine Daten zum Sichern.', { type: rec ? 'success' : 'info' });
          render();
          break;
        }
        case 'persist': {
          const ok = navigator.storage?.persist ? await navigator.storage.persist() : false;
          toast(ok ? 'Dauerhafter Speicher aktiviert.' : 'Der Browser hat die Anfrage abgelehnt. Installiere die App oder nutze sie regelmäßig.', { type: ok ? 'success' : 'info' });
          render();
          break;
        }
        case 'reset-progress': {
          if (await confirmDialog({ title: 'Gesamten Lernfortschritt zurücksetzen?', message: 'Alle Karten gelten danach wieder als neu. Die Wiederholungstermine gehen verloren.', confirmLabel: 'Zurücksetzen', danger: true })) {
            await createBackup('Automatisch vor Fortschritt-Reset', 'auto');
            const n = await resetProgress([...state.reviews.keys()]);
            toast(`Fortschritt von ${plural(n, 'Karte', 'Karten')} zurückgesetzt.`, { type: 'success' });
            render();
          }
          break;
        }
        case 'delete-all': {
          if (!state.cards.size && !state.categories.size) return toast('Es sind keine Daten vorhanden.', { type: 'info' });
          const ok = await confirmDialog({
            title: 'Alle Daten löschen?',
            message: 'Sämtliche Karteikarten, Kategorien und Lernfortschritte werden aus diesem Browser entfernt. Ein automatisches Backup bleibt zur Sicherheit im Browser erhalten.',
            confirmLabel: 'Weiter', danger: true,
          });
          if (!ok) return;
          const sure = await confirmDialog({
            title: 'Wirklich endgültig löschen?',
            message: `Es werden <strong>${plural(state.cards.size, 'Karteikarte', 'Karteikarten')}</strong> gelöscht.`,
            confirmLabel: 'Ja, alles löschen', danger: true,
          });
          if (!sure) return;
          await deleteAllData();
          toast('Alle Daten wurden gelöscht.', { type: 'success' });
          render();
          break;
        }
        default:
      }
    } catch (err) { showError(err); }
  };

  const onChange = async (e) => {
    const t = e.target;
    try {
      if (t.id === 'theme') {
        await updateSettings({ theme: t.value });
        applyTheme(t.value);
      } else if (t.id === 'order') {
        await updateSettings({ studyOrder: t.value });
      } else if (t.id === 'size') {
        await updateSettings({ sessionSize: Math.max(0, Math.min(10000, parseInt(t.value, 10) || 0)) });
      } else if (t.id === 'newper') {
        await updateSettings({ newPerReview: Math.max(0, Math.min(500, parseInt(t.value, 10) || 0)) });
      } else if (t.id === 'file' && t.files[0]) {
        const f = t.files[0];
        t.value = '';
        await runImport(f);
      }
    } catch (err) { showError(err); }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  render();

  return {
    // Beim Ändern von Einstellungen nicht neu zeichnen (Fokus erhalten); nur Zähler aktualisieren, wenn nichts fokussiert ist
    refresh() {
      if (!root.contains(document.activeElement) || document.activeElement === document.body) render();
    },
    destroy() {
      alive = false;
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
    },
  };
}
