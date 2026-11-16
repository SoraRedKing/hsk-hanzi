/* Web/iPad stand-in for the Electron preload bridge (window.api).
   Data comes from static JSON next to the page; progress lives in localStorage on this device. */
(function () {
  const KEY = "hsk-hanzi-progress-v1";
  const KEY_PREV = "hsk-hanzi-progress-prev";
  document.documentElement.classList.add("web");

  const pad = (x) => String(x).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const defaultProgress = () => ({ version: 2, settings: { pace: 12 }, streak: { count: 0, lastStudyDate: null }, words: {}, log: [] });
  const getJSON = async (p, optional) => {
    try { const r = await fetch(p); if (!r.ok) throw new Error(p + " " + r.status); return await r.json(); }
    catch (e) { if (optional) return []; throw e; }
  };

  function readProgress() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { progress: JSON.parse(raw), restored: false };
    } catch (e) {
      try { const prev = localStorage.getItem(KEY_PREV); if (prev) return { progress: JSON.parse(prev), restored: true }; } catch (e2) { /* fall through */ }
      return { progress: defaultProgress(), restored: true };
    }
    return { progress: defaultProgress(), restored: false };
  }

  window.api = {
    async loadAll() {
      const [words, strokes, order, sentences, stories, lines, chapters, components, componentMeanings] = await Promise.all([
        getJSON("data/words.json"), getJSON("data/strokes.json"), getJSON("data/order.json"),
        getJSON("data/sentences.json", true), getJSON("data/stories.json", true), getJSON("data/lines.json", true),
        getJSON("data/chapters.json", true), getJSON("data/components.json", true), getJSON("data/component-meanings.json", true),
      ]);
      const { progress, restored } = readProgress();
      const abs = new URL("audio/", location.href).href;
      return {
        words, strokes, progress, restored, audioBase: abs, today: todayStr(),
        stories, lines, linesBase: abs + "lines/", storiesBase: abs + "stories/", sentencesBase: abs + "sentences/",
        order, sentences, components, componentMeanings, chapters,
      };
    },
    async saveProgress(progress) {
      try {
        const old = localStorage.getItem(KEY);
        if (old) localStorage.setItem(KEY_PREV, old);
        localStorage.setItem(KEY, JSON.stringify(progress));
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    log() {},
    smokeDone() {},
    async reminder() { return { ok: false, error: "Reminders are not available on iPad" }; },
    onOpenNext() {},
  };

  // Ask Safari not to evict this app's storage.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((reg) => {
        // After the app itself is cached, fetch all audio quietly in the background.
        if (reg.active) reg.active.postMessage({ type: "cache-audio" });
      }).catch(() => {});
    });
  }
})();
