/* Lerneinheiten: Kartenauswahl, Reihenfolge und Zustand der laufenden Einheit. */

import { state, queryCards, categoryLabel } from './store.js';
import { uid, shuffle, collator } from './utils.js';

export const ORDERS = {
  random: 'Zufällig',
  chronological: 'Chronologisch (älteste zuerst)',
  newest: 'Neueste zuerst',
  category: 'Nach Kategorie',
};

export function orderCards(cards, order = 'random') {
  switch (order) {
    case 'chronological':
      return [...cards].sort((a, b) => a.createdAt - b.createdAt);
    case 'newest':
      return [...cards].sort((a, b) => b.createdAt - a.createdAt);
    case 'category': {
      const key = (c) => (c.categoryIds.length ? c.categoryIds.map(categoryLabel).sort(collator.compare)[0] : '￿');
      const keys = new Map(cards.map((c) => [c.id, key(c)]));
      return [...cards].sort((a, b) => collator.compare(keys.get(a.id), keys.get(b.id)) || a.createdAt - b.createdAt);
    }
    default:
      return shuffle(cards);
  }
}

/** Freies Lernen: Auswahl nach Kategorien und Lernstand. */
export function selectCards({ categoryIds = [], progress = 'all', order = 'random', limit = 0 } = {}) {
  const list = queryCards({ categoryIds, catMode: 'any', progress, sort: 'newest' });
  let out = orderCards(list, order);
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

/** Wiederholung: fällige Karten (überfälligste zuerst), optional ergänzt um neue Karten. */
export function selectReviewCards({ categoryIds = [], newLimit = 0 } = {}) {
  const due = queryCards({ categoryIds, catMode: 'any', progress: 'due', sort: 'due' });
  let fresh = [];
  if (newLimit > 0) {
    fresh = queryCards({ categoryIds, catMode: 'any', progress: 'new', sort: 'oldest' }).slice(0, newLimit);
  }
  return { due, fresh, all: [...due, ...fresh] };
}

/* ---------- Zustand der laufenden Einheit ---------- */

export let session = null;

function gotoSession() {
  if (location.hash === '#/session') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/session';
}

export function startSession({ ids, title, mode = 'study', track = true }) {
  const list = ids.filter((id) => state.cards.has(id));
  if (!list.length) return false;
  session = {
    id: uid(),
    ids: list,
    idx: 0,
    answers: new Map(), // cardId -> { known, prev, logId }
    revealed: new Set(),
    title,
    mode,
    track,
    round: 1,
    finished: false,
    startedAt: Date.now(),
  };
  gotoSession();
  return true;
}

export function retryWrong() {
  if (!session) return false;
  const wrong = session.ids.filter((id) => session.answers.get(id)?.known === false && state.cards.has(id));
  if (!wrong.length) return false;
  session = {
    ...session,
    ids: shuffle(wrong),
    idx: 0,
    answers: new Map(),
    revealed: new Set(),
    round: session.round + 1,
    finished: false,
  };
  gotoSession();
  return true;
}

export function restartAll() {
  if (!session) return false;
  const ids = session.ids.filter((id) => state.cards.has(id));
  const base = session;
  session = null;
  return startSession({ ids: shuffle(ids), title: base.title, mode: base.mode, track: base.track });
}

export const clearSession = () => { session = null; };
export const hasOpenSession = () => !!session && !session.finished;
