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

## Next
- Phase 3 (optional): passphrase encryption via Web Crypto before upload, so
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

## Avoid
- Do not open `index.html` via `file://` — browsers restrict storage there and
  entries can be lost. Use the Pages URL, or serve the folder over HTTP.
- Never commit exported diary files. `.gitignore` already blocks
  `diary-*.md` and `diary-backup-*.json`.
- No diary content belongs in this repo, ever.
- Local preview: there is a `diary` entry in
  `/Users/axelrad/Documents/projects/.claude/launch.json` (port 4599). The
  root-level launch.json is the one Claude Code reads, not a per-folder one.
