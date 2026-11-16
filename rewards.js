// XP, daily quests, chests, the monthly badge and achievements — pure logic, no DOM.
// Works in browser (window.Rewards) and Node (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rewards = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const FREEZE_CAP = 2;
  const BOOST_MS = 15 * 60 * 1000;
  const MONTHLY_TARGET = 40;
  const MONTH_BADGES = ["雪", "梅", "春", "花", "竹", "夏", "荷", "月", "秋", "枫", "冬", "福"];

  function lessonXp({ perfect, maxCombo, boosted, kind }) {
    const xp = kind === "legendary" ? 40 : 10 + (perfect ? 5 : 0) + Math.floor((maxCombo || 0) / 5) + (kind === "hard" ? 10 : 0);
    return boosted ? xp * 2 : xp;
  }

  // mode "max": progress is the best single value seen; "sum": values add up.
  const QUEST_POOL = [
    { id: "combo10", text: "Get 10 right in a row", event: "combo", target: 10, mode: "max" },
    { id: "write8", text: "Write 8 characters from memory", event: "write", target: 8, mode: "sum" },
    { id: "lessons2", text: "Finish 2 lessons", event: "lesson", target: 2, mode: "sum" },
    { id: "active20", text: "Do 20 active minutes", event: "active", target: 1200, mode: "sum" },
    { id: "speed30", text: "Score 30 in a speed round", event: "speed", target: 30, mode: "max" },
    { id: "perfect1", text: "Finish a perfect lesson", event: "lesson", target: 1, mode: "sum", perfectOnly: true },
    { id: "combo20", text: "Get 20 right in a row", event: "combo", target: 20, mode: "max" },
    { id: "write15", text: "Write 15 characters from memory", event: "write", target: 15, mode: "sum" },
    { id: "lessons4", text: "Finish 4 lessons", event: "lesson", target: 4, mode: "sum" },
    { id: "active40", text: "Do 40 active minutes", event: "active", target: 2400, mode: "sum" },
  ];

  function seeded(str) {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return function () {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  // Three distinct quests, never two driven by the same event, so one action
  // can't tick off two quests at once.
  function questsFor(dateStr, stats) {
    const rng = seeded("quests:" + dateStr);
    const left = QUEST_POOL.slice(), out = [], events = new Set();
    while (out.length < 3 && left.length) {
      const q = left.splice(Math.floor(rng() * left.length), 1)[0];
      if (events.has(q.event)) continue;
      events.add(q.event);
      out.push(Object.assign({}, q, { target: targetFor(q.id, stats) }));
    }
    return out;
  }

  // Averages over the last 7 days before today that had any activity, so quests
  // ask for a bit of what the learner actually does rather than a fixed wall.
  function statsFor(progress, today) {
    const from = addDays(today, -7);
    const days = (progress.log || []).filter((e) => e.date >= from && e.date < today && (e.activeSeconds || 0) > 0);
    const avg = (f) => (days.length ? days.reduce((a, e) => a + (e[f] || 0), 0) / days.length : 0);
    return {
      avgMinutes: Math.round(avg("activeSeconds") / 60),
      speedBest: progress.speedBest || 0,
      avgLessons: Math.round(avg("lessons")),
      avgWrites: Math.round(avg("written")),
    };
  }

  function targetFor(id, stats) {
    const q = QUEST_POOL.find((x) => x.id === id);
    if (!q || !stats) return q ? q.target : 0;
    const m = stats.avgMinutes || 0, l = stats.avgLessons || 0, w = stats.avgWrites || 0;
    switch (id) {
      case "active20": return Math.max(10, m) * 60;
      case "active40": return Math.max(15, Math.round(m * 1.5)) * 60;
      case "speed30": return Math.max(10, (stats.speedBest || 0) + 3);
      case "lessons2": return Math.max(2, l);
      case "lessons4": return Math.max(3, Math.round(l * 1.5));
      case "write8": return Math.max(3, w);
      case "write15": return Math.max(5, Math.round(w * 1.5));
      default: return q.target;
    }
  }

  // Quest wording follows the (adaptive) target, so the label never drifts from it.
  function questText(id, target) {
    const q = QUEST_POOL.find((x) => x.id === id);
    if (!q) return "";
    const t = target || q.target;
    switch (q.event) {
      case "combo": return `Get ${t} right in a row`;
      case "write": return `Write ${t} characters from memory`;
      case "lesson": return q.perfectOnly ? q.text : `Finish ${t} lessons`;
      case "active": return `Do ${Math.round(t / 60)} active minutes`;
      case "speed": return `Score ${t} in a speed round`;
    }
    return q.text;
  }

  function freshQuests(date, stats) {
    return { date, items: questsFor(date, stats).map((q) => ({ id: q.id, progress: 0, done: false, target: q.target })), chest: null };
  }

  // Early bird: the first lesson finished before 09:00 starts 15 minutes of double XP.
  function earlyBird(progress, now) {
    const p = clone(progress);
    const z = (x) => String(x).padStart(2, "0");
    const today = `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}`;
    let e = (p.log || []).find((x) => x.date === today);
    if (now.getHours() >= 9 || (e && e.earlyBird)) return p;
    if (!e) { e = { date: today, learned: 0, reviewed: 0, written: 0, activeSeconds: 0, xp: 0, streakCounted: false, perfect: 0, lateMinutes: 0 }; p.log = (p.log || []).concat([e]); }
    e.earlyBird = true;
    p.boostUntil = now.getTime() + BOOST_MS;
    return p;
  }

  function eventValue(q, ev) {
    if (q.event !== ev.type) return null;
    switch (ev.type) {
      case "combo": return ev.n;
      case "write": return ev.n || 1;
      case "lesson": return q.perfectOnly && !ev.perfect ? null : ev.n || 1;
      case "active": return ev.seconds;
      case "speed": return ev.score;
    }
    return null;
  }

  function track(progress, today, ev) {
    const p = clone(progress);
    if (!p.quests || p.quests.date !== today) p.quests = freshQuests(today, statsFor(p, today));
    const month = today.slice(0, 7);
    if (!p.monthly || p.monthly.month !== month) p.monthly = { month, count: 0 };
    const completed = [];
    for (const item of p.quests.items) {
      const q = QUEST_POOL.find((x) => x.id === item.id);
      if (!q || item.done) continue;
      const v = eventValue(q, ev);
      if (v === null || v === undefined) continue;
      item.progress = q.mode === "max" ? Math.max(item.progress, v) : item.progress + v;
      const target = item.target || q.target;
      if (item.progress >= target) {
        item.progress = target;
        item.done = true;
        completed.push(q);
        p.monthly.count++;
        if (p.monthly.count >= MONTHLY_TARGET && !p.badges.some((b) => b.month === month)) {
          p.badges.push({ month, char: MONTH_BADGES[Number(month.slice(5)) - 1] });
        }
      }
    }
    let chest = false;
    if (completed.length && p.quests.chest === null && p.quests.items.every((i) => i.done)) {
      p.quests.chest = "ready";
      chest = true;
    }
    return { progress: p, completed, chest };
  }

  function openChest(progress, nowMs) {
    const p = clone(progress);
    let reward;
    if ((p.freezes || 0) < FREEZE_CAP) { p.freezes = (p.freezes || 0) + 1; reward = "freeze"; }
    else { p.boostUntil = nowMs + BOOST_MS; reward = "boost"; }
    if (p.quests) p.quests.chest = "opened";
    return { progress: p, reward };
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + n);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  function nextDay(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  const sumLog = (p, f) => (p.log || []).reduce((a, e) => a + (e[f] || 0), 0);
  function consecutivePerfectDays(p) {
    const dates = (p.log || []).filter((e) => (e.perfect || 0) > 0).map((e) => e.date).sort();
    let best = 0, run = 0, prev = null;
    for (const d of dates) {
      const next = prev && nextDay(prev);
      run = prev && next === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return best;
  }

  const ACHIEVEMENTS = [
    { id: "write100", title: "100 characters written", test: (p) => sumLog(p, "written") >= 100 },
    { id: "write500", title: "500 characters written", test: (p) => sumLog(p, "written") >= 500 },
    { id: "hsk1", title: "HSK 1 complete", test: (p, words) => words.filter((w) => w.level === 1).every((w) => p.words[String(w.id)] && p.words[String(w.id)].introducedOn) },
    { id: "hsk2", title: "HSK 2 complete", test: (p, words) => words.filter((w) => w.level <= 2).every((w) => p.words[String(w.id)] && p.words[String(w.id)].introducedOn) },
    { id: "streak7", title: "7-day streak", test: (p) => p.streak.count >= 7 },
    { id: "streak30", title: "30-day streak", test: (p) => p.streak.count >= 30 },
    { id: "streak100", title: "100-day streak", test: (p) => p.streak.count >= 100 },
    { id: "streak365", title: "365-day streak", test: (p) => p.streak.count >= 365 },
    { id: "perfectStreak", title: "Perfect week (no freezes)", test: (p) => p.streak.count >= 7 && !p.streak.usedFreeze },
    { id: "firstBoss", title: "First boss beaten", test: (p) => Object.keys(p.crowns || {}).length > 0 },
    { id: "perfectWeek", title: "Perfect week", test: (p) => consecutivePerfectDays(p) >= 7 },
    { id: "nightOwl", title: "Night owl", test: (p) => (p.log || []).some((e) => (e.lateMinutes || 0) > 0) },
    { id: "firstStory", title: "First story read", test: (p) => Object.keys(p.stories || {}).length > 0 },
    { id: "speed40", title: "Speed demon (40 in a round)", test: (p) => (p.speedBest || 0) >= 40 },
  ];

  function refreshAchievements(progress, words, today) {
    const p = clone(progress);
    p.achievements = p.achievements || {};
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements[a.id] && a.test(p, words)) { p.achievements[a.id] = today; newly.push(a.id); }
    }
    return { progress: p, newly };
  }

  return { lessonXp, QUEST_POOL, questText, questsFor, targetFor, statsFor, earlyBird, track, openChest, MONTHLY_TARGET, MONTH_BADGES, ACHIEVEMENTS, refreshAchievements, BOOST_MS };
});
