/* Zentraler Datenspeicher: hält alle Daten im Arbeitsspeicher (schnelle Listen/Suche),
 * schreibt jede Änderung sofort und atomar in IndexedDB und informiert die Oberfläche. */

import * as db from './db.js';
import { uid, htmlToText, normalize, collator, startOfDay, hasImage } from './utils.js';
import { schedule, cardStatus, isDue, isDifficult } from './srs.js';

export const MAX_DEPTH = 3;
export const LEVEL_NAMES = ['Fach', 'Themengebiet', 'Unterthema'];
export const NO_CATEGORY = '__none__';

export const DEFAULT_SETTINGS = {
  theme: 'system',
  studyOrder: 'random',
  sessionSize: 0,
  newPerReview: 10,
  lastExportAt: 0,
  lastAutoBackupAt: 0,
};

export const state = {
  cards: new Map(),
  categories: new Map(),
  reviews: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  version: 0,
};

/* ---------- Ereignisse ---------- */

const listeners = new Set();
let catIndexCache = null;
let countsCache = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  state.version += 1;
  countsCache = null;
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('lernkarten-sync') : null;
if (channel) {
  channel.onmessage = async () => {
    try {
      await load();
      emit();
    } catch (e) {
      console.error(e);
    }
  };
}
const notifyOtherTabs = () => channel && channel.postMessage({ t: Date.now() });

/* ---------- Laden ---------- */

const textCache = new Map(); // cardId -> { front, back, hay }

function cacheText(card) {
  const front = htmlToText(card.front);
  const back = htmlToText(card.back);
  textCache.set(card.id, { front, back, hay: normalize(`${front} ${back}`), img: hasImage(card.front) || hasImage(card.back) });
}

export const cardText = (id) => textCache.get(id) || { front: '', back: '', hay: '', img: false };

export async function load() {
  const [cards, cats, reviews, settingsRec] = await Promise.all([
    db.getAll('cards'),
    db.getAll('categories'),
    db.getAll('reviews'),
    db.get('meta', 'settings'),
  ]);
  state.cards = new Map(cards.map((c) => [c.id, c]));
  state.categories = new Map(cats.map((c) => [c.id, c]));
  state.reviews = new Map(reviews.map((r) => [r.cardId, r]));
  state.settings = { ...DEFAULT_SETTINGS, ...(settingsRec ? settingsRec.value : {}) };
  textCache.clear();
  for (const c of state.cards.values()) {
    if (!Array.isArray(c.categoryIds)) c.categoryIds = [];
    cacheText(c);
  }
  catIndexCache = null;
  countsCache = null;
  await repairCategories();
}

/** Stellt eine gültige Baumstruktur sicher (keine Waisen, Zyklen oder zu tiefe Ebenen). */
async function repairCategories() {
  const fixes = [];
  for (const c of state.categories.values()) {
    let depth = 1;
    let cur = c;
    const seen = new Set([c.id]);
    let broken = false;
    while (cur.parentId) {
      const p = state.categories.get(cur.parentId);
      if (!p || seen.has(p.id)) { broken = true; break; }
      seen.add(p.id);
      cur = p;
      depth += 1;
    }
    if (broken || depth > MAX_DEPTH) fixes.push(c);
  }
  if (fixes.length) {
    const now = Date.now();
    for (const c of fixes) {
      c.parentId = null;
      c.updatedAt = now;
    }
    await db.runTx(['categories'], 'readwrite', (s) => fixes.forEach((c) => s('categories').put(c)));
    catIndexCache = null;
  }
}

/* ---------- Einstellungen ---------- */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.put('meta', { key: 'settings', value: state.settings });
  emit();
  notifyOtherTabs();
}

/* ---------- Kategorien: Index & Abfragen ---------- */

function catIndex() {
  if (catIndexCache) return catIndexCache;
  const children = new Map();
  for (const c of state.categories.values()) {
    const k = c.parentId ?? null;
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(c);
  }
  for (const arr of children.values()) arr.sort((a, b) => collator.compare(a.name, b.name));
  const depth = new Map();
  const path = new Map();
  const pathNorm = new Map();
  const flat = [];
  const visit = (c, d, p) => {
    const names = [...p, c.name];
    depth.set(c.id, d);
    path.set(c.id, names);
    pathNorm.set(c.id, normalize(names.join(' ')));
    flat.push({ category: c, depth: d });
    for (const ch of children.get(c.id) || []) visit(ch, d + 1, names);
  };
  for (const r of children.get(null) || []) visit(r, 1, []);
  catIndexCache = { children, depth, path, pathNorm, flat };
  return catIndexCache;
}

export const getCategory = (id) => state.categories.get(id);
export const rootCategories = () => catIndex().children.get(null) || [];
export const childCategories = (id) => catIndex().children.get(id) || [];
export const categoryDepth = (id) => catIndex().depth.get(id) || 1;
export const categoryPath = (id) => catIndex().path.get(id) || [];
export const categoryLabel = (id) => categoryPath(id).join(' › ');
export const categoryName = (id) => state.categories.get(id)?.name ?? '';
export const flatCategories = () => catIndex().flat;
export const levelName = (depth) => LEVEL_NAMES[Math.min(depth, MAX_DEPTH) - 1];

export function descendantIds(id) {
  const out = new Set();
  const walk = (cid) => {
    out.add(cid);
    for (const ch of childCategories(cid)) walk(ch.id);
  };
  if (state.categories.has(id)) walk(id);
  return out;
}

export function ancestorIds(id) {
  const out = [];
  let c = state.categories.get(id);
  while (c && c.parentId) {
    out.unshift(c.parentId);
    c = state.categories.get(c.parentId);
  }
  return out;
}

/** Anzahl der Ebenen im Teilbaum (Blatt = 1). */
export function subtreeHeight(id) {
  const kids = childCategories(id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(k.id))) : 0);
}

function siblingNameTaken(name, parentId, exceptId = null) {
  const n = normalize(name.trim());
  return (catIndex().children.get(parentId ?? null) || []).some((c) => c.id !== exceptId && normalize(c.name) === n);
}

function validName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Bitte gib einen Namen ein.');
  if (n.length > 80) throw new Error('Der Name darf höchstens 80 Zeichen lang sein.');
  return n;
}

/* ---------- Kategorien: Änderungen ---------- */

export async function createCategory(name, parentId = null) {
  const n = validName(name);
  if (parentId) {
    if (!state.categories.has(parentId)) throw new Error('Die übergeordnete Kategorie existiert nicht mehr.');
    if (categoryDepth(parentId) >= MAX_DEPTH) throw new Error('Unterhalb eines Unterthemas sind keine weiteren Ebenen möglich.');
  }
  if (siblingNameTaken(n, parentId)) throw new Error(`Hier gibt es bereits eine Kategorie mit dem Namen „${n}“.`);
  const now = Date.now();
  const cat = { id: uid(), name: n, parentId: parentId || null, createdAt: now, updatedAt: now };
  await db.put('categories', cat);
  state.categories.set(cat.id, cat);
  catIndexCache = null;
  emit();
  notifyOtherTabs();
  return cat;
}

export async function renameCategory(id, name) {
  const cat = state.categories.get(id);
  if (!cat) throw new Error('Kategorie nicht gefunden.');
  const n = validName(name);
  if (n === cat.name) return cat;
  if (siblingNameTaken(n, cat.parentId, id)) throw new Error(`Hier gibt es bereits eine Kategorie mit dem Namen „${n}“.`);
  const updated = { ...cat, name: n, updatedAt: Date.now() };
  await db.put('categories', updated);
  state.categories.set(id, updated);
  catIndexCache = null;
  emit();
  notifyOtherTabs();
  return updated;
}

export function canMoveCategory(id, newParentId) {
  const cat = state.categories.get(id);
  if (!cat) return 'Kategorie nicht gefunden.';
  const target = newParentId || null;
  if ((cat.parentId || null) === target) return 'Die Kategorie liegt bereits dort.';
  if (target) {
    if (!state.categories.has(target)) return 'Zielkategorie nicht gefunden.';
    if (descendantIds(id).has(target)) return 'Eine Kategorie kann nicht in sich selbst oder in eine ihrer Unterkategorien verschoben werden.';
    if (categoryDepth(target) + subtreeHeight(id) > MAX_DEPTH) return 'Dort ist nicht genug Platz: Es sind höchstens drei Ebenen (Fach → Themengebiet → Unterthema) möglich.';
  }
  if (siblingNameTaken(cat.name, target, id)) return `Am Ziel gibt es bereits eine Kategorie „${cat.name}“. Nutze stattdessen „Zusammenführen“.`;
  return null;
}

export async function moveCategory(id, newParentId) {
  const err = canMoveCategory(id, newParentId);
  if (err) throw new Error(err);
  const cat = state.categories.get(id);
  const updated = { ...cat, parentId: newParentId || null, updatedAt: Date.now() };
  await db.put('categories', updated);
  state.categories.set(id, updated);
  catIndexCache = null;
  emit();
  notifyOtherTabs();
}

export function canMergeCategories(sourceId, targetId) {
  if (sourceId === targetId) return 'Quelle und Ziel sind identisch.';
  if (!state.categories.has(sourceId) || !state.categories.has(targetId)) return 'Kategorie nicht gefunden.';
  if (descendantIds(sourceId).has(targetId)) return 'Eine Kategorie kann nicht mit einer ihrer eigenen Unterkategorien zusammengeführt werden.';
  if (descendantIds(targetId).has(sourceId)) return 'Eine Kategorie kann nicht mit einer übergeordneten Kategorie zusammengeführt werden. Verschiebe sie zuerst.';
  if (categoryDepth(targetId) + subtreeHeight(sourceId) - 1 > MAX_DEPTH) return 'Die Unterkategorien würden zu tief verschachtelt (maximal drei Ebenen).';
  return null;
}

/** Führt `sourceId` in `targetId` zusammen: Karten und Unterkategorien wandern ins Ziel. */
export async function mergeCategories(sourceId, targetId) {
  const err = canMergeCategories(sourceId, targetId);
  if (err) throw new Error(err);
  const now = Date.now();
  const remap = new Map();
  const updates = new Map();
  const deletes = new Set();

  const mergeInto = (src, dst) => {
    remap.set(src, dst);
    deletes.add(src);
    for (const child of childCategories(src)) {
      const twin = childCategories(dst).find((c) => normalize(c.name) === normalize(child.name) && !deletes.has(c.id));
      if (twin) {
        mergeInto(child.id, twin.id);
      } else {
        updates.set(child.id, { ...child, parentId: dst, updatedAt: now });
      }
    }
  };
  mergeInto(sourceId, targetId);

  const cardUpdates = [];
  for (const card of state.cards.values()) {
    if (!card.categoryIds.some((id) => remap.has(id))) continue;
    const ids = [...new Set(card.categoryIds.map((id) => remap.get(id) ?? id))];
    cardUpdates.push({ ...card, categoryIds: ids, updatedAt: now });
  }

  await db.runTx(['categories', 'cards', 'tombstones'], 'readwrite', (s) => {
    for (const c of updates.values()) s('categories').put(c);
    for (const id of deletes) {
      s('categories').delete(id);
      s('tombstones').put({ id, type: 'category', deletedAt: now });
    }
    for (const c of cardUpdates) s('cards').put(c);
  });
  for (const c of updates.values()) state.categories.set(c.id, c);
  for (const id of deletes) state.categories.delete(id);
  for (const c of cardUpdates) state.cards.set(c.id, c);
  catIndexCache = null;
  emit();
  notifyOtherTabs();
  return { movedCards: cardUpdates.length };
}

/** Löscht Kategorie samt Unterkategorien. Optional auch Karten, die ausschließlich dort liegen. */
export async function deleteCategory(id, { deleteCards = false } = {}) {
  if (!state.categories.has(id)) throw new Error('Kategorie nicht gefunden.');
  const ids = descendantIds(id);
  const now = Date.now();
  const cardsToDelete = [];
  const cardUpdates = [];
  for (const card of state.cards.values()) {
    if (!card.categoryIds.some((c) => ids.has(c))) continue;
    const rest = card.categoryIds.filter((c) => !ids.has(c));
    if (deleteCards && rest.length === 0) cardsToDelete.push(card.id);
    else cardUpdates.push({ ...card, categoryIds: rest, updatedAt: now });
  }
  await db.runTx(['categories', 'cards', 'reviews', 'tombstones'], 'readwrite', (s) => {
    for (const cid of ids) {
      s('categories').delete(cid);
      s('tombstones').put({ id: cid, type: 'category', deletedAt: now });
    }
    for (const c of cardUpdates) s('cards').put(c);
    for (const cid of cardsToDelete) {
      s('cards').delete(cid);
      s('reviews').delete(cid);
      s('tombstones').put({ id: cid, type: 'card', deletedAt: now });
    }
  });
  for (const cid of ids) state.categories.delete(cid);
  for (const c of cardUpdates) state.cards.set(c.id, c);
  for (const cid of cardsToDelete) {
    state.cards.delete(cid);
    state.reviews.delete(cid);
    textCache.delete(cid);
  }
  catIndexCache = null;
  emit();
  notifyOtherTabs();
  return { categories: ids.size, deletedCards: cardsToDelete.length };
}

/* ---------- Karteikarten ---------- */

const validCategoryIds = (ids) => [...new Set(ids || [])].filter((id) => state.categories.has(id));

export async function createCard({ front = '', back = '', categoryIds = [] }) {
  const now = Date.now();
  const card = { id: uid(), front, back, categoryIds: validCategoryIds(categoryIds), createdAt: now, updatedAt: now };
  await db.put('cards', card);
  state.cards.set(card.id, card);
  cacheText(card);
  emit();
  notifyOtherTabs();
  return card;
}

export async function updateCard(id, patch) {
  const card = state.cards.get(id);
  if (!card) throw new Error('Die Karteikarte existiert nicht mehr.');
  const updated = { ...card, ...patch, updatedAt: Date.now() };
  if (patch.categoryIds) updated.categoryIds = validCategoryIds(patch.categoryIds);
  await db.put('cards', updated);
  state.cards.set(id, updated);
  cacheText(updated);
  emit();
  notifyOtherTabs();
  return updated;
}

export async function duplicateCard(id) {
  const card = state.cards.get(id);
  if (!card) throw new Error('Die Karteikarte existiert nicht mehr.');
  return createCard({ front: card.front, back: card.back, categoryIds: card.categoryIds });
}

export async function deleteCards(ids) {
  const list = [...ids].filter((id) => state.cards.has(id));
  if (!list.length) return 0;
  const now = Date.now();
  await db.runTx(['cards', 'reviews', 'tombstones'], 'readwrite', (s) => {
    for (const id of list) {
      s('cards').delete(id);
      s('reviews').delete(id);
      s('tombstones').put({ id, type: 'card', deletedAt: now });
    }
  });
  for (const id of list) {
    state.cards.delete(id);
    state.reviews.delete(id);
    textCache.delete(id);
  }
  emit();
  notifyOtherTabs();
  return list.length;
}

/** mode: 'add' | 'replace' | 'remove' */
export async function assignCategories(cardIds, categoryIds, mode = 'add') {
  const now = Date.now();
  const target = validCategoryIds(categoryIds);
  const updates = [];
  for (const id of cardIds) {
    const card = state.cards.get(id);
    if (!card) continue;
    let next;
    if (mode === 'replace') next = target;
    else if (mode === 'remove') next = card.categoryIds.filter((c) => !target.includes(c));
    else next = [...new Set([...card.categoryIds, ...target])];
    updates.push({ ...card, categoryIds: next, updatedAt: now });
  }
  if (!updates.length) return 0;
  await db.runTx(['cards'], 'readwrite', (s) => updates.forEach((c) => s('cards').put(c)));
  for (const c of updates) state.cards.set(c.id, c);
  emit();
  notifyOtherTabs();
  return updates.length;
}

/* ---------- Lernfortschritt ---------- */

export const getReview = (cardId) => state.reviews.get(cardId) || null;

export async function answerCard(cardId, known, sessionId = null) {
  const prev = state.reviews.get(cardId) || null;
  const now = Date.now();
  const next = schedule(prev, cardId, known, now);
  const log = {
    id: uid(), cardId, at: now, known: !!known, sessionId,
    intervalBefore: prev ? prev.interval : 0, intervalAfter: next.interval,
  };
  await db.runTx(['reviews', 'reviewLog'], 'readwrite', (s) => {
    s('reviews').put(next);
    s('reviewLog').put(log);
  });
  state.reviews.set(cardId, next);
  emit();
  notifyOtherTabs();
  return { prev, next, logId: log.id };
}

export async function undoAnswer(cardId, prev, logId) {
  await db.runTx(['reviews', 'reviewLog'], 'readwrite', (s) => {
    if (prev) s('reviews').put(prev);
    else s('reviews').delete(cardId);
    if (logId) s('reviewLog').delete(logId);
  });
  if (prev) state.reviews.set(cardId, prev);
  else state.reviews.delete(cardId);
  emit();
  notifyOtherTabs();
}

export async function resetProgress(cardIds) {
  const ids = [...cardIds].filter((id) => state.reviews.has(id));
  if (!ids.length) return 0;
  await db.runTx(['reviews'], 'readwrite', (s) => ids.forEach((id) => s('reviews').delete(id)));
  for (const id of ids) state.reviews.delete(id);
  emit();
  notifyOtherTabs();
  return ids.length;
}

export const getReviewLogSince = (ms) => db.getAllFromIndex('reviewLog', 'at', IDBKeyRange.lowerBound(ms));

/* ---------- Statistik ---------- */

const emptyCounts = () => ({ total: 0, new: 0, learned: 0, mastered: 0, due: 0 });

/** Zähler pro Kategorie (inkl. Unterkategorien) und gesamt. */
export function categoryCounts(now = Date.now()) {
  const bucket = Math.floor(now / 60000);
  if (countsCache && countsCache.bucket === bucket) return countsCache;
  const counts = new Map();
  const total = { ...emptyCounts(), uncategorized: 0, difficult: 0 };
  const ancestorsOf = new Map();
  const closure = (cid) => {
    let a = ancestorsOf.get(cid);
    if (!a) {
      a = [];
      let c = state.categories.get(cid);
      let guard = 0;
      while (c && guard++ < 10) {
        a.push(c.id);
        c = state.categories.get(c.parentId);
      }
      ancestorsOf.set(cid, a);
    }
    return a;
  };
  for (const card of state.cards.values()) {
    const r = state.reviews.get(card.id);
    const st = cardStatus(r);
    const due = isDue(r, now);
    const bump = (o) => {
      o.total += 1;
      if (st === 'new') o.new += 1;
      else o.learned += 1;
      if (st === 'mastered') o.mastered += 1;
      if (due) o.due += 1;
    };
    bump(total);
    if (isDifficult(r)) total.difficult += 1;
    const ids = new Set();
    for (const cid of card.categoryIds) for (const a of closure(cid)) ids.add(a);
    if (!ids.size) total.uncategorized += 1;
    for (const id of ids) {
      let o = counts.get(id);
      if (!o) counts.set(id, (o = emptyCounts()));
      bump(o);
    }
  }
  countsCache = { counts, total, bucket };
  return countsCache;
}

export const countsFor = (id) => categoryCounts().counts.get(id) || emptyCounts();

export function dueCards(now = Date.now()) {
  const out = [];
  for (const card of state.cards.values()) if (isDue(state.reviews.get(card.id), now)) out.push(card);
  return out;
}

export function nextDueTime(now = Date.now()) {
  let min = Infinity;
  for (const r of state.reviews.values()) if (r.totalReviews > 0 && r.due > now && r.due < min) min = r.due;
  return Number.isFinite(min) ? min : null;
}

/** Fällige Karten pro Tag für die nächsten `days` Tage (Index 0 = heute inkl. überfällig). */
export function dueForecast(days = 7, now = Date.now()) {
  const out = new Array(days).fill(0);
  const today = startOfDay(now);
  for (const r of state.reviews.values()) {
    if (!r.totalReviews || !state.cards.has(r.cardId)) continue;
    const d = Math.round((startOfDay(r.due) - today) / 86400000);
    if (d < days) out[Math.max(0, d)] += 1;
  }
  return out;
}

/* ---------- Suche & Filter ---------- */

export const SORTS = {
  newest: 'Neueste zuerst',
  oldest: 'Älteste zuerst',
  edited: 'Zuletzt bearbeitet',
  alpha: 'Alphabetisch (Vorderseite)',
  due: 'Nächste Fälligkeit',
  difficulty: 'Schwierigste zuerst',
  category: 'Nach Kategorie',
};

export const PROGRESS_FILTERS = {
  all: 'Alle',
  new: 'Neu (noch nicht gelernt)',
  learned: 'Bereits gelernt',
  learning: 'Lernend',
  mastered: 'Gefestigt',
  due: 'Fällig',
  difficult: 'Schwierig',
};

function firstCategoryKey(card) {
  if (!card.categoryIds.length) return '￿';
  return card.categoryIds.map((id) => categoryLabel(id)).sort(collator.compare)[0];
}

/**
 * Filtert und sortiert Karteikarten.
 * f: { text, categoryIds[], catMode: 'any'|'all', uncategorized, progress, dateFrom, dateTo, sort }
 */
export function queryCards(f = {}) {
  const now = Date.now();
  const tokens = normalize(f.text || '').split(/\s+/).filter(Boolean);
  const sets = (f.categoryIds || []).map((id) => descendantIds(id));
  const idx = catIndex();
  const to = f.dateTo ? f.dateTo + 86400000 : Infinity;
  const from = f.dateFrom || 0;
  const progress = f.progress || 'all';
  const out = [];

  for (const card of state.cards.values()) {
    if (f.uncategorized && card.categoryIds.length) continue;
    if (sets.length) {
      const test = (set) => card.categoryIds.some((c) => set.has(c));
      if (f.catMode === 'all' ? !sets.every(test) : !sets.some(test)) continue;
    }
    if (card.createdAt < from || card.createdAt >= to) continue;
    if (progress !== 'all') {
      const r = state.reviews.get(card.id);
      const st = cardStatus(r);
      if (progress === 'new' && st !== 'new') continue;
      if (progress === 'learned' && st === 'new') continue;
      if (progress === 'learning' && st !== 'learning') continue;
      if (progress === 'mastered' && st !== 'mastered') continue;
      if (progress === 'due' && !isDue(r, now)) continue;
      if (progress === 'difficult' && !isDifficult(r)) continue;
    }
    if (tokens.length) {
      const t = textCache.get(card.id);
      const hay = t ? t.hay : '';
      let ok = true;
      for (const tok of tokens) {
        if (hay.includes(tok)) continue;
        if (card.categoryIds.some((id) => (idx.pathNorm.get(id) || '').includes(tok))) continue;
        ok = false;
        break;
      }
      if (!ok) continue;
    }
    out.push(card);
  }

  const sort = f.sort || 'newest';
  const front = (c) => cardText(c.id).front;
  const cmp = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    edited: (a, b) => b.updatedAt - a.updatedAt,
    alpha: (a, b) => collator.compare(front(a), front(b)),
    due: (a, b) => {
      const ra = state.reviews.get(a.id);
      const rb = state.reviews.get(b.id);
      const da = ra && ra.totalReviews ? ra.due : Infinity;
      const dbb = rb && rb.totalReviews ? rb.due : Infinity;
      return da === dbb ? b.createdAt - a.createdAt : da - dbb;
    },
    difficulty: (a, b) => {
      const ra = state.reviews.get(a.id);
      const rb = state.reviews.get(b.id);
      const ea = ra && ra.totalReviews ? ra.ease : 99;
      const eb = rb && rb.totalReviews ? rb.ease : 99;
      return ea === eb ? (rb?.lapses || 0) - (ra?.lapses || 0) : ea - eb;
    },
  }[sort];
  if (sort === 'category') {
    const keys = new Map(out.map((c) => [c.id, firstCategoryKey(c)]));
    out.sort((a, b) => collator.compare(keys.get(a.id), keys.get(b.id)) || a.createdAt - b.createdAt);
  } else {
    out.sort(cmp || ((a, b) => b.createdAt - a.createdAt));
  }
  return out;
}

/** Kategorien, deren Name zu allen Suchbegriffen passt (für „Passende Fächer & Themen“). */
export function matchingCategories(text, limit = 8) {
  const tokens = normalize(text || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  for (const { category } of flatCategories()) {
    const n = normalize(category.name);
    if (tokens.every((t) => n.includes(t))) out.push(category);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------- Entwurf (Autosave im Editor) ---------- */

export const saveDraft = (draft) => db.put('meta', { key: 'draft', value: { ...draft, savedAt: Date.now() } });
export const clearDraft = () => db.del('meta', 'draft');
export async function loadDraft() {
  const rec = await db.get('meta', 'draft');
  return rec ? rec.value : null;
}

/* ---------- Für Backup/Import ---------- */

export async function reloadFromDatabase() {
  await load();
  emit();
  notifyOtherTabs();
}
