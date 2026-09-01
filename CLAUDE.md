# Diary — working notes

## What it is
A private, local-first journalling web app for mixed Hebrew/English writing.
Plain HTML/CSS/JS, no build step, no dependencies, no server.

Live: https://lirazaxelrad100.github.io/Diary/
Repo: https://github.com/LirazAxelrad100/Diary (note the capital D — Pages URLs
are case-sensitive even though repo URLs are not)

## Status — 2026-09-01
Phase 1 done and deployed. Liraz is using it daily before we add sync.

- `index.html` / `style.css` / `app.js` — the whole app
- Storage: `localStorage`, key `diary.entries.v1`
- Data model: one record per **writing session** — `{ id, ts, text }`.
  Days are only a display grouping.

Working: autosave with "Saved HH:MM" confirmation, automatic timestamps,
session commit (Esc / page hidden / 5 min idle), edit + delete past entries,
Read mode, offline search with highlighting, export `.md`, backup/restore JSON,
light + dark, mobile layout.

## Next
- Phase 2: sync across laptop and phone. Planned approach: Supabase free tier,
  one table, one user. Export button already exists as anti-lock-in insurance.
- Phase 3 (optional): passphrase encryption via Web Crypto before upload.

## Key decisions and why
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
