// Vercel serverless function: audio in, text out.
// Runs server-side only, so this is the one place the OpenAI key can live.
// Set OPENAI_API_KEY in Vercel → Settings → Environment Variables.
//
// Only a signed-in diary session may use it — otherwise anyone who found the
// address could spend the key. Sign-ups are disabled in Supabase, so "any
// signed-in user" means the diary's owner.
//
// The audio is passed straight through and never stored or logged here.

// Same public values as config.js (the publishable key is not a secret).
const SUPABASE_URL = "https://adytbgjgsncylyxzonmk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YxNR7MOktLtu4RKu4roxPQ_hsyLXGnq";

const MODEL = process.env.TRANSCRIBE_MODEL || "gpt-4o-transcribe";

// Vercel rejects request bodies over 4.5MB before this code even runs; the
// app cuts recordings into short segments so each one stays well under it.
const MAX_BYTES = 4 * 1024 * 1024;

// OpenAI decides the format from the file name, so it needs the right one.
const EXTENSIONS = { "audio/mp4": "mp4", "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" };

async function signedIn(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: auth }
  });
  return r.ok;
}

// Read the raw upload. req.body is deliberately never touched: Vercel parses
// it lazily, and leaving it alone leaves the stream for us.
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function openaiText(audio, type, ext, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `note.${ext}`);
  form.append("model", MODEL);
  // Mostly Hebrew. Fixing the language stops a short note being misread as
  // another language.
  form.append("language", "he");
  // Without this, gpt-4o-transcribe can stop at the first pause and return
  // only the opening words (a 20s note came back as 4 words, 2026-11-10).
  form.append("chunking_strategy", "auto");
  // No prompt at all. gpt-4o-transcribe copies prompt text into its answer:
  // first the earlier diary text (notes looped), then even the fixed hint
  // "רשומה ביומן אישי…" appeared as a line of a 51s note (2026-11-11).
  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form
    });
    // Status only — the response body can echo the transcript back.
    if (!r.ok) { console.error("OpenAI transcription error", r.status); return null; }
    return ((await r.json()).text || "").trim();
  } catch (err) {
    console.error("OpenAI request failed");
    return null;
  }
}

async function elevenText(audio, type, ext) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `note.${ext}`);
  form.append("model_id", process.env.ELEVENLABS_MODEL || "scribe_v2");
  form.append("language_code", "heb");
  form.append("tag_audio_events", "false");   // no "(music)" markers in the text
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      body: form
    });
    if (!r.ok) { console.error("ElevenLabs transcription error", r.status); return null; }
    return ((await r.json()).text || "").trim();
  } catch (err) {
    console.error("ElevenLabs request failed");
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing OPENAI_API_KEY" });
    return;
  }

  try {
    if (!(await signedIn(req))) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }

    const type = (req.headers["content-type"] || "").split(";")[0].trim();
    const ext = EXTENSIONS[type];
    if (!ext) {
      res.status(415).json({ error: "Unsupported audio type" });
      return;
    }

    const audio = await readBody(req);
    if (!audio) {
      res.status(413).json({ error: "Recording too long" });
      return;
    }
    if (!audio.length) {
      res.status(400).json({ error: "Empty recording" });
      return;
    }

    // TEMPORARY comparison (2026-11-13): every note goes to OpenAI and, when
    // ELEVENLABS_API_KEY is set, to ElevenLabs Scribe at the same time. The
    // app shows both, so Liraz can see which one hears her Hebrew right — and
    // if both fail in the same places, the recording is the problem.
    const [openai, eleven] = await Promise.all([
      openaiText(audio, type, ext, apiKey),
      process.env.ELEVENLABS_API_KEY
        // A failed ElevenLabs call comes back as "" (shown as "—"), not null,
        // so a broken key is visible instead of silently ending the comparison.
        ? elevenText(audio, type, ext).then((t) => t ?? "")
        : Promise.resolve(null)
    ]);
    if (openai === null && !eleven) {
      res.status(502).json({ error: "Transcription service failed" });
      return;
    }
    res.status(200).json({ text: openai || "", alt: eleven });
  } catch (err) {
    console.error("Transcription failed:", err.message);
    res.status(500).json({ error: "Unexpected error" });
  }
};
