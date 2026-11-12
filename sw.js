/* Trading Desk service worker — network-first for HTML/JS/CSS, cache fallback. */
const CACHE = "desk-shell-v5";
const SHELL = [
  "./", "./index.html", "./app.css", "./app.js", "./desk-config.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-192-maskable.png", "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

function isShellRequest(request, url) {
  if (request.mode === "navigate") return true;
  const p = url.pathname;
  return /\.(?:html|js|css)$/i.test(p) || p.endsWith("/trading-desk") || p.endsWith("/trading-desk/");
}

function isPageRequest(request, url) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  const p = url.pathname;
  return /\.html$/i.test(p) || p.endsWith("/trading-desk") || p.endsWith("/trading-desk/") || p.endsWith("/");
}

function fallback(request, url) {
  return caches.match(request).then((r) => {
    if (r) return r;
    // Never serve index.html for scripts/styles — that parses as a JS SyntaxError
    // and leaves a blank screen on the phone.
    if (isPageRequest(request, url)) return caches.match("./index.html");
    return undefined;
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/d/")) return;

  if (isShellRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => fallback(event.request, url))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      });
      return cached || fetched;
    }).catch(() => fallback(event.request, url))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { body: event.data ? event.data.text() : "Update" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Trading Desk", {
    body: data.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) { c.navigate(target); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
