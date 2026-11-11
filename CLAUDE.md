# Diary — working notes

## What it is
A private, local-first journalling web app for mixed Hebrew/English writing.
Plain HTML/CSS/JS, no build step, no dependencies, no server.

Live: https://liraz-diary.vercel.app/ (Vercel, auto-deploys on push to main;
the original auto-generated diary-theta-five.vercel.app now redirects here)
Repo: https://github.com/LirazAxelrad100/Diary (capital D)

Hosting note: started on GitHub Pages, moved to Vercel on 2026-09-01 before
Phase 2. Reason: Phase 2 needs a Supabase API key, and Pages has no build step
and nowhere to keep a secret — Vercel generates config at deploy time from
environment variables, same pattern as the `expenses` project. GitHub Pages has
been switched off so there is only ever one live address; two would mean two
separate localStorage diaries.

## Status — 2026-09-02
Phase 2 done: syncs across devices behind an email+password login.
Phase 3 done: visual redesign from a written handoff (see "The redesign"
below). Desktop checked and approved; **a real-phone pass is still outstanding**
— responsive mode does not exercise the iOS keyboard against `100dvh` or the
safe-area insets.

**Update 2026-09-03 — real-phone pass done. Keyboard bugs found and fixed
(confirmed working on the phone).** Three symptoms that looked like one bug and
were actually two, taking four attempts because the first diagnoses were wrong.

*Symptom:* composer stayed above the keyboard correctly, but dismissing it left
the top bar hidden under the status bar, the page floating rather than fixed to
the edges, and content clipped at the inline-end edge — the clipping persisting
into reading mode.

*Cause 1 — the header.* iOS does not shrink the layout viewport for the
keyboard; it shrinks the **visual** viewport and pans it over a still
full-height page. Fixed by `interactive-widget=resizes-content` in the viewport
meta plus pinning `body` (`position: fixed`, `height: var(--app-height)`) with
`syncAppViewport()` tracking `visualViewport.height`.

*Cause 2 — the floating and the clipping, which was the real one.* **iOS zooms
the whole page in when a text field smaller than 16px takes focus, and does not
reliably zoom back out on blur.** The page is left scaled: clipped at the
inline edges, free to pan, and it stays that way across both modes until a
pinch or a reload — which is why the clipping showed up in reading view and
looked unrelated. Every field was under the line (search 13px, composer 15px,
editor and sign-in inheriting 15px). Fixed by forcing editable fields to 16px.

*Dead ends worth not repeating.* `overflow: hidden` on `html, body` plus
`window.scrollTo(0, 0)` on `focusout` did nothing, because the offset is not
document scroll and `scrollTo` cannot reach it; blocking document scroll only
converted "scrolled" into "floating". Then tracking `visualViewport.offsetTop`
live on the `scroll` event made the floating worse — iOS animates the keyboard
shut over ~250ms and emits a stream of intermediate offsets, so the page was
being moved by hand while the browser was already settling it. The offset is
now corrected once, 350ms after the last resize, and only if a real pan
survives.

Reading-view margins widened at the same time (`.stream` 20px → 26px, and 16px
→ 22px below 380px); the top bar was deliberately left at its old inset,
because it is a tight four-control row and extra padding there clips the
`קריאה` title.

**Phone checks — all passed on 2026-09-03.** Composer stays above the keyboard,
header clear of the Dynamic Island, caption clear of the home indicator,
landscape fine. (The home indicator auto-hides in a home-screen app and returns
on touch; `env(safe-area-inset-bottom)` reserves its space either way, so
nothing shifts when it fades.)

One regression was found and fixed during those checks: pressing Enter did not
grow the composer. Changing its cap from `52dvh` to a share of `--app-height`
had made the cap smaller than `min-height` whenever the keyboard was open, and
**`min-height` beats `max-height`**, so the box froze at the min and `autoGrow`
could not move it. Both bounds now scale with the visible area
(`min-height: min(232px, 30%)`, `max-height: 52%`), verified growing at 812px,
400px and 300px of visible height. Expect a smaller resting box with the
keyboard up — that is the only way both bounds fit; raise the `0.30` if it ever
feels too short.

**Update 2026-09-03 (later) — the keyboard blink, fixed and confirmed on the
phone.** Tapping the composer made the whole app vanish for about 400ms: the
header went first, then the entire page went blank, then it snapped back. A
screen recording pulled apart frame by frame showed the sequence — normal at
2.2s, header gone at 2.3s, fully blank at 2.5s, correct again at 2.6s.

*Cause.* Height and offset were being applied at different times. The height
was tracked live on `resize`, but the offset that cancels the pan waited for
the 350ms settle. In between, a body already shrunk to keyboard height was
still pinned to the top of a still-full-height layout viewport — i.e. above the
visible window. Closing had the mirror version of the same fault: the height
grew back instantly while the offset stayed stale at its keyboard-open value.

*Fix.* The two values must land in the same frame, always. On `resize` the
offset is now applied immediately whenever the viewport is shrinking, and for
700ms after focus enters *or leaves* a field, both values are re-applied every
frame from the same reading (`trackPan`). The delayed settle still runs
afterwards and has the last word.

*Why this is not the "floating" bug coming back.* That one applied `offsetTop`
alone, off the `scroll` event, while the height was tracked separately — the
two arrived out of step, so the body was repeatedly the wrong size for where it
had been put. Tracking both together is the opposite: the body exactly fills
the visible window at every instant. Verified by stepping a simulated close
frame by frame — height + offset summed to the full screen height at every
step (400+320, 500+220, 620+100, 700+20, 720+0).

Confirmed on the phone: no flash opening, no flash closing, no float, and the
box stays put while writing and across the reading-view switch.

- `index.html` / `style.css` / `app.js` — the whole app
- `config.js` — Supabase URL + publishable key (committed on purpose, see below)
- `schema.sql` — run once in the Supabase SQL editor
- Local cache: `localStorage`, key `diary.entries.v1`; upload queue in
  `diary.pending.v1`
- Data model: one record per **writing session** —
  `{ id, ts, text, updated_at, deleted }`. Days are only a display grouping.

Working: autosave with "Saved HH:MM" confirmation, automatic timestamps,
session commit (Esc / page hidden / 5 min idle), edit + delete past entries,
Read mode, offline search with highlighting, export `.md`, backup/restore JSON,
light + dark, mobile layout, home-screen icon, sign-in screen, cross-device
sync with an offline queue.

**Update 2026-09-20 — month arrows no longer stop at today.** `nextMonth` was
disabled whenever `visibleMonth >= thisMonth()`, so an entry stamped into a
*future* month — which only needs a device clock running fast — sat in a month
the arrows could never reach. It now also checks `hasEntriesAfter()`, the
mirror of the existing `hasEntriesBefore()`. Verified in a browser with fake
Aug/Sep/Oct entries: the arrow was dead before the change and steps to October
after, while a diary with nothing in the future still stops at this month.

This came out of a false alarm worth recording, because it will come up again:
Liraz went looking for August entries and could not reach them. **There are
none — the diary's first commit is 2026-09-01, and every entry is stamped
`new Date()` at write time, so nothing in it can predate that.** Her August
writing is in OneNote. Before hunting for a navigation bug, check whether the
data can exist at all. The `›` arrow answers this directly: it is disabled
exactly when nothing exists before the visible month.

Second trap hit during the same session: **localhost and the live site are
separate origins with separate `localStorage`.** A stale snapshot on
`localhost:4599` looks like missing data. Check the Vercel URL, where the
sign-in and the Supabase pull actually happen, before concluding anything about
what is or is not stored.

**Update 2026-10-02 — month picker in reading view.** With two months of
writing, stepping one month at a time by arrow was neither clear nor quick.
The month name (`#monthLabel`, now a `<button>`) opens a strip under the
header (`#monthStrip`) listing **only months that have entries**
(`monthsWithEntries()`), grouped by year with a rail-coloured divider, oldest
on the right. Tap a month to jump there; the strip closes on re-tap, outside
click, Esc, search, or switching to writing. Arrows kept for single steps.
Confirmed working by Liraz.

*Design choices.* The header looks exactly as before — no chevron added; a
soft `--surface` tint on hover / while open is the only hint. Chosen over a
popover list (A) and an always-visible 12-month year strip (B): the strip
pushes the page down instead of floating, and showing only months with
writing matches "empty days are not shown". Because every month in it has
entries, the dot marks **only the current month**, not "has content".
It wraps to a second row on a phone at ~6+ months — expected.

*Gotcha hit while building.* On mobile the label gets a 44px target via a
transparent `border` + `background-clip: padding-box`, so only the text is
tinted. The open/hover rule must use `background-color`, not `background` —
the shorthand resets `background-clip` and the tint floods the whole target.

**Update 2026-10-19 — voice notes (Phase 5).** A 🎤 in the composer's
bottom inline-end corner (writing view, signed in only). Tap to record, tap
again: the audio goes to `api/transcribe.js` (Vercel function) → OpenAI
`gpt-4o-transcribe`, `language: he` plus a prompt saying English words occur.
The text lands at the caret and saves like typing. Audio is never stored.
Deployed and the endpoint verified live (rejects unsigned requests).
All three versions below were checked on the phone the same day; the final
one (preview + full take) is what is live.

*How it works (revised same day — text now appears while recording).* An
`AnalyserNode` meters the mic every 100ms; the recording is cut at each pause
(700ms quiet, piece ≥3s, forced cut at 45s), each piece its own
`MediaRecorder` (a complete file), sent in order through one promise chain.
So text arrives sentence by sentence while she is still talking, no word is
split at a join, and pieces stay far under Vercel's 4.5MB body limit.
"Quiet" is relative to a decaying recent peak, because iOS auto-gain makes
absolute levels meaningless. Pieces with no speech are not sent (cost, and
silence makes the model invent phrases). The last 200 chars of the entry
before the caret go along as `x-context` (percent-encoded — headers are
ASCII) and become part of the prompt, so short pieces continue the text.
The red button's ring follows the voice level (`--level`), so a dead mic shows
before any text is due. Auto-stop at 30 min.

*Preview + full take (revised again same day).* On the phone the live pieces
came back ~80% right with wrong Hebrew words — a few seconds of audio give the
model too little context. Now a second `MediaRecorder` records the whole take
uninterrupted; on stop it is transcribed in one go and **replaces** the
preview stretch (tracked as `take.start/end/inserted`), but only if that
stretch is still exactly as inserted — if she edited it, hers stays. Over
4MB, no second recorder, or a failure → the preview stays as the text, and
failed preview pieces are offered for retry. Costs ~2× per minute. A late
preview piece arriving after the full take is dropped (`take.done`).

*Meter safeguard.* iOS only starts audio inside the tap, so the
`AudioContext` is resumed synchronously in the click handler before
`getUserMedia`. If the meter still is not running (context not `running`, or
peak exactly 0 after 1.5s), pause detection switches off: every piece is sent
and cuts fall back to 45s. Losing a note to a broken meter is worse than
paying for silence. Word-by-word streaming (OpenAI Realtime) was considered and
deferred — much more complex for a small gain over sentence-by-sentence. Failed segments are kept in memory for "לנסות שוב" — lost
on reload. Recording stops on mode switch, backgrounding, and sign-out; the
idle commit and the background commit both wait for a pending transcript, so
it joins the same entry instead of starting a new one.

*Security.* `OPENAI_API_KEY` is a Vercel **Secret** env var, Production only.
The function checks the caller's Supabase access token against
`/auth/v1/user` before calling OpenAI, so the endpoint cannot be used to spend
the key. OpenAI key is "restricted": Model capabilities = Request, all else
None (transcription has no row of its own in OpenAI's permission list). Model
is overridable with a `TRANSCRIBE_MODEL` env var, no code change.

*Privacy decision.* Liraz accepted that audio goes to OpenAI (API: not used for
training, retained up to 30 days for abuse checks). Her reasoning: Apple's
keyboard dictation is also a third party, so it is not more private. This
cannot be covered by Phase 4 encryption — the service must hear the audio.

**Update 2026-10-19 — the in-place editor is now visible.** Tapping a past
note (writing view, today only) always opened an editor, but it was
borderless and transparent, so it looked identical to the note and Liraz
concluded editing did not exist. It now wears the composer's fill and border.
Same fix removed the last `dir="ltr"` on a positioned `.time` (it made the
time vanish while editing) — see the `dir` rule under Avoid. `style.css` is
now cache-busted (`?v=2`) like `app.js`, so phones pick up CSS changes.

**Update 2026-11-03 — editing on mobile + recording preview (pushed).
Editing confirmed on the phone; recording preview approved by Liraz.**

*Editing was broken on the phone, three bugs.* (1) The fixed 232px composer
took all the room above the keyboard, so the entry being edited was squeezed
out of sight. Now `body.editing` hides `.composerWrap`, and the entry scrolls
into view 400ms after focus. (2) `סיום` closed the entry, then the same tap
bubbled to the stream's click handler from an element already removed by
`render()`, and reopened it — so "done" never worked. The handler now ignores
taps whose target is no longer in `stream`. (3) Tapping a second entry left
the first one open too; the previous edit is now ended (saved) first. Also:
any `render()` ends an open edit, because a re-render replaces the editor and
would otherwise leave the composer hidden with nothing to type in. Starting an
edit commits the composer's draft as its own entry, and is ignored while a
voice note is still recording or being transcribed.

*Recording "rewrote itself".* The preview pieces used to be typed into the
box and then swapped for the full take on stop — Liraz saw that as text
jumping and editing itself. The preview now never enters the textarea; on
stop, the full take is inserted once at the caret (or the preview text, if
there is no full take or it fails). `take` is now just
`{ preview, failed, done }`; the `start/end/inserted` tracking is gone.
A first version showed the preview as a small grey strip at the bottom of the
box — she found the font, colour and position wrong. Now `#micPreview` wears
the `composer` class and lies exactly over the textarea while recording: what
is written, plus the heard words in `--ink-recede` at the caret, where they
will land. Same font, same place; only the shade says "not final yet".
*Third round, same day.* (1) Live pieces were too rough to read (3s of audio
each). 8000 was accurate but the first words took 10-12s and she read the
empty box as "no live text"; settled on `MIN_SEG_MS` 5000, plus "מקשיבה…"
in the overlay until the first piece returns. If still
not good enough, next options in order: ElevenLabs Scribe, then OpenAI
Realtime streaming. (2) **Bug: the full take dropped her last sentence** — the
preview had "האם אין את הבאגים שהיו קודם?", the final did not. Likely cause:
`stopRecording()` stopped the mic tracks in the same instant as
`recorder.stop()`, cutting audio still being encoded. The mic is now released
only after both recorders fire `stop` (2s safety timeout). Safety net in
`applyFinal`: if the full take is under 70% of the preview's length, the
preview is used instead — a missing sentence is worse than a wrong word.
Root cause is a likely diagnosis, not proven; watch for it on the phone.

`bodyState()` owns `body.className` (mode + editing + recording) — set classes
through it, since `updateChrome` used to overwrite the whole attribute.

*Mic permission asked every time* — iOS, not the app. Suggested Settings →
Apps → Safari → Microphone → Allow; a home-screen app may still ask once per
launch. Not fixable in code without keeping the mic open (which keeps the
recording indicator on — rejected).

Verified in the browser at 375px with a simulated keyboard and a faked
transcriber. Cache-busted to `style.css?v=3`, `app.js?v=8`.

**Update 2026-11-10 — voice notes were gibberish; the cause was ours, not
OpenAI's (pushed, awaiting a phone test).** Liraz recorded 3 Voice Memos
and we ran them through OpenAI `gpt-4o-transcribe`, ElevenLabs Scribe v1/v2
and Gemini (Gemini failed: 2.5 retired, 3.8 Flash overloaded, 3.1 Pro not on
the free tier). **OpenAI was accurate on all three** — same model and
settings as the diary. So the model was fine and the diary's input was not.
A diary screenshot showed the note *looping* (the same sentences three
times) plus invented words. Four changes:
1. **No previous text in the prompt.** The `x-context` hint (last 200 chars)
   was being copied back into the answer — the likely cause of the loops.
   Removed in `app.js` and `api/transcribe.js`; the fixed one-line prompt stays.
2. **Call processing off:** `echoCancellation` and `noiseSuppression` are
   `false`. `autoGainControl` was turned off too at first, and that killed
   the live text: the raw iPhone level never crossed the meter's fixed 0.01
   speech threshold, so every piece was dropped as silence and text only
   appeared on stop. **AGC stays on** (`v=14`). If AGC is ever removed, the
   meter's thresholds must become relative first.
   Phone test of `v=13`: one note came back with only its first of two
   sentences, still marked `תמלול מלא ✓`. Its retry was complete. Watch for
   it — with no live text the 70% safety net had nothing to compare against.
3. **64 kbps** (was 32), matching Voice Memos. The 4MB upload limit now means
   a full take covers ~8 min; longer falls back to live text. Liraz's notes
   are far shorter, so accepted.
4. **TEMPORARY** `lastSource` message under the mic after each note —
   `תמלול מלא ✓` or `טקסט חי בלבד · …` — to tell whether the final text came
   from the full take or the rough pieces. Remove once quality is settled.
`app.js?v=13`. Test script used: a throwaway Node script in a scratchpad,
not in the repo. Ramble Flow CLI (suggested by Liraz) was checked first: it
just calls Groq Whisper or OpenAI, nothing Hebrew-specific — not useful.

**Update 2026-11-10 (later) — live text removed; voice is now one plain
recording (`app.js?v=15`, `style.css?v=6`).** The `v=14` phone test still
failed: live text came late, and the final note was cut off mid-word
("עדיין לא רואה את ה"). After three rounds of tuning the pieces, Liraz chose
simple over live. **Everything about pieces, the second recorder, the
volume meter, pause detection, `#micPreview`, the level ring and the 70%
safety net is gone** — the earlier updates above describe code that no
longer exists. Now: tap → one `MediaRecorder` → tap again → it keeps
recording **1s more** (`TAIL_MS`, iOS drops the last moment on stop) →
stops → mic released after `onstop` → one upload → text at the caret.
Auto-stop at **8 min** (`MAX_REC_MS`) so the file always fits under 4MB.
`sending` is counted from the tap, so the idle/background commits wait for
the text. Retry on failure kept. Verified in the browser with a fake mic
and faked transcriber (text lands ~1s after stop; failure → retry works).
Phone test of `v=15`: a 20s note came back as its first 4 words. Next
round (`v=16`): `chunking_strategy: "auto"` added in `api/transcribe.js`
(gpt-4o-transcribe is known to stop at the first pause without it), plus a
**TEMPORARY** `lastClip` readout under the mic — seconds · KB · ▶ play — to
tell a cut recording (KB far under ~8KB/s) from a cut transcript. Remove
`lastClip` once confirmed.
**Result on the phone: fixed.** A 25s note (195KB, i.e. complete) came back
whole and accurate. The recording was never the problem — the model was
stopping at the first pause; `chunking_strategy: "auto"` is what fixed it.
Side effect: each chunk arrives on its own line. Liraz is happy with that —
do not join them. She is testing a few more notes; then remove `lastClip`
(it also overlaps the composer's last line, which is fine while temporary).
**2026-11-11 — not fixed after all.** A 51s note (399KB, complete) came
back with a gap marked "..." where speech was skipped, and the fixed prompt
"רשומה ביומן אישי, בעברית, לפעמים עם מילים באנגלית." appeared as a line of
the text. The prompt is now removed entirely (only `language: he` is sent).
If gaps or "..." still appear, switch to ElevenLabs Scribe — Liraz's test
results are in `~/Documents/voice test/results.html` (outside the repo).

## How sync works
Local-first. Every change is written to `localStorage` first, so the app works
with no signal; Supabase is the copy other devices read.

- Each change stamps `updated_at` and adds the id to a pending queue.
- `flush()` upserts the queue; failures stay queued and retry.
- `pull()` runs on sign-in, on returning to the tab, and on coming back online;
  a remote row wins only if its `updated_at` is newer.
- Deletes set `deleted: true` (a tombstone) rather than removing the row, so
  the delete reaches the other device instead of the row reappearing.
- The top bar shows `↑ N` when uploads are queued, `Offline` when there's no
  connection, and nothing at all when everything is synced. Tap it to force one.

## The redesign (2026-09-02)
Source: `~/Downloads/design_handoff_digital_diary/` — a README plus
`design-reference-3g.html`. Values were read out of it and re-expressed here;
the prototype HTML was not ported.

- Hebrew-first, `dir="rtl"`, light only. All tokens are CSS variables at the
  top of `style.css` with the handoff's own token names.
- Writing view shows **today only**; reading view pages **one month at a time**.
- Search lives in the reading header only, and spans **all** months (the
  handoff said "current scope" — deliberately widened, one line to revert).
- New state: `visibleMonth {y, m}`.

### Where the handoff's README and its mock disagreed
The README was followed in all five cases; the mock looks like the older draft.
Worth re-checking with the designer if the look is ever revisited:
- every session time — README `#96684f` terracotta, mock `#8a93a1` slate
- composer live time, caret, mobile live dot — README `#5c6b7d`, mock `#8a93a1`
- mobile writing header — README says time-of-day was dropped, mock still
  shows `ערב`

### Deliberate departures from the spec
- **Fonts.** Space Grotesk has no Hebrew glyphs (latin/latin-ext/vietnamese
  only) and JetBrains Mono has none either — so ~95% of the app would have
  fallen back silently. Assistant leads `--font-ui`, Space Grotesk picks up
  Latin runs. Mono is for LTR times and counts only. Swap the Hebrew face by
  changing `--font-he` alone.
- **Month arrows** padded to ~28px desktop / 44px mobile; drawn at the spec'd
  size, but 12×15px is not a target. Same for the other mobile controls.
- **Below 720px** the entry counts and the clock half of the header stamp are
  hidden — they do not fit beside the buttons.
- **Composer capped at `52dvh`.** The spec says it should never scroll
  internally; unbounded growth eats the page on a phone.
- **UI copy is Hebrew throughout**, including the undesigned parts (menu,
  sign-in), which the handoff did not cover.

## Next
- Voice notes (2026-11-11): prompt removed; test 2-3 notes. Gaps or "..."
  again → ElevenLabs Scribe. Once good, remove
  the temporary `lastClip` readout (`app.js`). If accuracy ever drops,
  ElevenLabs Scribe is the next try (server-only change + a new Vercel
  secret). Do not bring live text back by cutting pieces — that design is
  what broke; if live text is ever wanted, it means streaming (OpenAI
  Realtime), a separate project.
- Voice notes: accuracy accepted as-is on 2026-10-19 — Liraz corrects the
  text by hand. If it ever needs to be better, try ElevenLabs Scribe (reported
  stronger Hebrew, similar price): a server change in `api/transcribe.js` plus
  a new Vercel secret; the app side does not change.
- Phase 4 (optional): passphrase encryption via Web Crypto before upload, so
  the text is unreadable even to Supabase.

## Key decisions and why
- **Email + password login, not the no-auth pattern used in `expenses`.** The
  site is public, so an anon-readable table would mean anyone who viewed the
  page source could read the whole diary. RLS scopes every row to
  `user_id = auth.uid()`, sign-ups are disabled in the Supabase dashboard, and
  only the `authenticated` role is granted table access — never `anon`.
  Verified from outside: an anon read returns `[]`, an anon insert is rejected.
- **`config.js` is committed, unlike in `expenses`.** The publishable key is
  designed to be public in browser apps and grants nothing without a session,
  so there is no secret to hide and therefore no need for Vercel environment
  variables or a build step. Never commit anything from Supabase's "Secret
  keys" section.
- **Password chosen separately from the Supabase database password.** Different
  blast radius.
- **Markdown in a `<textarea>`, not a rich-text editor.** `contenteditable`
  handles mixed RTL/LTR badly (jumping cursor, flipped punctuation) — that is
  exactly the OneNote problem we are replacing. `dir="auto"` per block solves it.
- **No formatting toolbar.** Reviewed a real month of entries: zero bold, zero
  bullets. Markdown is still stored so it can be added later without migration.
- **One record per session, not per day.** A single monthly page is a sync
  disaster; small timestamped records make write conflicts nearly impossible.
- **Automatic timestamps.** She was already typing `אחהצ` / `ערב` by hand.
- **No streaks, no reminders, no "you missed a day."** Deliberate.
- **Empty days are not shown.**
- **No language/direction toggle — documented instead (2026-09-03).** The idea
  was raised only for PR/portfolio value (someone forking the repo), not
  because English is wanted. A visible switcher would add a control to test in
  both directions for no personal benefit, so the README's Design section now
  describes the RTL architecture instead. Verified true before writing it:
  `dir="rtl"` appears once, on `<html>`, and `style.css` has zero physical
  `left`/`right` properties — 19 logical ones. The README also states the
  honest limit, that UI copy is still hardcoded Hebrew (~29 lines across
  `index.html` and `app.js`). If English is ever actually wanted, extracting
  those strings is the work; the layout needs no change.

## Avoid
- **Never log the OpenAI response body or the audio** in `api/transcribe.js`
  — the body echoes the transcript, i.e. diary content, into Vercel's logs.
  Status codes only.
- **Never bound navigation by the clock alone.** Anything that decides which
  months are reachable must be bounded by the *data*, not by `thisMonth()`. A
  cap at today assumes no entry can be stamped later than now, which a fast
  device clock breaks — and the result is silent: the entry exists, search
  finds it, but no arrow leads to it. Both directions are now data-bounded
  (`hasEntriesBefore` / `hasEntriesAfter`), with today kept only as a floor so
  the current month always stays reachable.
- **Never put `dir` and a logical property on the same element.**
  `inset-inline-start`, `margin-inline-*` and `padding-inline-*` resolve against
  the direction of the element they are written on — so `dir="ltr"` on a
  positioned timestamp (to stop `07:14` reversing) silently flips which side
  `inset-inline-start` means, and the element lands hundreds of pixels away with
  no error. Put the LTR isolation on an inner `<bdi>` and leave the positioned
  element in the parent's direction. Three places rely on this: session times,
  the composer's live time, and the header stamp.
- **`min-height` beats `max-height`.** Any element whose max is derived from
  `--app-height` needs its min derived from it too, or the min silently wins
  when the viewport shrinks and the element freezes — no error, no visual clue
  that a cap is involved. This is what broke composer growth once already.
- **Never let an editable field drop below 16px on mobile.** `.composer`,
  `.editor`, `.search` and the sign-in inputs are pinned to 16px in the
  `max-width: 720px` block. Below that, iOS zooms the entire page on focus and
  does not reliably zoom back out — leaving it scaled, clipped at the inline
  edges and able to drift, in *both* modes, until a pinch or a reload. The
  symptom appears far from the cause (clipped text in reading view, hours after
  typing), so this rule is not a style preference. If the type scale is ever
  revisited, the chrome can shrink; the fields cannot.
- **Never let the document itself scroll.** The app is exactly one viewport
  tall and scrolls inside `.stream`, so `html, body { overflow: hidden }` and
  the `position: fixed` body are load-bearing. Note the corollary learned the
  hard way: because the offset iOS applies is *visual viewport pan*, not
  document scroll, `window.scrollTo` cannot correct it — and blocking document
  scroll alone only converts the symptom from "scrolled" to "floating". Any new
  full-height element must scroll internally too.
- **Never apply the viewport height and the pan offset at different times.**
  This is the single rule behind two opposite-looking bugs, and the earlier
  version of this note ("do not track `offsetTop` live") had it wrong — it
  banned the technique instead of the mismatch, which is why the blink took a
  second round to fix. The body's height comes from `visualViewport.height` and
  its position from `visualViewport.offsetTop`; the two are locked together
  (the offset is whatever the shrunken height leaves above the fold), so
  applying one without the other always puts the body somewhere it does not
  fit. Update both from the same reading in the same frame — `trackPan()` — and
  live tracking is not only safe, it is what removes the flicker. Apply the
  offset alone, off the `scroll` event, and the screen floats; apply the height
  alone and the app blinks off screen entirely.
- Do not open `index.html` via `file://` — browsers restrict storage there and
  entries can be lost. Use the Pages URL, or serve the folder over HTTP.
- Never commit exported diary files. `.gitignore` already blocks
  `diary-*.md` and `diary-backup-*.json`.
- No diary content belongs in this repo, ever.
- Local preview: there is a `diary` entry in
  `/Users/axelrad/Documents/projects/.claude/launch.json` (port 4599). The
  root-level launch.json is the one Claude Code reads, not a per-folder one.
