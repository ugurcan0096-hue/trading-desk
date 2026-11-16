/* Yörünge service worker: works offline after the first visit. */
const CACHE = "yorunge-v7";
const SHELL = ["./", "./index.html", "./game.js", "./platform.js", "./i18n.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-192-maskable.png", "./icons/icon-512-maskable.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("yorunge-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: "no-store" }).then((res) => {
    if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : new Response("", { status: 504 })))));
});
