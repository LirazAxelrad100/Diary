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

**Update 2026-09-03 — first real-phone pass done, one bug found and fixed.**
Composer stays above the keyboard (good), but dismissing the keyboard left the
page scrolled, stranding the top bar under the status bar. Cause: `html, body`
had no `overflow` rule, so the document itself could scroll. Fixed by
`overflow: hidden` on `html, body` plus `resetPageScroll()` in `app.js` on
`focusout` and on `visualViewport` resize — two handlers because tapping away
fires `focusout` while the keyboard's Done key closes it without moving focus.
Reading-view margins widened at the same time (`.stream` 20px → 26px, and 16px
→ 22px below 380px); the top bar was deliberately left at its old inset,
because it is a tight four-control row and extra padding there clips the
`קריאה` title. **Re-check on the phone still pending**, along with original
checks 2, 4, 5 and 6 (composer growth, Dynamic Island, home indicator,
landscape). The fix is reasoned, not proven — no simulator here produces a real
iOS keyboard.

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
- **Never let the document itself scroll.** The app is exactly one viewport
  tall and scrolls inside `.stream`; `html, body { overflow: hidden }` is
  load-bearing, not tidiness. Without it iOS scrolls the whole page up to clear
  the keyboard and never scrolls back, so the top bar ends up under the status
  bar — and because the body is `100dvh`, nothing about the layout reveals the
  cause. Any new full-height element must scroll internally too.
- Do not open `index.html` via `file://` — browsers restrict storage there and
  entries can be lost. Use the Pages URL, or serve the folder over HTTP.
- Never commit exported diary files. `.gitignore` already blocks
  `diary-*.md` and `diary-backup-*.json`.
- No diary content belongs in this repo, ever.
- Local preview: there is a `diary` entry in
  `/Users/axelrad/Documents/projects/.claude/launch.json` (port 4599). The
  root-level launch.json is the one Claude Code reads, not a per-folder one.
