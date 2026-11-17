// Path model — pure logic, no DOM. Turns progress into the list of stops the home screen draws.
// Works in browser (window.Path) and Node (require).
//
// v2: units and days come from teaching positions (syllabus-order.json), new-word
// lessons hold 2 words, and each day ends with the optional hard "day check".
//
// Statuses: done · current (the one next lesson in the chain) · locked (finish the stop
// before it first) · open (optional and available: day checks, component lessons,
// bosses, legendary, stories, and reviews while the backlog is under the limit).
// Nothing is ever gated by date.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./syllabus.js"), require("./scheduler.js"));
  else root.Path = factory(root.Syllabus, root.Scheduler);
})(typeof self !== "undefined" ? self : this, function (Y, S) {
  const BACKLOG = 60;
  const LESSON_WORDS = 5; // target new words per lesson; a day splits evenly around it
  const REVIEW_WORDS = 12;

  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  // ceil(len / target) parts in order, sizes differing by at most 1 (10 → 5+5, 12 → 6+6)
  const balanced = (arr, target) => {
    const parts = Math.ceil(arr.length / target), out = [];
    let at = 0;
    for (let i = 0; i < parts; i++) {
      const size = Math.floor(arr.length / parts) + (i < arr.length % parts ? 1 : 0);
      out.push(arr.slice(at, at + size));
      at += size;
    }
    return out;
  };

  function dueWordIds(progress, today) {
    const ids = [];
    for (const k in progress.words) {
      const st = progress.words[k];
      if (st && st.introducedOn && S.isDue(st, today)) ids.push(Number(k));
    }
    const st = (id) => progress.words[String(id)];
    const priority = (id) => (st(id).leech ? 0 : st(id).writeRetry ? 1 : 2);
    return ids.sort((a, b) => priority(a) - priority(b) || (st(a).due < st(b).due ? -1 : st(a).due > st(b).due ? 1 : a - b));
  }

  function buildPath(progress, words, today, storiesAvailable, order) {
    const total = order.total;
    const pace = Y.normalizePace(progress.settings && progress.settings.pace);
    const introduced = (id) => !!(progress.words[String(id)] && progress.words[String(id)].introducedOn);
    const done = progress.done || {};
    const crowns = progress.crowns || {};
    const legendary = progress.legendary || {};
    const stories = progress.stories || {};
    const lip = progress.lessonInProgress || null;
    const firstUnmet = Y.firstUnmetPos(progress.words, order);
    const cursorUnit = Y.unitOfPos(firstUnmet === null ? total : firstUnmet);
    const lastUnit = Y.unitOfPos(total);
    const stops = [];

    const unitIds = (u) => {
      const r = Y.unitPosRange(u, total);
      const out = [];
      for (let p = r.first; p <= r.last; p++) out.push(order.idAt(p));
      return out;
    };
    const dayKey = (day) => `c-${day[0]}-${day[day.length - 1]}`;

    // a unit's component lesson opens after its first day check
    const component = (u, firstDay) => {
      const key = `u${u}-component`;
      stops.push({ key, kind: "component", unit: u, wordIds: firstDay.slice(), status: done[key] ? "done" : done[dayKey(firstDay)] ? "open" : "locked" });
    };

    const unitEnd = (u) => {
      const ids = unitIds(u);
      const allMet = ids.every(introduced);
      stops.push({ key: `u${u}-boss`, kind: "boss", unit: u, wordIds: ids, status: crowns[u] ? "done" : allMet ? "open" : "locked", crowned: !!crowns[u] });
      if (crowns[u]) stops.push({ key: `u${u}-legendary`, kind: "legendary", unit: u, wordIds: ids, status: legendary[u] ? "done" : "open" });
      // the story is the boss's reward: it opens after any boss attempt, crown or not
      const bossTried = crowns[u] || done[`u${u}-boss`];
      if (storiesAvailable.has(u)) {
        stops.push({ key: `u${u}-story`, kind: "story", unit: u, wordIds: [], status: stories[u] ? "done" : bossTried ? "open" : "locked" });
      } else {
        stops.push({ key: `u${u}-soon`, kind: "soon", unit: u, wordIds: [], status: "locked" });
      }
    };

    // past units collapse to their component lesson, boss, legendary and story
    for (let u = 1; u < cursorUnit; u++) {
      component(u, chunk(unitIds(u), pace)[0]);
      unitEnd(u);
    }

    // reviews: chunks of 12, leeches and writeRetry first, then oldest due
    const due = dueWordIds(progress, today);
    const backlog = due.length > BACKLOG;
    chunk(due, REVIEW_WORDS).forEach((ids, i) => {
      stops.push({ key: `rev-${today}-${i}`, kind: "review", unit: Y.unitOfPos(order.posOf(ids[0])), wordIds: ids, status: "open" });
    });

    // current unit: pace-sized days in teaching order, split into 2-word lessons.
    // Met words collapse into done lessons; the in-progress lesson stays whole.
    const lipWords = lip && lip.kind === "new" ? new Set(lip.wordIds) : new Set();
    let lipPlaced = false;
    const days = chunk(unitIds(cursorUnit), pace);
    days.forEach((day, di) => {
      const met = day.filter((id) => introduced(id) && !lipWords.has(id));
      const rest = day.filter((id) => !introduced(id) && !lipWords.has(id));
      for (const ids of balanced(met, LESSON_WORDS)) {
        stops.push({ key: `l-${ids[0]}-${ids[ids.length - 1]}`, kind: "lesson", unit: cursorUnit, wordIds: ids, status: "done" });
      }
      if (!lipPlaced && day.some((id) => lipWords.has(id))) {
        stops.push({ key: lip.key, kind: "lesson", unit: cursorUnit, wordIds: lip.wordIds.slice(), status: "pending", resume: true });
        lipPlaced = true;
      }
      for (const ids of balanced(rest, LESSON_WORDS)) {
        stops.push({ key: `l-${ids[0]}-${ids[ids.length - 1]}`, kind: "lesson", unit: cursorUnit, wordIds: ids, status: "pending" });
      }
      const key = dayKey(day);
      const dayMet = day.every(introduced) && !day.some((id) => lipWords.has(id));
      stops.push({ key, kind: "checkpoint", hard: true, unit: cursorUnit, wordIds: day, status: done[key] ? "done" : dayMet ? "open" : "locked" });
      if (di === 0) component(cursorUnit, day);
    });
    unitEnd(cursorUnit);

    // an in-progress lesson of another kind (a review, a pace-orphaned new lesson…)
    if (lip && !stops.some((s) => s.key === lip.key)) {
      // practice-tab sessions (mistakes, listen, practice, test-out…) wait as "open";
      // only an orphaned path lesson or review takes the chain
      const onPath = lip.kind === "new" || lip.kind === "review";
      stops.unshift({ key: lip.key, kind: lip.kind === "new" ? "lesson" : lip.kind, unit: Y.unitOfPos(order.posOf(lip.wordIds[0]) || 1), wordIds: lip.wordIds.slice(), status: onPath ? "pending" : "open", resume: true });
    } else if (lip) {
      const s = stops.find((x) => x.key === lip.key);
      s.resume = true;
      s.status = "pending";
    }

    // chain: the first pending stop is current, later pending lessons are locked.
    // Under a backlog the first review takes the current slot and lessons wait.
    let current = -1;
    if (backlog) {
      current = stops.findIndex((s) => s.kind === "review");
      stops[current].status = "current";
    }
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].status !== "pending") continue;
      if (current === -1 && !backlog) { stops[i].status = "current"; current = i; }
      else if (stops[i].resume) stops[i].status = "open"; // a started lesson can always be finished
      else stops[i].status = "locked";
    }

    const units = [];
    for (let u = 1; u <= lastUnit; u++) {
      const status = u < cursorUnit ? "past" : u === cursorUnit ? "current" : "future";
      units.push({ unit: u, status, testOut: status === "future" });
    }
    return { stops, current, units };
  }

  return { BACKLOG, LESSON_WORDS, REVIEW_WORDS, buildPath, dueWordIds };
});
