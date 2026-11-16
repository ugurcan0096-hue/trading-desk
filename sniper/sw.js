/* Meme Sniper service worker: app shell works offline; market data always from network. */
const CACHE = "sniper-v2";
const SHELL = ["./", "./index.html", "./sniper.css", "./engine.js", "./feed.js", "./app.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-192-maskable.png", "./icons/icon-512-maskable.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sniper-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // DexScreener / RugCheck: never cached
  e.respondWith(
    fetch(req, { cache: "no-store" }).then((res) => {
      if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => {
      if (r) return r;
      if (req.mode === "navigate") return caches.match("./index.html");
      return new Response("", { status: 504, statusText: "offline" });
    }))
  );
});
