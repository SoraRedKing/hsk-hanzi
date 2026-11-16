/* Offline cache for HSK 汉字. The version and file list below are filled in by tools/build_web.js. */
const VERSION = "20261116114919";
const SHELL = `hsk-shell-${VERSION}`;
const AUDIO = "hsk-audio-v1"; // audio never changes in place, so it survives app updates
const SHELL_FILES = ["activity.js","app.js","data/chapters.json","data/component-meanings.json","data/components.json","data/lines.json","data/order.json","data/sentences.json","data/stories.json","data/strokes.json","data/words.json","extras.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","./","lesson.js","manifest.webmanifest","mascot.js","outcome.js","parts.js","path.js","rewards.js","scheduler.js","sfx.js","shim.js","styles.css","syllabus.js","tones.js","ui-extras.js","ui-lesson.js","ui-path.js","ui-practice.js","ui-story.js","vendor/hanzi-writer.min.js","web.css","index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("hsk-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Safari only plays media from a service worker if range requests get 206 answers.
async function rangeResponse(req, res) {
  const range = req.headers.get("range");
  if (!range || !res || res.status !== 200) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : buf.byteLength - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, buf.byteLength - parseInt(m[2], 10)); end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: "Partial Content",
    headers: { "Content-Type": res.headers.get("Content-Type") || "audio/mpeg", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`, "Accept-Ranges": "bytes" },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/audio/")) {
    e.respondWith((async () => {
      const cache = await caches.open(AUDIO);
      const key = new Request(req.url); // ignore Range header when matching
      let hit = await cache.match(key);
      if (!hit) {
        const net = await fetch(key).catch(() => null);
        if (!net || !net.ok) return net || new Response("", { status: 504 });
        await cache.put(key, net.clone());
        hit = net;
      }
      return rangeResponse(req, hit);
    })());
    return;
  }

  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(req); } catch (err) { return (await c.match("./index.html")) || Response.error(); }
    })
  );
});

self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "cache-audio") return;
  e.waitUntil((async () => {
    const list = await (await fetch("data/audio-index.json")).json();
    const cache = await caches.open(AUDIO);
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
    const base = new URL("./", self.registration.scope).pathname;
    const todo = list.filter((f) => !have.has(base + f));
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map((f) => fetch(f).then((r) => (r.ok ? cache.put(new Request(f), r) : null)).catch(() => {})));
    }
  })());
});
