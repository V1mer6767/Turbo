const CACHE = "turbo-cache-v40";
const ASSETS = ["./", "index.html", "style.css", "manifest.json", "js/main.js", "js/world.js", "js/car.js", "js/trackmath.js", "js/audio.js", "js/models.js", "js/arena.js", "js/engine-worklet.js", "vendor/jsm/GLTFLoader.js", "vendor/jsm/BufferGeometryUtils.js", "vendor/three.module.min.js", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "icons/favicon-32.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => fetch(new Request(u, { cache: "reload" })).then(r => { if (!r.ok) throw new Error(u); return c.put(u, r); })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname;
  if (path.endsWith("version.json")) return;   // завжди з мережі
  if (/\.(js|css|html)$|\/$/.test(path)) {      // код: спершу мережа, кеш лише офлайн
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req, { cache: "no-cache" }).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; }).catch(() => hit);
    return hit || net;
  }));
});
