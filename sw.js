// Keeps the app shell available offline. Questions still need internet.
const CACHE = "study-buddy-v6";
const SHELL = ["./", "index.html", "app.css", "app.js", "config.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-32.png"];
const LAME = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    try { await c.add(LAME); } catch {}
  }));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin && url.href !== LAME) return; // never cache Supabase or Gemini calls
  // Network first, so updates show up; cache when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
