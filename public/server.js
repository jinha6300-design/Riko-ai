// RIKO AI backend. The Gemini API key lives ONLY here (environment variable).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_KEY = process.env.GEMINI_API_KEY || "";
const PASSCODE = process.env.APP_PASSCODE || ""; // optional but strongly recommended on a public URL
const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `You are RIKO AI, a friendly, quick and capable voice assistant running on the user's Android phone.
LANGUAGE: If the user speaks or writes Hindi (Devanagari or Hinglish), reply in natural spoken Hindi (Devanagari script). If they use English, reply in English. Match their language every turn.
STYLE: This is a voice conversation. Keep replies short (1-3 sentences), warm and natural. No markdown, no bullet lists, no emojis, no asterisks.
ACTIONS: When the user asks you to open a website, search something, call, message, navigate with maps, type text, copy text, or scroll, call the matching function. You can only act inside this web app and by handing the phone links that the user taps. Never claim you controlled other apps. After calling a function, briefly confirm what you did.
SCREEN: If an image of the user's shared screen/camera is attached, describe or help with what is visible. Never guess about content you cannot see.`;

const tools = [{
  functionDeclarations: [
    { name: "open_website", description: "Open a website URL for the user.",
      parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Full https URL or domain" } }, required: ["url"] } },
    { name: "web_search", description: "Search the web (Google) for a query.",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
    { name: "type_text", description: "Type text into a field inside the RIKO app (notes pad or message box).",
      parameters: { type: "OBJECT", properties: { field: { type: "STRING", description: "notes or message" }, text: { type: "STRING" }, append: { type: "BOOLEAN" } }, required: ["text"] } },
    { name: "copy_text", description: "Copy text to the clipboard.",
      parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
    { name: "open_maps", description: "Open Google Maps for a place or directions.",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
    { name: "call_number", description: "Prepare a phone call to a number.",
      parameters: { type: "OBJECT", properties: { number: { type: "STRING" } }, required: ["number"] } },
    { name: "send_whatsapp", description: "Prepare a WhatsApp message.",
      parameters: { type: "OBJECT", properties: { number: { type: "STRING", description: "digits with country code, optional" }, text: { type: "STRING" } }, required: ["text"] } },
    { name: "scroll_page", description: "Scroll the RIKO page.",
      parameters: { type: "OBJECT", properties: { direction: { type: "STRING", description: "up or down" } }, required: ["direction"] } }
  ]
}];

// --- tiny in-memory rate limit + passcode ---
const hits = new Map();
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function guard(req, res) {
  if (!API_KEY) { send(res, 503, { error: "SERVER_NOT_CONFIGURED", message: "GEMINI_API_KEY is not set on the server." }); return false; }
  if (PASSCODE) {
    const a = Buffer.from(String(req.headers["x-passcode"] || "")), b = Buffer.from(PASSCODE);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { send(res, 401, { error: "BAD_PASSCODE" }); return false; }
  }
  const now = Date.now(), ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 40) { send(res, 429, { error: "RATE_LIMIT" }); return false; }
  arr.push(now); hits.set(ip, arr);
  return true;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > 12e6) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function gemini(model, body) {
  const r = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.error?.message || `Gemini error ${r.status}`);
    e.status = r.status; throw e;
  }
  return data;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const PUB = path.join(__dirname, "public");

async function chat(req, res) {
  try {
    const { history = [], message = "", image } = await readJson(req);
    if (!message && !image) return send(res, 400, { error: "EMPTY" });
    const contents = history.slice(-20).map(h => ({ role: h.role === "model" ? "model" : "user", parts: [{ text: String(h.text || "").slice(0, 4000) }] }));
    const parts = [];
    if (image?.data) parts.push({ inlineData: { mimeType: image.mime || "image/jpeg", data: image.data } });
    parts.push({ text: message || "Describe what you see." });
    contents.push({ role: "user", parts });
    const data = await gemini(CHAT_MODEL, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents, tools,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    });
    const cparts = data?.candidates?.[0]?.content?.parts || [];
    const text = cparts.filter(p => p.text).map(p => p.text).join(" ").trim();
    const actions = cparts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
    send(res, 200, { text, actions });
  } catch (e) {
    send(res, e.status && e.status < 600 ? e.status : 500, { error: "GEMINI_ERROR", message: e.message });
  }
}

// Gemini TTS -> WAV (24kHz 16-bit mono). Good Hindi voice.
async function tts(req, res) {
  try {
    const { text: t } = await readJson(req);
    const text = String(t || "").slice(0, 1200);
    if (!text) return send(res, 400, { error: "EMPTY" });
    const data = await gemini(TTS_MODEL, {
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } } }
    });
    const b64 = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!b64) return send(res, 502, { error: "NO_AUDIO" });
    const pcm = Buffer.from(b64, "base64");
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
    res.writeHead(200, { "Content-Type": "audio/wav" }); res.end(Buffer.concat([h, pcm]));
  } catch (e) { send(res, 500, { error: "TTS_ERROR", message: e.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/api/health")
    return send(res, 200, { ok: true, configured: !!API_KEY, passcodeRequired: !!PASSCODE, model: CHAT_MODEL });
  if (req.method === "POST" && url.pathname === "/api/auth") { if (guard(req, res)) send(res, 200, { ok: true }); return; }
  if (req.method === "POST" && url.pathname === "/api/chat") { if (guard(req, res)) await chat(req, res); return; }
  if (req.method === "POST" && url.pathname === "/api/tts") { if (guard(req, res)) await tts(req, res); return; }
  if (req.method !== "GET") return send(res, 405, { error: "METHOD" });
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(PUB, p);
  if (!file.startsWith(PUB)) return send(res, 403, { error: "FORBIDDEN" });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "NOT_FOUND" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("sw.js") ? "no-cache" : "public, max-age=300" });
    res.end(buf);
  });
});
const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log(`RIKO AI running on :${port} (key ${API_KEY ? "set" : "MISSING"})`));
