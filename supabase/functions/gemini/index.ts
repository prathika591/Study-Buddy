// Study Buddy — server function that talks to the AI.
// 1. Tries Google Gemini first (GEMINI_API_KEY).
// 2. If every Gemini model is busy or out of quota, switches to Groq (GROQ_API_KEY), a free backup:
//    text and chat go to a Llama model, photos to a vision model, recordings are transcribed with Whisper,
//    and PDFs are turned into text first.
// The keys live here as secrets, so they never reach anyone's browser.
// Every request must come from a signed-in user, and each user gets a daily limit (DAILY_LIMIT, default 150).

import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/";
const GROQ_API = "https://api.groq.com/openai/v1";
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"];
const ALLOWED_GEMINI = new Set(GEMINI_MODELS);
const list = (name: string, fallback: string[]) => (Deno.env.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean).concat(fallback);
// Each list is tried in order; a model that's retired or busy is skipped. Override with secrets if Groq renames models.
const GROQ_TEXT = list("GROQ_TEXT_MODELS", ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b", "llama-3.1-8b-instant"]);
const GROQ_VISION = list("GROQ_VISION_MODELS", ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"]);
const GROQ_SEARCH = list("GROQ_SEARCH_MODELS", ["groq/compound-mini", "groq/compound"]);
const GROQ_WHISPER = list("GROQ_WHISPER_MODELS", ["whisper-large-v3-turbo", "whisper-large-v3"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Model, X-Provider",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Part = { text?: string; inline_data?: { mime_type: string; data: string } };
type Content = { role?: string; parts: Part[] };
type Input = { contents: Content[]; system?: string; search?: boolean; json?: boolean; maxTokens?: number; stream?: boolean; model?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GEMINI_KEY && !GROQ_KEY) return json({ error: "server_not_configured", message: "The server has no AI key. Add GEMINI_API_KEY (and GROQ_API_KEY as a backup) in Supabase secrets." }, 500);

  // ---- 1. Who is asking? ----
  let serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serverKey) { try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); serverKey = keys.default ?? Object.values(keys)[0]; } catch { /* handled below */ } }
  if (!serverKey) return json({ error: "server_not_configured", message: "The server can't find its Supabase secret key." }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: "not_signed_in", message: "Please sign in again." }, 401);

  // ---- 2. Daily limit ----
  const limit = Number(Deno.env.get("DAILY_LIMIT") ?? 150);
  const { data: allowed, error: usageError } = await admin.rpc("bump_usage", { p_user: user.id, p_limit: limit });
  if (usageError) return json({ error: "usage_check_failed", message: usageError.message }, 500);
  if (!allowed) return json({ error: "daily_limit", message: `You've used today's ${limit} requests. It resets at midnight.` }, 429);

  let input: Input;
  try { input = await req.json(); } catch { return json({ error: "bad_request", message: "The request wasn't valid JSON." }, 400); }
  if (!Array.isArray(input.contents) || !input.contents.length) return json({ error: "bad_request", message: "Nothing to send." }, 400);

  // ---- 3. Gemini first ----
  let geminiProblem = "no Gemini key";
  if (GEMINI_KEY) {
    const r = await tryGemini(input, GEMINI_KEY);
    if (r.response) return r.response;
    if (r.fatal) return r.fatal;
    geminiProblem = r.problem;
  }

  // ---- 4. Backup: Groq ----
  if (GROQ_KEY) {
    try {
      const r = await tryGroq(input, GROQ_KEY);
      if (r) return r;
    } catch (e) {
      console.error("Groq backup failed:", e);
    }
  }
  return json({
    error: "busy",
    message: GROQ_KEY
      ? "Both Gemini and the backup AI are busy right now. Wait a minute and try again."
      : "All Gemini models are busy right now. Wait a minute and try again. (Adding a free Groq key as a backup avoids this.)",
    detail: geminiProblem,
  }, 503);
});

/* =========================== Gemini =========================== */
async function tryGemini(input: Input, key: string): Promise<{ response?: Response; fatal?: Response; problem: string }> {
  const models = [...new Set([input.model, ...GEMINI_MODELS].filter((m): m is string => !!m && ALLOWED_GEMINI.has(m)))].slice(0, 3);
  let problem = "";
  for (const model of models) {
    let useSearch = !!input.search && !input.json;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body: Record<string, unknown> = { contents: input.contents, generationConfig: { maxOutputTokens: Math.min(Number(input.maxTokens) || 8192, 32000) } };
      // Without Google Search, a current-affairs question gets live headlines fetched by this server instead.
      const news = input.search && !useSearch && !input.json ? await liveNews(input) : null;
      const system = (input.system ?? "") + (news ? news.prompt : "");
      if (system) body.systemInstruction = { parts: [{ text: system.slice(0, 200_000) }] };
      if (useSearch) body.tools = [{ google_search: {} }];
      if (input.json) (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
      const url = GEMINI_API + model + (input.stream ? ":streamGenerateContent?alt=sse" : ":generateContent");
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      } catch (e) { problem = String(e); break; }
      if (res.ok) {
        const headers = { ...cors, "X-Model": model, "X-Provider": "gemini" };
        if (input.stream) {
          // Only commit to this model once real words arrive; an empty or failed stream moves on.
          const stream = await primed(res.body!, news?.sources);
          if (stream) { console.log("answered by", model, news ? "with live headlines" : ""); return { response: new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }), problem }; }
          problem = `${model}: empty stream`; console.warn(problem);
          if (useSearch) { useSearch = false; attempt--; continue; }   // try once more without Google Search
          break;
        }
        const out = await res.json();
        if (hasText(out)) {
          if (news && out.candidates?.[0]) out.candidates[0].groundingMetadata ??= sourcesMeta(news.sources);
          console.log("answered by", model); return { response: json({ ...out, model, provider: "gemini" }, 200, headers), problem };
        }
        problem = `${model}: empty reply (${out?.candidates?.[0]?.finishReason ?? out?.promptFeedback?.blockReason ?? "no text"})`; console.warn(problem);
        if (useSearch) { useSearch = false; attempt--; continue; }
        break;
      }
      const err = await res.json().catch(() => ({}));
      const msg: string = err?.error?.message ?? res.statusText;
      problem = `${model}: ${res.status} ${msg}`;
      if (res.status === 400 && useSearch && /search|tool/i.test(msg)) { useSearch = false; attempt--; continue; }
      if (res.status === 400 && /api key/i.test(msg)) { problem = "Gemini key invalid"; return { problem }; }   // fall back to Groq
      if (res.status === 404) break;                                                     // model retired: next one
      if (res.status === 429 || res.status >= 500) { if (attempt === 0) { await sleep(1200); continue; } break; }
      return { fatal: json({ error: "gemini_error", message: msg }, 400), problem };    // a real problem with the request
    }
  }
  return { problem };
}

/* ============================ Groq ============================ */
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function transcribe(part: { mime_type: string; data: string }, key: string): Promise<string> {
  const ext = ({ "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "audio/aac": "m4a" } as Record<string, string>)[part.mime_type] ?? "mp3";
  for (const model of GROQ_WHISPER) {
    const form = new FormData();
    form.append("file", new Blob([b64ToBytes(part.data)], { type: part.mime_type }), "recording." + ext);
    form.append("model", model);
    form.append("response_format", "text");
    const res = await fetch(GROQ_API + "/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: form });
    if (res.ok) return (await res.text()).trim();
    if (res.status === 404 || res.status === 400) continue;
    if (res.status === 429 || res.status >= 500) { await sleep(1500); continue; }
    throw new Error("Transcription failed: " + res.status + " " + (await res.text()).slice(0, 200));
  }
  throw new Error("No transcription model was available.");
}

async function pdfText(data: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(b64ToBytes(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).trim();
}

async function tryGroq(input: Input, key: string): Promise<Response | null> {
  // Turn Gemini-style parts into Groq (OpenAI-style) messages.
  let hasImage = false, transcript = "";
  const messages: Record<string, unknown>[] = [];
  let system = input.system ?? "";
  const news = input.search && !input.json ? await liveNews(input) : null;
  if (news) system += news.prompt;
  else if (input.search) system += "\n\nIf you can't search the web, say clearly when an answer might be out of date, especially for news, results or prices.";
  if (input.json) system += "\n\nReply with a single JSON object only. If you are asked for a list, put it in the object under the key \"items\".";

  for (const c of input.contents) {
    const content: Record<string, unknown>[] = [];
    for (const p of c.parts) {
      if (p.text) content.push({ type: "text", text: p.text });
      const d = p.inline_data;
      if (!d) continue;
      if (d.mime_type.startsWith("image/")) { hasImage = true; content.push({ type: "image_url", image_url: { url: `data:${d.mime_type};base64,${d.data}` } }); }
      else if (d.mime_type.startsWith("audio/")) {
        const t = await transcribe(d, key);
        transcript += (transcript ? "\n\n" : "") + t;
        content.push({ type: "text", text: "Transcript of the recording:\n" + t.slice(0, 40_000) });
      } else if (d.mime_type === "application/pdf") {
        const t = await pdfText(d.data);
        if (!t) return null;   // a scanned PDF with no text: let the app retry with Gemini later
        content.push({ type: "text", text: "Text of the PDF:\n" + t.slice(0, 40_000) });
      }
    }
    messages.push({ role: c.role === "model" ? "assistant" : "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
  }
  if (transcript && !input.stream) system += "\n\nThe recording's transcript is given to you. Write the study notes, but leave out the Transcript section; it will be added separately.";
  if (system) messages.unshift({ role: "system", content: system });

  const models = hasImage ? GROQ_VISION : [...(input.search && !input.json && !news ? GROQ_SEARCH : []), ...GROQ_TEXT];
  const maxTokens = Math.min(Number(input.maxTokens) || 4096, 8000);

  for (const model of [...new Set(models)]) {
    const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens, temperature: 0.2, stream: !!input.stream };
    if (input.json) body.response_format = { type: "json_object" };
    let res: Response;
    try {
      res = await fetch(GROQ_API + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) });
    } catch { continue; }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error(`Groq ${model}: ${res.status} ${detail}`);
      if (res.status === 401) throw new Error("GROQ_API_KEY is invalid");
      continue;   // retired model, too-large request, rate limit or busy: try the next model
    }
    const headers = { ...cors, "X-Model": model, "X-Provider": "groq" };
    if (input.stream) {
      const stream = await primed(groqToGeminiStream(res.body!), news?.sources);
      if (stream) { console.log("answered by Groq", model); return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }); }
      console.warn(`Groq ${model}: empty stream`); continue;
    }

    const out = await res.json();
    let text: string = out.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) continue;
    if (input.json) text = unwrapJson(text);
    if (transcript) text = text.replace(/\n#{1,3}\s*Transcript[\s\S]*$/i, "").trim() + "\n\n## Transcript\n" + transcript;
    return json({ candidates: [{ content: { parts: [{ text }] }, ...(news ? { groundingMetadata: sourcesMeta(news.sources) } : {}) }], model, provider: "groq" }, 200, headers);
  }
  return null;
}

/* ========================= Live news ========================= */
// Free, no key: Google News RSS. Used only for current-affairs questions when Gemini's own search isn't available.
type Source = { title: string; uri: string };
const NEWSY = /\b(news|headlines?|today|tonight|yesterday|this week|latest|current affairs?|recent|recently|breaking|score|scores|match|won|wins|winner|result|results|election|elections|weather|price|prices|stock|sensex|nifty|launch|launched|announced|update|updates|happening|happened|trending)\b|\b20[2-9]\d\b/i;
const newsCache = new WeakMap<Input, Promise<{ prompt: string; sources: Source[] } | null>>();
// Live lookups for answers without Google Search: news headlines and Wikipedia facts, run together.
function liveNews(input: Input) {
  if (!newsCache.has(input)) newsCache.set(input, (async () => {
    const [news, wiki] = await Promise.all([
      fetchNews(input).catch((e) => { console.warn("news lookup failed:", e); return null; }),
      fetchWiki(input).catch((e) => { console.warn("wikipedia lookup failed:", e); return null; }),
    ]);
    if (!news && !wiki) return null;
    return { prompt: (news?.prompt ?? "") + (wiki?.prompt ?? ""), sources: [...(news?.sources ?? []), ...(wiki?.sources ?? [])].slice(0, 6) };
  })());
  return newsCache.get(input)!;
}
const lastQuestion = (input: Input) => [...input.contents].reverse().find((c) => c.role !== "model")?.parts.map((p) => p.text ?? "").join(" ").trim() ?? "";

/* Free, no key: Wikipedia. Used for factual questions (people, places, events, definitions) so the answer is checked
   against a real source instead of the model's memory. */
const FACTUAL = /\b(who|whom|whose|when|where|which|what is|what are|what was|what were|what's|define|definition|meaning of|tell me about|history of|founded|invented|discovered|born|died|capital of|president|prime minister|ceo|author of|written by|population|located)\b/i;
async function fetchWiki(input: Input) {
  const q = lastQuestion(input);
  if (!q || !FACTUAL.test(q) || q.length > 300) return null;
  const terms = q.replace(/\b(who|whom|whose|what|when|where|which|why|how|is|are|was|were|the|a|an|tell|me|about|please|can|you|do|does|did|define|definition|meaning|of|explain)\b/gi, " ").replace(/[^\p{L}\p{N}\s.-]/gu, " ").replace(/\s+/g, " ").trim();
  if (terms.length < 2) return null;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  const headers = { "User-Agent": "StudyBuddy/1.0 (student study app)" };
  try {
    const search = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(terms)}&limit=3`, { signal: ctrl.signal, headers });
    if (!search.ok) throw new Error("Wikipedia " + search.status);
    const pages: { key: string; title: string }[] = (await search.json()).pages ?? [];
    const summaries = await Promise.all(pages.slice(0, 3).map(async (p) => {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key)}`, { signal: ctrl.signal, headers });
      if (!r.ok) return null;
      const d = await r.json();
      if (d.type === "disambiguation" || !d.extract) return null;
      return { title: d.title as string, text: String(d.extract).slice(0, 1500), uri: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${p.key}` };
    }));
    const found = summaries.filter((x): x is { title: string; text: string; uri: string } => !!x);
    if (!found.length) return { prompt: "\n\nA Wikipedia search found nothing for this question. If it is about a specific person, place or event you don't have reliable facts about, say you don't have information on it instead of guessing.", sources: [] };
    return {
      prompt: "\n\nReference entries fetched from Wikipedia just now. Only use an entry if it is clearly about the same subject the student asked about (a different person with a similar name doesn't count). If none of them match and you don't have reliable facts, say you don't have information on it. Don't add details that aren't supported.\n" +
        found.map((f, i) => `[${i + 1}] ${f.title}: ${f.text}`).join("\n"),
      sources: found.map((f) => ({ title: "Wikipedia: " + f.title, uri: f.uri })),
    };
  } finally { clearTimeout(timer); }
}
const unxml = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
async function fetchNews(input: Input) {
  const question = lastQuestion(input);
  if (!question || !NEWSY.test(question)) return null;
  const generic = /\b(top|today'?s|latest|main|major|breaking)\b.*\b(news|headlines?)\b|\bcurrent affairs?\b/i.test(question) && question.split(/\s+/).length <= 12;
  const india = /\bindia|indian\b/i.test(question) || !/\b(world|global|international|usa|america|uk|britain|china)\b/i.test(question);
  const terms = question.replace(/\b(what|what's|whats|are|is|the|today'?s|today|tell|me|about|latest|news|headlines?|please|give|show|top|in|on|of|any|can|you)\b/gi, " ").replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  const base = "https://news.google.com/rss";
  const locale = india ? "hl=en-IN&gl=IN&ceid=IN:en" : "hl=en-US&gl=US&ceid=US:en";
  const url = generic || terms.length < 3 ? `${base}?${locale}` : `${base}/search?q=${encodeURIComponent(terms + " when:7d")}&${locale}`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 7000);
  const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 StudyBuddy" } }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error("Google News " + res.status);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map((m) => {
    const get = (tag: string) => unxml(m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
    return { title: get("title"), link: get("link"), date: get("pubDate"), source: get("source") };
  }).filter((i) => i.title && i.link);
  if (!items.length) return null;
  const now = new Date().toUTCString();
  const lines = items.map((i, n) => `${n + 1}. ${i.title}${i.date ? ` (${i.date})` : ""}`).join("\n");
  return {
    prompt: `\n\nLive headlines fetched from Google News just now (${now}). Answer the question using these. Mention each story's source name, give the date, and don't add facts that aren't in the headlines. If the headlines don't answer the question, say so.\n${lines}`,
    sources: items.slice(0, 5).map((i) => ({ title: i.source || i.title.split(" - ").pop() || "Google News", uri: i.link })),
  };
}
const sourcesMeta = (sources: Source[]) => ({ groundingChunks: sources.map((s) => ({ web: s })) });

/* ======================= Stream helpers ======================= */
// True when a Gemini-format reply contains real answer text (not just "thinking" parts).
function hasText(out: unknown): boolean {
  const parts = (out as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts.some((p) => !p.thought && !!p.text?.trim());
}
// Reads a Gemini-format event stream until the first real text arrives, then hands back a stream that replays
// what was read and continues with the rest. Returns null if the stream ends or errors before any text.
async function primed(body: ReadableStream<Uint8Array>, sources?: Source[]): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader(), dec = new TextDecoder(), seen: Uint8Array[] = [];
  let buf = "", found = false;
  const deadline = Date.now() + 45_000;
  try {
    while (!found && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      seen.push(value);
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n")) > -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.error) { reader.cancel().catch(() => {}); return null; }
          if (hasText(ev)) found = true;
        } catch { /* partial or non-JSON line */ }
      }
    }
  } catch { return null; }
  if (!found) { reader.cancel().catch(() => {}); return null; }
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      if (sources?.length) ctrl.enqueue(new TextEncoder().encode("data: " + JSON.stringify({ candidates: [{ groundingMetadata: sourcesMeta(sources) }] }) + "\n\n"));
      for (const c of seen) ctrl.enqueue(c);
    },
    async pull(ctrl) {
      try { const { value, done } = await reader.read(); if (done) ctrl.close(); else ctrl.enqueue(value); }
      catch { ctrl.close(); }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
}

// The app expects lists for flashcards and quizzes; Groq's JSON mode wraps them in an object.
function unwrapJson(text: string): string {
  try {
    const v = JSON.parse(text);
    if (v && !Array.isArray(v) && typeof v === "object") {
      if (v.subjects || v.classes) return text;               // timetable import keeps its object
      const arr = v.items ?? v.flashcards ?? v.questions ?? v.quiz ?? Object.values(v).find(Array.isArray);
      if (Array.isArray(arr)) return JSON.stringify(arr);
    }
  } catch { /* leave as is */ }
  return text;
}

// Re-shape Groq's streamed chunks into the Gemini format the app already understands.
function groqToGeminiStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) > -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const t = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (t) ctrl.enqueue(enc.encode("data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + "\n\n"));
        } catch { /* skip partial lines */ }
      }
    },
  }));
}
