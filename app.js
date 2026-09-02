/* Diary — Phase 2
   Local-first with sync. Everything is written to this browser first, so the
   app works with no signal; Supabase is a copy that lets other devices catch up.

   Data model: one record per WRITING SESSION.
     { id, ts, text, updated_at, deleted }
   `updated_at` decides who wins when two devices touched the same entry.
   `deleted` is a tombstone, so a delete travels to the other device too. */

const KEY = 'diary.entries.v1';
const PENDING_KEY = 'diary.pending.v1';

const IDLE_MS = 5 * 60 * 1000;   // after 5 min of not typing, the session closes
const SAVE_MS = 400;             // autosave delay after the last keystroke
const FLUSH_MS = 1200;           // upload delay after the last local change

// Until config.js is filled in, run local-only rather than locking her out.
const configured = typeof SUPABASE_URL === 'string' && !SUPABASE_URL.includes('YOUR-');

// Never call this `supabase` — the CDN library already owns that global.
const db = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let entries = load();
let pending = loadPending();     // ids waiting to be uploaded
let user = null;

let draftId = null;              // the entry currently in the composer
let editId = null;               // an older entry being edited in place
let query = '';
let readMode = false;

const $ = (id) => document.getElementById(id);
const stream = $('stream');
const composer = $('composer');
const composerWrap = $('composerWrap');

const now = () => new Date().toISOString();

/* ---------- storage ---------- */

function normalize(e) {
  return {
    id: e.id,
    ts: e.ts,
    text: e.text,
    updated_at: e.updated_at || e.ts,   // entries written before Phase 2
    deleted: !!e.deleted
  };
}

function load() {
  try {
    return (JSON.parse(localStorage.getItem(KEY)) || []).map(normalize);
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

function loadPending() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PENDING_KEY)) || []);
  } catch {
    return new Set();
  }
}

function savePending() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pending]));
  } catch (err) {
    console.error('Could not save queue', err);
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Every local change goes through here: stamp it, queue it, schedule upload. */
function touch(entry) {
  entry.updated_at = now();
  pending.add(entry.id);
  save();
  savePending();
  scheduleFlush();
}

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
    .filter((e) => !e.deleted && e.id !== draftId)   // the draft lives in the composer
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

/* ---------- sync ---------- */

let flushTimer = null;

function scheduleFlush() {
  updateSync();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function updateSync() {
  const el = $('sync');
  if (!db || !user) { el.hidden = true; return; }

  if (!navigator.onLine) {
    el.hidden = false;
    el.textContent = 'Offline';
  } else if (pending.size) {
    el.hidden = false;
    el.textContent = `↑ ${pending.size}`;
  } else {
    el.hidden = true;
  }
}

// Send everything queued. Anything that fails stays queued for next time.
async function flush() {
  if (!db || !user || !pending.size) { updateSync(); return; }

  const rows = [...pending]
    .map((id) => entries.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      user_id: user.id,
      ts: e.ts,
      text: e.text,
      updated_at: e.updated_at,
      deleted: e.deleted
    }));

  if (!rows.length) { pending.clear(); savePending(); updateSync(); return; }

  const { error } = await db.from('entries').upsert(rows);

  if (error) {
    console.warn('Sync failed, will retry:', error.message);
  } else {
    rows.forEach((r) => pending.delete(r.id));
    savePending();
  }
  updateSync();
}

// Take anything newer from the server. Never touches the entry being typed.
async function pull() {
  if (!db || !user) return;

  const { data, error } = await db
    .from('entries')
    .select('id,ts,text,updated_at,deleted');

  if (error) { console.warn('Could not fetch:', error.message); updateSync(); return; }

  let changed = false;

  for (const row of data) {
    if (row.id === draftId) continue;
    const local = entries.find((e) => e.id === row.id);

    if (!local) {
      entries.push(normalize(row));
      changed = true;
    } else if (new Date(row.updated_at) > new Date(local.updated_at)) {
      Object.assign(local, normalize(row));
      changed = true;
    }
  }

  if (changed) { save(); render(); }
  updateSync();
}

async function syncNow() {
  await flush();
  await pull();
}

/* ---------- sign in ---------- */

function showGate(message = '') {
  $('gate').hidden = false;
  $('loginError').textContent = message;
  $('signOut').hidden = true;
  updateSync();
}

async function onSignedIn(u) {
  if (user && user.id === u.id) return;   // onAuthStateChange also fires on load
  user = u;

  $('gate').hidden = true;
  $('signOut').hidden = false;
  $('menuNote').textContent = `Signed in as ${u.email}. Entries sync to your devices.`;

  // First time this account is used in this browser: make sure everything
  // already written here gets uploaded rather than stranded.
  const firstKey = `diary.synced.${u.id}`;
  if (!localStorage.getItem(firstKey)) {
    entries.forEach((e) => pending.add(e.id));
    savePending();
    localStorage.setItem(firstKey, now());
  }

  await syncNow();
  render();
  scrollToBottom();
}

$('loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!db) return;

  const btn = $('loginBtn');
  btn.disabled = true;
  $('loginError').textContent = '';

  const { error } = await db.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });

  btn.disabled = false;
  if (error) $('loginError').textContent = error.message;
  else $('password').value = '';
});

$('signOut').addEventListener('click', async () => {
  await flush();
  await db.auth.signOut();
  user = null;
  $('menu').hidden = true;
  showGate();
});

async function initAuth() {
  if (!db) {                       // local-only mode, no config yet
    $('gate').hidden = true;
    return;
  }

  const { data } = await db.auth.getSession();
  if (data.session) await onSignedIn(data.session.user);
  else showGate();

  db.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) onSignedIn(session.user);
    else if (user) { user = null; showGate(); }
  });
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
      const entry = entries.find((e) => e.id === draftId);
      if (entry) { entry.deleted = true; entry.text = ''; touch(entry); }
      draftId = null;
    }
    return;
  }

  let entry;
  if (!draftId) {                           // first keystroke stamps the time
    draftId = uid();
    entry = { id: draftId, ts: now(), text, updated_at: now(), deleted: false };
    entries.push(entry);
  } else {
    entry = entries.find((e) => e.id === draftId);
    entry.text = text;
  }

  touch(entry);
  flashSaved(`Saved ${timeLabel(entry.ts)}`);
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
  flush();
}

composer.addEventListener('input', onType);

composer.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { commitDraft(); composer.blur(); }
});

// Leaving the page ends the session and pushes what's queued.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    saveDraft();
    commitDraft();
  } else {
    pull();          // coming back: pick up anything written on another device
  }
});

window.addEventListener('beforeunload', saveDraft);
window.addEventListener('online', syncNow);
window.addEventListener('offline', updateSync);

$('sync').addEventListener('click', syncNow);

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
    saveTimer = setTimeout(() => { touch(entry); flashSaved(); }, SAVE_MS);
  });

  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') endEdit(); });

  article.querySelector('[data-act="done"]').addEventListener('click', endEdit);

  article.querySelector('[data-act="delete"]').addEventListener('click', () => {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    entry.deleted = true;      // tombstone, so the delete reaches other devices
    touch(entry);
    editId = null;
    render();
  });
}

function endEdit() {
  const entry = entries.find((e) => e.id === editId);
  if (entry) {
    if (!entry.text.trim()) entry.deleted = true;
    touch(entry);
  }
  editId = null;
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
  const sorted = entries
    .filter((e) => !e.deleted)
    .sort((a, b) => a.ts.localeCompare(b.ts));

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
        const entry = normalize(e);
        entries.push(entry);
        pending.add(entry.id);
        seen.add(entry.id);
        added++;
      }
    }
    save();
    savePending();
    scheduleFlush();
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
initAuth();
