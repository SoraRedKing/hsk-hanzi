/* HSK 汉字 — app core: state, saving, audio, the HUD, date rollover, active time and boot.
   Screens live in ui-*.js; rules live in the pure modules (lesson, outcome, activity, path, rewards). */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const Y = window.Syllabus;

  const App = {
    state: {
      words: [], byId: new Map(), strokes: {}, progress: null,
      audioBase: "", linesBase: "", storiesBase: "", sentencesBase: "", stories: [], lines: [],
      order: null, sentences: [], sentenceById: new Map(),
      today: "", dirty: false,
    },
    memoryOnly: false,
    // --shot modes: stage a screen with in-memory data (saves are memory-only)
    shots: {
      lesson: () => UILesson._shot && UILesson._shot(),
      meet: () => UILesson._shotMeet(),
      recall: () => UILesson._shotRecall(),
      write: () => UILesson._shotWrite && UILesson._shotWrite(),
      sentence: () => UILesson._shotSentence && UILesson._shotSentence(),
      trace: () => UILesson._shotTrace(false),
      traceok: () => UILesson._shotTrace(true),
      finish: () => UIExtras._shot && UIExtras._shot(),
      stats: () => UIExtras._shotStats && UIExtras._shotStats(),
      story: () => UIStory._shot && UIStory._shot(),
      speed: () => UIExtras._shotSpeed && UIExtras._shotSpeed(),
      practice: () => { UIPractice.showWords(); },
    },
  };
  window.App = App;

  /* ---------- utilities ---------- */

  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toast._h);
    toast._h = setTimeout(() => { t.style.display = "none"; }, ms || 3500);
  }
  App.toast = toast;

  const audio = new Audio();
  // Plays one clip, stopping whatever was playing. Resolves when it ends (or fails).
  App.playUrl = function (url) {
    return new Promise((resolve) => {
      try {
        audio.pause();
        audio.onended = audio.onerror = () => resolve();
        audio.src = url;
        audio.play().catch(() => resolve());
      } catch (e) { resolve(); }
    });
  };
  App.playAudio = (id) => App.playUrl(App.state.audioBase + id + ".mp3");
  App.lineIds = () => new Set(App.state.lines.map((l) => l.id));
  App.playLine = (id) => (App.lineIds().has(id) ? App.playUrl(App.state.linesBase + id + ".mp3") : Promise.resolve());

  App.todayStr = () => App.state.today;
  App.esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  App.hanziHTML = function (word) {
    const chars = Array.from(word.hanzi);
    const tones = Tones.tonesForWord(word.hanzi, word.pinyin);
    return chars.map((c, i) => {
      const cls = tones === null ? "tx" : "t" + (tones[Math.min(i, tones.length - 1)] ?? 0);
      return `<span class="${cls}">${c}</span>`;
    }).join("");
  };
  function splitMeaning(m) {
    const i = m.indexOf("; ");
    if (i > 0 && i < 40 && /^[a-z（）()/ 、\-]+$/i.test(m.slice(0, i))) return { pos: m.slice(0, i), gloss: m.slice(i + 2) };
    return { pos: "", gloss: m };
  }
  App.gloss = (word) => splitMeaning(word.meaning).gloss;
  App.meaningHTML = function (word) {
    const { pos, gloss } = splitMeaning(word.meaning);
    return (pos ? `<span class="pos">${App.esc(pos)}</span>` : "") + App.esc(gloss);
  };

  /* ---------- persistence ---------- */

  let saveTimer = null;
  App.set = function (progress) {
    App.state.progress = progress;
    App.saveSoon();
  };
  App.saveSoon = function () {
    App.state.dirty = true;
    clearTimeout(saveTimer);
    // Resolve App.flushSave at fire time so memory-only mode can't be bypassed.
    saveTimer = setTimeout(() => App.flushSave(), 800);
  };
  App.flushSave = async function () {
    if (!App.state.dirty) return { ok: true };
    clearTimeout(saveTimer);
    App.state.dirty = false;
    try {
      const r = await window.api.saveProgress(App.state.progress);
      if (!r.ok) { toast("Saving failed: " + r.error); App.state.dirty = true; }
      return r;
    } catch (e) {
      toast("Saving failed: " + e.message);
      App.state.dirty = true;
      return { ok: false };
    }
  };
  App.useMemoryOnlySave = function () {
    clearTimeout(saveTimer);
    saveTimer = null;
    App.memoryOnly = true;
    App.lastSaved = null;
    App.flushSave = async () => {
      App.lastSaved = JSON.parse(JSON.stringify(App.state.progress));
      App.state.dirty = false;
      return { ok: true };
    };
    App.saveSoon = () => { App.state.dirty = true; };
  };

  /* ---------- derived data ---------- */

  App.word = (id) => App.state.byId.get(id);
  App.wordState = (id) => App.state.progress.words[String(id)] || null;
  App.introducedCount = () => Y.introducedCount(App.state.progress.words);
  App.knownIds = () => App.state.words.filter((w) => App.wordState(w.id)?.introducedOn).map((w) => w.id);
  App.storiesAvailable = () => new Set(App.state.stories.map((s) => s.unit));
  App.buildPath = () => Path.buildPath(App.state.progress, App.state.words, App.todayStr(), App.storiesAvailable(), App.state.order);
  App.unitIds = (u) => {
    const r = Y.unitPosRange(u, App.state.order.total);
    const out = [];
    for (let p = r.first; p <= r.last; p++) out.push(App.state.order.idAt(p));
    return out;
  };
  // Themed chapters (chapters.json): unit u's chapter, and the chapter day a word is taught on.
  App.chapter = (u) => (App.state.chapters || []).find((c) => c.unit === u) || null;
  App.chapterDay = (id) => {
    const pos = App.state.order.posOf(id);
    const ch = pos && App.chapter(Y.unitOfPos(pos));
    if (!ch) return null;
    let at = (Y.unitOfPos(pos) - 1) * Y.UNIT_SIZE;
    for (let i = 0; i < ch.days.length; i++) {
      at += ch.days[i].words.split(/\s+/).length;
      if (pos <= at) return { n: i + 1, ...ch.days[i] };
    }
    return null;
  };
  // Level 0 = words outside the HSK list, added because the learner met them on Duolingo.
  App.levelName = (lv) => (lv ? `HSK ${lv}` : "Duolingo extra");
  App.sentence = (id) => App.state.sentenceById.get(id);
  App.playSentence = (id) => App.playUrl(App.state.sentencesBase + id + ".mp3");
  App.boosted = () => Date.now() < (App.state.progress.boostUntil || 0);

  App.lessonCtx = function () {
    const weak = {};
    for (const k in App.state.progress.words) {
      const st = App.state.progress.words[k];
      weak[k] = (st.weak || 0) + (st.writeErrors || 0);
    }
    return {
      byId: App.state.byId,
      known: App.knownIds(),
      upcoming: Y.nextNewIds(App.state.progress.words, App.state.order, 25),
      strokes: App.state.strokes,
      weak,
      rng: Math.random,
      today: App.todayStr(),
      states: App.state.progress.words,
      sentences: App.state.sentences,
      parts: Parts.table(),
    };
  };

  // today's log entry counters (learned / reviewed / written / xp / perfect)
  App.bumpLog = function (field, n) {
    const p = Activity.creditActive(App.state.progress, App.todayStr(), 0);
    const e = p.log.find((x) => x.date === App.todayStr());
    e[field] = (e[field] || 0) + n;
    App.set(p);
  };

  App.track = function (ev) {
    const r = Rewards.track(App.state.progress, App.todayStr(), ev);
    App.set(r.progress);
    if (r.completed.length && window.UIExtras) UIExtras.onQuests(r);
    App.renderHud();
    return r;
  };

  App.refreshAchievements = function () {
    const r = Rewards.refreshAchievements(App.state.progress, App.state.words, App.todayStr());
    if (r.newly.length) {
      App.set(r.progress);
      const titles = r.newly.map((id) => Rewards.ACHIEVEMENTS.find((a) => a.id === id).title);
      toast("🏆 Achievement: " + titles.join(" · "), 4500);
    }
    return r.newly;
  };

  /* ---------- date rollover ---------- */

  // The date is re-read whenever the window regains focus, so an app left open
  // overnight still sees the new day: streak settled, quests renewed, path redrawn.
  App.refreshToday = function () {
    const today = Activity.localDate(new Date());
    const changed = today !== App.state.today;
    App.state.today = today;
    let p = Activity.rollover(App.state.progress, today);
    p = Rewards.track(p, today, { type: "tick" }).progress;
    App.set(p);
    if (changed) {
      App.renderHud();
      if (document.body.dataset.screen === "path") UIPath.render();
    }
    return changed;
  };
  window.addEventListener("focus", () => App.state.progress && App.refreshToday());
  document.addEventListener("visibilitychange", () => {
    if (!App.state.progress) return;
    if (document.hidden) App.flushSave();
    else App.refreshToday();
  });
  window.addEventListener("blur", () => App.flushSave());

  /* ---------- active time ---------- */

  App.tracker = new Activity.Tracker();
  document.addEventListener("keydown", () => App.tracker.input(), true);
  document.addEventListener("pointerdown", () => App.tracker.input(), true);
  App.creditActive = function (seconds) {
    if (!(seconds > 0)) return;
    const before = Activity.todaySeconds(App.state.progress, App.todayStr());
    const countBefore = App.state.progress.streak.count;
    App.set(Activity.creditActive(App.state.progress, App.todayStr(), seconds, new Date().getHours()));
    App.track({ type: "active", seconds });
    const after = before + seconds;
    if (before < Activity.STREAK_SECONDS && after >= Activity.STREAK_SECONDS) {
      toast("🔥 10 minutes — today counts for your streak!");
      Mascot.say("panda-streak");
      App.refreshAchievements();
    }
    const goal = Activity.goalSeconds(App.state.progress);
    if (before < goal && after >= goal) UIExtras.goalComplete();
    const count = App.state.progress.streak.count;
    if (count !== countBefore && Activity.milestoneFor(count)) UIExtras.milestone(count);
    App.renderHud();
  };
  setInterval(() => App.state.progress && App.creditActive(App.tracker.drain()), 5000);

  /* ---------- HUD ---------- */

  App.renderHud = function () {
    const p = App.state.progress;
    if (!p) return;
    const secs = Activity.todaySeconds(p, App.todayStr());
    const mins = Math.floor(secs / 60);
    const counted = (p.log.find((e) => e.date === App.todayStr()) || {}).streakCounted;
    $("#streak-n").textContent = p.streak.count;
    const repairToday = !!(p.streak.repair && Scheduler.addDays(p.streak.repair.brokenOn, 1) === App.todayStr());
    const st = $("#hud-streak");
    st.classList.toggle("cold", !counted && !repairToday);
    st.classList.toggle("repair", repairToday);
    st.classList.toggle("gold", p.streak.count >= 7 && !p.streak.usedFreeze);
    st.title = repairToday ? `🔧 Study 20 minutes today to repair your ${p.streak.repair.count}-day streak` : "Day streak · 10 active minutes keeps it";
    $("#streak-n").textContent = repairToday ? "🔧" : p.streak.count;
    $("#freeze-n").textContent = p.freezes ? "❄×" + p.freezes : "";
    const goal = Activity.goalSeconds(p), goalMin = goal / 60;
    $("#ring-fg").setAttribute("stroke-dasharray", `${Math.min(100, (secs / goal) * 100)} 100`);
    $("#hud-ring").classList.toggle("full", secs >= goal);
    $("#ring-label").textContent = `${Math.min(mins, goalMin)}/${goalMin}`;
    const q = p.quests && p.quests.date === App.todayStr() ? p.quests.items : [];
    $("#quest-n").textContent = `${q.filter((i) => i.done).length}/3`;
    $("#hud-mute").textContent = p.muted ? "🔇" : "🔊";

  };
  $("#hud-streak").addEventListener("click", () => {
    const p = App.state.progress;
    toast(`🔥 ${p.streak.count}-day streak · 10 active minutes keeps it · ❄ ${p.freezes || 0} freeze${p.freezes === 1 ? "" : "s"} held`);
  });
  $("#hud-ring").addEventListener("click", () => {
    const m = Math.floor(Activity.todaySeconds(App.state.progress, App.todayStr()) / 60);
    toast(`${m} of ${Activity.goalSeconds(App.state.progress) / 60} active minutes today · change your goal in Stats`);
  });
  $("#hud-mute").addEventListener("click", () => {
    App.set(Object.assign({}, App.state.progress, { muted: !App.state.progress.muted }));
    App.renderHud();
  });
  $("#hud-quests").addEventListener("click", () => UIExtras.openQuests());
  $("#hud-practice").addEventListener("click", () => UIPractice.open());
  $("#practice-back").addEventListener("click", () => App.go("path"));
  $("#radio-pinyin").addEventListener("click", () => { document.body.classList.toggle("show-pinyin"); $("#radio-pinyin").classList.toggle("on"); });
  $("#radio-en").addEventListener("click", () => { document.body.classList.toggle("show-en"); $("#radio-en").classList.toggle("on"); });
  $("#hud-stats").addEventListener("click", () => { UIExtras.renderStats(); App.go("stats"); });

  /* ---------- router + keys ---------- */

  const STUDY_SCREENS = ["lesson", "speed", "story", "radio"];
  App.go = function (screen) {
    App.flushSave();
    App.creditActive(App.tracker.drain());
    document.body.dataset.screen = screen;
    App.tracker.setActive(STUDY_SCREENS.includes(screen));
    if (screen === "path") { UIPath.render(); UIExtras.showReadyChest(); }
    App.renderHud();
  };

  document.addEventListener("keydown", (e) => {
    const screen = document.body.dataset.screen;
    if (screen === "lesson") return UILesson.onKey(e);
    if (screen === "speed") return UIExtras.onSpeedKey(e);
    if (screen === "story") return UIStory.onKey(e);
    if (screen === "practice" || screen === "radio") return UIPractice.onKey(e);
    if (e.key === "Escape" && (screen === "stats" || screen === "finish")) App.go("path");
    if (screen === "finish" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); UIExtras.finishContinue(); }
  });
  $("#stats-back").addEventListener("click", () => App.go("path"));

  App.openNext = function () {
    if (document.body.dataset.screen === "lesson") return;
    const P = App.buildPath();
    const next = P.stops[P.current] || P.stops.find((s) => s.status === "open");
    if (next) next.kind === "story" ? UIStory.start(next.unit) : UILesson.start(next);
  };

  /* ---------- boot ---------- */

  async function init() {
    const params = new URLSearchParams(location.search);
    const isSmoke = params.get("smoke") === "1";
    const shot = params.get("shot");
    // Install before loadAll: migration calls saveSoon, and a timer armed here
    // would otherwise fire the real saver mid-test.
    if (isSmoke || shot) App.useMemoryOnlySave();

    const data = await window.api.loadAll();
    App.state.words = data.words;
    App.state.strokes = data.strokes;
    App.state.audioBase = data.audioBase;
    App.state.linesBase = data.linesBase;
    App.state.storiesBase = data.storiesBase;
    App.state.stories = data.stories || [];
    App.state.sentencesBase = data.sentencesBase;
    App.state.order = Y.makeOrder(data.order);
    App.state.sentences = data.sentences || [];
    App.state.sentenceById = new Map(App.state.sentences.map((s) => [s.id, s]));
    App.state.chapters = data.chapters || [];
    Parts.load(data.components, data.componentMeanings);
    App.state.lines = data.lines || [];
    App.state.today = data.today;
    App.state.byId = new Map(data.words.map((w) => [w.id, w]));
    App.state.progress = Y.migrate(data.progress, data.today);
    if ((data.progress?.version || 1) < 4) App.saveSoon(); // persist the migrated shape
    App.refreshToday();
    App.refreshAchievements();
    if (data.restored) toast("Your progress file was damaged — restored automatically from the latest backup.");

    Mascot.mount($("#hud-mascot"));
    UIPath.onStart((stop) => {
      if (stop.kind === "story") return UIStory.start(stop.unit);
      UILesson.start(stop);
    });
    App.go("path");
    const s = App.state.progress.streak;
    if (!isSmoke && !shot) setTimeout(() => Mascot.say(s.count === 0 && s.lastStudyDate ? "panda-comeback" : "panda-greet"), 600);
    window.api.log(`APP READY words=${data.words.length}`);

    if (isSmoke) {
      try { await window.runSmoke(); } catch (e) { window.api.log("SMOKE CRASH " + (e.stack || e.message)); window.api.smokeDone(1); }
    }
    if (shot && App.shots[shot]) App.shots[shot]();
    // opened from the reminder notification: go straight into the next lesson
    if (params.get("openNext") === "1") App.openNext();
    if (window.api.onOpenNext) window.api.onOpenNext(() => App.openNext());
    if (!isSmoke && !shot) setTimeout(() => UIExtras.maybeAskReminder(), 1500);
  }

  init();
})();
