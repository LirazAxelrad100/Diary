/* Diary — Phase 1
   Everything lives in this browser's localStorage. Nothing is sent anywhere.

   Data model: one record per WRITING SESSION.
     { id: "…", ts: "2026-09-01T08:12:00.000Z", text: "…" }
   Days are only a way of displaying them. */

const KEY = 'diary.entries.v1';
const IDLE_MS = 5 * 60 * 1000;   // after 5 min of not typing, the session closes
const SAVE_MS = 400;             // autosave delay after the last keystroke

let entries = load();
let draftId = null;              // the entry currently in the composer
let editId = null;               // an older entry being edited in place
let query = '';
let readMode = false;

const $ = (id) => document.getElementById(id);
const stream = $('stream');
const composer = $('composer');
const composerWrap = $('composerWrap');

/* ---------- storage ---------- */

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (err) {
    console.error('Could not save', err);
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Quiet confirmation, so you never wonder whether it saved. */
let statusTimer = null;

function flashSaved(text = 'Saved') {
  const el = $('status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------- dates ---------- */

// Local YYYY-MM-DD, used to group entries into days.
function dayKey(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function timeLabel(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- tiny markdown ---------- */

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function highlight(html) {
  if (!query) return html;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(safe, 'gi'), (m) => `<mark>${m}</mark>`);
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(\S(?:.*?\S)?)\*(?=\W|$)/g, '$1<em>$2</em>');
}

// Blank line = new paragraph. A block of "- " lines = a list.
// dir="auto" on every block is what makes Hebrew and English sit correctly.
function toHtml(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li dir="auto">${highlight(inline(escapeHtml(l.replace(/^\s*[-*]\s+/, ''))))}</li>`)
          .join('');
        return `<ul dir="auto">${items}</ul>`;
      }
      const body = lines.map((l) => highlight(inline(escapeHtml(l)))).join('<br>');
      return `<p dir="auto">${body}</p>`;
    })
    .join('');
}

/* ---------- rendering ---------- */

function visibleEntries() {
  const list = entries
    .filter((e) => e.id !== draftId)               // the draft lives in the composer
    .sort((a, b) => a.ts.localeCompare(b.ts));

  if (!query) return list;
  const q = query.toLowerCase();
  return list.filter((e) => e.text.toLowerCase().includes(q));
}

function render() {
  const list = visibleEntries();
  stream.className = 'stream' + (readMode || query ? ' read' : '');

  if (!list.length) {
    const msg = query ? 'Nothing found.' : 'Start writing below.';
    stream.innerHTML = `<div class="inner"><p class="empty">${msg}</p></div>`;
    return;
  }

  let html = '<div class="inner">';
  let lastDay = null;

  for (const e of list) {
    const key = dayKey(e.ts);
    if (key !== lastDay) {
      html += `<h2 class="day">${dayLabel(e.ts)}</h2>`;
      lastDay = key;
    }
    html += `<article class="entry" data-id="${e.id}">
               <span class="time">${timeLabel(e.ts)}</span>
               ${toHtml(e.text)}
             </article>`;
  }

  stream.innerHTML = html + '</div>';
}

function scrollToBottom() {
  stream.scrollTop = stream.scrollHeight;
}

/* ---------- writing (composer) ---------- */

let saveTimer = null;
let idleTimer = null;

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function onType() {
  autoGrow(composer);
  clearTimeout(saveTimer);
  clearTimeout(idleTimer);
  saveTimer = setTimeout(saveDraft, SAVE_MS);
  idleTimer = setTimeout(commitDraft, IDLE_MS);
}

function saveDraft() {
  const text = composer.value;

  if (!text.trim()) {                       // emptied again — drop the record
    if (draftId) {
      entries = entries.filter((e) => e.id !== draftId);
      draftId = null;
      save();
    }
    return;
  }

  if (!draftId) {                           // first keystroke stamps the time
    draftId = uid();
    entries.push({ id: draftId, ts: new Date().toISOString(), text });
  } else {
    entries.find((e) => e.id === draftId).text = text;
  }
  save();
  flashSaved(`Saved ${timeLabel(entries.find((e) => e.id === draftId).ts)}`);
}

// End the current writing session: the text moves up into the stream.
function commitDraft() {
  clearTimeout(saveTimer);
  clearTimeout(idleTimer);
  saveDraft();
  if (!draftId) return;
  draftId = null;
  composer.value = '';
  autoGrow(composer);
  render();
  scrollToBottom();
}

composer.addEventListener('input', onType);

composer.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { commitDraft(); composer.blur(); }
});

// A session also ends when you leave the page or close the tab.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveDraft(); commitDraft(); }
});

window.addEventListener('beforeunload', saveDraft);

/* ---------- editing an older entry ---------- */

stream.addEventListener('click', (ev) => {
  if (readMode || query) return;
  const article = ev.target.closest('.entry');
  if (!article || article.dataset.id === editId) return;
  startEdit(article.dataset.id);
});

function startEdit(id) {
  editId = id;
  const entry = entries.find((e) => e.id === id);
  const article = stream.querySelector(`[data-id="${id}"]`);

  article.innerHTML = `<span class="time">${timeLabel(entry.ts)}</span>
    <textarea class="editor" dir="auto"></textarea>
    <div class="entryTools">
      <button type="button" class="danger" data-act="delete">Delete</button>
      <button type="button" data-act="done">Done</button>
    </div>`;

  const box = article.querySelector('.editor');
  box.value = entry.text;
  autoGrow(box);
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);

  box.addEventListener('input', () => {
    autoGrow(box);
    entry.text = box.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { save(); flashSaved(); }, SAVE_MS);
  });

  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') endEdit(); });

  article.querySelector('[data-act="done"]').addEventListener('click', endEdit);

  article.querySelector('[data-act="delete"]').addEventListener('click', () => {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    entries = entries.filter((e) => e.id !== id);
    editId = null;
    save();
    render();
  });
}

function endEdit() {
  const entry = entries.find((e) => e.id === editId);
  if (entry && !entry.text.trim()) entries = entries.filter((e) => e.id !== editId);
  editId = null;
  save();
  render();
}

/* ---------- search, modes, menu ---------- */

$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  composerWrap.classList.toggle('hidden', !!query);
  render();
  if (!query) scrollToBottom();
});

$('modeBtn').addEventListener('click', () => {
  commitDraft();
  readMode = !readMode;
  $('modeBtn').textContent = readMode ? 'Write' : 'Read';
  composerWrap.classList.toggle('hidden', readMode);
  render();
  if (!readMode) scrollToBottom();
});

$('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu').hidden = !$('menu').hidden;
});

document.addEventListener('click', (e) => {
  if (!$('menu').hidden && !$('menu').contains(e.target)) $('menu').hidden = true;
});

/* ---------- export / restore ---------- */

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

$('exportMd').addEventListener('click', () => {
  commitDraft();
  const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
  let out = '';
  let lastDay = null;

  for (const e of sorted) {
    const key = dayKey(e.ts);
    if (key !== lastDay) {
      out += `\n## ${key} — ${dayLabel(e.ts)}\n`;
      lastDay = key;
    }
    out += `\n### ${timeLabel(e.ts)}\n\n${e.text.trim()}\n`;
  }

  download(`diary-${stamp()}.md`, out.trim() + '\n', 'text/markdown');
});

$('exportJson').addEventListener('click', () => {
  commitDraft();
  download(`diary-backup-${stamp()}.json`, JSON.stringify(entries, null, 2), 'application/json');
});

$('importJson').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error('not a diary backup');

    const seen = new Set(entries.map((e) => e.id));
    let added = 0;
    for (const e of incoming) {
      if (e && e.id && e.ts && typeof e.text === 'string' && !seen.has(e.id)) {
        entries.push(e);
        seen.add(e.id);
        added++;
      }
    }
    save();
    render();
    scrollToBottom();
    alert(`Restored ${added} ${added === 1 ? 'entry' : 'entries'}.`);
  } catch (err) {
    alert("That file doesn't look like a diary backup.");
  }
  ev.target.value = '';
  $('menu').hidden = true;
});

/* ---------- start ---------- */

render();
scrollToBottom();
autoGrow(composer);
