/* ML Trainer service worker.
 *
 * Three routes, by what the asset actually is:
 *
 *   local shell  (html/js/css/manifest/icons) -> stale-while-revalidate
 *   local content (content/*.json)            -> stale-while-revalidate
 *   pinned CDN   (KaTeX at a fixed version)   -> cache-first, it never changes
 *
 * The shell is deliberately NOT cache-first. Cache-first would mean every code
 * push needed a manual SHELL_VERSION bump or installed copies would serve stale
 * JS forever — easy to forget, and silent when forgotten. Stale-while-revalidate
 * still paints instantly from cache and still works offline; it just picks the
 * new build up on the next open.
 */

const SHELL_VERSION = "v1";
const SHELL_CACHE = `mltrainer-shell-${SHELL_VERSION}`;
const CONTENT_CACHE = "mltrainer-content";

const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";

/* Every woff2 referenced by katex.min.css. They are precached so a formula
 * renders with real maths glyphs offline, not fallback boxes. */
const KATEX_FONTS = [
  "KaTeX_AMS-Regular", "KaTeX_Caligraphic-Bold", "KaTeX_Caligraphic-Regular",
  "KaTeX_Fraktur-Bold", "KaTeX_Fraktur-Regular", "KaTeX_Main-Bold",
  "KaTeX_Main-BoldItalic", "KaTeX_Main-Italic", "KaTeX_Main-Regular",
  "KaTeX_Math-BoldItalic", "KaTeX_Math-Italic", "KaTeX_SansSerif-Bold",
  "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Regular", "KaTeX_Script-Regular",
  "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular",
  "KaTeX_Size4-Regular", "KaTeX_Typewriter-Regular",
].map((name) => `${KATEX}/fonts/${name}.woff2`);

const SHELL_ASSETS = [
  ".",
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  `${KATEX}/katex.min.css`,
  `${KATEX}/katex.min.js`,
  ...KATEX_FONTS,
];

/** Cache each asset independently: one CDN hiccup must not fail the install. */
async function precache(cache, urls) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      // Cross-origin CDN assets need an explicit cors request to be cacheable
      // with a readable response.
      const request = url.startsWith("http")
        ? new Request(url, { mode: "cors", credentials: "omit" })
        : new Request(url, { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      await cache.put(request, response);
    })
  );
  const failed = results
    .map((r, i) => (r.status === "rejected" ? urls[i] : null))
    .filter(Boolean);
  if (failed.length) console.warn("precache misses", failed);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await precache(cache, SHELL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("mltrainer-shell-") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** Serve the cached copy immediately, refresh it in the background.
 *  `event` is needed so waitUntil keeps the revalidation alive after the
 *  cached response has already been returned. */
async function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => null);

  // A cached deck renders instantly; app.js re-validates whatever it receives,
  // so a bad content push is caught there rather than here.
  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  // Offline with nothing cached. A navigation still gets the shell; content
  // gets an empty deck so app.js can fall back to its localStorage copy.
  if (request.mode === "navigate") {
    const shell = await caches.match("index.html");
    if (shell) return shell;
  }
  return new Response("[]", { headers: { "Content-Type": "application/json" } });
}

/** Pinned CDN assets never change under their URL, so cache-first is correct. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isLocal = url.origin === self.location.origin;
  const isContent = isLocal && url.pathname.includes("/content/");

  if (!isLocal) {
    event.respondWith(cacheFirst(request));      // KaTeX, pinned by version
  } else {
    event.respondWith(
      staleWhileRevalidate(event, isContent ? CONTENT_CACHE : SHELL_CACHE)
    );
  }
});
