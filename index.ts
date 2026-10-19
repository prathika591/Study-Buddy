// Study Buddy — server function that talks to Gemini.
// The Gemini key lives here as a secret (GEMINI_API_KEY), so it never reaches anyone's browser.
// Every request must come from a signed-in user, and each user gets a daily limit (DAILY_LIMIT, default 150).

import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"];
const ALLOWED_MODELS = new Set(DEFAULT_MODELS);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_KEY) return json({ error: "server_not_configured", message: "The GEMINI_API_KEY secret isn't set on the server." }, 500);

  // 1. Who is asking?
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: "not_signed_in", message: "Please sign in again." }, 401);

  // 2. Daily limit
  const limit = Number(Deno.env.get("DAILY_LIMIT") ?? 150);
  const { data: allowed, error: usageError } = await admin.rpc("bump_usage", { p_user: user.id, p_limit: limit });
  if (usageError) return json({ error: "usage_check_failed", message: usageError.message }, 500);
  if (!allowed) return json({ error: "daily_limit", message: `You've used today's ${limit} requests. It resets at midnight.` }, 429);

  // 3. Build the Gemini request
  let input: {
    contents: unknown[]; system?: string; search?: boolean; json?: boolean;
    maxTokens?: number; stream?: boolean; model?: string;
  };
  try { input = await req.json(); } catch { return json({ error: "bad_request", message: "The request wasn't valid JSON." }, 400); }
  if (!Array.isArray(input.contents) || !input.contents.length) return json({ error: "bad_request", message: "Nothing to send." }, 400);

  const models = [...new Set([input.model, ...DEFAULT_MODELS].filter((m): m is string => !!m && ALLOWED_MODELS.has(m)))];
  let last = "";

  for (const model of models) {
    let useSearch = !!input.search && !input.json;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body: Record<string, unknown> = { contents: input.contents, generationConfig: {} };
      if (input.system) body.systemInstruction = { parts: [{ text: String(input.system).slice(0, 200_000) }] };
      if (useSearch) body.tools = [{ google_search: {} }];
      const gc = body.generationConfig as Record<string, unknown>;
      gc.maxOutputTokens = Math.min(Number(input.maxTokens) || 8192, 32000);
      if (input.json) gc.responseMimeType = "application/json";

      const endpoint = API + model + (input.stream ? ":streamGenerateContent?alt=sse" : ":generateContent");
      let res: Response;
      try {
        res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY }, body: JSON.stringify(body) });
      } catch (e) { last = String(e); await sleep(1000); continue; }

      if (res.ok) {
        if (input.stream) {
          return new Response(res.body, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Model": model } });
        }
        const out = await res.json();
        return json({ ...out, model });
      }

      const err = await res.json().catch(() => ({}));
      const msg: string = err?.error?.message ?? res.statusText;
      last = msg;
      if (res.status === 400 && useSearch && /search|tool/i.test(msg)) { useSearch = false; attempt--; continue; }
      if (res.status === 400 && /api key/i.test(msg)) return json({ error: "server_key_invalid", message: "The server's Gemini key isn't valid. The app owner needs to update it." }, 500);
      if (res.status === 404) break;                                   // model not available: try the next one
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
      return json({ error: "gemini_error", message: msg }, 400);
    }
  }
  return json({ error: "busy", message: "All Gemini models are busy right now. Wait a minute and try again.", detail: last }, 503);
});
