// Vercel serverless function: audio in, text out.
// Runs server-side only, so this is the one place the ElevenLabs key can live.
// Set ELEVENLABS_API_KEY in Vercel → Settings → Environment Variables.
//
// Only a signed-in diary session may use it — otherwise anyone who found the
// address could spend the key. Sign-ups are disabled in Supabase, so "any
// signed-in user" means the diary's owner.
//
// The audio is passed straight through and never stored or logged here.
//
// Why ElevenLabs Scribe (2026-11-13): OpenAI gpt-4o-transcribe was tried for a
// month and kept skipping speech, inventing lines (even Irish) and getting
// Hebrew gender wrong. A side-by-side test on the same recordings had Scribe
// complete and correct where OpenAI failed — so the recording was fine and
// the model was the problem.

// Same public values as config.js (the publishable key is not a secret).
const SUPABASE_URL = "https://adytbgjgsncylyxzonmk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YxNR7MOktLtu4RKu4roxPQ_hsyLXGnq";

const MODEL = process.env.ELEVENLABS_MODEL || "scribe_v2";

// Vercel rejects request bodies over 4.5MB before this code even runs; the
// app sends long notes as several WAV pieces so each one stays under it.
const MAX_BYTES = 4 * 1024 * 1024;

// The file name tells the service the format.
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

async function transcribe(audio, type, ext, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `note.${ext}`);
  form.append("model_id", MODEL);
  form.append("language_code", "heb");
  form.append("tag_audio_events", "false");   // no "(music)" markers in the text
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form
  });
  // Status only — the response body is the transcript, i.e. diary content.
  if (!r.ok) { console.error("ElevenLabs transcription error", r.status); return { failed: r.status }; }
  return { text: ((await r.json()).text || "").trim() };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ELEVENLABS_API_KEY" });
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

    const out = await transcribe(audio, type, ext, apiKey);
    if (out.failed) {
      // ElevenLabs' status code only (e.g. 401 bad key, 429 quota), never its
      // body, so the app can show why without digging in Vercel's logs.
      res.status(502).json({ error: "Transcription service failed", upstream: out.failed });
      return;
    }
    res.status(200).json({ text: out.text });
  } catch (err) {
    console.error("Transcription failed:", err.message);
    res.status(500).json({ error: "Unexpected error" });
  }
};
