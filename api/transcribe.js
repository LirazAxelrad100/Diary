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

    const form = new FormData();
    form.append("file", new Blob([audio], { type }), `note.${ext}`);
    form.append("model", MODEL);
    // Mostly Hebrew. Fixing the language stops a short note being misread as
    // another language; the prompt tells it English words are expected too.
    form.append("language", "he");
    // The app sends the end of the entry so far, so a short piece continues
    // it (names, punctuation) instead of starting cold.
    let context = "";
    try { context = decodeURIComponent(req.headers["x-context"] || "").slice(-300); } catch {}
    form.append("prompt", `רשומה ביומן אישי, בעברית, לפעמים עם מילים באנגלית. ${context}`.trim());

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!response.ok) {
      // Status only — the response body can echo the transcript back.
      console.error("OpenAI transcription error", response.status);
      res.status(502).json({ error: "Transcription service failed" });
      return;
    }

    const data = await response.json();
    res.status(200).json({ text: (data.text || "").trim() });
  } catch (err) {
    console.error("Transcription failed:", err.message);
    res.status(500).json({ error: "Unexpected error" });
  }
};
