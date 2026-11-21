/* Einfacher Rich-Text-Editor (contenteditable) mit Formatierung, Listen und Bildern. */

import { icon, sanitizeHtml, htmlToText, hasImage, compressImage, esc } from '../utils.js';
import { toast, showError } from '../ui.js';

const BUTTONS = [
  { cmd: 'bold', icon: 'bold', title: 'Fett (Strg+B)', state: true },
  { cmd: 'italic', icon: 'italic', title: 'Kursiv (Strg+I)', state: true },
  { cmd: 'underline', icon: 'underline', title: 'Unterstrichen (Strg+U)', state: true },
  { cmd: 'strikeThrough', icon: 'strike', title: 'Durchgestrichen', state: true },
  { sep: true },
  { cmd: 'insertUnorderedList', icon: 'list', title: 'Aufzählung', state: true },
  { cmd: 'insertOrderedList', icon: 'list-ol', title: 'Nummerierte Liste', state: true },
  { cmd: 'heading', icon: 'heading', title: 'Überschrift' },
  { cmd: 'code', icon: 'code', title: 'Code / Formel (Festbreitenschrift)' },
  { sep: true },
  { cmd: 'superscript', text: 'x²', title: 'Hochgestellt', state: true },
  { cmd: 'subscript', text: 'x₂', title: 'Tiefgestellt', state: true },
  { sep: true },
  { cmd: 'image', icon: 'image', title: 'Bild einfügen' },
  { cmd: 'removeFormat', icon: 'eraser', title: 'Formatierung entfernen' },
];

export function createRichEditor({ label, placeholder = '', html = '', onChange = () => {} }) {
  const root = document.createElement('div');
  root.className = 'rte';
  root.innerHTML = `
    <div class="rte-toolbar" role="toolbar" aria-label="Formatierung: ${esc(label)}">
      ${BUTTONS.map((b) => (b.sep
        ? '<span class="rte-sep"></span>'
        : `<button type="button" class="rte-btn" data-cmd="${b.cmd}" title="${esc(b.title)}" aria-label="${esc(b.title)}">${b.icon ? icon(b.icon) : `<span class="rte-text">${b.text}</span>`}</button>`)).join('')}
    </div>
    <div class="rte-body rich" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}" data-placeholder="${esc(placeholder)}" spellcheck="true"></div>
    <input type="file" accept="image/*" multiple hidden>`;
  const body = root.querySelector('.rte-body');
  const fileInput = root.querySelector('input[type=file]');
  body.innerHTML = html || '';

  try { document.execCommand('styleWithCSS', false, false); } catch { /* ignorieren */ }

  const fire = () => onChange();

  function updateState() {
    for (const b of BUTTONS) {
      if (!b.state) continue;
      const el = root.querySelector(`[data-cmd="${b.cmd}"]`);
      let on = false;
      try { on = document.queryCommandState(b.cmd); } catch { /* ignorieren */ }
      el.classList.toggle('active', !!on && document.activeElement === body);
    }
  }

  function focusEnd() {
    body.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  async function insertImages(files) {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    for (const f of imgs) {
      try {
        const url = await compressImage(f);
        focusEnd();
        document.execCommand('insertImage', false, url);
      } catch (e) {
        showError(e, 'Bild konnte nicht eingefügt werden: ');
      }
    }
    fire();
  }

  root.querySelector('.rte-toolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('.rte-btn')) e.preventDefault(); // Fokus/Auswahl im Editor behalten
  });
  root.querySelector('.rte-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.rte-btn');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    focusEnd();
    if (cmd === 'image') {
      fileInput.click();
      return;
    }
    if (cmd === 'heading') {
      const cur = document.queryCommandValue('formatBlock').toLowerCase();
      document.execCommand('formatBlock', false, cur === 'h3' ? 'div' : 'h3');
    } else if (cmd === 'code') {
      toggleCode();
    } else {
      document.execCommand(cmd, false, null);
    }
    updateState();
    fire();
  });

  function toggleCode() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const inCode = node && node.closest('code') && body.contains(node);
    if (inCode) {
      const code = node.closest('code');
      const text = document.createTextNode(code.textContent);
      code.replaceWith(text);
    } else if (!sel.isCollapsed) {
      document.execCommand('insertHTML', false, `<code>${esc(sel.toString())}</code>`);
    } else {
      document.execCommand('insertHTML', false, '<code>&#8203;</code>');
    }
  }

  fileInput.addEventListener('change', async () => {
    await insertImages(fileInput.files);
    fileInput.value = '';
  });

  body.addEventListener('input', () => {
    fire();
    updateState();
  });
  body.addEventListener('keyup', updateState);
  body.addEventListener('mouseup', updateState);
  body.addEventListener('focus', updateState);
  body.addEventListener('blur', updateState);

  body.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      insertImages(files);
      return;
    }
    const h = cd.getData('text/html');
    e.preventDefault();
    if (h) {
      document.execCommand('insertHTML', false, sanitizeHtml(h));
    } else {
      document.execCommand('insertText', false, cd.getData('text/plain'));
    }
    fire();
  });

  body.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
  });
  body.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      e.preventDefault();
      if ([...files].some((f) => f.type.startsWith('image/'))) insertImages(files);
      else toast('Nur Bilddateien können eingefügt werden.', { type: 'error' });
    }
  });

  // Auswahl eines Bildes per Klick markieren (löschbar mit Entf/Backspace)
  body.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
      const range = document.createRange();
      range.selectNode(e.target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  return {
    el: root,
    body,
    getHtml: () => sanitizeHtml(body.innerHTML.replace(/​/g, '')),
    setHtml(h) { body.innerHTML = h || ''; },
    isEmpty() {
      const h = body.innerHTML;
      return !hasImage(h) && !htmlToText(h).replace(/​/g, '');
    },
    focus: () => body.focus(),
  };
}
