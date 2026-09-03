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
- **Read mode** turns the stream into a clean page, one month at a time, with
  each day's sessions hung off a single vertical thread.
- **Instant offline search** across everything you have ever written.
- **Syncs across devices.** Write on the laptop in the morning, read it on the
  phone at night. Works offline and catches up when the signal returns.
- **Export** to plain Markdown, or a JSON backup you can restore.
- **No streaks, no reminders, no "you missed a day."**

## Privacy

Entries live behind an email and password, and every row is scoped to the
account that wrote it by Postgres row level security — a signed-out visitor
reading the database directly gets an empty list, and writing is rejected.
Sign-ups are disabled, so no second account can exist. There are no analytics.
This repository contains only the app's code — no diary content is in it, and
none ever will be.

The Supabase URL and publishable key are committed here deliberately. A
publishable key is meant to be public in browser apps: it identifies the
project but grants nothing without a valid session. The password is what
protects the diary.

## Design

The current look was built from a written design handoff — tokens, type scale,
spacing and copy specified up front, then rebuilt inside this codebase rather
than pasted in from the prototype.

**Hebrew-first, right-to-left.** About 95% of what I write is Hebrew, so the
app is laid out RTL, with clock times isolated back to LTR so `07:14` never
reverses.

Direction is set once, on the `<html>` element. The stylesheet contains no
`left` or `right` properties at all — every rule uses logical properties
(`margin-inline-start`, `inset-inline-end`), so the layout mirrors itself from
that single attribute instead of from a second sheet of RTL overrides. Entry
text is `dir="auto"` per paragraph, so a Hebrew entry with an English sentence
inside it sits correctly without either language being the default.

The interface copy is still Hebrew in the markup. A full English build would
mean extracting those strings; the layout would not need to change.

**The specified typeface had no Hebrew in it.** The handoff called for Space
Grotesk throughout; it ships Latin, Latin-ext and Vietnamese only, so almost
every character in the app would have fallen back to whatever the system
offered. Assistant now carries the Hebrew and Space Grotesk picks up the
English words inside a Hebrew sentence. JetBrains Mono has no Hebrew either,
so it is used strictly for times and counts, never for Hebrew captions.

**Light only.** The design was specified light-only and the dark theme was
dropped with it rather than invented to fill the gap.

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

## How sync works

Local-first. Every keystroke is saved to the browser before anything is sent,
so the app works with no signal and never blocks on the network.

Each change stamps an `updated_at` and joins an upload queue; the queue drains
in the background and retries on failure. Incoming rows only win if they are
newer. Deletes leave a tombstone rather than removing the row, so deleting on
the phone actually deletes on the laptop instead of the entry reappearing on
the next sync.

## Status

Phase 1 — local-only journal. **Done.**
Phase 2 — sync across phone and laptop, behind a login. **Done.**
Phase 3 — visual redesign, Hebrew-first RTL, month-at-a-time reading. **Done.**
Phase 4 — optional passphrase encryption, so the text is unreadable even to
the database. Not started.
