/* Spaced Repetition (vereinfachtes SM-2 für die Antworten "gewusst" / "nicht gewusst").
 *
 *  - gewusst:        1. Treffer → 1 Tag, 2. Treffer → 3 Tage, danach Intervall × Leichtigkeitsfaktor.
 *                    Der Faktor steigt leicht, das Intervall wird minimal gestreut.
 *  - nicht gewusst:  Zurück auf Anfang, Karte kommt nach 10 Minuten wieder.
 *                    Der Faktor sinkt → schwierige Karten wachsen langsamer und kommen häufiger.
 */

import { addDays, startOfDay } from './utils.js';

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 2.8;
export const MASTERED_DAYS = 21;
export const RELEARN_MS = 10 * 60 * 1000;
export const DIFFICULT_EASE = 2.2;

export function newReview(cardId) {
  return {
    cardId, ease: DEFAULT_EASE, interval: 0, due: 0, reps: 0, lapses: 0,
    totalReviews: 0, correct: 0, firstReviewedAt: 0, lastReviewedAt: 0, updatedAt: 0,
  };
}

export function schedule(prev, cardId, known, now = Date.now()) {
  const r = prev ? { ...prev } : newReview(cardId);
  r.totalReviews += 1;
  if (!r.firstReviewedAt) r.firstReviewedAt = now;
  r.lastReviewedAt = now;
  r.updatedAt = now;

  if (known) {
    r.correct += 1;
    r.reps += 1;
    let interval;
    if (r.reps === 1) interval = 1;
    else if (r.reps === 2) interval = 3;
    else interval = Math.max(r.interval + 1, Math.round(r.interval * r.ease));
    if (interval >= 7) interval = Math.max(r.interval + 1, Math.round(interval * (0.95 + Math.random() * 0.1)));
    r.interval = interval;
    r.ease = Math.min(MAX_EASE, +(r.ease + 0.05).toFixed(2));
    r.due = addDays(startOfDay(now), interval);
  } else {
    r.lapses += 1;
    r.reps = 0;
    r.interval = 0;
    r.ease = Math.max(MIN_EASE, +(r.ease - 0.2).toFixed(2));
    r.due = now + RELEARN_MS;
  }
  return r;
}

/** 'new' | 'learning' | 'mastered' */
export function cardStatus(r) {
  if (!r || !r.totalReviews) return 'new';
  return r.interval >= MASTERED_DAYS ? 'mastered' : 'learning';
}

export const isDue = (r, now = Date.now()) => !!r && r.totalReviews > 0 && r.due <= now;
export const isDifficult = (r) => !!r && r.totalReviews > 0 && r.ease < DIFFICULT_EASE;

export const STATUS_LABELS = { new: 'Neu', learning: 'Lernend', mastered: 'Gefestigt' };
