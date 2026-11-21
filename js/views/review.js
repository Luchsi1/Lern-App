/* Wiederholungen: fällige Karten nach Spaced Repetition, fach- oder themenspezifisch. */

import {
  state, categoryCounts, rootCategories, childCategories, dueForecast, nextDueTime, queryCards,
} from '../store.js';
import { esc, icon, plural, formatDue, addDays, startOfDay } from '../utils.js';
import { startSession, selectReviewCards } from '../session.js';
import { toast } from '../ui.js';
import { orderCards } from '../session.js';

const open = new Set();

export function mount(root) {
  function start(categoryIds, title) {
    const { all } = selectReviewCards({ categoryIds, newLimit: state.settings.newPerReview });
    if (!all.length) return toast('Hier steht nichts zur Wiederholung an.', { type: 'info' });
    startSession({ ids: all.map((c) => c.id), title, mode: 'review' });
  }

  function treeRow(cat, depth) {
    const c = categoryCounts().counts.get(cat.id) || { total: 0, due: 0, new: 0 };
    const kids = childCategories(cat.id);
    const isOpen = open.has(cat.id);
    let html = `<div class="rv-row" style="--depth:${depth}">
      ${kids.length ? `<button type="button" class="tree-toggle ${isOpen ? 'open' : ''}" data-toggle="${cat.id}" aria-label="${isOpen ? 'Zuklappen' : 'Aufklappen'}" aria-expanded="${isOpen}">${icon('chevron-right')}</button>` : '<span class="tree-toggle spacer"></span>'}
      <span class="rv-name">${esc(cat.name)}</span>
      <span class="rv-counts"><span class="rv-due ${c.due ? 'has-due' : ''}" title="Fällig">${c.due} fällig</span><span class="muted small">${c.total} gesamt</span></span>
      <button type="button" class="btn btn-sm ${depth === 0 ? '' : 'btn-ghost'}" data-start="${cat.id}" ${c.due ? '' : 'disabled'}>${icon('play')}<span>Wiederholen</span></button>
    </div>`;
    if (isOpen) for (const k of kids) html += treeRow(k, depth + 1);
    return html;
  }

  function render() {
    const { total, counts } = categoryCounts();
    const now = Date.now();
    const forecast = dueForecast(7, now);
    const max = Math.max(1, ...forecast);
    const next = nextDueTime(now);
    const wd = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
    const today = startOfDay(now);
    const roots = rootCategories();
    const newCount = Math.min(total.new, state.settings.newPerReview);

    root.innerHTML = `
      <div class="page-head"><div><h1>Wiederholungen</h1><p class="page-sub">Spaced Repetition: Karten kommen in wachsenden Abständen wieder.</p></div></div>
      <section class="card hero">
        <div class="hero-main">
          <div class="big-number ${total.due ? 'has-due' : ''}">${total.due}</div>
          <h2>${total.due === 1 ? 'Karte steht' : 'Karten stehen'} zur Wiederholung an</h2>
          <p class="muted">${total.due
            ? 'Fachübergreifend – oder unten gezielt nach Fach und Themengebiet.'
            : (next ? `Aktuell ist nichts fällig. Die nächste Karte ist ${formatDue(next).toLowerCase()} dran.` : 'Sobald du Karten gelernt hast, erscheinen hier die Wiederholungstermine.')}</p>
          <div class="btn-row">
            <button type="button" class="btn btn-primary btn-lg" data-start="" ${total.due || newCount ? '' : 'disabled'}>${icon('play')}<span>Alle Fächer wiederholen</span></button>
            ${total.difficult ? `<button type="button" class="btn btn-lg" data-hard>${icon('flame')}<span>${plural(total.difficult, 'schwierige Karte', 'schwierige Karten')} üben</span></button>` : ''}
          </div>
          ${state.settings.newPerReview > 0 && total.new > 0 ? `<p class="hint small muted">Zusätzlich werden bis zu ${newCount} neue Karten eingestreut (einstellbar unter <a class="link" href="#/settings">Einstellungen</a>).</p>` : ''}
        </div>
        <div class="forecast" role="img" aria-label="Fällige Karten in den nächsten 7 Tagen">
          <div class="forecast-title muted small">Vorschau</div>
          <div class="spark spark-lg">
            ${forecast.map((n, i) => `<div class="spark-col"><span class="spark-num">${n}</span><span class="spark-bar ${i === 0 ? 'is-today' : ''}" style="height:${Math.max(4, (n / max) * 100)}%"></span><span class="spark-label">${i === 0 ? 'Heute' : wd.format(addDays(today, i)).replace('.', '')}</span></div>`).join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Nach Fach und Themengebiet</h2></div>
        ${roots.length ? `<div class="card rv-tree">${roots.map((r) => treeRow(r, 0)).join('')}</div>` : '<p class="muted">Noch keine Fächer angelegt.</p>'}
        ${total.uncategorized && roots.length ? '' : ''}
      </section>`;
  }

  const onClick = (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const id = t.dataset.toggle;
      if (open.has(id)) open.delete(id);
      else open.add(id);
      return render();
    }
    const s = e.target.closest('[data-start]');
    if (s) {
      const id = s.dataset.start;
      const cat = id ? state.categories.get(id) : null;
      return start(id ? [id] : [], cat ? cat.name : 'Fällige Wiederholung');
    }
    if (e.target.closest('[data-hard]')) {
      const list = queryCards({ progress: 'difficult', sort: 'difficulty' });
      startSession({ ids: orderCards(list, 'random').map((c) => c.id), title: 'Schwierige Karten', mode: 'review' });
    }
  };
  root.addEventListener('click', onClick);
  render();

  const timer = setInterval(render, 60000);
  return {
    refresh: render,
    destroy() {
      clearInterval(timer);
      root.removeEventListener('click', onClick);
    },
  };
}
