"use strict";
/* Study Buddy
   Frontend: plain JavaScript, no build step.
   Backend: Supabase (sign-in, Postgres database with Row Level Security) and an Edge Function that holds the Gemini key.
   Files waiting to be turned into notes are kept in this browser (IndexedDB) until Gemini finishes, so a busy server never loses a recording. */

/* =====================================================================
   1. Helpers
   ===================================================================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const COLORS = ["#6C4CF1", "#FF5A6E", "#14A37F", "#FF9F43", "#2BA8D9", "#D9529F", "#0E9F9A", "#C9A227", "#7A5CFA", "#E4572E"];
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const fmtTime = t => { const m = toMin(t), h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${(h % 12) || 12}:${mm} ${h < 12 ? "am" : "pm"}`; };
const fmtDate = iso => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const fmtDateTime = iso => fmtDate(iso) + ", " + new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const addMin = (t, m) => { const x = toMin(t) + m; return String(Math.floor(x / 60) % 24).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); };
const initial = s => (String(s || "?").trim()[0] || "?").toUpperCase();
const shareCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
class FriendlyError extends Error {}

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy on this device"); } }

const ICONS = {
  recording: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  text: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  chats: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  cards: '<rect x="2" y="6" width="15" height="14" rx="2"/><path d="M7 2h13a2 2 0 0 1 2 2v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'
};
/* Animated logo: the Study Buddy compass. Moods: "float" (gentle sway), "thinking" (slow spin), "done". */
const COMPASS = (() => {
  const c = 50, tri = pts => pts.map(p => p.join(",")).join(" ");
  const main = [[0, -44], [44, 0], [0, 44], [-44, 0]];
  let shapes = "";
  for (const a of [45, 135, 225, 315]) {
    const r = a * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), px = dy, py = -dx;
    const tip = [c + dx * 27, c + dy * 27], b1 = [c + dx * 5 + px * 4, c + dy * 5 + py * 4], b2 = [c + dx * 5 - px * 4, c + dy * 5 - py * 4];
    shapes += `<polygon points="${tri([tip, b1, [c, c]])}" fill="currentColor"/><polygon points="${tri([tip, b2, [c, c]])}" fill="currentColor" opacity=".55"/>`;
  }
  for (const [x, y] of main) {
    const len = Math.hypot(x, y), dx = x / len, dy = y / len, px = -dy, py = dx;
    const tip = [c + x, c + y], s1 = [c + dx * 6 + px * 5.5, c + dy * 6 + py * 5.5], s2 = [c + dx * 6 - px * 5.5, c + dy * 6 - py * 5.5];
    shapes += `<polygon points="${tri([tip, s1, [c, c]])}" fill="currentColor"/><polygon points="${tri([tip, s2, [c, c]])}" fill="currentColor" opacity=".55"/>`;
  }
  return `<circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" stroke-width="3.6"/><g class="cp-star">${shapes}</g>`;
})();
function mark(mood = "") {
  return `<svg class="mark ${mood}" viewBox="0 0 100 100" aria-hidden="true">${COMPASS}</svg>`;
}
/* A short, tasteful confetti burst for real achievements (respects reduced motion). */
function confetti(count = 70) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div"); box.className = "confetti"; document.body.append(box);
  const colors = ["#6C4CF1", "#FF8FD8", "#FFC93C", "#4CC9F0", "#2EC4A6", "#FF5A6E"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw"; p.style.background = colors[i % colors.length];
    if (i % 3 === 0) { p.style.width = p.style.height = "8px"; p.style.borderRadius = "50%"; }
    box.append(p);
    p.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${(Math.random() - .5) * 200}px, ${innerHeight * (.7 + Math.random() * .4)}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
      { duration: 1600 + Math.random() * 1400, delay: Math.random() * 250, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" });
  }
  setTimeout(() => box.remove(), 3400);
}
const words = text => text.split(" ").map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ");
const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const svg = (name, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] || ""}</svg>`;

/* Markdown — the text is escaped first, so nothing from Gemini or a note can inject HTML. */
function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<mark>$1</mark>")
       .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
       .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + codes[i] + "</code>");
}
/* ---------- Maths: LaTeX like \frac{a}{b} becomes real formulas with KaTeX (loaded the first time it's needed) ---------- */
const MATH_DISPLAY = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
const MATH_INLINE = /\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s\d])([^$\n]+?)(?<!\s)\$(?!\d)/g;
const looksMathy = t => /[\\^_{}=<>+\-*/]|^[a-zA-Z]$/.test(t);
function extractMath(part, store) {
  return part
    .replace(MATH_DISPLAY, (_, a, b) => { store.push({ tex: (a ?? b).trim(), display: true }); return `\n\u0001${store.length - 1}\u0001\n`; })
    .replace(MATH_INLINE, (all, a, b) => { const tex = (a ?? b).trim(); if (b != null && !looksMathy(tex)) return all; store.push({ tex, display: false }); return `\u0001${store.length - 1}\u0001`; });
}
let katexState = "";
function loadKatex() {
  if (katexState) return;
  katexState = "loading";
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
  document.head.append(css);
  const js = document.createElement("script");
  js.src = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
  js.onload = () => { katexState = "ready"; if (typeof rerender === "function" && !state.busy) rerender(); };
  js.onerror = () => { katexState = "failed"; };
  document.head.append(js);
}
function renderMath({ tex, display }) {
  if (window.katex) {
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" }); } catch {}
  } else loadKatex();
  // Until KaTeX loads (or if it can't), show a readable version instead of raw code.
  return `<span class="math-plain${display ? " block" : ""}">${esc(texToText(tex))}</span>`;
}
/* Readable plain-text maths, used in PDFs and as a fallback: \frac{a}{b} → (a)/(b), \times → ×, x^{2} → x² */
function texToText(tex) {
  const sym = { times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", iff: "⇔", sum: "Σ", prod: "Π", int: "∫", partial: "∂", nabla: "∇", Delta: "Δ", delta: "δ", alpha: "α", beta: "β", gamma: "γ", Gamma: "Γ", epsilon: "ε", varepsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", Sigma: "Σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω", Omega: "Ω", eta: "η", degree: "°", circ: "°", ldots: "…", cdots: "…", dots: "…", in: "∈", forall: "∀", exists: "∃", cup: "∪", cap: "∩", subset: "⊂", angle: "∠", perp: "⊥", parallel: "∥", log: "log", ln: "ln", sin: "sin", cos: "cos", tan: "tan", lim: "lim", max: "max", min: "min" };
  const sup = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "n": "ⁿ" };
  let t = String(tex);
  t = t.replace(/\\(left|right|displaystyle|textstyle|big|Big|bigg|Bigg)\b/g, "").replace(/\\[,;:! ]|\\q?quad\b/g, " ");
  for (let k = 0; k < 6; k++) t = t.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf)\{([^{}]*)\}/g, "$1");
  for (let k = 0; k < 6; k++) {
    const before = t;
    t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${/^[\w.]+$/.test(a.trim()) ? a.trim() : "(" + a.trim() + ")"} / ${/^[\w.]+$/.test(b.trim()) ? b.trim() : "(" + b.trim() + ")"}`)
         .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
    if (t === before) break;
  }
  t = t.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_, a, b) => { const v = a ?? b; return [...v].every(c => sup[c]) ? [...v].map(c => sup[c]).join("") : "^(" + v + ")"; })
       .replace(/_\{([^{}]*)\}|_(\w)/g, (_, a, b) => "_" + (a ?? b))
       .replace(/\\([A-Za-z]+)/g, (all, w) => sym[w] ?? w)
       .replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  return t;
}

function md(text) {
  let html = "";
  const maths = [];
  String(text || "").split(/```/).forEach((part, i) => {
    if (i % 2) { html += "<pre><code>" + esc(part.replace(/^[^\n]*\n/, "")) + "</code></pre>"; return; }
    part = extractMath(part, maths);
    let list = null, para = [], table = [];
    const flushPara = () => { if (para.length) { html += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
    const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|\s*$/g, "").split("|").map(c => inline(c.trim())));
      html += "<table>" + rows.map((r, n) => "<tr>" + r.map(c => n ? `<td>${c}</td>` : `<th>${c}</th>`).join("") + "</tr>").join("") + "</table>";
      table = [];
    };
    for (const raw of part.split("\n")) {
      const line = raw.replace(/\s+$/, ""); let m;
      if (/^\s*\|.*\|$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^\s*\u0001(\d+)\u0001\s*$/)) && maths[+m[1]]?.display) { flushPara(); html += `<div class="math-block">\u0001${m[1]}\u0001</div>`; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushPara(); flushList(); const h = m[1].length <= 2 ? "h3" : "h4"; html += `<${h}>${inline(m[2])}</${h}>`; continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (list !== "ul") { flushList(); html += "<ul>"; list = "ul"; } html += "<li>" + inline(m[1]) + "</li>"; continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list !== "ol") { flushList(); html += "<ol>"; list = "ol"; } html += "<li>" + inline(m[1]) + "</li>"; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); continue; }
      flushList(); para.push(line);
    }
    flushPara(); flushList(); flushTable();
  });
  return maths.length ? html.replace(/\u0001(\d+)\u0001/g, (_, n) => maths[+n] ? renderMath(maths[+n]) : "") : html;
}

/* =====================================================================
   2. Backend connection and local storage
   ===================================================================== */
const CFG = window.STUDY_BUDDY_CONFIG || {};
const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
}) : null;
const DAILY_LIMIT = Number(CFG.dailyLimit) || 150;

const prefs = {
  get(k, d) { try { const v = localStorage.getItem("sb." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sb." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("sb." + k); } catch {} }
};
/* IndexedDB on this device: "media" holds files waiting for Gemini; the other stores hold notes from the older offline version. */
const LocalDB = {
  db: null,
  open() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open("study-buddy", 1);
      r.onupgradeneeded = () => { for (const s of ["subjects", "slots", "notes", "media"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: "id" }); };
      r.onsuccess = () => ok(this.db = r.result);
      r.onerror = () => fail(r.error);
    });
  },
  run(store, mode, fn) {
    if (!this.db) return Promise.reject(new Error("Local storage unavailable"));
    return new Promise((ok, fail) => {
      const t = this.db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => ok(req && req.result); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error);
    });
  },
  all(s) { return this.run(s, "readonly", o => o.getAll()); },
  get(s, id) { return this.run(s, "readonly", o => o.get(id)); },
  put(s, v) { return this.run(s, "readwrite", o => o.put(v)); },
  del(s, id) { return this.run(s, "readwrite", o => o.delete(id)); },
  clear(s) { return this.run(s, "readwrite", o => o.clear()); }
};

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new FriendlyError(/fetch|network/i.test(error.message) ? "You're offline. Check your connection and try again." : error.message);
  return data;
}
const api = {
  all: (t, order = "created_at", ascending = true) => q(sb.from(t).select("*").order(order, { ascending })),
  insert: (t, row) => q(sb.from(t).insert(row).select().single()),
  insertMany: (t, rows) => rows.length ? q(sb.from(t).insert(rows).select()) : Promise.resolve([]),
  update: (t, id, patch) => q(sb.from(t).update(patch).eq("id", id)),
  remove: (t, id) => q(sb.from(t).delete().eq("id", id))
};
const saveFail = e => toast(e instanceof FriendlyError ? e.message : "Couldn't save. Check your connection.");

const state = {
  user: null,
  model: prefs.get("model", "gemini-3.5-flash-lite"),
  theme: prefs.get("theme", ""),
  chats: [], chatId: null, messages: [],
  pinned: null, busy: false, abort: null, loaded: false
};
const data = { subjects: [], slots: [], notes: [] };
const ui = { noteTab: {}, edit: null, day: new Date().getDay(), searchQ: "", fc: null, qz: null, generating: {}, legacy: null };

const noteById = id => data.notes.find(n => n.id === id);
const subjectById = id => data.subjects.find(s => s.id === id);
const subjectName = id => subjectById(id)?.name || "Unsorted";
const subjectColor = id => subjectById(id)?.color || "var(--muted)";
const sortedNotes = list => list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
async function patchNote(n, patch) { Object.assign(n, patch); try { await api.update("notes", n.id, patch); } catch (e) { saveFail(e); } }

function slotAt(date = new Date()) {
  const day = date.getDay(), m = date.getHours() * 60 + date.getMinutes();
  return data.slots.filter(s => s.day === day && toMin(s.start_time) - 10 <= m && m <= toMin(s.end_time) + 10 && subjectById(s.subject_id))
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time))[0] || null;
}
const subjectAt = date => slotAt(date)?.subject_id || "";
function nextSlotToday(date = new Date()) {
  const m = date.getHours() * 60 + date.getMinutes();
  return data.slots.filter(s => s.day === date.getDay() && toMin(s.start_time) > m && subjectById(s.subject_id)).sort((a, b) => toMin(a.start_time) - toMin(b.start_time))[0] || null;
}
function subjectOptions(selected) {
  return `<option value="">Unsorted</option>` + data.subjects.map(s => `<option value="${esc(s.id)}"${s.id === selected ? " selected" : ""}>${esc(s.name)}${s.code ? " (" + esc(s.code) + ")" : ""}</option>`).join("");
}

/* =====================================================================
   3. Talking to Gemini through the server function
   ===================================================================== */
const MAX_UPLOAD = 14 * 1024 * 1024;
const SYSTEM = `You are Study Buddy, a helpful, knowledgeable general-purpose AI assistant, like ChatGPT, Claude or Perplexity. The person using you is a college student in India, but they can ask about anything: general knowledge, everyday questions, advice, writing, maths, coding, health, money, current events, or their studies.
- Answer the question directly first, then add only the detail that helps. Match the length to the question: a short question gets a short answer.
- Don't assume a question is about studying or computer science. Don't turn answers into lessons, coding projects, exercises or study plans unless asked. Give examples only when they make the answer clearer.
- For anything recent or anything that may have changed (news, prices, results, people's current roles, dates), use Google Search and say when the information is from. Base factual answers on reliable sources; the app shows the sources under your answer.
- Never invent facts, quotes, numbers, links or sources. If you don't know or can't verify something, say so plainly instead of guessing.
- Questions about a person: answer only with well-established facts about public figures. If the name isn't someone you have reliable information about, say you don't have information about them and ask who they are or what they'd like to know. Never make up a biography, works, achievements or projects for a person, and don't speculate about private individuals.
- Reply in the same language the person writes in.
- Use Markdown: short paragraphs, bullet lists when they help, and **bold** only for the few most important terms.
- For code, use fenced code blocks. Write maths in LaTeX: $...$ inside a sentence and $$...$$ on its own line.
- This app can turn any answer into a PDF file. When asked for a PDF, document, handout or notes to download, write the complete content yourself here in Markdown, starting with a # title. Never tell them to use another website or tool to make it; the app adds a Download PDF button under your answer.`;

async function callAI({ contents, system = SYSTEM, search = false, json = false, maxTokens, stream = false, onDelta, signal }) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new FriendlyError("You've been signed out. Sign in again to continue.");
  let res;
  try {
    res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/gemini", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: CFG.supabaseAnonKey },
      body: JSON.stringify({ contents, system, search, json, maxTokens, stream, model: state.model })
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    const fe = new FriendlyError("Couldn't reach the server. Check your internet connection and try again.");
    fe.busy = true; throw fe;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) throw new FriendlyError("The **gemini** server function isn't set up yet. Follow step 4 in SETUP.md.");
    if (res.status === 401) throw new FriendlyError(err.message || "Please sign in again.");
    const fe = new FriendlyError(err.message || "The server had a problem (" + res.status + "). Try again in a minute.");
    fe.busy = res.status === 503 || res.status >= 500 || (res.status === 429 && err.error !== "daily_limit");
    throw fe;
  }
  const backup = res.headers.get("X-Provider") === "groq";
  if (!stream) {
    const out = await res.json();
    const cand = out.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => p.text || "").join("").trim();
    if (!text) throw new FriendlyError(cand?.finishReason === "SAFETY" ? "Gemini declined to answer that." : "Gemini sent an empty reply. Try again.");
    return { text, backup, sources: (cand.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(w => w?.uri).slice(0, 5) };
  }
  // Streamed answer (server-sent events): show it word by word as it arrives.
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", sources = [];
  const handle = block => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const c = JSON.parse(payload).candidates?.[0];
        const t = (c?.content?.parts || []).map(p => p.text || "").join("");
        if (t) { text += t; onDelta?.(text); }
        const g = c?.groundingMetadata?.groundingChunks;
        if (g) sources = g.map(x => x.web).filter(w => w?.uri).slice(0, 5);
      } catch {}
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) > -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) handle(buf);
  } catch (e) {
    if (e.name === "AbortError") return { text, sources, backup, stopped: true };
    if (!text) throw new FriendlyError("The connection dropped. Try again.");
  }
  if (!text.trim()) {
    // Rare, but some answers arrive empty when streamed; ask once more the ordinary way.
    const again = await callAI({ contents, system, search, json, maxTokens, stream: false, signal });
    onDelta?.(again.text);
    return again;
  }
  return { text, sources, backup };
}
function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a > -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw new FriendlyError("Gemini's reply wasn't in the expected format. Try again.");
}
const blobToBase64 = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = fail; r.readAsDataURL(blob); });
const blobToDataURL = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });

/* =====================================================================
   4. Searching notes (Search tab, and context for chat questions)
   ===================================================================== */
const STOP = new Set("the a an and or of to in on at for with from about what when where which who whom why how did does do is are was were be been sir mam madam teacher said say says tell me my our we you i it this that these those any some class classes lecture notes note please can could would should give show find learn learnt learned taught".split(" "));
function dateRange(q) {
  const now = new Date(), day = 864e5, start = d => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
  if (/\btoday\b/.test(q)) return [start(now), now];
  if (/\byesterday\b/.test(q)) { const s = new Date(start(now) - day); return [s, new Date(+s + day - 1)]; }
  if (/\blast week\b|\bpast week\b/.test(q)) return [new Date(+start(now) - 7 * day), now];
  if (/\bthis week\b/.test(q)) { const s = start(now); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return [s, now]; }
  for (let i = 0; i < 7; i++) {
    if (new RegExp("\\b" + DAYS[i].toLowerCase() + "\\b").test(q)) {
      const s = start(now); s.setDate(s.getDate() - ((s.getDay() - i + 7) % 7));
      return [s, new Date(+s + day - 1)];
    }
  }
  return null;
}
function parseQuery(raw) {
  const q = raw.toLowerCase();
  const subjectIds = data.subjects.filter(s => {
    const name = s.name.toLowerCase(), code = (s.code || "").toLowerCase(), first = name.split(/\s+/)[0];
    return q.includes(name) || (code && q.includes(code)) || (first.length >= 4 && q.includes(first));
  }).map(s => s.id);
  const dayWords = new Set([...DAYS.map(d => d.toLowerCase()), "today", "yesterday", "week", "last", "past", "this", "latest", "recent", "previous"]);
  const subjWords = new Set(data.subjects.flatMap(s => (s.name + " " + (s.code || "")).toLowerCase().split(/\s+/)));
  const terms = [...new Set(q.split(/[^a-z0-9']+/).map(w => w.replace(/'s$/, "").replace(/'/g, "")).filter(w => w.length >= 3 && !STOP.has(w) && !dayWords.has(w) && !subjWords.has(w)))];
  return { terms, range: dateRange(q), subjectIds };
}
function countIn(text, term) {
  if (!text) return 0;
  const m = text.toLowerCase().match(new RegExp(reEsc(term.replace(/s$/, "")), "g"));
  return Math.min(5, m ? m.length : 0);
}
function searchNotes(raw, { limit = 30 } = {}) {
  const { terms, range, subjectIds } = parseQuery(raw), out = [];
  if (!terms.length && !range && !subjectIds.length) return out;
  for (const n of data.notes) {
    if (n.status !== "ready") continue;
    const at = new Date(n.created_at);
    if (range && (at < range[0] || at > range[1])) continue;
    const inSubject = subjectIds.includes(n.subject_id);
    if (subjectIds.length && !inSubject && !terms.length) continue;
    let score = 0;
    for (const t of terms) score += countIn(n.title, t) * 5 + countIn(n.notes, t) * 2 + countIn(n.transcript, t);
    if (terms.length && !score) continue;
    out.push({ note: n, score: score + (inSubject ? 4 : 0) + (range ? 6 : 0), terms });
  }
  return out.sort((a, b) => b.score - a.score || b.note.created_at.localeCompare(a.note.created_at)).slice(0, limit);
}
function snippet(n, terms) {
  const hay = [n.notes || "", n.transcript || ""].join("\n").replace(/[#*`>|]/g, "").replace(/\s+/g, " ");
  const lower = hay.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t.replace(/s$/, "")); if (i > -1 && (at < 0 || i < at)) at = i; }
  const from = Math.max(0, at - 70);
  let html = esc((from ? "…" : "") + hay.slice(from, from + 220) + "…");
  for (const t of terms) html = html.replace(new RegExp("(" + reEsc(esc(t.replace(/s$/, ""))) + "[a-z]*)", "gi"), "<mark>$1</mark>");
  return html;
}
function notesContext(question) {
  const picked = [];
  if (state.pinned && noteById(state.pinned)?.status === "ready") picked.push(noteById(state.pinned));
  const { range, subjectIds } = parseQuery(question);
  // Only bring in notes when the question is clearly about the student's own classes, or matches a note strongly.
  const aboutClasses = /\b(class|classes|lecture|notes?|homework|assignment|sir|ma'?am|madam|teacher|professor|taught|syllabus|exam|test|lab|record(ed|ing)?)\b/i.test(question) || range || subjectIds.length;
  let hits = searchNotes(question, { limit: 3 }).filter(h => aboutClasses || h.score >= 10).map(h => h.note);
  if (!hits.length && (range || subjectIds.length) && /class|lecture|sir|mam|teacher|homework|taught|notes|learn/i.test(question)) {
    hits = sortedNotes(data.notes.filter(n => n.status === "ready" && (!range || (new Date(n.created_at) >= range[0] && new Date(n.created_at) <= range[1])) && (!subjectIds.length || subjectIds.includes(n.subject_id)))).slice(0, 3);
  }
  if (subjectIds.length && hits.some(n => subjectIds.includes(n.subject_id))) hits = hits.filter(n => subjectIds.includes(n.subject_id));
  if (/\b(last|latest|recent|previous)\b/i.test(question)) hits.sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const n of hits) if (!picked.includes(n)) picked.push(n);
  if (!picked.length) return { system: SYSTEM, refs: [] };
  let budget = 60000, block = "";
  for (const n of picked.slice(0, 4)) {
    const s = subjectById(n.subject_id);
    let part = `\n\n=== CLASS: "${n.title}" | Subject: ${s ? s.name + (s.code ? " (" + s.code + ")" : "") : "Unsorted"} | Date: ${fmtDateTime(n.created_at)} ===\n${n.notes}`;
    if (n.transcript) part += "\n\n--- Transcript ---\n" + n.transcript;
    part = part.slice(0, budget); budget -= part.length; block += part;
    if (budget <= 0) break;
  }
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return {
    system: SYSTEM + `\n\nToday is ${today}. Below are the student's own saved class notes. When the question is about their classes, homework, or what a teacher said, answer from these notes and say which class it came from (subject and date). If the notes don't cover it, say that clearly, then answer from general knowledge if that helps. Don't use Google Search for questions about their own classes.` + block,
    refs: picked.slice(0, 4).map(n => ({ id: n.id, subject: subjectName(n.subject_id), date: n.created_at }))
  };
}

/* =====================================================================
   PDF export: turns any answer or note into a real PDF on the device (no website needed).
   Uses pdfmake, loaded only the first time someone downloads a PDF.
   ===================================================================== */
const PDF_LIBS = [
  ["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js", "https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js", "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js", "https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js"]
];
let pdfReady = null;
function loadPdfLib() {
  if (window.pdfMake?.vfs) return Promise.resolve();
  return pdfReady ||= (async () => {
    for (const urls of PDF_LIBS) {
      let ok = false;
      for (const u of urls) { try { await loadScript(u); ok = true; break; } catch {} }
      if (!ok) throw new Error("load");
    }
    if (!window.pdfMake?.vfs && window.pdfMake?.addVirtualFileSystem && window.pdfFonts) pdfMake.addVirtualFileSystem(pdfFonts);
  })().catch(e => { pdfReady = null; throw e; });
}
const PDF_COLORS = { ink: "#2B2147", muted: "#6E6690", accent: "#6C4CF1", hl: "#FFE27A", line: "#E9E2F8", code: "#F3EEFF" };
function pdfInline(s) {
  const out = [], re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?:^|(?<=[^*]))\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) out.push({ text: t.slice(2, -2), bold: true, background: PDF_COLORS.hl });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1), background: PDF_COLORS.code, fontSize: 10 });
    else if (t.startsWith("[")) { const mm = t.match(/^\[([^\]]+)\]\((.+)\)$/); out.push({ text: mm[1], link: mm[2], color: PDF_COLORS.accent, decoration: "underline" }); }
    else out.push({ text: t.slice(1, -1), italics: true });
    last = m.index + t.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: "" }];
}
function mdToPdf(markdown) {
  const content = [];
  String(markdown || "").split(/```/).forEach((part, i) => {
    if (!(i % 2)) part = part.replace(MATH_DISPLAY, (_, a, b) => "\n" + texToText(a ?? b) + "\n").replace(MATH_INLINE, (all, a, b) => b != null && !looksMathy(b.trim()) ? all : texToText(a ?? b));
    if (i % 2) {
      content.push({ table: { widths: ["*"], body: [[{ text: part.replace(/^[^\n]*\n/, "").replace(/\n$/, ""), fontSize: 9, preserveLeadingSpaces: true, color: PDF_COLORS.ink }]] },
        layout: { fillColor: () => PDF_COLORS.code, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 }, margin: [0, 4, 0, 10] });
      return;
    }
    let list = null, para = [], table = [];
    const flushPara = () => { if (para.length) { content.push({ text: para.flatMap((l, k) => [...pdfInline(l), ...(k < para.length - 1 ? [{ text: "\n" }] : [])]), margin: [0, 0, 0, 8] }); para = []; } };
    const flushList = () => { if (list) { content.push({ [list.type]: list.items, margin: [0, 0, 0, 8] }); list = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|\s*$/g, "").split("|").map(c => c.trim()));
      const cols = Math.max(...rows.map(r => r.length));
      content.push({ table: { headerRows: 1, widths: Array(cols).fill("*"), body: rows.map((r, n) => Array.from({ length: cols }, (_, c) => ({ text: pdfInline(r[c] || ""), bold: n === 0, fontSize: 10 }))) },
        layout: { fillColor: r => r === 0 ? PDF_COLORS.code : null, hLineColor: () => PDF_COLORS.line, vLineColor: () => PDF_COLORS.line }, margin: [0, 2, 0, 10] });
      table = [];
    };
    for (const raw of part.split("\n")) {
      const line = raw.replace(/\s+$/, ""); let m;
      if (/^\s*\|.*\|$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushPara(); flushList(); content.push({ text: pdfInline(m[2]).map(r => ({ ...r, background: undefined })), style: m[1].length <= 2 ? "h2" : "h3" }); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (list?.type !== "ul") { flushList(); list = { type: "ul", items: [] }; } list.items.push({ text: pdfInline(m[1]), margin: [0, 1, 0, 2] }); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list?.type !== "ol") { flushList(); list = { type: "ol", items: [] }; } list.items.push({ text: pdfInline(m[1]), margin: [0, 1, 0, 2] }); continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineColor: PDF_COLORS.line }], margin: [0, 4, 0, 10] }); continue; }
      flushList(); para.push(line);
    }
    flushPara(); flushList(); flushTable();
  });
  return content;
}
function buildPdfDoc({ title, subtitle, markdown, sources }) {
  let body = String(markdown || "");
  // Use the answer's own first heading as the title instead of printing it twice.
  const first = body.match(/^\s*#{1,2}\s+(.+)\n/);
  if (first && first[1].replace(/[*_`]/g, "").trim() === title) body = body.slice(first[0].length);
  const content = [
    { text: "Study Buddy", style: "brand" },
    { text: title, style: "title" },
    { text: subtitle || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), style: "subtitle" },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: PDF_COLORS.accent }], margin: [0, 0, 0, 14] },
    ...mdToPdf(body)
  ];
  if (sources?.length) content.push({ text: "Sources", style: "h3" }, { ul: sources.map(s => ({ text: s.title || s.uri, link: s.uri, color: PDF_COLORS.accent, fontSize: 10 })) });
  return {
    info: { title, creator: "Study Buddy" },
    pageSize: "A4", pageMargins: [40, 48, 40, 52],
    content,
    footer: (page, pages) => ({ columns: [{ text: "Made with Study Buddy", color: PDF_COLORS.muted, fontSize: 8 }, { text: `${page} / ${pages}`, alignment: "right", color: PDF_COLORS.muted, fontSize: 8 }], margin: [40, 16, 40, 0] }),
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.3, color: PDF_COLORS.ink },
    styles: {
      brand: { fontSize: 9, bold: true, color: PDF_COLORS.accent, margin: [0, 0, 0, 4] },
      title: { fontSize: 22, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 10, color: PDF_COLORS.muted, margin: [0, 0, 0, 10] },
      h2: { fontSize: 15, bold: true, color: PDF_COLORS.accent, margin: [0, 10, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 8, 0, 4] }
    }
  };
}
async function downloadPdf({ title, subtitle, markdown, sources, button }) {
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = "Making PDF…"; }
  try {
    await loadPdfLib();
    const name = (title || "Study Buddy").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) + ".pdf";
    const pdf = pdfMake.createPdf(buildPdfDoc({ title: title || "Study Buddy notes", subtitle, markdown, sources }));
    const blob = await new Promise(ok => pdf.getBlob(ok));
    const file = new File([blob], name, { type: "application/pdf" });
    // Phones: open the share sheet so it can be saved to Files, Drive or sent on WhatsApp. Laptops: download.
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); toast("PDF ready"); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("PDF downloaded");
  } catch {
    toast("Couldn't make the PDF. Check your internet connection and try again.");
  } finally {
    if (button) { button.disabled = false; button.innerHTML = label; }
  }
}

/* =====================================================================
   5. Router and page frame
   ===================================================================== */
const view = $("#view"), scroller = $("#scroller");
let currentRoute = "";
let rec = null;   // the active recording, if any (section 11)
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h || /access_token|error_description|type=/.test(h)) return ["chat"];
  return h.split("/");
}
function route() {
  const [name, id] = parseHash();
  if (name === "s") { renderShare(id); return; }
  if (!sb) { renderSetup(); return; }
  if (!state.user) { renderSignIn(); return; }
  showShell();
  const key = [name, id].filter(Boolean).join("/");
  const tab = { chat: "chat", notes: "notes", subject: "notes", note: "notes", search: "search", timetable: "timetable" }[name] || "chat";
  document.querySelectorAll("[data-tab]").forEach(a => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const changed = key !== currentRoute; currentRoute = key;
  $("#chatDock").hidden = tab !== "chat" || !!rec;
  setTopActions(tab);
  if (!state.loaded) { renderLoading(); return; }
  if (name === "note") renderNote(id);
  else if (name === "subject") renderSubject(id);
  else if (name === "notes") renderNotes();
  else if (name === "search") renderSearch();
  else if (name === "timetable") renderTimetable();
  else renderChat();
  renderSidebar();
  if (changed) { view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); if (tab !== "chat") scroller.scrollTop = 0; }
}
window.addEventListener("hashchange", () => { ui.edit = null; route(); });
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const rerender = () => route();
const onChat = () => currentRoute === "chat" || currentRoute === "";
function setTitle(t) { $("#pageTitle").textContent = t; document.title = t === "Study Buddy" ? "Study Buddy" : t + " · Study Buddy"; }
function showShell() { $("#outside").hidden = true; $("#shell").hidden = false; }
function showOutside(html) { $("#shell").hidden = true; $("#chatDock").hidden = true; const o = $("#outside"); o.hidden = false; o.innerHTML = html; }
function renderLoading() { setTitle("Study Buddy"); view.innerHTML = `<div class="loading">${mark("thinking")}<span>Getting your notes ready…</span></div>`; }
function setTopActions(tab) {
  $("#topActions").innerHTML = tab === "chat"
    ? `<button class="icon-btn" data-top="chats" aria-label="Your chats" title="Your chats">${svg("chats")}</button><button class="icon-btn" data-top="new" aria-label="New chat" title="New chat">${svg("plus")}</button>`
    : "";
}
$("#topActions").addEventListener("click", e => {
  const b = e.target.closest("[data-top]"); if (!b) return;
  if (b.dataset.top === "new") newChat(); else openChats();
});
function renderSidebar() {
  const counts = {}; for (const n of data.notes) counts[n.subject_id] = (counts[n.subject_id] || 0) + 1;
  $("#sideSubjects").innerHTML = data.subjects.length
    ? data.subjects.map(s => `<a class="side-sub" href="#/subject/${esc(s.id)}"><span class="dot-c" style="--c:${s.color}"></span>${esc(s.name)}<span class="n">${counts[s.id] || ""}</span></a>`).join("")
    : `<a class="side-sub" href="#/timetable" style="color:var(--muted)">Add your subjects</a>`;
}
function setAccountUI() {
  const email = state.user?.email || "";
  for (const id of ["#sideAvatar", "#topAvatar", "#acctAvatar"]) $(id).textContent = initial(email);
  $("#sideWho").textContent = email; $("#acctEmail").textContent = email;
}

/* =====================================================================
   6. Sign in, setup and shared notes (pages shown outside the app)
   ===================================================================== */
let authMsg = "";
function renderSignIn(stage = "form", email = "") {
  const features = [
    ["recording", "Record a lecture and get clean notes, homework and a transcript", "var(--rec)"],
    ["cards", "Flashcards and quizzes from every class", "var(--accent)"],
    ["globe", "Ask anything, including today's news, with sources", "var(--sky)"]
  ];
  showOutside(`<div class="auth"><div class="auth-card">
    <div class="auth-brand">${mark("float")}Study Buddy</div>
    ${stage === "form" ? `
      <h1>${words("Your classes,")} <span class="w hl" style="--i:2">sorted.</span></h1>
      <p class="lead">Find your focus, reach your goals. Every lecture filed under the right subject, ready to revise.</p>
      <ul class="feature-list">${features.map(([i, t, c], n) => `<li style="--i:${n}"><span class="ico" style="--tint:${c}">${svg(i)}</span><span>${t}</span></li>`).join("")}</ul>
      <form class="auth-form" id="signInForm">
        ${authMsg ? `<p class="err" style="margin:0 0 12px">${esc(authMsg)}</p>` : ""}
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(email)}">
        <button class="btn primary block" type="submit">${svg("mail")}Email me a sign-in link</button>
        ${CFG.googleSignIn ? `<div class="or">or</div><button class="btn block" type="button" id="googleBtn">Continue with Google</button>` : ""}
      </form>
      <p class="auth-note">No password needed. Your notes sync to every device you sign in on.</p>`
    : `
      <h1>Check your <span class="hl">inbox</span>.</h1>
      <p class="lead">We sent a sign-in link to <b>${esc(email)}</b>. Open it on this device to continue. It can take a minute, and might land in spam.</p>
      <form class="auth-form" id="codeForm">
        <label for="code">Or enter the code from the email</label>
        <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" maxlength="10">
        <button class="btn primary block" type="submit">Sign in with code</button>
      </form>
      <p class="auth-note"><a href="#" id="changeEmail">Use a different email</a></p>`}
  </div></div>`);
  authMsg = "";
  $("#signInForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const addr = $("#email").value.trim(), btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    if (error) { authMsg = /rate|seconds/i.test(error.message) ? "Too many attempts. Wait a minute and try again." : error.message; renderSignIn("form", addr); return; }
    renderSignIn("sent", addr);
  });
  $("#googleBtn")?.addEventListener("click", () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }));
  $("#codeForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const token = $("#code").value.replace(/\s/g, "");
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) toast("That code didn't work. Check it or use the link instead.");
  });
  $("#changeEmail")?.addEventListener("click", e => { e.preventDefault(); renderSignIn("form", email); });
}
function renderSetup() {
  showOutside(`<div class="auth"><div class="auth-card">
    <div class="auth-brand">${mark("float")}Study Buddy</div>
    <h1>Almost <span class="hl">there</span>.</h1>
    <p class="lead">The app isn't connected to its backend yet. Open <b>config.js</b>, paste your Supabase project URL and anon key, then upload it again. SETUP.md walks through every step.</p>
    <div class="empty" style="text-align:left">${configured && !window.supabase ? "<b>The Supabase library didn't load.</b>Check your internet connection and reload.<br><br>" : ""}<b>Still to do</b>Fill in <code>supabaseUrl</code> and <code>supabaseAnonKey</code> in config.js.</div>
  </div></div>`);
}
async function renderShare(id) {
  if (!sb) { renderSetup(); return; }
  showOutside(`<div class="share-page"><div class="page"><div class="skel" style="height:44px"></div><div class="skel"></div></div></div>`);
  const { data: rows, error } = await sb.rpc("get_shared_note", { sid: id || "" });
  const n = rows?.[0];
  const home = location.pathname + "#/chat";
  if (error || !n) {
    showOutside(`<div class="auth"><div class="auth-card"><div class="auth-brand">${mark("float")}Study Buddy</div><h1>Link not <span class="hl">found</span>.</h1><p class="lead">These notes were removed, or sharing was turned off.</p><a class="btn primary" href="${home}">Open Study Buddy</a></div></div>`);
    return;
  }
  document.title = n.title + " · Study Buddy";
  showOutside(`<div class="share-page"><div class="page enter">
    <div class="auth-brand">${mark("float")}Study Buddy</div>
    <div class="page-head"><h1>${esc(n.title)}</h1></div>
    <div class="note-meta"><span>${esc(n.subject || "Class notes")}${n.subject_code ? " (" + esc(n.subject_code) + ")" : ""} · ${esc(fmtDateTime(n.created_at))}</span></div>
    <div class="body">${md(n.notes)}</div>
    ${n.transcript ? `<details style="margin-top:20px"><summary class="btn small">Show transcript</summary><div class="transcript-text" style="margin-top:12px">${esc(n.transcript)}</div></details>` : ""}
    <div class="share-cta">${mark("float")}<span class="t"><b>Shared from Study Buddy</b><br><span class="hint">Record your own classes and get notes, flashcards and quizzes.</span></span><a class="btn primary" href="${home}">Try it free</a></div>
  </div></div>`);
}

/* =====================================================================
   7. Chat
   ===================================================================== */
const IDEAS = [
  ["Help me write a polite leave letter to my HOD", "Writing", "edit"],
  ["What are today's top news headlines in India?", "Current affairs", "globe"],
  ["What was the homework in my last class?", "From your notes", "pdf"]
];
function renderChat() {
  const chat = state.chats.find(c => c.id === state.chatId);
  setTitle(chat ? chat.title : "Study Buddy");
  updatePinned();
  if (!state.messages.length) {
    const name = (state.user?.email || "").split("@")[0].split(/[._0-9]/)[0];
    const who = name && name.length > 1 ? ", " + esc(name[0].toUpperCase() + name.slice(1)) : "";
    view.innerHTML = `<section class="welcome"><div class="welcome-top">${mark("float")}<p class="hello">${greeting()}${who}</p></div>
      <h1>${words("What can I")} <span class="w hl" style="--i:3">help</span> <span class="w" style="--i:4">with?</span></h1>
      <p>Ask me anything: questions, today's news, writing, maths or your own past classes. Tap the red button to record a class.</p>
      <div class="ideas">${IDEAS.map(([qq, t, icon], i) => `<button type="button" data-act="ask" data-q="${esc(qq)}" style="--i:${i}"><span class="ico">${svg(icon)}</span><b>${esc(qq)}</b><small>${t}</small></button>`).join("")}</div></section>`;
    return;
  }
  view.innerHTML = `<div class="thread" id="thread"></div>`;
  const thread = $("#thread");
  for (const m of state.messages) thread.append(msgEl(m));
  scrollDown(true);
}
function msgEl(m) {
  const el = document.createElement("article");
  el.className = "msg " + m.role;
  if (m.role === "user") { el.textContent = m.text; return el; }
  const chips = [
    ...(m.refs || []).map(r => `<a class="note-ref" href="#/note/${esc(r.id)}" title="Open these notes">📒 ${esc(r.subject)} · ${esc(fmtDate(r.date))}</a>`),
    ...(m.sources || []).map(s => { let host = ""; try { host = new URL(s.uri).hostname; } catch {} return `<a href="${esc(s.uri)}" target="_blank" rel="noopener" title="${esc(s.title || s.uri)}">${esc(s.title || host)}</a>`; })
  ];
  el.innerHTML = `${mark(m.pending ? "thinking" : "")}<div class="content">
    <div class="body${m.is_error ? " err" : ""}">${m.pending && !m.text ? `<div class="typing"><i></i><i></i><i></i><span>${esc(m.pending)}</span></div>` : md(m.text) + (m.pending ? '<span class="caret"></span>' : "")}</div>
    ${chips.length && !m.pending ? `<div class="chips">${chips.join("")}</div>` : ""}
    ${!m.is_error && !m.pending && askedForPdf(m) ? `<button type="button" class="btn primary pdf-cta">${svg("download")}Download PDF</button>` : ""}
    ${!m.is_error && !m.pending ? `<div class="tools"><button type="button" class="copy">Copy</button><button type="button" class="pdf">PDF</button>${m.backup ? `<span class="backup-tag" title="Gemini was busy, so the backup AI answered">Backup AI</span>` : ""}</div>` : ""}
    ${m.is_error && m.retry ? `<div class="tools"><button type="button" class="retry">Try again</button></div>` : ""}</div>`;
  el.querySelector(".copy")?.addEventListener("click", () => copy(m.text));
  el.querySelectorAll(".pdf, .pdf-cta").forEach(b => b.addEventListener("click", () => downloadPdf({ markdown: m.text, title: pdfTitle(m), sources: m.sources, button: b })));
  el.querySelector(".retry")?.addEventListener("click", () => retryLast(m));
  return el;
}
const scrollDown = instant => requestAnimationFrame(() => { if (instant) scroller.style.scrollBehavior = "auto"; scroller.scrollTop = scroller.scrollHeight; scroller.style.scrollBehavior = ""; });
function chatHistory() {
  const msgs = state.messages.filter(m => !m.is_error && !m.pending && m.text).slice(-20);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
}
async function send(text) {
  text = (text || "").trim();
  if (!text || state.busy) return;
  if (!onChat()) go("#/chat");
  state.busy = true; updateSend();
  if (!state.chatId) {
    const chat = { id: uuid(), title: text.slice(0, 60), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    state.chats.unshift(chat); state.chatId = chat.id;
    chatSaves[chat.id] = api.insert("chats", { id: chat.id, title: chat.title }).catch(saveFail);
  }
  const chatId = state.chatId;
  const userMsg = { id: uuid(), chat_id: chatId, role: "user", text, created_at: new Date().toISOString() };
  state.messages.push(userMsg);
  const ctx = notesContext(text);
  const reply = { id: uuid(), chat_id: chatId, role: "model", text: "", sources: [], refs: ctx.refs, pending: ctx.refs.length ? "Checking your notes" : "Thinking" };
  const history = chatHistory();
  state.messages.push(reply);
  if (onChat()) renderChat();
  // Saving waits for the chat row to exist, so the message never arrives before its chat.
  const saved = (async () => { await sleepUntilChatSaved(chatId); await api.insert("messages", { id: userMsg.id, chat_id: chatId, role: "user", text }); })().catch(saveFail);
  let frame = 0;
  const paint = () => {
    frame = 0;
    if (!reply.pending || state.chatId !== chatId || !onChat()) return;
    const body = $("#thread")?.lastElementChild?.querySelector(".body");
    if (body) {
      body.innerHTML = md(reply.text) + '<span class="caret"></span>';
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 200) scrollDown(true);
    }
  };
  state.abort = new AbortController();
  try {
    const r = await callAI({ contents: history, system: ctx.system, search: true, stream: true, signal: state.abort.signal, onDelta: t => { reply.text = t; if (!frame) frame = requestAnimationFrame(paint); } });
    reply.text = r.text; reply.sources = r.sources; reply.backup = !!r.backup;
    if (r.stopped) reply.text += "\n\n*Stopped.*";
  } catch (e) {
    if (e.name === "AbortError") reply.text = (reply.text || "") + "\n\n*Stopped.*";
    else { reply.text = e instanceof FriendlyError ? e.message : "Something went wrong: " + e.message; reply.is_error = true; reply.retry = text; }
  }
  if (frame) cancelAnimationFrame(frame);
  delete reply.pending;
  state.busy = false; state.abort = null; updateSend();
  if (!reply.is_error) {
    saved.then(() => api.insert("messages", { id: reply.id, chat_id: chatId, role: "model", text: reply.text, sources: reply.sources || [], refs: reply.refs || [] })).catch(saveFail);
    const chat = state.chats.find(c => c.id === chatId);
    if (chat) { chat.updated_at = new Date().toISOString(); state.chats = [chat, ...state.chats.filter(c => c !== chat)]; api.update("chats", chatId, { title: chat.title }).catch(() => {}); }
  }
  if (state.chatId === chatId && onChat()) renderChat();
}
function questionFor(m) { const i = state.messages.indexOf(m); for (let j = i - 1; j >= 0; j--) if (state.messages[j].role === "user") return state.messages[j].text; return ""; }
const askedForPdf = m => /\bpdf\b|\bdownload(able)?\b|\bprintable\b|\bhandout\b/i.test(questionFor(m));
function pdfTitle(m) {
  const h = (m.text.match(/^#{1,3}\s+(.+)$/m) || [])[1];
  if (h) return h.replace(/[*_`#]/g, "").trim();
  const q = questionFor(m).replace(/\b(make|create|generate|give|send|write|me|a|an|the|pdf|of|on|about|for|please|can you|download)\b/gi, " ").replace(/\s+/g, " ").trim();
  return q ? q[0].toUpperCase() + q.slice(1, 70) : "Study Buddy notes";
}
function retryLast(m) {
  if (state.busy || !m.retry) return;
  const i = state.messages.indexOf(m);
  if (i > 0 && state.messages[i - 1].role === "user") state.messages.splice(i - 1, 2); else state.messages.splice(i, 1);
  send(m.retry);
}
const chatSaves = {};
function sleepUntilChatSaved(id) { return chatSaves[id] || Promise.resolve(); }
const input = $("#input"), sendBtn = $("#sendBtn");
function updateSend() {
  sendBtn.classList.toggle("stop", state.busy);
  sendBtn.disabled = !state.busy && !input.value.trim();
  sendBtn.setAttribute("aria-label", state.busy ? "Stop" : "Send");
  sendBtn.innerHTML = state.busy
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; updateSend(); });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover:hover)").matches) { e.preventDefault(); if (!state.busy) $("#composer").requestSubmit(); } });
$("#composer").addEventListener("submit", e => {
  e.preventDefault();
  if (state.busy) { state.abort?.abort(); return; }
  const t = input.value; input.value = ""; input.style.height = "auto"; send(t);
});
function updatePinned() {
  const n = state.pinned && noteById(state.pinned);
  $("#pinned").hidden = !n;
  if (n) $("#pinnedLabel").textContent = "Asking about: " + n.title;
}
$("#unpinBtn").onclick = () => { state.pinned = null; updatePinned(); };
$("#attachBtn").onclick = () => openAdd();
function newChat() { if (state.busy) return; state.chatId = null; state.messages = []; if ($("#chatsDlg").open) $("#chatsDlg").close(); go("#/chat"); setTimeout(() => input.focus(), 50); }
async function openChat(id) {
  if (state.busy) return;
  $("#chatsDlg").close();
  state.chatId = id; state.messages = [];
  go("#/chat");
  view.innerHTML = `<div class="skel"></div><div class="skel" style="width:70%;margin-left:auto"></div><div class="skel"></div>`;
  try { state.messages = await q(sb.from("messages").select("*").eq("chat_id", id).order("created_at", { ascending: true })); }
  catch (e) { saveFail(e); }
  if (state.chatId === id && onChat()) renderChat();
}
function openChats() {
  $("#chatList").innerHTML = state.chats.length
    ? state.chats.map(c => `<div class="chat-item${c.id === state.chatId ? " current" : ""}"><button type="button" class="open" data-chat="${esc(c.id)}"><b>${esc(c.title)}</b><small>${esc(fmtDateTime(c.updated_at))}</small></button><button type="button" class="icon-btn" data-del-chat="${esc(c.id)}" aria-label="Delete chat">${svg("trash")}</button></div>`).join("")
    : `<p class="hint">No chats yet. Ask a question to start one.</p>`;
  if (!$("#chatsDlg").open) $("#chatsDlg").showModal();
}
$("#chatList").addEventListener("click", e => {
  const open = e.target.closest("[data-chat]"), del = e.target.closest("[data-del-chat]");
  if (open) openChat(open.dataset.chat);
  if (del) {
    if (!confirm("Delete this chat?")) return;
    const id = del.dataset.delChat;
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.chatId === id) { state.chatId = null; state.messages = []; if (onChat()) renderChat(); }
    api.remove("chats", id).catch(saveFail); openChats();
  }
});
$("#newChatBtn").onclick = newChat;

/* =====================================================================
   8. Notes library and a single note
   ===================================================================== */
const best = n => Math.max(0, ...(n.scores || []).map(s => s.score / s.total));
function noteRow(n, i = 0) {
  const status = n.status === "processing" ? `<div class="spin" aria-label="Making notes"></div>` : n.status === "error" ? (autoRetry[n.id]?.timer ? `<span class="badge">Retrying soon</span>` : `<span class="badge bad">Needs retry</span>`) :
    (n.scores?.length ? `<span class="badge ${best(n) >= .7 ? "ok" : ""}">Quiz ${Math.round(best(n) * 100)}%</span>` : n.share_id ? `<span class="badge ok">Shared</span>` : "");
  return `<a class="note-row" href="#/note/${esc(n.id)}" style="--c:${subjectColor(n.subject_id)};--i:${Math.min(i, 8)}">
    <span class="ico">${svg(n.source)}</span>
    <span class="t"><b>${esc(n.status === "processing" ? "Making notes…" : n.title)}</b><small>${esc(subjectName(n.subject_id))} · ${esc(fmtDateTime(n.created_at))}${n.minutes ? " · " + n.minutes + " min" : ""}</small></span>${status}</a>`;
}
function renderNotes() {
  setTitle("Notes");
  const counts = {}; for (const n of data.notes) counts[n.subject_id || ""] = (counts[n.subject_id || ""] || 0) + 1;
  let cardI = 0;
  const card = (href, name, sub, color, count, letter) => `<a class="subject-card" href="${href}" style="--c:${color};--i:${cardI++}"><span class="swatch">${esc(letter)}</span><b>${esc(name)}</b><small>${esc(sub)}</small><span class="foot"><span class="count">${count}</span><small>${count === 1 ? "class" : "classes"}</small></span></a>`;
  const cards = data.subjects.map(s => {
    const last = sortedNotes(data.notes.filter(n => n.subject_id === s.id))[0];
    return card("#/subject/" + s.id, s.name, [s.code, last ? "last " + fmtDate(last.created_at) : ""].filter(Boolean).join(" · "), s.color, counts[s.id] || 0, initial(s.name));
  });
  if (counts[""]) cards.push(card("#/subject/unsorted", "Unsorted", "Not on your timetable", "var(--muted)", counts[""], "?"));
  const recent = sortedNotes(data.notes).slice(0, 6);
  const legacy = ui.legacy ? `<div class="banner"><span class="t"><b>Notes found on this device</b><br>${ui.legacy.notes.length} notes and ${ui.legacy.subjects.length} subjects from the earlier version. Move them into your account so they sync everywhere.</span><button class="btn primary" data-act="import">Move them</button></div>` : "";
  view.innerHTML = `
    <div class="page-head"><h1>Notes</h1><button class="btn primary" data-act="add">${svg("plus")}Add notes</button></div>
    ${legacy}
    ${data.subjects.length ? "" : `<div class="empty" style="margin-bottom:18px"><b>Add your subjects first</b>Then every recording and upload is filed under the class on your timetable.<div class="row"><a class="btn primary" href="#/timetable">Set up timetable</a></div></div>`}
    ${cards.length ? `<div class="grid">${cards.join("")}</div>` : ""}
    <h2 class="section-title">Recent</h2>
    ${recent.length ? `<div class="note-list">${recent.map((n, i) => noteRow(n, i)).join("")}</div>` : `<div class="empty">${mark("float")}<b>No notes yet</b>Record your next class, or add photos of the board, a PDF or a recording.</div>`}`;
}
function renderSubject(id) {
  const s = id === "unsorted" ? null : subjectById(id);
  if (id !== "unsorted" && !s) { go("#/notes"); return; }
  setTitle(s ? s.name : "Unsorted");
  const list = sortedNotes(data.notes.filter(n => (n.subject_id || "") === (s ? s.id : "")));
  view.innerHTML = `
    <a class="back" href="#/notes">${svg("back")}All subjects</a>
    <div class="page-head"><h1>${esc(s ? s.name : "Unsorted")}</h1><button class="btn primary" data-act="add" data-subject="${esc(s ? s.id : "")}">${svg("plus")}Add notes</button></div>
    ${s?.code ? `<p class="hint" style="margin-top:-10px">${esc(s.code)}</p>` : ""}
    ${list.length ? `<div class="note-list">${list.map((n, i) => noteRow(n, i)).join("")}</div>` : `<div class="empty"><b>No classes here yet</b>Record or upload notes during a ${esc(s ? s.name : "")} class and they'll appear here.</div>`}`;
}
const shareLink = n => location.origin + location.pathname + "#/s/" + n.share_id;
function renderNote(id) {
  const n = noteById(id);
  if (!n) { go("#/notes"); return; }
  setTitle(n.status === "ready" ? n.title : "Notes");
  const backHref = "#/subject/" + (n.subject_id && subjectById(n.subject_id) ? n.subject_id : "unsorted");
  const head = `<a class="back" href="${backHref}">${svg("back")}${esc(subjectName(n.subject_id))}</a>`;
  if (n.status === "processing") {
    const audio = n.source === "recording" || n.source === "audio";
    const steps = [`Reading the ${audio ? "recording" : n.source === "pdf" ? "PDF" : n.source === "photo" ? "photos" : "text"}`, "Writing a summary, key terms and homework", ...(audio ? ["Cleaning up the transcript"] : [])];
    view.innerHTML = head + `<div class="processing">${mark("thinking")}<b>Making your notes</b><p class="hint">${audio ? "Long classes can take a minute or two." : "This usually takes under a minute."} You can keep using the app.</p>
      <ul class="steps">${steps.map((t, i) => `<li style="--i:${i}">${t}</li>`).join("")}</ul></div>`;
    return;
  }
  if (n.status === "error") {
    const waiting = !!autoRetry[n.id]?.timer;
    view.innerHTML = head + `<div class="page-head"><h1>${waiting ? "Waiting to try again" : "Couldn't make notes"}</h1></div><div class="body${waiting ? "" : " err"}">${md(n.error || "Something went wrong.")}</div>
      <div class="actions"><button class="btn primary" data-act="retry" data-id="${esc(n.id)}">Try again now</button><button class="btn danger" data-act="delete-note" data-id="${esc(n.id)}">${svg("trash")}Delete</button></div>`;
    return;
  }
  const tabs = [["notes", "Notes"], ...(n.transcript ? [["transcript", "Transcript"]] : []), ["flash", "Flashcards"], ["quiz", "Quiz"]];
  let tab = ui.noteTab[id] || "notes";
  if (!tabs.some(t => t[0] === tab)) tab = "notes";
  const meta = `<div class="note-meta"><select data-act="move" data-id="${esc(n.id)}" aria-label="Subject">${subjectOptions(n.subject_id)}</select><span>${esc(fmtDateTime(n.created_at))}${n.minutes ? " · " + n.minutes + " min" : ""}${n.file_name ? " · " + esc(n.file_name) : ""}</span>${n.share_id ? `<span class="shared-tag">Shared</span>` : ""}</div>`;
  if (ui.edit && ui.edit.id === id) {
    const field = ui.edit.field;
    view.innerHTML = head + `<label class="sr" for="titleEdit">Title</label><input class="title-input" id="titleEdit" value="${esc(n.title)}">
      ${meta}<p class="hint">Editing the ${field}. Use **double stars** to highlight a key term and lines starting with ## for headings.</p>
      <label class="sr" for="bodyEdit">Text</label><textarea class="editor" id="bodyEdit">${esc(n[field] || "")}</textarea>
      <div class="actions"><button class="btn primary" data-act="save-edit" data-id="${esc(n.id)}">Save changes</button><button class="btn" data-act="cancel-edit">Cancel</button></div>`;
    return;
  }
  let body;
  if (tab === "notes") body = (n.thumbs?.length ? `<div class="thumbs">${n.thumbs.map(t => `<img src="${esc(t)}" alt="">`).join("")}</div>` : "") + `<div class="note-card body">${md(n.notes)}</div>`;
  else if (tab === "transcript") body = `<div class="note-card transcript-text">${esc(n.transcript)}</div>`;
  else if (tab === "flash") body = flashHTML(n);
  else body = quizHTML(n);
  const actions = (tab === "notes" || tab === "transcript") ? `<div class="actions">
      <button class="btn" data-act="pin" data-id="${esc(n.id)}">${svg("chats")}Ask about this class</button>
      <button class="btn" data-act="edit" data-id="${esc(n.id)}" data-field="${tab === "transcript" ? "transcript" : "notes"}">${svg("edit")}Edit</button>
      <button class="btn" data-act="share" data-id="${esc(n.id)}">${svg("share")}${n.share_id ? "Share link" : "Share"}</button>
      ${n.share_id ? `<button class="btn" data-act="unshare" data-id="${esc(n.id)}">Stop sharing</button>` : ""}
      <button class="btn" data-act="pdf-note" data-id="${esc(n.id)}">${svg("download")}Download PDF</button>
      <button class="btn" data-act="copy-note" data-id="${esc(n.id)}">Copy</button>
      <button class="btn danger" data-act="delete-note" data-id="${esc(n.id)}">${svg("trash")}Delete</button></div>` : "";
  view.innerHTML = head + `<div class="page-head"><h1>${esc(n.title)}</h1></div>${meta}
    <div class="seg" role="tablist">${tabs.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-act="tab" data-id="${esc(n.id)}" data-tab="${k}">${label}</button>`).join("")}</div>
    ${body}${actions}`;
}

/* ---------- Flashcards ---------- */
function flashHTML(n) {
  if (ui.generating[n.id + "flash"]) return `<div class="empty"><div class="spin big-spin" style="margin:0 auto 12px"></div><b>Making flashcards</b>Picking the key ideas from this class.</div>`;
  if (!n.flashcards?.length) return `<div class="empty"><b>No flashcards yet</b>Turn these notes into cards for quick revision.<div class="row"><button class="btn primary" data-act="make-flash" data-id="${esc(n.id)}">Make flashcards</button></div></div>`;
  let fc = ui.fc;
  if (!fc || fc.id !== n.id) fc = ui.fc = { id: n.id, order: n.flashcards.map((_, i) => i), i: 0, flipped: false, known: 0, missed: [] };
  if (fc.i >= fc.order.length) {
    return `<div class="empty"><div class="score">${fc.known}/${fc.order.length}</div><b>${fc.missed.length ? "Go through the ones you missed again." : "You knew every card."}</b>
      <div class="row">${fc.missed.length ? `<button class="btn primary" data-act="fc-missed">Practise ${fc.missed.length} missed</button>` : ""}
      <button class="btn" data-act="fc-restart">Start over</button><button class="btn" data-act="make-flash" data-id="${esc(n.id)}">New cards</button></div></div>`;
  }
  const card = n.flashcards[fc.order[fc.i]];
  return `<div class="progress"><div style="width:${(fc.i / fc.order.length) * 100}%"></div></div>
    <div class="flash"><div class="card${fc.flipped ? " flipped" : ""}" data-act="fc-flip" role="button" tabindex="0" aria-label="Flip card">
      <div class="face"><small>Card ${fc.i + 1} of ${fc.order.length}</small>${esc(card.q)}</div>
      <div class="face back-face"><small>Answer</small>${inline(card.a)}</div></div></div>
    <div class="flash-nav">${fc.flipped
      ? `<button class="btn danger" data-act="fc-again">Again</button><span class="hint">Did you know it?</span><button class="btn primary" data-act="fc-got">${svg("check")}Got it</button>`
      : `<span class="hint">Think of the answer, then tap the card.</span><button class="btn primary" data-act="fc-flip">Show answer</button>`}</div>`;
}
/* ---------- Quiz ---------- */
function quizHTML(n) {
  if (ui.generating[n.id + "quiz"]) return `<div class="empty"><div class="spin big-spin" style="margin:0 auto 12px"></div><b>Writing your quiz</b>Ten questions with explanations.</div>`;
  const history = n.scores?.length ? `<div class="history">${n.scores.slice(-6).map(s => `<span class="badge ${s.score / s.total >= .7 ? "ok" : ""}">${s.score}/${s.total} · ${esc(fmtDate(s.at))}</span>`).join("")}</div>` : "";
  if (!n.quiz?.length) return `<div class="empty"><b>No quiz yet</b>Get 10 multiple-choice questions from this class, with explanations.<div class="row"><button class="btn primary" data-act="make-quiz" data-id="${esc(n.id)}">Make a quiz</button></div></div>`;
  const qz = ui.qz;
  if (!qz || qz.id !== n.id) return `<div class="empty"><b>${n.quiz.length} questions ready</b>${n.scores?.length ? "Your best so far is " + Math.round(best(n) * 100) + "%." : "See how much of this class you remember."}
    <div class="row"><button class="btn primary" data-act="qz-start" data-id="${esc(n.id)}">Start quiz</button><button class="btn" data-act="make-quiz" data-id="${esc(n.id)}">New questions</button></div>${history}</div>`;
  if (qz.i >= qz.order.length) {
    const score = qz.right, total = qz.order.length;
    return `<div class="empty"><div class="score">${score}/${total}</div><b>${score === total ? "Perfect score!" : score / total >= .7 ? "Good work." : "Worth another go after a quick revision."}</b>
      <div class="row"><button class="btn primary" data-act="qz-start" data-id="${esc(n.id)}">Try again</button><button class="btn" data-act="make-quiz" data-id="${esc(n.id)}">New questions</button><button class="btn" data-act="tab" data-id="${esc(n.id)}" data-tab="flash">Revise with flashcards</button></div>${history}</div>`;
  }
  const qq = n.quiz[qz.order[qz.i]], chosen = qz.chosen;
  return `<div class="progress"><div style="width:${(qz.i / qz.order.length) * 100}%"></div></div>
    <p class="hint">Question ${qz.i + 1} of ${qz.order.length} · ${qz.right} right so far</p>
    <div class="q">${inline(qq.q)}</div>
    <div class="options">${qq.options.map((o, i) => {
      const cls = chosen == null ? "" : i === qq.answer ? "right" : i === chosen ? "wrong" : "";
      return `<button type="button" class="${cls}" data-act="qz-pick" data-i="${i}" ${chosen != null ? "disabled" : ""}><span class="letter">${"ABCD"[i]}</span><span>${inline(o)}</span></button>`;
    }).join("")}</div>
    ${chosen != null ? `<div class="explain"><b>${chosen === qq.answer ? "Correct." : "Not quite. The answer is " + "ABCD"[qq.answer] + "."}</b> ${inline(qq.explain || "")}</div>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-act="qz-next">${qz.i + 1 === qz.order.length ? "See my score" : "Next question"}</button></div>` : ""}`;
}
async function makeStudyItems(id, kind) {
  const n = noteById(id); if (!n) return;
  ui.generating[id + kind] = true; ui.noteTab[id] = kind; rerender();
  const source = (n.notes + (n.transcript ? "\n\nTranscript:\n" + n.transcript.slice(0, 40000) : "")).slice(0, 60000);
  const prompt = kind === "flash"
    ? `Make 12 flashcards from these class notes for revision. Return only a JSON array of objects like {"q": "question", "a": "answer"}. Questions should be short. Answers should be 1–2 sentences. Cover definitions, formulas, key ideas and anything the teacher stressed.\n\nNOTES:\n${source}`
    : `Write a 10-question multiple-choice quiz from these class notes. Return only a JSON array of objects like {"q": "question", "options": ["A", "B", "C", "D"], "answer": 0, "explain": "one sentence on why"}. "answer" is the index (0–3) of the correct option. Each question has exactly 4 options. Vary which position is correct. Mix easy and harder questions, and only test what's in the notes.\n\nNOTES:\n${source}`;
  try {
    const r = await callAI({ contents: [{ role: "user", parts: [{ text: prompt }] }], json: true, maxTokens: 8000, system: "You create accurate study material for a college student. Output valid JSON only." });
    let items = parseJSON(r.text);
    if (!Array.isArray(items)) items = items.items || items.questions || items.flashcards || [];
    if (kind === "flash") {
      items = items.filter(x => x && x.q && x.a).map(x => ({ q: String(x.q), a: String(x.a) }));
      if (!items.length) throw new FriendlyError("Gemini didn't return any flashcards. Try again.");
      ui.fc = null; await patchNote(n, { flashcards: items });
    } else {
      items = items.filter(x => x && x.q && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(+x.answer) && +x.answer < x.options.length)
        .map(x => ({ q: String(x.q), options: x.options.slice(0, 4).map(String), answer: +x.answer, explain: String(x.explain || "") }));
      if (!items.length) throw new FriendlyError("Gemini didn't return any questions. Try again.");
      ui.qz = null; await patchNote(n, { quiz: items });
    }
  } catch (e) { toast(e instanceof FriendlyError ? e.message.replace(/\*\*/g, "").split("\n")[0] : "Couldn't make that. Try again."); }
  ui.generating[id + kind] = false; rerender();
}

/* =====================================================================
   9. Search and timetable
   ===================================================================== */
function renderSearch() {
  setTitle("Search");
  view.innerHTML = `<div class="page-head"><h1>Search</h1></div>
    <form class="search-box" id="searchForm" role="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <label class="sr" for="searchInput">Search your notes</label>
      <input id="searchInput" type="search" placeholder="Kirchhoff's law, homework on Tuesday…" value="${esc(ui.searchQ)}" autocomplete="off">
      <button class="btn small primary" type="submit">Ask</button></form>
    <div id="results"></div>`;
  const inp = $("#searchInput");
  inp.addEventListener("input", () => { ui.searchQ = inp.value; showResults(); });
  $("#searchForm").addEventListener("submit", e => { e.preventDefault(); const qq = ui.searchQ.trim(); if (!qq) { toast("Type a question first"); return; } if (state.busy) return; state.chatId = null; state.messages = []; send(qq); });
  showResults();
  if (matchMedia("(hover:hover)").matches) inp.focus();
}
function showResults() {
  const box = $("#results"), qq = ui.searchQ.trim();
  if (!qq) { box.innerHTML = `<p class="hint">Search every class you've saved by topic, subject or day. Try “Kirchhoff”, “calculus homework” or “Tuesday”.<br>Tap <b>Ask</b> to get an answer written from your notes, like “What did sir say about the homework on Tuesday?”</p>`; return; }
  const hits = searchNotes(qq);
  box.innerHTML = hits.length
    ? `<p class="hint">${hits.length} ${hits.length === 1 ? "class" : "classes"} found</p>` + hits.map(h => `<a class="result" href="#/note/${esc(h.note.id)}"><b>${esc(h.note.title)}</b><br><small><span class="dot-c" style="--c:${subjectColor(h.note.subject_id)}"></span>${esc(subjectName(h.note.subject_id))} · ${esc(fmtDateTime(h.note.created_at))}</small>${h.terms.length ? `<div class="snippet">${snippet(h.note, h.terms)}</div>` : ""}</a>`).join("")
    : `<div class="empty"><b>Nothing matched “${esc(qq)}”</b>Try a different word, or tap Ask to have Study Buddy look through your notes.</div>`;
}
function renderTimetable() {
  setTitle("Timetable");
  const now = slotAt(), next = nextSlotToday();
  const card = now ? `<div class="now-card"><span class="live"></span><span class="t"><b>Now: ${esc(subjectName(now.subject_id))}</b><br><small>${fmtTime(now.start_time)} to ${fmtTime(now.end_time)}</small></span>${rec ? "" : `<button class="btn" data-act="record" data-subject="${esc(now.subject_id)}">Record this class</button>`}</div>`
    : next ? `<div class="now-card"><span class="t"><b>Next: ${esc(subjectName(next.subject_id))}</b><br><small>at ${fmtTime(next.start_time)}</small></span></div>` : "";
  const counts = {}; for (const n of data.notes) counts[n.subject_id] = (counts[n.subject_id] || 0) + 1;
  const slots = data.slots.filter(s => s.day === ui.day).sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  view.innerHTML = `<div class="page-head"><h1>Timetable</h1><button class="btn primary" data-act="tt-import">${svg("photo")}Import from photo or PDF</button></div>${importHTML()}${card}
    <h2 class="section-title" style="margin-top:0">Subjects</h2>
    <div>${data.subjects.map(s => `<div class="subj-row"><span class="dot-c" style="--c:${s.color}"></span><span class="name"><b>${esc(s.name)}</b> <small>${esc(s.code || "")}${counts[s.id] ? " · " + counts[s.id] + (counts[s.id] === 1 ? " note" : " notes") : ""}</small></span>
      <button class="btn small" data-act="rename-subject" data-id="${esc(s.id)}">Rename</button><button class="icon-btn" data-act="delete-subject" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">${svg("trash")}</button></div>`).join("") || `<p class="hint">Add each course you take this semester.</p>`}</div>
    <form class="form-row" id="subjectForm" style="margin-top:12px">
      <label>Subject name<input id="subjName" required placeholder="Calculus" maxlength="60"></label>
      <label>Course code (optional)<input id="subjCode" placeholder="23MAT107" maxlength="20"></label>
      <button class="btn primary" type="submit">Add subject</button></form>
    <h2 class="section-title">Weekly classes</h2>
    <p class="hint" style="margin-top:-4px">Recordings and uploads are filed under whichever class is on at that time.</p>
    <div class="days" role="tablist">${WEEK.map(d => `<button type="button" role="tab" aria-selected="${d === ui.day}" data-act="day" data-day="${d}">${DAYS[d].slice(0, 3)}</button>`).join("")}</div>
    <div>${slots.map(s => `<div class="slot${now && now.id === s.id ? " now" : ""}" style="--c:${subjectColor(s.subject_id)}"><span class="time">${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}</span><span class="name">${esc(subjectName(s.subject_id))}</span><button class="icon-btn" data-act="delete-slot" data-id="${esc(s.id)}" aria-label="Remove this class">${svg("trash")}</button></div>`).join("") || `<p class="hint">No classes on ${DAYS[ui.day]} yet. Add them below, or import your whole timetable from a photo or PDF.</p>`}</div>
    ${data.subjects.length ? `<form class="form-row" id="slotForm" style="margin-top:12px">
      <label>Subject<select id="slotSubject" required>${data.subjects.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></label>
      <label>Starts<input id="slotStart" type="time" required value="${esc(ui.lastEnd || "09:00")}"></label>
      <label>Ends<input id="slotEnd" type="time" required value="${esc(ui.lastEnd ? addMin(ui.lastEnd, 50) : "09:50")}"></label>
      <button class="btn primary" type="submit">Add to ${DAYS[ui.day]}</button></form>` : `<p class="hint">Add a subject above first.</p>`}`;
  $("#subjectForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#subjName").value.trim(); if (!name) return;
    const s = { id: uuid(), name, code: $("#subjCode").value.trim().toUpperCase() || null, color: COLORS[data.subjects.length % COLORS.length], created_at: new Date().toISOString() };
    data.subjects.push(s); renderTimetable(); renderSidebar(); toast(name + " added");
    api.insert("subjects", { id: s.id, name: s.name, code: s.code, color: s.color }).catch(err => { data.subjects = data.subjects.filter(x => x !== s); saveFail(err); renderTimetable(); });
  });
  $("#slotForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const start = $("#slotStart").value, end = $("#slotEnd").value;
    if (toMin(end) <= toMin(start)) { toast("The end time must be after the start time"); return; }
    const s = { id: uuid(), day: ui.day, start_time: start, end_time: end, subject_id: $("#slotSubject").value };
    data.slots.push(s); ui.lastEnd = end; renderTimetable();
    api.insert("slots", s).catch(err => { data.slots = data.slots.filter(x => x !== s); saveFail(err); renderTimetable(); });
  });
}

/* ---------- Import a timetable from a photo or PDF ---------- */
const ttInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*,application/pdf,.pdf", hidden: true });
document.body.append(ttInput);
ttInput.onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importTimetable(f); };
const TT_PROMPT = `This image or PDF is a college class timetable. Read it carefully and return only JSON in this shape:
{"subjects":[{"name":"Calculus","code":"23MAT107"}],
 "classes":[{"day":"Monday","start":"09:00","end":"09:50","subject":"23MAT107"}]}
Rules:
- Days run down one side or across the top; periods usually have their times in a header row. Use those times for each class.
- Write times in 24-hour HH:MM. Afternoon classes such as 1:30 must become 13:30.
- A class that spans several periods (like a lab) is one entry from the first start time to the last end time.
- Skip breaks, lunch, free periods and empty cells.
- If the timetable uses short codes or abbreviations and lists full course names elsewhere (often in a table underneath), use the full name and the course code.
- "subject" in each class must match a subject's code, or its name when there is no code.
- Don't invent anything that isn't in the timetable.`;
function normDay(d) {
  if (typeof d === "number") return d >= 0 && d <= 6 ? d : null;
  const i = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(d).trim().slice(0, 3).toLowerCase());
  return i < 0 ? null : i;
}
function normTime(t) {
  const m = String(t || "").trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 6) h += 12;   // college classes at "1:30" mean 1:30 pm
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}
function findSubject(list, key) {
  const k = String(key || "").trim().toLowerCase();
  return list.find(s => (s.code && s.code.toLowerCase() === k) || s.name.toLowerCase() === k);
}
async function importTimetable(file) {
  if (file.size > MAX_UPLOAD) { toast("That file is too large. Try a smaller photo or a single-page PDF."); return; }
  ui.ttImport = { status: "reading" }; renderTimetable(); scroller.scrollTop = 0;
  try {
    let blob = file, mime = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "image/jpeg");
    if (mime.startsWith("image/")) { try { blob = await drawImage(await createImageBitmap(file), 2200, .88); mime = "image/jpeg"; } catch {} }
    const r = await callAI({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: await blobToBase64(blob) } }, { text: TT_PROMPT }] }], json: true, maxTokens: 8000, system: "You read college timetables accurately and output valid JSON only." });
    let out; try { out = JSON.parse(r.text); } catch { out = parseJSON(r.text); }
    const subjects = (out.subjects || []).filter(s => s && s.name).map(s => ({ name: String(s.name).trim().slice(0, 80), code: s.code ? String(s.code).trim().toUpperCase().slice(0, 30) : null }));
    const classes = [];
    for (const c of out.classes || []) {
      const day = normDay(c.day), start = normTime(c.start), end = normTime(c.end);
      if (day == null || !start || !end || toMin(end) <= toMin(start) || !c.subject) continue;
      let subj = findSubject(subjects, c.subject);
      if (!subj) { subj = { name: String(c.subject).trim().slice(0, 80), code: null }; subjects.push(subj); }
      classes.push({ day, start, end, subject: subj });
    }
    if (!classes.length) throw new FriendlyError("I couldn't find any classes in that file. Try a clearer photo, taken straight on, with the whole timetable in view.");
    ui.ttImport = { status: "review", subjects, classes, replace: false };
  } catch (e) {
    ui.ttImport = { status: "error", message: e instanceof FriendlyError ? e.message : "Couldn't read that timetable. Try again." };
  }
  if (currentRoute.startsWith("timetable")) renderTimetable(); else toast("Your timetable is ready to review in the Timetable tab");
}
function importHTML() {
  const t = ui.ttImport; if (!t) return "";
  if (t.status === "reading") return `<div class="import-card"><div class="processing" style="box-shadow:none;padding:10px">${mark("thinking")}<b>Reading your timetable</b><p class="hint">Finding subjects, days and class times. This takes a few seconds.</p></div></div>`;
  if (t.status === "error") return `<div class="import-card"><b>Couldn't import that timetable</b><p class="hint">${esc(t.message)}</p><div class="row"><button class="btn primary" data-act="tt-import">Try another file</button><button class="btn" data-act="tt-cancel">Close</button></div></div>`;
  const isNew = s => !findSubject(data.subjects, s.code || s.name) && !findSubject(data.subjects, s.name);
  const byDay = WEEK.map(d => [d, t.classes.filter(c => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start))]).filter(([, list]) => list.length);
  return `<div class="import-card">
    <b>Found ${t.classes.length} classes and ${t.subjects.length} subjects</b>
    <p class="hint">Check them, then add them to your timetable. You can fix anything by hand afterwards.</p>
    <div class="import-subjects">${t.subjects.map(s => `<span class="badge${isNew(s) ? " ok" : ""}">${esc(s.name)}${s.code ? " · " + esc(s.code) : ""}${isNew(s) ? " · new" : ""}</span>`).join("")}</div>
    <div class="import-days">${byDay.map(([d, list]) => `<div><b>${DAYS[d]}</b>${list.map(c => `<div class="import-slot"><span>${fmtTime(c.start)} – ${fmtTime(c.end)}</span>${esc(c.subject.name)}</div>`).join("")}</div>`).join("")}</div>
    ${data.slots.length ? `<label class="import-replace"><input type="checkbox" id="ttReplace"> Replace the ${data.slots.length} classes already in my timetable</label>` : ""}
    <div class="row"><button class="btn primary" data-act="tt-apply">Add to timetable</button><button class="btn" data-act="tt-cancel">Cancel</button></div>
  </div>`;
}
async function applyTimetableImport(btn) {
  const t = ui.ttImport; if (!t || t.status !== "review") return;
  const replace = $("#ttReplace")?.checked;
  btn.disabled = true; btn.textContent = "Adding…";
  try {
    if (replace) { const old = data.slots.slice(); data.slots = []; await Promise.all(old.map(sl => api.remove("slots", sl.id))); }
    const newSubjects = [];
    for (const s of t.subjects) {
      let existing = findSubject(data.subjects, s.code || s.name) || findSubject(data.subjects, s.name);
      if (!existing) { existing = { id: uuid(), name: s.name, code: s.code, color: COLORS[(data.subjects.length + newSubjects.length) % COLORS.length] }; newSubjects.push(existing); }
      s.id = existing.id;
    }
    if (newSubjects.length) data.subjects.push(...await api.insertMany("subjects", newSubjects));
    const seen = new Set(data.slots.map(sl => `${sl.day}|${sl.start_time}|${sl.subject_id}`));
    const rows = [];
    for (const c of t.classes) {
      const key = `${c.day}|${c.start}|${c.subject.id}`;
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ id: uuid(), day: c.day, start_time: c.start, end_time: c.end, subject_id: c.subject.id });
    }
    data.slots.push(...await api.insertMany("slots", rows));
    ui.ttImport = null;
    toast(`Added ${rows.length} classes${newSubjects.length ? ` and ${newSubjects.length} subjects` : ""}`); confetti(40);
  } catch (e) { saveFail(e); btn.disabled = false; btn.textContent = "Add to timetable"; return; }
  renderTimetable(); renderSidebar();
}

/* =====================================================================
   10. One click handler for the page
   ===================================================================== */
view.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT") return;
  const id = b.dataset.id, n = id && noteById(id);
  switch (b.dataset.act) {
    case "ask": send(b.dataset.q); break;
    case "add": openAdd(b.dataset.subject); break;
    case "record": startRecording(b.dataset.subject); break;
    case "import": importLegacy(b); break;
    case "tab": ui.noteTab[id] = b.dataset.tab; if (b.dataset.tab === "flash") ui.fc = null; renderNote(id); break;
    case "edit": ui.edit = { id, field: b.dataset.field }; renderNote(id); $("#bodyEdit")?.focus(); break;
    case "cancel-edit": { const nid = ui.edit?.id; ui.edit = null; renderNote(nid); break; }
    case "save-edit": {
      const field = ui.edit.field, title = $("#titleEdit").value.trim() || n.title, text = $("#bodyEdit").value;
      ui.edit = null;
      await patchNote(n, { title, [field]: text });
      toast("Saved"); renderNote(id); break;
    }
    case "pin": state.pinned = id; if (!state.busy) { state.chatId = null; state.messages = []; } go("#/chat"); setTimeout(() => input.focus(), 50); toast("Ask anything about this class"); break;
    case "pdf-note": {
      const tab = ui.noteTab[id] === "transcript" ? "transcript" : "notes";
      const s2 = subjectById(n.subject_id);
      downloadPdf({ title: n.title, subtitle: `${s2 ? s2.name + (s2.code ? " (" + s2.code + ")" : "") : "Class notes"} · ${fmtDateTime(n.created_at)}`, markdown: tab === "notes" ? n.notes + (n.transcript ? "\n\n## Transcript\n" + n.transcript : "") : "## Transcript\n" + n.transcript, button: b });
      break;
    }
    case "copy-note": copy(`${n.title}\n${subjectName(n.subject_id)} · ${fmtDateTime(n.created_at)}\n\n${n.notes}${n.transcript ? "\n\nTranscript:\n" + n.transcript : ""}`); break;
    case "share": {
      if (!n.share_id) await patchNote(n, { share_id: shareCode() });
      const url = shareLink(n);
      if (navigator.share) { try { await navigator.share({ title: n.title, text: `My notes on ${n.title}`, url }); } catch {} }
      else copy(url);
      renderNote(id); break;
    }
    case "unshare": await patchNote(n, { share_id: null }); toast("Sharing turned off. The old link no longer works."); renderNote(id); break;
    case "delete-note":
      if (!confirm("Delete these notes? This can't be undone.")) break;
      data.notes = data.notes.filter(x => x.id !== id);
      api.remove("notes", id).catch(saveFail); LocalDB.del("media", id).catch(() => {});
      if (state.pinned === id) state.pinned = null;
      toast("Deleted"); go("#/subject/" + (n.subject_id && subjectById(n.subject_id) ? n.subject_id : "unsorted")); break;
    case "retry": if (autoRetry[id]?.timer) clearTimeout(autoRetry[id].timer); processNote(id); break;
    case "make-flash": makeStudyItems(id, "flash"); break;
    case "make-quiz": makeStudyItems(id, "quiz"); break;
    case "fc-flip": ui.fc.flipped = !ui.fc.flipped; renderNote(ui.fc.id); break;
    case "fc-got": ui.fc.known++; ui.fc.i++; ui.fc.flipped = false; if (ui.fc.i >= ui.fc.order.length && !ui.fc.missed.length) confetti(); renderNote(ui.fc.id); break;
    case "fc-again": ui.fc.missed.push(ui.fc.order[ui.fc.i]); ui.fc.i++; ui.fc.flipped = false; renderNote(ui.fc.id); break;
    case "fc-missed": Object.assign(ui.fc, { order: shuffle(ui.fc.missed), i: 0, known: 0, missed: [], flipped: false }); renderNote(ui.fc.id); break;
    case "fc-restart": { const fid = ui.fc.id; ui.fc = null; renderNote(fid); break; }
    case "qz-start": ui.qz = { id, order: shuffle(n.quiz.map((_, i) => i)), i: 0, right: 0, chosen: null }; ui.noteTab[id] = "quiz"; renderNote(id); break;
    case "qz-pick": {
      const qz = ui.qz, note = noteById(qz.id), qq = note.quiz[qz.order[qz.i]];
      qz.chosen = +b.dataset.i; if (qz.chosen === qq.answer) qz.right++;
      renderNote(qz.id); break;
    }
    case "qz-next": {
      const qz = ui.qz, note = noteById(qz.id);
      qz.i++; qz.chosen = null;
      if (qz.i >= qz.order.length) { await patchNote(note, { scores: [...(note.scores || []), { at: new Date().toISOString(), score: qz.right, total: qz.order.length }] }); if (qz.right / qz.order.length >= .7) confetti(); }
      renderNote(qz.id); scroller.scrollTop = 0; break;
    }
    case "day": ui.day = +b.dataset.day; renderTimetable(); break;
    case "tt-import": ttInput.click(); break;
    case "tt-cancel": ui.ttImport = null; renderTimetable(); break;
    case "tt-apply": applyTimetableImport(b); break;
    case "delete-slot": data.slots = data.slots.filter(s => s.id !== id); renderTimetable(); api.remove("slots", id).catch(saveFail); break;
    case "rename-subject": {
      const s = subjectById(id), name = prompt("Subject name", s.name); if (!name?.trim()) break;
      const code = prompt("Course code (optional)", s.code || "");
      s.name = name.trim(); s.code = (code || "").trim().toUpperCase() || null;
      renderTimetable(); renderSidebar(); api.update("subjects", id, { name: s.name, code: s.code }).catch(saveFail); break;
    }
    case "delete-subject": {
      const s = subjectById(id);
      if (!confirm(`Delete ${s.name}? Its classes are removed from the timetable, and its notes move to Unsorted.`)) break;
      data.subjects = data.subjects.filter(x => x.id !== id);
      data.slots = data.slots.filter(x => x.subject_id !== id);
      for (const nt of data.notes) if (nt.subject_id === id) nt.subject_id = null;
      renderTimetable(); renderSidebar(); api.remove("subjects", id).catch(saveFail); break;
    }
  }
});
view.addEventListener("change", async e => {
  const sel = e.target.closest('select[data-act="move"]'); if (!sel) return;
  const n = noteById(sel.dataset.id);
  await patchNote(n, { subject_id: sel.value || null });
  toast("Moved to " + subjectName(n.subject_id)); renderNote(n.id); renderSidebar();
});
view.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('.card[data-act="fc-flip"]')) { e.preventDefault(); e.target.click(); } });

/* =====================================================================
   11. Adding notes: recordings, audio files, photos, PDFs and text
   ===================================================================== */
let pendingSubject = "";
function openAdd(preset) {
  pendingSubject = preset !== undefined && preset !== null ? preset : subjectAt(new Date());
  $("#addSubject").innerHTML = subjectOptions(pendingSubject);
  $("#addDlg").showModal();
}
$("#addSubject").onchange = e => pendingSubject = e.target.value;
$("#addDlg").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  $("#addDlg").close();
  const kind = b.dataset.add, pickers = { camera: "#cameraInput", photo: "#photoInput", pdf: "#pdfInput", audio: "#audioInput" };
  if (kind === "record") startRecording(pendingSubject);
  else if (kind === "text") { $("#textInput").value = ""; $("#textDlg").showModal(); }
  else if (pickers[kind]) $(pickers[kind]).click();
});
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", e => { if (e.target === d) d.close(); });
$("#textForm").addEventListener("submit", e => {
  const text = $("#textInput").value.trim();
  if (text.length < 20) { e.preventDefault(); toast("Add a bit more text first"); return; }
  createNote({ source: "text", subjectId: pendingSubject, text });
});
$("#pdfInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) createNote({ source: "pdf", subjectId: pendingSubject, parts: [{ mime: "application/pdf", blob: f }], fileName: f.name }); };
$("#audioInput").onchange = e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  const types = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm" };
  createNote({ source: "audio", subjectId: pendingSubject, parts: [{ mime: f.type || types[ext] || "audio/mpeg", blob: f }], fileName: f.name });
};
function drawImage(bmp, max, quality) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, "image/jpeg", quality));
}
async function onPhotos(files) {
  if (!files.length) return;
  toast("Preparing photos…");
  const parts = [], thumbs = [];
  for (const f of files.slice(0, 12)) {
    try {
      const bmp = await createImageBitmap(f);
      parts.push({ mime: "image/jpeg", blob: await drawImage(bmp, 1600, .82) });
      thumbs.push(await blobToDataURL(await drawImage(bmp, 176, .7)));
    } catch { parts.push({ mime: f.type || "image/jpeg", blob: f }); }
  }
  createNote({ source: "photo", subjectId: pendingSubject, parts, thumbs, fileName: files.length > 1 ? files.length + " photos" : files[0].name });
}
$("#photoInput").onchange = e => { const f = [...e.target.files]; e.target.value = ""; onPhotos(f); };
$("#cameraInput").onchange = e => { const f = [...e.target.files]; e.target.value = ""; onPhotos(f); };

async function createNote({ source, subjectId = "", parts = [], text = "", fileName = "", minutes = 0, thumbs = [], created }) {
  const size = parts.reduce((t, p) => t + p.blob.size, 0);
  if (size > MAX_UPLOAD) { toast(`That's ${(size / 1048576).toFixed(1)} MB. The limit is about 14 MB, so split it into smaller parts.`); return; }
  const n = { id: uuid(), subject_id: subjectId || null, source, title: "Making notes…", status: "processing", error: null, notes: "", transcript: "", minutes, file_name: fileName || null, thumbs, flashcards: null, quiz: null, scores: [], share_id: null, created_at: created || new Date().toISOString() };
  try { await LocalDB.put("media", { id: n.id, parts, text }); } catch {}
  data.notes.push(n);
  try { await api.insert("notes", { id: n.id, subject_id: n.subject_id, source, title: n.title, status: n.status, minutes, file_name: n.file_name, thumbs, created_at: n.created_at }); }
  catch (e) { data.notes = data.notes.filter(x => x !== n); saveFail(e); return; }
  go("#/note/" + n.id);
  processNote(n.id);
}
function notesPrompt(n) {
  const s = subjectById(n.subject_id);
  const intro = {
    recording: "This audio is a recording of a college class or a meeting.",
    audio: "This audio is a recording of a college class or a meeting.",
    pdf: "This PDF is study material: lecture slides, a handout or textbook pages.",
    photo: "These photos show a whiteboard, lecture slides or textbook pages. Read every piece of text, equation and diagram carefully.",
    text: "Below are a student's rough notes or text copied from a class."
  }[n.source];
  const isAudio = n.source === "recording" || n.source === "audio";
  return `${intro}${s ? ` The subject is ${s.name}${s.code ? " (" + s.code + ")" : ""}.` : ""}

Start with one line exactly like this:
TITLE: <the main topic in at most 8 words>

Then write study notes in this structure:

## Summary
3 to 5 sentences on what it covers.

## Key points
Bullet points of the main ideas, in order.

## Important terms
Bullet points: **term** – short definition.

## Formulas and examples
Only if there are any. Skip this heading otherwise.

## Homework, deadlines and action items
Bullet points, or "None mentioned".

## Check yourself
3 short questions to test understanding.
${isAudio ? `
## Transcript
The full transcript, with filler words removed and speaker labels (Teacher, Student, Speaker 1…) when you can tell them apart.
` : ""}
Write the notes in English. If parts are in Tamil or another language, translate them in the notes${isAudio ? " and keep the transcript in the language spoken" : ""}. Use **bold** for key terms. Don't invent anything that isn't in the material.`;
}
const processing = new Set();
const autoRetry = {};
async function processNote(id) {
  const n = noteById(id); if (!n || processing.has(id)) return;
  const media = await LocalDB.get("media", id).catch(() => null);
  if (!media) { await patchNote(n, { status: "error", error: "The original file isn't on this device, so it can't be retried here. Delete this and add the file again." }); rerender(); return; }
  processing.add(id);
  await patchNote(n, { status: "processing", error: null }); rerender();
  try {
    const parts = [];
    for (const p of media.parts || []) parts.push({ inline_data: { mime_type: p.mime, data: await blobToBase64(p.blob) } });
    parts.push({ text: notesPrompt(n) + (media.text ? "\n\nTEXT:\n" + media.text : "") });
    const r = await callAI({ contents: [{ role: "user", parts }], maxTokens: 32000, system: "You turn class material into clear, accurate study notes for a college student." });
    let text = r.text;
    const t = text.match(/^\s*\**TITLE:?\**\s*(.+)$/im);
    if (t) text = text.replace(t[0], "").trim();
    const cut = text.search(/^#{1,3}\s*Transcript\s*$/im);
    await patchNote(n, {
      notes: (cut > -1 ? text.slice(0, cut) : text).trim(),
      transcript: cut > -1 ? text.slice(cut).replace(/^#{1,3}\s*Transcript\s*/i, "").trim() : "",
      title: (t ? t[1].replace(/[*#"]/g, "").trim() : "") || `${subjectName(n.subject_id)} class`,
      status: "ready", error: null
    });
    LocalDB.del("media", id).catch(() => {});
    toast("Notes ready: " + n.title); confetti(50);
  } catch (e) {
    const tries = (autoRetry[id]?.tries || 0) + 1;
    if (e.busy && tries <= 5) {
      const wait = [1, 2, 4, 8, 15][tries - 1];
      autoRetry[id] = { tries, timer: setTimeout(() => { delete autoRetry[id].timer; processNote(id); }, wait * 60000) };
      await patchNote(n, { status: "error", error: `${e.message}\n\nStudy Buddy will try again automatically in ${wait} minute${wait > 1 ? "s" : ""} while the app is open. Your file is saved on this device, so nothing is lost.` });
    } else {
      await patchNote(n, { status: "error", error: e instanceof FriendlyError ? e.message : "Something went wrong: " + e.message });
    }
  }
  processing.delete(id);
  rerender();
}

/* ---------- Recording: mic → 16 kHz mono MP3, encoded live so long classes stay small ---------- */
const MAX_REC_MIN = 75;
const loadScript = src => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); });
async function getEncoder() {
  if (!window.lamejs) { try { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js"); } catch {} }
  try { return window.lamejs ? new lamejs.Mp3Encoder(1, 16000, 24) : null; } catch { return null; }
}
function downsample(buf, from, to) {
  if (from === to) return buf;
  const ratio = from / to, out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(Math.floor((i + 1) * ratio), buf.length);
    let sum = 0; for (let j = a; j < b; j++) sum += buf[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}
const levels = new Array(36).fill(0);
function drawBars() { $("#bars").innerHTML = levels.map(l => `<i style="height:${Math.max(3, Math.min(30, l * 160))}px"></i>`).join(""); }
function setRecordingUI(on) {
  document.querySelectorAll("[data-record]").forEach(b => b.classList.toggle("on", on));
  $("#recDock").hidden = !on;
  $("#chatDock").hidden = on || !onChat() || !state.user;
}
async function startRecording(subjectId) {
  if (rec) { toast("Already recording"); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast("This browser can't record audio"); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { toast("Microphone access was blocked. Allow it in your browser settings."); return; }
  const encoder = await getEncoder(), start = new Date();
  rec = { stream, chunks: [], start: +start, created: start.toISOString(), encoder };
  if (encoder) {
    let ctx, src;
    try { ctx = new AudioContext({ sampleRate: 16000 }); src = ctx.createMediaStreamSource(stream); }
    catch { try { ctx?.close(); } catch {} ctx = new AudioContext(); src = ctx.createMediaStreamSource(stream); }
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    let frames = 0;
    proc.onaudioprocess = e => {
      const f = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate, 16000);
      const pcm = new Int16Array(f.length); let sq = 0;
      for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; sq += v * v; }
      const out = encoder.encodeBuffer(pcm);
      if (out.length) rec?.chunks.push(new Uint8Array(out));
      levels.push(Math.sqrt(sq / Math.max(1, f.length))); levels.shift();
      if (++frames % 2 === 0) drawBars();
    };
    src.connect(proc); proc.connect(ctx.destination);
    Object.assign(rec, { ctx, src, proc });
    if (ctx.state === "suspended") await ctx.resume();
  } else {
    const type = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 24000 } : {});
    mr.ondataavailable = e => e.data.size && rec?.chunks.push(e.data);
    mr.start(5000); rec.mr = mr;
  }
  try { rec.wake = await navigator.wakeLock?.request("screen"); } catch {}
  $("#recSubject").innerHTML = subjectOptions(subjectId ?? subjectAt(start));
  levels.fill(0); drawBars(); setRecordingUI(true);
  tick(); rec.timer = setInterval(tick, 500);
}
function tick() {
  if (!rec) return;
  const s = Math.floor((Date.now() - rec.start) / 1000);
  $("#timer").textContent = (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  if (s >= MAX_REC_MIN * 60) { toast(`Reached ${MAX_REC_MIN} minutes, making notes now`); stopRecording(true); }
}
async function stopRecording(keep) {
  if (!rec) return;
  const r = rec; rec = null;
  clearInterval(r.timer);
  try { r.wake?.release(); } catch {}
  let blob;
  if (r.mr) {
    if (r.mr.state !== "inactive") await new Promise(ok => { r.mr.onstop = ok; r.mr.stop(); });
    blob = new Blob(r.chunks, { type: (r.mr.mimeType || "audio/webm").split(";")[0] });
  } else {
    r.proc.disconnect(); r.src.disconnect(); r.ctx.close();
    const tail = r.encoder.flush(); if (tail.length) r.chunks.push(new Uint8Array(tail));
    blob = new Blob(r.chunks, { type: "audio/mpeg" });
  }
  r.stream.getTracks().forEach(t => t.stop());
  const subjectId = $("#recSubject").value;
  setRecordingUI(false);
  if (!keep) { toast("Recording discarded"); return; }
  if (blob.size < 2000) { toast("The recording was empty"); return; }
  createNote({ source: "recording", subjectId, parts: [{ mime: blob.type, blob }], minutes: Math.max(1, Math.round((Date.now() - r.start) / 60000)), created: r.created });
}
document.querySelectorAll("[data-record]").forEach(b => b.addEventListener("click", () => rec ? $("#stopBtn").focus() : startRecording()));
$("#stopBtn").onclick = () => stopRecording(true);
$("#cancelBtn").onclick = () => { if (confirm("Discard this recording?")) stopRecording(false); };
window.addEventListener("beforeunload", e => { if (rec || processing.size) { e.preventDefault(); e.returnValue = ""; } });

/* =====================================================================
   12. Account, settings, moving old notes, install
   ===================================================================== */
function applyTheme() {
  if (state.theme) document.documentElement.dataset.theme = state.theme; else delete document.documentElement.dataset.theme;
  const dark = state.theme === "dark" || (!state.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#17112C" : "#6C4CF1";
}
async function openAccount() {
  $("#modelSelect").value = [...$("#modelSelect").options].some(o => o.value === state.model) ? state.model : "gemini-3.5-flash-lite";
  $("#themeSelect").value = state.theme;
  $("#usageText").textContent = "Checking…"; $("#usageBar").style.width = "0";
  $("#accountDlg").showModal();
  try {
    const row = await q(sb.from("usage").select("requests").eq("day", new Date().toISOString().slice(0, 10)).maybeSingle());
    const used = row?.requests || 0;
    $("#usageBar").style.width = Math.min(100, used / DAILY_LIMIT * 100) + "%";
    $("#usageText").textContent = `${used} of ${DAILY_LIMIT} used today. Resets daily.`;
  } catch { $("#usageText").textContent = "Couldn't check right now."; }
}
document.querySelectorAll("[data-account]").forEach(b => b.addEventListener("click", openAccount));
$("#accountForm").addEventListener("submit", () => {
  state.model = $("#modelSelect").value; prefs.set("model", state.model);
  state.theme = $("#themeSelect").value; prefs.set("theme", state.theme); applyTheme();
});
$("#signOutBtn").onclick = async () => {
  if (rec && !confirm("You're recording. Sign out and discard it?")) return;
  if (rec) await stopRecording(false);
  $("#accountDlg").close();
  await sb.auth.signOut();
  onSignedOut();
};
$("#exportBtn").onclick = async () => {
  try {
    const messages = await q(sb.from("messages").select("*").order("created_at"));
    const backup = { app: "study-buddy", exported: new Date().toISOString(), account: state.user.email, subjects: data.subjects, slots: data.slots, notes: data.notes, chats: state.chats, messages };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" }));
    a.download = "study-buddy-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { saveFail(e); }
};

async function checkLegacy() {
  ui.legacy = null;
  if (prefs.get("imported." + state.user.id, false)) return;
  try {
    const [subjects, slots, notes] = await Promise.all([LocalDB.all("subjects"), LocalDB.all("slots"), LocalDB.all("notes")]);
    const messages = prefs.get("messages", []);
    const ready = notes.filter(n => n.status === "ready");
    if (subjects.length || ready.length) ui.legacy = { subjects, slots, notes: ready, messages };
  } catch {}
}
async function importLegacy(btn) {
  const L = ui.legacy; if (!L) return;
  btn.disabled = true; btn.textContent = "Moving…";
  try {
    const map = {};
    const subjects = L.subjects.map((s, i) => { map[s.id] = uuid(); return { id: map[s.id], name: s.name, code: s.code || null, color: s.color || COLORS[(data.subjects.length + i) % COLORS.length] }; });
    data.subjects.push(...await api.insertMany("subjects", subjects));
    data.slots.push(...await api.insertMany("slots", L.slots.filter(s => map[s.subjectId]).map(s => ({ id: uuid(), day: s.day, start_time: s.start, end_time: s.end, subject_id: map[s.subjectId] }))));
    data.notes.push(...await api.insertMany("notes", L.notes.map(n => ({
      id: uuid(), subject_id: map[n.subjectId] || null, source: n.source || "text", title: n.title || "Class notes", status: "ready",
      notes: n.notes || "", transcript: n.transcript || "", minutes: n.minutes || 0, file_name: n.fileName || null, thumbs: n.thumbs || [],
      flashcards: n.flashcards || null, quiz: n.quiz || null, scores: n.scores || [], created_at: n.created || new Date().toISOString()
    }))));
    const msgs = (L.messages || []).filter(m => m.text && !m.error && m.kind !== "notes");
    if (msgs.length) {
      const chat = await api.insert("chats", { id: uuid(), title: "Earlier chat" });
      state.chats.push(chat);
      await api.insertMany("messages", msgs.map(m => ({ id: uuid(), chat_id: chat.id, role: m.role === "user" ? "user" : "model", text: m.text, sources: m.sources || [] })));
    }
    await Promise.all(["subjects", "slots", "notes"].map(s => LocalDB.clear(s))).catch(() => {});
    prefs.del("messages"); prefs.set("imported." + state.user.id, true);
    ui.legacy = null; toast("Moved into your account"); rerender();
  } catch (e) { saveFail(e); btn.disabled = false; btn.textContent = "Try again"; }
}

let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
$("#installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").hidden = true; };

/* =====================================================================
   13. Start
   ===================================================================== */
let loadingFor = null;
async function onSignedIn(user) {
  if (loadingFor === user.id) return;
  loadingFor = user.id;
  state.user = user; state.loaded = false;
  setAccountUI();
  if (/access_token|error_description/.test(location.hash)) history.replaceState(null, "", location.pathname + "#/chat");
  route();
  try {
    const [subjects, slots, notes, chats] = await Promise.all([api.all("subjects"), api.all("slots"), api.all("notes", "created_at", false), api.all("chats", "updated_at", false)]);
    Object.assign(data, { subjects, slots, notes }); state.chats = chats;
  } catch (e) { saveFail(e); }
  // Notes that failed earlier because the AI was busy: try them again now, if the file is still on this device.
  for (const n of data.notes.filter(x => x.status === "error")) {
    if (await LocalDB.get("media", n.id).catch(() => null)) setTimeout(() => processNote(n.id), 3000);
  }
  for (const n of data.notes.filter(x => x.status === "processing")) {
    const local = await LocalDB.get("media", n.id).catch(() => null);
    const stale = Date.now() - new Date(n.created_at) > 10 * 60000;
    if (local) { patchNote(n, { status: "error", error: "The app was closed before the notes were finished. Retrying now…" }); setTimeout(() => processNote(n.id), 1500); }
    else if (stale) patchNote(n, { status: "error", error: "This didn't finish. If you started it on another device, retry it there." });
  }
  await checkLegacy();
  state.loaded = true;
  route();
}
function onSignedOut() {
  loadingFor = null;
  state.user = null; state.chats = []; state.chatId = null; state.messages = []; state.pinned = null; state.loaded = false;
  Object.assign(data, { subjects: [], slots: [], notes: [] });
  currentRoute = "";
  route();
}
(async function init() {
  document.querySelectorAll("[data-mark]").forEach(el => el.outerHTML = mark());
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  await LocalDB.open().catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!sb) { route(); return; }
  const hp = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
  if (hp.get("error_description")) { authMsg = hp.get("error_description").replace(/\+/g, " ") + ". Request a new link."; history.replaceState(null, "", location.pathname); }
  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) { if (!state.user || state.user.id !== session.user.id) setTimeout(() => onSignedIn(session.user)); }
    else if (event === "SIGNED_OUT" && state.user) setTimeout(onSignedOut);
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) onSignedIn(session.user); else route();
  setInterval(() => { if (currentRoute.startsWith("timetable") && state.loaded) renderTimetable(); }, 60000);
})();
