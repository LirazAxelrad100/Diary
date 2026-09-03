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
- Real-phone check of the redesign (keyboard + safe area).
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
- **Do not track `visualViewport.offsetTop` live.** iOS animates the keyboard
  shut over ~250ms and emits intermediate offsets the whole way; applying each
  one moves the page by hand while the browser is already settling it, which
  reads as the screen floating. Correct once after it settles instead — see
  `settleAppViewport()`.
- Do not open `index.html` via `file://` — browsers restrict storage there and
  entries can be lost. Use the Pages URL, or serve the folder over HTTP.
- Never commit exported diary files. `.gitignore` already blocks
  `diary-*.md` and `diary-backup-*.json`.
- No diary content belongs in this repo, ever.
- Local preview: there is a `diary` entry in
  `/Users/axelrad/Documents/projects/.claude/launch.json` (port 4599). The
  root-level launch.json is the one Claude Code reads, not a per-folder one.
