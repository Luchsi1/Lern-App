/* Ansicht der laufenden Lerneinheit (Karte, Bewertung, Auswertung). */

import { state, answerCard, undoAnswer, categoryLabel, cardText } from '../store.js';
import { esc, icon, plural } from '../utils.js';
import { session, retryWrong, restartAll, clearSession } from '../session.js';
import { confirmDialog, showError } from '../ui.js';
import { openCardEditor } from '../components/cardEditor.js';
import { formatDue } from '../utils.js';
import { getReview } from '../store.js';

export function mount(root) {
  if (!session) {
    location.replace('#/study');
    return { destroy() {} };
  }
  let busy = false;
  const S = session;

  const currentId = () => S.ids[S.idx];
  const counts = () => {
    let known = 0;
    let unknown = 0;
    for (const a of S.answers.values()) a.known ? known++ : unknown++;
    return { known, unknown, answered: known + unknown, skipped: S.ids.length - known - unknown };
  };

  /* ---------- Karte ---------- */
  function renderCard() {
    if (S.finished) return renderSummary();
    // gelöschte Karten überspringen
    while (S.idx < S.ids.length && !state.cards.has(currentId())) S.idx++;
    if (S.idx >= S.ids.length) {
      S.idx = S.ids.length - 1;
      while (S.idx > 0 && !state.cards.has(currentId())) S.idx--;
      if (!state.cards.has(currentId())) return finish();
    }
    const card = state.cards.get(currentId());
    const revealed = S.revealed.has(card.id);
    const ans = S.answers.get(card.id);
    const c = counts();
    const total = S.ids.length;
    const cat = card.categoryIds[0] ? categoryLabel(card.categoryIds[0]) : '';
    const isLast = S.idx === total - 1;

    root.innerHTML = `
      <div class="session">
        <div class="session-top">
          <button type="button" class="btn btn-ghost btn-sm" data-act="quit">${icon('x')}<span>Beenden</span></button>
          <div class="session-title"><strong>${esc(S.title)}</strong>${S.round > 1 ? ` <span class="badge">Runde ${S.round}</span>` : ''}${!S.track || S.round > 1 ? ' <span class="badge" title="Antworten ändern keine Wiederholungstermine">ohne Fortschritt</span>' : ''}</div>
          <div class="session-score" aria-label="Zwischenstand"><span class="score-ok">${icon('check')}${c.known}</span><span class="score-bad">${icon('x')}${c.unknown}</span></div>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${c.answered}"><span style="width:${(c.answered / total) * 100}%"></span></div>
        <div class="session-pos">Karte ${S.idx + 1} von ${total}${cat ? ` · <span class="muted">${esc(cat)}</span>` : ''}</div>

        <article class="flashcard ${revealed ? 'is-revealed' : ''}" data-act="${revealed ? '' : 'reveal'}" ${revealed ? '' : 'tabindex="0" role="button" aria-label="Rückseite aufdecken"'}>
          <div class="fc-side fc-front"><span class="fc-label">Vorderseite</span><div class="rich">${card.front}</div></div>
          ${revealed
            ? `<div class="fc-side fc-back"><span class="fc-label">Rückseite</span><div class="rich">${card.back}</div></div>`
            : `<div class="fc-hint">${icon('eye')}<span>Zum Aufdecken klicken oder <kbd>Leertaste</kbd> drücken</span></div>`}
        </article>

        <div class="session-controls">
          <button type="button" class="btn btn-lg" data-act="prev" ${S.idx === 0 ? 'disabled' : ''} aria-label="Vorherige Karte" title="Vorherige Karte (←)">${icon('arrow-left')}</button>
          ${revealed ? `
            <button type="button" class="btn btn-lg btn-bad ${ans && !ans.known ? 'is-chosen' : ''}" data-act="unknown">${icon('x')}<span>Nicht gewusst</span><kbd>1</kbd></button>
            <button type="button" class="btn btn-lg btn-good ${ans && ans.known ? 'is-chosen' : ''}" data-act="known">${icon('check')}<span>Gewusst</span><kbd>2</kbd></button>`
            : `<button type="button" class="btn btn-lg btn-primary grow" data-act="reveal">${icon('eye')}<span>Antwort aufdecken</span><kbd>␣</kbd></button>`}
          <button type="button" class="btn btn-lg" data-act="next" aria-label="${isLast ? 'Auswertung' : 'Nächste Karte'}" title="${isLast ? 'Auswertung anzeigen' : 'Nächste Karte (→)'}">${isLast ? icon('flag') : icon('arrow-right')}</button>
        </div>
        <p class="session-keys muted small"><kbd>␣</kbd> aufdecken · <kbd>1</kbd> nicht gewusst · <kbd>2</kbd> gewusst · <kbd>←</kbd> <kbd>→</kbd> navigieren · <kbd>Esc</kbd> beenden</p>
      </div>`;
    const fc = root.querySelector('.flashcard');
    if (fc && !revealed) fc.focus({ preventScroll: true });
  }

  function reveal() {
    const id = currentId();
    if (!id || S.revealed.has(id)) return;
    S.revealed.add(id);
    renderCard();
  }

  async function answer(known) {
    if (busy) return;
    const id = currentId();
    if (!S.revealed.has(id)) return;
    busy = true;
    try {
      const existing = S.answers.get(id);
      if (S.track && S.round === 1) {
        if (existing && existing.logId) await undoAnswer(id, existing.prev, existing.logId);
        const res = await answerCard(id, known, S.id);
        S.answers.set(id, { known, prev: res.prev, logId: res.logId });
      } else {
        S.answers.set(id, { known });
      }
      busy = false;
      advance();
    } catch (e) {
      busy = false;
      showError(e, 'Antwort konnte nicht gespeichert werden: ');
    }
  }

  function advance() {
    if (S.idx < S.ids.length - 1) {
      S.idx += 1;
      renderCard();
    } else {
      finish();
    }
  }

  function go(delta) {
    const n = S.idx + delta;
    if (n < 0) return;
    if (n >= S.ids.length) return finish();
    S.idx = n;
    renderCard();
  }

  function finish() {
    S.finished = true;
    renderSummary();
  }

  /* ---------- Auswertung ---------- */
  function renderSummary() {
    const c = counts();
    const total = S.ids.length;
    const pct = c.answered ? Math.round((c.known / c.answered) * 100) : 0;
    const wrong = S.ids.filter((id) => S.answers.get(id)?.known === false && state.cards.has(id));
    const skipped = S.ids.filter((id) => !S.answers.has(id) && state.cards.has(id));
    const row = (id) => {
      const t = cardText(id);
      const card = state.cards.get(id);
      const r = getReview(id);
      return `<li><button type="button" class="list-row" data-edit="${id}"><span class="list-row-main"><span class="list-row-title">${esc(t.front || '(leer)')}</span>
        <span class="list-row-sub">${esc(card.categoryIds[0] ? categoryLabel(card.categoryIds[0]) : 'Ohne Kategorie')}</span></span>
        ${S.track && S.round === 1 && r ? `<span class="list-row-time">${esc(formatDue(r.due))}</span>` : ''}</button></li>`;
    };
    root.innerHTML = `
      <div class="session summary">
        <div class="summary-head">
          <div class="ring" style="--p:${pct}" role="img" aria-label="${pct} Prozent gewusst"><div class="ring-inner"><strong>${pct}%</strong><span>gewusst</span></div></div>
          <div>
            <h1>${c.answered === total && !c.unknown ? 'Perfekt!' : 'Lerneinheit beendet'}</h1>
            <p class="muted">${esc(S.title)}${S.round > 1 ? ` · Runde ${S.round}` : ''} · ${plural(total, 'Karte', 'Karten')}</p>
          </div>
        </div>
        <div class="stat-grid stat-grid-3">
          <div class="stat stat-good"><span class="stat-label">Gewusst</span><span class="stat-value">${c.known}</span></div>
          <div class="stat stat-bad"><span class="stat-label">Nicht gewusst</span><span class="stat-value">${c.unknown}</span></div>
          <div class="stat"><span class="stat-label">Übersprungen</span><span class="stat-value">${c.skipped}</span></div>
        </div>
        ${S.track && S.round === 1 ? '<p class="muted small">Dein Lernfortschritt wurde gespeichert und die nächsten Wiederholungstermine sind geplant.</p>' : '<p class="muted small">Diese Runde verändert die Wiederholungstermine nicht.</p>'}
        <div class="btn-row">
          ${wrong.length ? `<button type="button" class="btn btn-primary btn-lg" data-act="retry">${icon('refresh')}<span>${plural(wrong.length, 'falsche Karte', 'falsche Karten')} erneut lernen</span></button>` : ''}
          <button type="button" class="btn btn-lg" data-act="again">${icon('play')}<span>Alle Karten noch einmal</span></button>
          <a class="btn btn-lg btn-ghost" href="#/dashboard" data-act="done">Fertig</a>
        </div>
        ${wrong.length ? `<section class="card"><h2>Nicht gewusst (${wrong.length})</h2><ul class="list">${wrong.map(row).join('')}</ul></section>` : ''}
        ${skipped.length ? `<section class="card"><h2>Übersprungen (${skipped.length})</h2><ul class="list">${skipped.map(row).join('')}</ul></section>` : ''}
      </div>`;
  }

  async function quit() {
    const c = counts();
    if (c.answered === 0) {
      clearSession();
      location.hash = '#/study';
      return;
    }
    const ok = await confirmDialog({
      title: 'Lerneinheit beenden?',
      message: `Du hast ${c.answered} von ${S.ids.length} Karten beantwortet. Dein Fortschritt ist bereits gespeichert.`,
      confirmLabel: 'Zur Auswertung', cancelLabel: 'Weiterlernen',
    });
    if (ok) finish();
  }

  /* ---------- Ereignisse ---------- */
  const onClick = (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) return openCardEditor({ cardId: edit.dataset.edit });
    const t = e.target.closest('[data-act]');
    if (!t) return;
    switch (t.dataset.act) {
      case 'reveal': reveal(); break;
      case 'known': answer(true); break;
      case 'unknown': answer(false); break;
      case 'prev': go(-1); break;
      case 'next': go(1); break;
      case 'quit': quit(); break;
      case 'retry': retryWrong(); break;
      case 'again': restartAll(); break;
      case 'done': clearSession(); break;
      default:
    }
  };

  const onKey = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.finished) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        if (e.key === 'Enter' && document.activeElement.tagName === 'BUTTON') return;
        e.preventDefault();
        reveal();
        break;
      case '1': answer(false); break;
      case '2': answer(true); break;
      case 'ArrowLeft': e.preventDefault(); go(-1); break;
      case 'ArrowRight': e.preventDefault(); go(1); break;
      case 'Escape': quit(); break;
      default:
    }
  };

  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  renderCard();

  return {
    destroy() {
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    },
  };
}
