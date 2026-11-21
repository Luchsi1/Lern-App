/* Dashboard / Startseite */

import {
  state, categoryCounts, rootCategories, categoryLabel, getReviewLogSince, cardText, nextDueTime,
} from '../store.js';
import { esc, icon, plural, relativeTime, startOfDay, addDays, DAY_MS, formatDate, formatDue } from '../utils.js';
import { openCardEditor } from '../components/cardEditor.js';
import { startSession, selectCards, selectReviewCards } from '../session.js';
import { cardStatus } from '../srs.js';
import { toast } from '../ui.js';
import { downloadExport } from '../backup.js';
import { showError } from '../ui.js';

function smartPlan() {
  const { total } = categoryCounts();
  if (total.total === 0) return null;
  const { settings } = state;
  if (total.due > 0) {
    const sel = selectReviewCards({ newLimit: settings.newPerReview });
    return { label: `${plural(total.due, 'fällige Karte', 'fällige Karten')} wiederholen`, ids: sel.all.map((c) => c.id), mode: 'review', title: 'Fällige Wiederholung' };
  }
  if (total.new > 0) {
    const limit = settings.sessionSize > 0 ? settings.sessionSize : 20;
    const cards = selectCards({ progress: 'new', order: 'chronological', limit });
    return { label: `${plural(cards.length, 'neue Karte', 'neue Karten')} lernen`, ids: cards.map((c) => c.id), mode: 'study', title: 'Neue Karten' };
  }
  const cards = selectCards({ order: settings.studyOrder, limit: settings.sessionSize });
  return { label: `${plural(cards.length, 'Karte', 'Karten')} durchgehen`, ids: cards.map((c) => c.id), mode: 'study', title: 'Alle Karten' };
}

function cardRow(card, timeText) {
  const t = cardText(card.id);
  const cat = card.categoryIds[0] ? categoryLabel(card.categoryIds[0]) : 'Ohne Kategorie';
  return `<li><button type="button" class="list-row" data-edit="${card.id}">
    <span class="list-row-main"><span class="list-row-title">${esc(t.front || '(leer)')}</span>
    <span class="list-row-sub">${esc(cat)}</span></span>
    <span class="list-row-time">${esc(timeText)}</span></button></li>`;
}

export function mount(root) {
  let alive = true;

  function donut(c) {
    if (!c.total) return '';
    const m = (c.mastered / c.total) * 100;
    const l = ((c.learned - c.mastered) / c.total) * 100;
    const pct = Math.round((c.learned / c.total) * 100);
    return `<div class="donut" style="--m:${m}%;--l:${m + l}%" role="img" aria-label="${pct} Prozent bereits gelernt">
      <div class="donut-center"><strong>${pct}%</strong><span>gelernt</span></div></div>`;
  }

  function subjectCard(cat) {
    const c = categoryCounts().counts.get(cat.id) || { total: 0, new: 0, learned: 0, mastered: 0, due: 0 };
    const mp = c.total ? (c.mastered / c.total) * 100 : 0;
    const lp = c.total ? ((c.learned - c.mastered) / c.total) * 100 : 0;
    return `<article class="subject-card">
      <a class="subject-title" href="#/cards?cat=${cat.id}">${esc(cat.name)}</a>
      <div class="subject-count">${plural(c.total, 'Karte', 'Karten')}${c.due ? ` · <span class="text-warn">${c.due} fällig</span>` : ''}</div>
      <div class="bar" role="img" aria-label="${c.mastered} gefestigt, ${c.learned - c.mastered} lernend, ${c.new} neu">
        <span class="bar-seg bar-mastered" style="width:${mp}%"></span><span class="bar-seg bar-learning" style="width:${lp}%"></span>
      </div>
      <div class="subject-actions">
        <a class="btn btn-sm btn-ghost" href="#/cards?cat=${cat.id}">${icon('layers')}<span>Karten</span></a>
        <button type="button" class="btn btn-sm" data-study="${cat.id}" ${c.total ? '' : 'disabled'}>${icon('play')}<span>Lernen</span></button>
      </div></article>`;
  }

  function render() {
    if (!alive) return;
    const { total, counts } = categoryCounts();
    const now = Date.now();
    const cards = [...state.cards.values()];
    const hasData = cards.length > 0 || state.categories.size > 0;
    const plan = smartPlan();

    let html = `
      <div class="page-head">
        <div><h1>Dashboard</h1><p class="page-sub">${new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</p></div>
        <button type="button" class="btn btn-primary" data-act="new-card">${icon('plus')}<span>Neue Karteikarte</span></button>
      </div>`;

    if (!hasData) {
      html += `
      <section class="card welcome">
        <h2>Willkommen! Lass uns starten.</h2>
        <p class="muted">Deine Lernkarten werden ausschließlich in diesem Browser gespeichert – ohne Konto und ohne Server.</p>
        <ol class="welcome-steps">
          <li><strong>Fach anlegen</strong> – z. B. „Physik“, danach Themengebiete und Unterthemen.</li>
          <li><strong>Karteikarten erstellen</strong> – mit Formatierung und Bildern.</li>
          <li><strong>Lernen &amp; wiederholen</strong> – die App plant die Wiederholungen für dich.</li>
        </ol>
        <div class="btn-row">
          <a class="btn btn-primary" href="#/categories">${icon('folder')}<span>Fächer einrichten</span></a>
          <button type="button" class="btn" data-act="new-card">${icon('plus')}<span>Erste Karteikarte erstellen</span></button>
          <a class="btn btn-ghost" href="#/settings">${icon('upload')}<span>Backup importieren</span></a>
        </div>
      </section>`;
      root.innerHTML = html;
      return;
    }

    const lastExport = state.settings.lastExportAt || 0;
    if (cards.length && now - lastExport > 14 * DAY_MS) {
      html += `<div class="banner" role="note">${icon('shield')}<div><strong>Backup-Erinnerung</strong><br><span class="muted">${lastExport ? `Dein letzter Export war am ${formatDate(lastExport)}.` : 'Du hast noch kein Backup exportiert.'} Deine Daten liegen nur in diesem Browser – sichere sie regelmäßig als Datei.</span></div>
        <button type="button" class="btn btn-sm" data-act="backup">${icon('download')}<span>Jetzt sichern</span></button></div>`;
    }

    html += `
      <section class="hero card">
        <div class="hero-main">
          <h2>${plan ? (total.due > 0 ? 'Zeit für die Wiederholung' : 'Bereit zum Lernen?') : 'Noch keine Karteikarten'}</h2>
          <p class="muted">${plan
            ? (total.due > 0 ? `${plural(total.due, 'Karte steht', 'Karten stehen')} zur Wiederholung an.` : (nextDueTime() ? `Aktuell ist nichts fällig. Nächste Wiederholung: ${formatDue(nextDueTime()).toLowerCase()}.` : 'Starte deine erste Lerneinheit.'))
            : 'Erstelle deine erste Karteikarte, um mit dem Lernen zu beginnen.'}</p>
          <div class="btn-row">
            ${plan ? `<button type="button" class="btn btn-primary btn-lg" data-act="start">${icon('play')}<span>Lerneinheit starten</span></button>
              <a class="btn btn-lg" href="#/study">${icon('sliders')}<span>Anpassen</span></a>` : `<button type="button" class="btn btn-primary btn-lg" data-act="new-card">${icon('plus')}<span>Karteikarte erstellen</span></button>`}
          </div>
          ${plan ? `<p class="hint small muted">${esc(plan.label)}</p>` : ''}
        </div>
        ${donut(total)}
      </section>

      <section class="stat-grid" aria-label="Kennzahlen">
        <div class="stat"><span class="stat-label">Karteikarten gesamt</span><span class="stat-value">${total.total}</span></div>
        <div class="stat"><span class="stat-label">Noch nicht gelernt</span><span class="stat-value">${total.new}</span></div>
        <div class="stat"><span class="stat-label">Bereits gelernt</span><span class="stat-value">${total.learned}</span><span class="stat-sub">davon ${total.mastered} gefestigt</span></div>
        <div class="stat ${total.due ? 'stat-accent' : ''}"><span class="stat-label">Zur Wiederholung fällig</span><span class="stat-value">${total.due}</span><span class="stat-sub">${total.difficult ? `${total.difficult} schwierige Karten` : 'heute &amp; überfällig'}</span></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Fächer</h2><a class="link" href="#/categories">Verwalten</a></div>`;
    const roots = rootCategories();
    if (!roots.length && !total.uncategorized) {
      html += `<p class="muted">Noch keine Fächer. <a class="link" href="#/categories">Lege dein erstes Fach an.</a></p>`;
    } else {
      html += `<div class="subject-grid">${roots.map(subjectCard).join('')}`;
      if (total.uncategorized) {
        html += `<article class="subject-card subject-none"><a class="subject-title" href="#/cards?none=1">Ohne Kategorie</a>
          <div class="subject-count">${plural(total.uncategorized, 'Karte', 'Karten')}</div>
          <div class="subject-actions"><a class="btn btn-sm btn-ghost" href="#/cards?none=1">${icon('layers')}<span>Karten</span></a></div></article>`;
      }
      html += '</div>';
    }
    html += '</section>';

    const created = [...cards].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    const edited = cards.filter((c) => c.updatedAt - c.createdAt > 1500).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    html += `
      <div class="two-col">
        <section class="card"><div class="section-head"><h2>Kürzlich erstellt</h2><a class="link" href="#/cards">Alle</a></div>
          ${created.length ? `<ul class="list">${created.map((c) => cardRow(c, relativeTime(c.createdAt))).join('')}</ul>` : '<p class="muted">Noch nichts erstellt.</p>'}</section>
        <section class="card"><div class="section-head"><h2>Kürzlich bearbeitet</h2><a class="link" href="#/cards?sort=edited">Alle</a></div>
          ${edited.length ? `<ul class="list">${edited.map((c) => cardRow(c, relativeTime(c.updatedAt))).join('')}</ul>` : '<p class="muted">Noch keine Karte bearbeitet.</p>'}</section>
      </div>
      <section class="card" id="activity"><div class="section-head"><h2>Aktivität</h2></div><div class="activity-body muted">Wird geladen …</div></section>`;
    root.innerHTML = html;
    loadActivity();
  }

  async function loadActivity() {
    try {
      const since = addDays(startOfDay(), -60);
      const logs = await getReviewLogSince(since);
      if (!alive) return;
      const el = root.querySelector('.activity-body');
      if (!el) return;
      const perDay = new Map();
      for (const l of logs) {
        const d = startOfDay(l.at);
        perDay.set(d, (perDay.get(d) || 0) + 1);
      }
      const today = startOfDay();
      let streak = 0;
      let d = perDay.has(today) ? today : addDays(today, -1);
      while (perDay.has(d)) {
        streak += 1;
        d = addDays(d, -1);
      }
      const days = [...Array(7)].map((_, i) => addDays(today, i - 6));
      const max = Math.max(1, ...days.map((x) => perDay.get(x) || 0));
      const wd = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
      el.classList.remove('muted');
      el.innerHTML = `
        <div class="activity">
          <div class="activity-stats">
            <div><span class="stat-value">${perDay.get(today) || 0}</span><span class="stat-label">heute beantwortet</span></div>
            <div><span class="stat-value">${streak}</span><span class="stat-label">${streak === 1 ? 'Tag' : 'Tage'} in Folge</span></div>
          </div>
          <div class="spark" role="img" aria-label="Beantwortete Karten der letzten 7 Tage">
            ${days.map((x) => `<div class="spark-col"><span class="spark-bar" style="height:${Math.max(4, ((perDay.get(x) || 0) / max) * 100)}%" title="${perDay.get(x) || 0} Karten"></span><span class="spark-label">${wd.format(x).replace('.', '')}</span></div>`).join('')}
          </div>
        </div>`;
    } catch (e) {
      console.error(e);
    }
  }

  const onClick = async (e) => {
    const t = e.target.closest('[data-act],[data-edit],[data-study]');
    if (!t) return;
    if (t.dataset.edit) return openCardEditor({ cardId: t.dataset.edit });
    if (t.dataset.study) {
      const cards = selectCards({ categoryIds: [t.dataset.study], order: state.settings.studyOrder, limit: state.settings.sessionSize });
      startSession({ ids: cards.map((c) => c.id), title: 'Lerneinheit', mode: 'study' });
      return;
    }
    const act = t.dataset.act;
    if (act === 'new-card') openCardEditor();
    else if (act === 'start') {
      const plan = smartPlan();
      if (!plan || !plan.ids.length) return toast('Keine Karten verfügbar.', { type: 'error' });
      startSession({ ids: plan.ids, title: plan.title, mode: plan.mode });
    } else if (act === 'backup') {
      try {
        await downloadExport();
        toast('Backup heruntergeladen.', { type: 'success' });
        render();
      } catch (err) { showError(err); }
    }
  };
  root.addEventListener('click', onClick);
  render();

  return {
    refresh: render,
    destroy() {
      alive = false;
      root.removeEventListener('click', onClick);
    },
  };
}
