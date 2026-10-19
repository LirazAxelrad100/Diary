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
let visibleMonth = thisMonth();  // which month the reading view is showing

const $ = (id) => document.getElementById(id);
const stream = $('stream');
const composer = $('composer');

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

/* Quiet confirmation under the composer, so you never wonder whether it saved.
   The Esc hint is always there; "נשמר HH:MM" appears once there is something
   to save. It stays put rather than flashing — the design treats it as a
   standing caption, not a notification. */
let savedAt = '';

function setStatus(time) {
  if (time !== undefined) savedAt = time;
  $('status').innerHTML =
    (savedAt ? `נשמר <span class="mono" dir="ltr">${savedAt}</span>` : '') +
    `<span class="escHint">${savedAt ? ' · ' : ''}Esc לסגירת הרשומה</span>`;
}

function flashSaved(time = '') { setStatus(time); }

/* ---------- dates ---------- */

// Local YYYY-MM-DD, used to group entries into days.
function dayKey(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "יום שלישי · 1 בספטמבר" — the divider between days in the reading view.
function dayLabel(iso) {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString('he-IL', { weekday: 'long' });
  const date = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  return `${weekday} · ${date}`;
}

function timeLabel(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- months ---------- */

// A month is {y, m} with m 0-11, matching Date. Compared via monthKey.
function thisMonth() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
}

function monthOf(iso) {
  const d = new Date(iso);
  return { y: d.getFullYear(), m: d.getMonth() };
}

const monthKey = (mo) => mo.y * 12 + mo.m;

function stepMonth(mo, by) {
  const d = new Date(mo.y, mo.m + by, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

// "ספטמבר 2026"
function monthLabel(mo) {
  return new Date(mo.y, mo.m, 1)
    .toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

// "tue 01.09 · 22:05" — stays LTR so the clock never reverses. The clock half
// is its own span so a narrow header can drop it; the composer shows the time
// anyway, and the full stamp will not fit beside the buttons on a phone.
function headStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' }).toLowerCase();
  return `<bdi>${wd} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}</bdi>` +
         `<span class="stampTime"> · <bdi>${timeLabel(d.toISOString())}</bdi></span>`;
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

// The draft lives in the composer, not the stream, and deletes are tombstones.
const live = () => entries.filter((e) => !e.deleted && e.id !== draftId);

const byTime = (a, b) => a.ts.localeCompare(b.ts);

function matches(e) {
  return !query || e.text.toLowerCase().includes(query.toLowerCase());
}

// Writing view shows today only — the earlier sessions of this same day.
function todayEntries() {
  const key = dayKey(now());
  return live().filter((e) => dayKey(e.ts) === key).sort(byTime);
}

// Reading view is scoped to one month. A search reaches across every month,
// because paging month by month to find a word is not really searching.
function readingEntries() {
  const list = live().filter(matches).sort(byTime);
  if (query) return list;
  const k = monthKey(visibleMonth);
  return list.filter((e) => monthKey(monthOf(e.ts)) === k);
}

function hasEntriesBefore(mo) {
  const k = monthKey(mo);
  return live().some((e) => monthKey(monthOf(e.ts)) < k);
}

function hasEntriesAfter(mo) {
  const k = monthKey(mo);
  return live().some((e) => monthKey(monthOf(e.ts)) > k);
}

// Every month that has writing, oldest first, as {y, m}.
function monthsWithEntries() {
  const keys = [...new Set(live().map((e) => monthKey(monthOf(e.ts))))].sort((a, b) => a - b);
  return keys.map((k) => ({ y: Math.floor(k / 12), m: k % 12 }));
}

// "ספט׳" — the short name, grouped under its year.
function renderMonthStrip() {
  const cur = monthKey(visibleMonth);
  let html = '';
  let year = null;
  for (const mo of monthsWithEntries()) {
    if (mo.y !== year) {
      if (year !== null) html += '<span class="msSep"></span>';
      html += `<span class="msYear">${mo.y}</span>`;
      year = mo.y;
    }
    const name = new Date(mo.y, mo.m, 1).toLocaleDateString('he-IL', { month: 'short' });
    const here = monthKey(mo) === cur ? ' aria-current="true"' : '';
    html += `<button class="msMonth" type="button" data-key="${monthKey(mo)}"
                     aria-label="${monthLabel(mo)}"${here}>${name}</button>`;
  }
  $('monthStrip').innerHTML = html;
}

function setMonthStrip(open) {
  $('monthStrip').hidden = !open;
  $('monthLabel').setAttribute('aria-expanded', String(open));
  if (open) renderMonthStrip();
}

function entryHtml(e) {
  // The <bdi> keeps the clock LTR without setting dir on the positioned span —
  // dir on that span would flip which side inset-inline-start means.
  return `<article class="entry" data-id="${e.id}">
            <span class="dot"></span>
            <span class="time"><bdi>${timeLabel(e.ts)}</bdi></span>
            <div class="body">${toHtml(e.text)}</div>
          </article>`;
}

function render() {
  const list = readMode ? readingEntries() : todayEntries();

  if (!list.length) {
    const msg = query ? 'לא נמצא כלום.'
      : readMode ? 'אין רשומות בחודש הזה.'
      : 'אפשר להתחיל לכתוב למטה.';
    stream.innerHTML = `<div class="inner"><p class="empty">${msg}</p></div>`;
    updateChrome(0);
    return;
  }

  let html = '<div class="inner">';

  if (readMode) {
    // Each day gets its own divider and its own length of rail.
    let lastDay = null;
    for (const e of list) {
      const key = dayKey(e.ts);
      if (key !== lastDay) {
        if (lastDay !== null) html += '</div></section>';
        html += `<section class="dayGroup">
                   <div class="dayDivider"><span>${dayLabel(e.ts)}</span></div>
                   <div class="thread">`;
        lastDay = key;
      }
      html += entryHtml(e);
    }
    html += '</div></section>';
  } else {
    html += `<div class="thread">${list.map(entryHtml).join('')}</div>`;
  }

  stream.innerHTML = html + '</div>';
  updateChrome(list.length);
}

/* Header text differs per mode; both halves live in the same bar. */
function updateChrome(shown) {
  document.body.className = readMode ? 'mode-reading' : 'mode-writing';
  $('barTitle').textContent = readMode ? 'קריאה' : 'כותבת עכשיו';
  $('modeBtn').textContent = readMode ? 'כתיבה' : 'קריאה';

  if (readMode) {
    $('monthNav').hidden = !!query;
    if (query) setMonthStrip(false);
    else if (!$('monthStrip').hidden) renderMonthStrip();
    $('monthLabel').textContent = monthLabel(visibleMonth);
    // In RTL ‹ moves forward. It normally stops at the month we are actually
    // in, but never before an entry: a wrong device clock can stamp writing
    // into a future month, and capping at today would strand it unreachable.
    $('nextMonth').disabled =
      monthKey(visibleMonth) >= monthKey(thisMonth()) && !hasEntriesAfter(visibleMonth);
    $('prevMonth').disabled = !hasEntriesBefore(visibleMonth);
    const noun = shown === 1 ? 'entry' : 'entries';
    $('countReading').textContent = query
      ? `${shown} ${shown === 1 ? 'hit' : 'hits'}`
      : `${shown} ${noun}`;
  } else {
    setMonthStrip(false);
    $('nowStamp').innerHTML = headStamp();
    $('countWriting').textContent = String(live().length);
    $('liveTime').innerHTML = `<bdi>${timeLabel(now())}</bdi>`;
  }
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
    el.textContent = 'לא מקוון';
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
  stopRecording();
  showMic(false);
  updateSync();
}

async function onSignedIn(u) {
  if (user && user.id === u.id) return;   // onAuthStateChange also fires on load
  user = u;

  $('gate').hidden = true;
  $('signOut').hidden = false;
  showMic(true);
  $('menuNote').textContent = `מחוברת כ־${u.email}. הרשומות מסתנכרנות בין המכשירים.`;

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
  idleTimer = setTimeout(idleCommit, IDLE_MS);
}

// Not while a voice note is still recording or on its way back as text.
function idleCommit() {
  if (recording || sending) idleTimer = setTimeout(idleCommit, IDLE_MS);
  else commitDraft();
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
  setStatus(timeLabel(now()));
  updateChrome(0);
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
  setStatus('');            // the next session starts with a clean caption
  render();
  scrollToBottom();
  flush();
}

composer.addEventListener('input', onType);

composer.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { commitDraft(); composer.blur(); }
});

/* ---------- voice notes ---------- */

/* Tap the mic, talk, tap again: the audio goes to /api/transcribe (OpenAI,
   behind the sign-in) and the text lands at the caret, where it saves like
   typing. The audio itself is never stored — only the text is kept.

   Two recorders run on the same mic:
   - PIECES, cut at every pause and sent as each one closes, so text appears
     sentence by sentence while she is still talking — the proof the mic is
     working. This is only a preview: a few seconds of audio give the model
     too little context, and short pieces came back noticeably less accurate.
   - The FULL take, one uninterrupted file. On stop it is transcribed in one
     go and replaces the preview, so the text that stays is as good as a
     single recording. If she edited the preview meanwhile, it is left alone.
   If the full take cannot be used (no second recorder, over Vercel's 4.5MB
   limit, or it fails) the preview simply stays as the text. */
const MIN_SEG_MS = 3000;               // never cut shorter than this
const MAX_SEG_MS = 45000;              // cut here even without a pause
const PAUSE_MS = 700;                  // this much quiet ends a sentence
const MAX_REC_MS = 30 * 60 * 1000;     // a forgotten mic stops itself
const TICK_MS = 100;

let micStream = null;
let recorder = null;
let recStart = 0;
let recTick = null;
let audioCtx = null;
let analyser = null;
let levelBuf = null;
let peak = 0;                          // loudest recent level, slowly decaying
let quietSince = 0;
let recording = false;
let starting = false;                  // waiting on the mic permission prompt
let sending = 0;                       // segments uploaded but not answered
let failedClips = [];                  // kept in memory for "try again"
let sendChain = Promise.resolve();     // keeps segments in spoken order
let fullRec = null;                    // the uninterrupted recording
let take = null;                       // where this recording's preview sits
const MAX_UPLOAD = 4 * 1024 * 1024;

const canRecord = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function recMime() {
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function showMic(on) {
  $('micWrap').hidden = !(on && canRecord());
}

function micNote() {
  const btn = $('micBtn');
  btn.classList.toggle('rec', recording);
  btn.classList.toggle('busy', !recording && sending > 0);
  btn.setAttribute('aria-label', recording ? 'עצירת ההקלטה' : 'הקלטה');

  const note = $('micNote');
  if (recording) {
    const s = Math.floor((Date.now() - recStart) / 1000);
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    note.innerHTML = `<span class="mono" dir="ltr">${clock}</span>`;
  } else if (sending) {
    note.textContent = 'מתמללת…';
  } else if (failedClips.length) {
    note.innerHTML = 'התמלול נכשל · <button type="button" id="micRetry">לנסות שוב</button>';
  } else {
    note.textContent = '';
  }
}

/* How loud the mic is right now, 0..1 (RMS of the latest samples). Phones
   apply automatic gain, so absolute thresholds are unreliable; "quiet" is
   measured against the recent peak instead. */
function micLevel() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (const v of levelBuf) sum += v * v;
  return Math.sqrt(sum / levelBuf.length);
}

/* iOS only lets audio start inside the tap itself, and the permission prompt
   breaks that link — so the context is woken here, synchronously on the tap,
   before the mic is requested. */
function wakeAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (err) {
    audioCtx = null;
  }
}

function listen() {
  analyser = null;
  peak = 0;
  quietSince = 0;
  if (!audioCtx) return;
  try {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    levelBuf = new Float32Array(analyser.fftSize);
    // Routed on to a silent output: Safari may not run a node nothing pulls.
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
    analyser.connect(mute).connect(audioCtx.destination);
  } catch (err) {
    analyser = null;
  }
}

/* If the meter is not working — the context never started, or it has heard
   nothing at all — pause detection is switched off: every piece is sent and
   cuts fall back to MAX_SEG_MS. Losing a note to a broken meter would be far
   worse than paying for a few seconds of silence. */
function meterDead() {
  if (analyser && (audioCtx.state !== 'running' ||
                   (Date.now() - recStart > 1500 && peak === 0))) {
    analyser = null;
    if (recorder) recorder.hadSpeech = true;
  }
  return !analyser;
}

// Runs every TICK_MS while recording: meter, pause detection, cutting.
function recTickFn() {
  const t = Date.now();
  if (t - recStart >= MAX_REC_MS) { stopRecording(); return; }

  if (meterDead()) {
    if (t - recorder.startedAt >= MAX_SEG_MS) { recorder.stop(); startSegment(); }
    micNote();
    return;
  }

  const level = micLevel();
  peak = Math.max(level, peak * 0.995);
  const quiet = level < Math.max(0.006, peak * 0.2);
  if (level > 0.01) recorder.hadSpeech = true;
  quietSince = quiet ? (quietSince || t) : 0;

  // The ring around the red button follows her voice.
  $('micBtn').style.setProperty('--level', Math.min(1, level / (peak || 1)).toFixed(2));

  const age = t - recorder.startedAt;
  const paused = quietSince && t - quietSince >= PAUSE_MS;
  if ((age >= MIN_SEG_MS && paused && recorder.hadSpeech) || age >= MAX_SEG_MS) {
    recorder.stop();
    startSegment();
  }
  micNote();
}

// Put text at the caret (the caret survives the blur the mic tap causes), with
// a space between it and whatever is already there, then save as if typed.
function insertTranscript(text) {
  if (!text) return;
  const v = composer.value;
  const a = composer.selectionStart ?? v.length;
  const b = composer.selectionEnd ?? v.length;
  const before = v.slice(0, a);
  const after = v.slice(b);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^\s/.test(after) ? ' ' : '';
  composer.value = before + pre + text + post + after;
  const caret = (before + pre + text).length;
  composer.setSelectionRange(caret, caret);
  onType();
  composer.scrollTop = composer.scrollHeight;
  return { start: a, end: caret };
}

// A preview piece arrived: insert it and remember the stretch it covers.
function addPreview(t, text) {
  if (t.done) return;          // the full take already landed; this is in it
  const r = insertTranscript(text);
  if (!r) return;
  if (t.start === null) t.start = r.start;
  t.end = r.end;
  t.inserted = composer.value.slice(t.start, t.end);
}

// The full transcript arrived: swap it in for the preview, if the preview is
// still exactly as it was inserted. Otherwise she has edited it — keep hers.
function applyFinal(t, text) {
  t.done = true;
  if (t.start === null) { insertTranscript(text); return true; }
  if (composer.value.slice(t.start, t.end) !== t.inserted) return false;
  if (!text) return true;
  composer.setSelectionRange(t.start, t.end);
  insertTranscript(text);
  return true;
}

// The end of what is already written, so each short piece is transcribed as
// a continuation — spelling of names, punctuation, Hebrew vs English — rather
// than as a sentence out of nowhere. Only the entry being written is sent.
function transcriptContext() {
  return composer.value.slice(0, composer.selectionStart ?? composer.value.length).slice(-200);
}

async function transcribe(blob, context) {
  const { data } = await db.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) throw new Error('signed out');

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': blob.type,
      // Headers must be plain ASCII; Hebrew travels percent-encoded.
      'x-context': encodeURIComponent(context || '')
    },
    body: blob
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  return (await res.json()).text;
}

/* Everything is answered strictly one after another, so pieces land in
   spoken order and the full take always comes after its own pieces.
   kind: 'piece' (preview), 'final' (full take), 'plain' (retry: just insert). */
function sendClip(blob, kind = 'plain', t = null) {
  if (!blob.size) return;
  sending++;
  micNote();
  sendChain = sendChain.then(async () => {
    try {
      const context = kind === 'final' && t.start !== null
        ? composer.value.slice(0, t.start).slice(-200)
        : transcriptContext();
      const text = await transcribe(blob, context);
      if (kind === 'piece') addPreview(t, text);
      else if (kind === 'final') applyFinal(t, text);
      else insertTranscript(text);
    } catch (err) {
      console.warn('Transcription failed:', err.message);
      // A failed preview piece only matters if no full take will cover it.
      if (kind === 'piece') t.failed.push(blob);
      else failedClips.push(blob);
    }
    sending--;
    micNote();
  });
}

// On stop: send the full take, or — when there is none — keep the preview and
// offer to retry whatever preview pieces failed.
function finishTake(t, blob) {
  if (blob && blob.size && blob.size <= MAX_UPLOAD) {
    sendClip(blob, 'final', t);
  } else {
    sendChain = sendChain.then(() => {
      failedClips.push(...t.failed);
      micNote();
    });
  }
}

// One MediaRecorder per segment: each one produces a complete, playable file.
function startSegment() {
  const type = recMime();
  const rec = new MediaRecorder(micStream, {
    ...(type && { mimeType: type }),
    audioBitsPerSecond: 32000            // speech needs little; may be ignored
  });
  const parts = [];
  rec.hadSpeech = !analyser;           // no meter: send everything
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const t = take;
  rec.onstop = () => {
    if (!rec.hadSpeech) return;        // silence: nothing to transcribe
    // The container type only — the server picks the file name from it.
    sendClip(new Blob(parts, { type: (rec.mimeType || type).split(';')[0] }), 'piece', t);
  };
  rec.start();
  rec.startedAt = Date.now();
  recorder = rec;
}

function startFull() {
  const t = take;
  const type = recMime();
  try {
    const rec = new MediaRecorder(micStream, {
      ...(type && { mimeType: type }),
      audioBitsPerSecond: 32000
    });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    // Normally queued after the last piece (stopped first); if the events
    // arrive the other way round, t.done keeps that piece from doubling up.
    rec.onstop = () => finishTake(t, new Blob(parts, { type: (rec.mimeType || type).split(';')[0] }));
    rec.start();
    fullRec = rec;
  } catch (err) {
    fullRec = null;                    // preview pieces become the text
  }
}

async function startRecording() {
  if (starting) return;
  starting = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    $('micNote').textContent = 'אין גישה למיקרופון';
    return;
  } finally {
    starting = false;
  }
  // The idle timer would close the session in the middle of a long note.
  clearTimeout(idleTimer);
  recording = true;
  recStart = Date.now();
  take = { start: null, end: null, inserted: '', failed: [], done: false };
  startFull();
  listen();
  startSegment();
  recTick = setInterval(recTickFn, TICK_MS);
  micNote();
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  clearInterval(recTick);
  analyser = null;
  if (audioCtx) audioCtx.suspend();
  $('micBtn').style.removeProperty('--level');
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  if (fullRec && fullRec.state !== 'inactive') fullRec.stop();
  else finishTake(take, null);
  fullRec = null;
  // Release the mic so the phone's recording indicator goes away.
  micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  micNote();
}

$('micBtn').addEventListener('click', () => {
  if (recording) { stopRecording(); return; }
  wakeAudio();
  startRecording();
});

$('micWrap').addEventListener('click', (e) => {
  if (e.target.id !== 'micRetry') return;
  const clips = failedClips;
  failedClips = [];
  clips.forEach((blob) => sendClip(blob));
});

/* iOS does not shrink the layout viewport when the keyboard opens. It shrinks
   the *visual* viewport and pans it over a still-full-height page, so the
   header slides out of sight above the fold. That offset is not document
   scroll — window.scrollTo cannot correct it — so the body is pinned to the
   visual viewport instead: --app-height gives it the visible height, and
   inset-block-start cancels the pan.

   Where the browser honours interactive-widget=resizes-content (see the
   viewport meta) the two viewports already agree, offsetTop stays 0, and this
   costs nothing. */
const vv = window.visualViewport;

function syncAppViewport() {
  if (!vv) return;
  // A hidden or backgrounded page can report 0 here; writing that through
  // would collapse the app to nothing. Keep the last good height instead.
  if (!(vv.height > 0)) return;
  document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
}

/* Opening and closing the keyboard need opposite treatment.

   Closing: the pan offset is deliberately NOT tracked live. iOS animates the
   keyboard shut over roughly a quarter of a second, emitting a stream of
   intermediate offsets; applying each one moves the page by hand while the
   browser is already settling it correctly, which reads as the whole screen
   floating. So the offset is corrected once, after the animation has finished.

   Opening: the height and the offset must land in the SAME frame. The height
   is safe to track live, but a short body still pinned to the top of the
   full-height layout viewport sits above the visible window — the header goes
   first, then the entire app, until the correction arrives. Deferring the
   offset by 350ms here is what made the app blink off screen on every tap. */
let settleTimer;
let lastVvHeight = vv ? vv.height : 0;

function applyPan() {
  if (!vv) return;
  document.body.style.insetBlockStart = vv.offsetTop ? `${vv.offsetTop}px` : '';
}

function settleAppViewport() {
  if (!vv) return;
  syncAppViewport();
  applyPan();
}

/* iOS also pans *between* resize events, so correcting only on resize still
   leaves gaps the eye catches. For the length of the keyboard animation —
   opening or closing — height and offset are re-applied every frame instead.

   This is not the live tracking that once made the screen float. That applied
   offsetTop on its own, from the scroll event, while the height was tracked
   separately: the two arrived out of step and the body was repeatedly the
   wrong size for where it had been put. Here both come from the same reading
   in the same frame, so the body exactly fills the visible window at every
   instant of the animation — which is also why the two viewports stay locked
   (offsetTop is whatever the shrunken height leaves above the fold).

   The window is short and starts only on focus entering or leaving a field, so
   nothing is tracked while the app is simply sitting there. */
const PAN_TRACK_MS = 700;
let panRaf = 0;
let trackUntil = 0;

function trackPan() {
  syncAppViewport();
  applyPan();
  panRaf = performance.now() < trackUntil ? requestAnimationFrame(trackPan) : 0;
}

function startPanTracking() {
  trackUntil = performance.now() + PAN_TRACK_MS;
  if (!panRaf) panRaf = requestAnimationFrame(trackPan);
}

function stopPanTracking() {
  trackUntil = 0;
  if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; }
}

function opensKeyboard(el) {
  return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
}

if (vv) {
  vv.addEventListener('resize', () => {
    const shrinking = vv.height < lastVvHeight - 1;   // keyboard coming up
    lastVvHeight = vv.height;
    syncAppViewport();                 // height may change; safe to track live
    if (shrinking) applyPan();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleAppViewport, 350);
  });

  // Both edges of the keyboard animation: coming up on focus, going down on
  // blur. The delayed settle still runs afterwards and has the last word.
  document.addEventListener('focusin', (e) => {
    if (opensKeyboard(e.target)) startPanTracking();
  });

  document.addEventListener('focusout', (e) => {
    if (opensKeyboard(e.target)) startPanTracking();
  });

  // A backgrounded page gets no frames; drop the loop rather than leave it
  // pending, and let the settle correct things when the page comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPanTracking();
  });

  syncAppViewport();
}

// Leaving the page ends the session and pushes what's queued.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // iOS cuts the mic off in the background anyway. The last segment is only
    // queued once the recorder has finished stopping, so `sending` is not
    // yet counting it — hence the separate flag.
    const wasRecording = recording;
    stopRecording();
    saveDraft();
    // A voice note still on its way back belongs to this entry, so the
    // session stays open for it; what was written is already saved above.
    if (!wasRecording && !sending) commitDraft();
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

  article.innerHTML = `<span class="dot"></span>
    <span class="time" dir="ltr">${timeLabel(entry.ts)}</span>
    <div class="body">
      <textarea class="editor" dir="auto"></textarea>
      <div class="entryTools">
        <button type="button" class="danger" data-act="delete">מחיקה</button>
        <button type="button" data-act="done">סיום</button>
      </div>
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
    saveTimer = setTimeout(() => { touch(entry); setStatus(timeLabel(now())); }, SAVE_MS);
  });

  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') endEdit(); });

  article.querySelector('[data-act="done"]').addEventListener('click', endEdit);

  article.querySelector('[data-act="delete"]').addEventListener('click', () => {
    if (!confirm('למחוק את הרשומה? אי אפשר לבטל.')) return;
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

// Search only exists in the reading header, so it never interrupts writing.
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  render();
  stream.scrollTop = 0;
});

$('modeBtn').addEventListener('click', () => {
  stopRecording();
  commitDraft();
  readMode = !readMode;

  if (readMode) {
    // Land on this month, or on the newest month that actually has writing.
    visibleMonth = thisMonth();
    if (!readingEntries().length) {
      const newest = live().sort(byTime).pop();
      if (newest) visibleMonth = monthOf(newest.ts);
    }
  } else {
    query = '';
    $('search').value = '';
  }

  render();
  if (readMode) stream.scrollTop = 0;
  else { scrollToBottom(); composer.focus(); }
});

/* Month switcher. RTL: › steps back in time, ‹ steps forward. */
function goMonth(by) {
  visibleMonth = stepMonth(visibleMonth, by);
  render();
  stream.scrollTop = 0;
}

$('prevMonth').addEventListener('click', () => goMonth(-1));
$('nextMonth').addEventListener('click', () => goMonth(1));

$('monthLabel').addEventListener('click', (e) => {
  e.stopPropagation();
  setMonthStrip($('monthStrip').hidden);
});

$('monthStrip').addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = e.target.closest('.msMonth');
  if (!btn) return;
  const k = Number(btn.dataset.key);
  visibleMonth = { y: Math.floor(k / 12), m: k % 12 };
  setMonthStrip(false);
  render();
  stream.scrollTop = 0;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('monthStrip').hidden) setMonthStrip(false);
});

$('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu').hidden = !$('menu').hidden;
});

document.addEventListener('click', (e) => {
  if (!$('menu').hidden && !$('menu').contains(e.target)) $('menu').hidden = true;
  if (!$('monthStrip').hidden) setMonthStrip(false);
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

setStatus('');
render();
scrollToBottom();
autoGrow(composer);

// The landing state is writing, with the caret already in the box.
composer.focus();

// The header clock is part of the design, so it has to stay true.
setInterval(() => { if (!readMode) updateChrome(0); }, 20000);

initAuth();
