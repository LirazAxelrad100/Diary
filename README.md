# Diary

A private journalling app for people who write in more than one language.

Built because every note-taking tool I tried either handled mixed Hebrew and
English badly, moved my text around while I was writing, or eventually asked
for a subscription.

**[Open it →](https://liraz-diary.vercel.app/)**

## What it does

- **Writes like a stream.** Open it and the cursor is already in the box. No
  "new note" button, no title to invent. Past entries scroll above.
- **Stamps its own times.** Each writing session is saved with the time you
  started it, grouped under the day. Write three times a day and you see three
  times.
- **Handles Hebrew and English properly.** Direction is decided per paragraph,
  so a Hebrew entry with an English word inside it stays where you put it.
- **Saves as you type.** There is deliberately no Save button.
- **Read mode** turns the stream into a clean page, times in the margin.
- **Instant offline search** across everything you have ever written.
- **Export** to plain Markdown, or a JSON backup you can restore.
- **No streaks, no reminders, no "you missed a day."**

## Privacy

Entries are stored in your own browser (`localStorage`) and never leave your
device. There is no server, no account, and no analytics. This repository
contains only the app's code — no diary content is in it, and none ever will be.

## Design decisions

**Markdown instead of a rich-text editor.** Mixing right-to-left and
left-to-right text inside a `contenteditable` box is where most editors break —
jumping cursors, punctuation flipping to the wrong end. A plain `<textarea>`
with `dir="auto"` avoids the problem entirely, and the entries stay readable as
plain text files forever.

**One record per writing session, not per day.** A single long page per month
is pleasant to read but terrible to sync — two devices editing the same page
means one of them loses a paragraph. Small, timestamped records make conflicts
almost impossible. Days are only a display grouping.

**No formatting toolbar.** I reviewed a month of my own real entries: not one
bold word, not one bullet. The toolbar was a habit from other apps, not a need.
Markdown is still stored, so bold and lists can be added later without touching
old entries.

## Running it locally

No build step, no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 4599
```

Then open `http://localhost:4599`. Opening `index.html` directly from Finder
will not work reliably — browsers restrict storage on `file://` addresses.

## Status

Phase 1 — works on one device, stores locally.
Phase 2 — sync across phone and laptop.
Phase 3 — optional passphrase encryption.
