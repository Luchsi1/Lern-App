/* Export, Import, Backups und Zurücksetzen. */

import * as db from './db.js';
import { state, reloadFromDatabase, updateSettings, DEFAULT_SETTINGS, MAX_DEPTH } from './store.js';
import { uid, sanitizeHtml, downloadBlob, toDateInputValue, DAY_MS } from './utils.js';

export const FORMAT_VERSION = 1;
const MAX_AUTO_BACKUPS = 3;
const MAX_MANUAL_BACKUPS = 5;

/* ---------- Export ---------- */

export async function buildExport() {
  const data = await db.readEverything();
  return {
    app: 'lernkarten',
    format: FORMAT_VERSION,
    exportedAt: Date.now(),
    data,
  };
}

export async function downloadExport(prefix = 'lernkarten-export') {
  const payload = await buildExport();
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  downloadBlob(blob, `${prefix}-${toDateInputValue(Date.now())}.json`);
  await updateSettings({ lastExportAt: Date.now() });
  return payload.data;
}

/* ---------- Import: Prüfung ---------- */

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Prüft eine Importdatei und liefert bereinigte Daten.
 * @returns {{ok:boolean, error?:string, data?:object, summary?:object, warnings:number}}
 */
export function validateImport(json) {
  let warnings = 0;
  if (!json || typeof json !== 'object') return { ok: false, error: 'Die Datei enthält kein gültiges JSON-Objekt.', warnings };
  if (json.app !== 'lernkarten' || !json.data || typeof json.data !== 'object') {
    return { ok: false, error: 'Das ist keine Sicherungsdatei dieser App (Format nicht erkannt).', warnings };
  }
  if (isNum(json.format) && json.format > FORMAT_VERSION) {
    return { ok: false, error: 'Die Datei stammt aus einer neueren Version der App. Bitte aktualisiere die App.', warnings };
  }
  const d = json.data;
  const now = Date.now();

  // Kategorien
  const catsRaw = Array.isArray(d.categories) ? d.categories : [];
  const cats = new Map();
  for (const c of catsRaw) {
    if (!c || !isStr(c.id) || !isStr(c.name)) { warnings++; continue; }
    cats.set(c.id, {
      id: c.id,
      name: String(c.name).trim().slice(0, 80) || 'Ohne Namen',
      parentId: isStr(c.parentId) ? c.parentId : null,
      createdAt: isNum(c.createdAt) ? c.createdAt : now,
      updatedAt: isNum(c.updatedAt) ? c.updatedAt : now,
    });
  }
  // Baum reparieren (Waisen, Zyklen, zu tief)
  for (const c of cats.values()) {
    let depth = 1;
    let cur = c;
    const seen = new Set([c.id]);
    let broken = false;
    while (cur.parentId) {
      const p = cats.get(cur.parentId);
      if (!p || seen.has(p.id)) { broken = true; break; }
      seen.add(p.id);
      cur = p;
      depth++;
    }
    if (broken || depth > MAX_DEPTH) { c.parentId = null; warnings++; }
  }

  // Karten
  const cardsRaw = Array.isArray(d.cards) ? d.cards : [];
  const cards = new Map();
  for (const c of cardsRaw) {
    if (!c || !isStr(c.id)) { warnings++; continue; }
    const ids = Array.isArray(c.categoryIds) ? c.categoryIds.filter((id) => cats.has(id)) : [];
    cards.set(c.id, {
      id: c.id,
      front: sanitizeHtml(typeof c.front === 'string' ? c.front : ''),
      back: sanitizeHtml(typeof c.back === 'string' ? c.back : ''),
      categoryIds: [...new Set(ids)],
      createdAt: isNum(c.createdAt) ? c.createdAt : now,
      updatedAt: isNum(c.updatedAt) ? c.updatedAt : now,
    });
  }

  // Lernfortschritt
  const reviews = [];
  for (const r of Array.isArray(d.reviews) ? d.reviews : []) {
    if (!r || !isStr(r.cardId) || !cards.has(r.cardId)) { warnings++; continue; }
    reviews.push({
      cardId: r.cardId,
      ease: isNum(r.ease) ? Math.min(3, Math.max(1.3, r.ease)) : 2.5,
      interval: isNum(r.interval) ? Math.max(0, r.interval) : 0,
      due: isNum(r.due) ? r.due : 0,
      reps: isNum(r.reps) ? Math.max(0, r.reps) : 0,
      lapses: isNum(r.lapses) ? Math.max(0, r.lapses) : 0,
      totalReviews: isNum(r.totalReviews) ? Math.max(0, r.totalReviews) : 0,
      correct: isNum(r.correct) ? Math.max(0, r.correct) : 0,
      firstReviewedAt: isNum(r.firstReviewedAt) ? r.firstReviewedAt : 0,
      lastReviewedAt: isNum(r.lastReviewedAt) ? r.lastReviewedAt : 0,
      updatedAt: isNum(r.updatedAt) ? r.updatedAt : now,
    });
  }

  const reviewLog = [];
  for (const l of Array.isArray(d.reviewLog) ? d.reviewLog : []) {
    if (!l || !isStr(l.id) || !isStr(l.cardId) || !isNum(l.at)) { warnings++; continue; }
    reviewLog.push({
      id: l.id, cardId: l.cardId, at: l.at, known: !!l.known,
      sessionId: isStr(l.sessionId) ? l.sessionId : null,
      intervalBefore: isNum(l.intervalBefore) ? l.intervalBefore : 0,
      intervalAfter: isNum(l.intervalAfter) ? l.intervalAfter : 0,
    });
  }

  const tombstones = [];
  for (const t of Array.isArray(d.tombstones) ? d.tombstones : []) {
    if (t && isStr(t.id) && isNum(t.deletedAt)) tombstones.push({ id: t.id, type: t.type === 'category' ? 'category' : 'card', deletedAt: t.deletedAt });
  }

  const settings = d.settings && typeof d.settings === 'object' ? { ...DEFAULT_SETTINGS, ...d.settings } : { ...DEFAULT_SETTINGS };

  const data = {
    categories: [...cats.values()],
    cards: [...cards.values()],
    reviews,
    reviewLog,
    tombstones,
    settings,
  };
  return {
    ok: true,
    data,
    warnings,
    summary: {
      cards: data.cards.length,
      categories: data.categories.length,
      reviews: data.reviews.length,
      exportedAt: isNum(json.exportedAt) ? json.exportedAt : null,
    },
  };
}

/* ---------- Import: Ausführung ---------- */

/** mode: 'replace' (alles ersetzen) | 'merge' (zusammenführen, Neueres gewinnt). */
export async function importData(data, mode) {
  await createBackup('Automatisch vor Import', 'auto');

  if (mode === 'replace') {
    await db.runTx([...db.DATA_STORES, 'meta'], 'readwrite', (s) => {
      for (const n of db.DATA_STORES) s(n).clear();
      for (const n of db.DATA_STORES) for (const rec of data[n]) s(n).put(rec);
      s('meta').put({ key: 'settings', value: data.settings });
      s('meta').delete('draft');
    });
  } else {
    const tomb = new Map((await db.getAll('tombstones')).map((t) => [t.id, t]));
    const localCats = state.categories;
    const localCards = state.cards;
    const localReviews = state.reviews;
    await db.runTx([...db.DATA_STORES], 'readwrite', (s) => {
      for (const c of data.categories) {
        const l = localCats.get(c.id);
        const t = tomb.get(c.id);
        if (t && t.deletedAt > c.updatedAt) continue;
        if (!l || l.updatedAt < c.updatedAt) s('categories').put(c);
      }
      for (const c of data.cards) {
        const l = localCards.get(c.id);
        const t = tomb.get(c.id);
        if (t && t.deletedAt > c.updatedAt) continue;
        if (!l || l.updatedAt < c.updatedAt) s('cards').put(c);
      }
      for (const r of data.reviews) {
        const t = tomb.get(r.cardId);
        if (t && !localCards.has(r.cardId)) continue;
        const l = localReviews.get(r.cardId);
        if (!l || l.lastReviewedAt < r.lastReviewedAt) s('reviews').put(r);
      }
      for (const l of data.reviewLog) s('reviewLog').put(l);
      for (const t of data.tombstones) if (!tomb.has(t.id)) s('tombstones').put(t);
    });
  }
  await reloadFromDatabase();
}

/* ---------- Interne Backups ---------- */

export async function createBackup(reason = 'Manuell', kind = 'manual') {
  const data = await db.readEverything();
  const rec = {
    id: uid(),
    createdAt: Date.now(),
    reason,
    kind,
    counts: { cards: data.cards.length, categories: data.categories.length },
    data,
  };
  // leere Datenbank nicht sichern
  if (!rec.counts.cards && !rec.counts.categories) return null;
  await db.put('backups', rec);
  await pruneBackups();
  return rec;
}

export async function listBackups() {
  const all = await db.getAll('backups');
  return all
    .map(({ id, createdAt, reason, kind, counts }) => ({ id, createdAt, reason, kind, counts }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function pruneBackups() {
  const all = await listBackups();
  const drop = [
    ...all.filter((b) => b.kind === 'auto').slice(MAX_AUTO_BACKUPS),
    ...all.filter((b) => b.kind !== 'auto').slice(MAX_MANUAL_BACKUPS),
  ];
  if (drop.length) await db.runTx(['backups'], 'readwrite', (s) => drop.forEach((b) => s('backups').delete(b.id)));
}

export async function getBackupExport(id) {
  const rec = await db.get('backups', id);
  if (!rec) throw new Error('Backup nicht gefunden.');
  return { app: 'lernkarten', format: FORMAT_VERSION, exportedAt: rec.createdAt, data: rec.data };
}

export async function downloadBackup(id) {
  const payload = await getBackupExport(id);
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `lernkarten-backup-${toDateInputValue(payload.exportedAt)}.json`);
}

export async function restoreBackup(id) {
  const payload = await getBackupExport(id);
  const v = validateImport(payload);
  if (!v.ok) throw new Error(v.error);
  await importData(v.data, 'replace');
}

export const deleteBackup = (id) => db.del('backups', id);

/** Legt höchstens einmal pro Tag eine automatische Sicherung im Browser an. */
export async function maybeAutoBackup() {
  if (!state.cards.size && !state.categories.size) return;
  if (Date.now() - (state.settings.lastAutoBackupAt || 0) < DAY_MS) return;
  await createBackup('Automatisch (täglich)', 'auto');
  await updateSettings({ lastAutoBackupAt: Date.now() });
}

/* ---------- Zurücksetzen ---------- */

export async function deleteAllData() {
  await createBackup('Automatisch vor dem Löschen aller Daten', 'auto');
  await db.runTx([...db.DATA_STORES, 'meta'], 'readwrite', (s) => {
    for (const n of db.DATA_STORES) s(n).clear();
    s('meta').delete('draft');
  });
  await reloadFromDatabase();
}
