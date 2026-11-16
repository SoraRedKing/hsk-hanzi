// Pace-aware syllabus math — pure logic, no DOM. Works in browser (window.Syllabus) and Node (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Syllabus = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // 10/day lines days up with the themed chapters (chapters.json: six 10-word topic days a unit)
  const PACE_OPTIONS = [10, 12, 25];
  const DEFAULT_PACE = 10;
  const LEGACY_PACE = 25; // every pre-v2 profile was batched at 25/day

  function normalizePace(v) {
    return PACE_OPTIONS.includes(v) ? v : DEFAULT_PACE;
  }

  // Units are fixed 60-word ranges. Days never cross a unit end, so the boss and
  // story always close a day, and a pace change never moves a unit boundary.
  const UNIT_SIZE = 60;

  function unitOf(wordId) {
    return Math.ceil(wordId / UNIT_SIZE);
  }

  function unitRange(unit, total) {
    return { first: (unit - 1) * UNIT_SIZE + 1, last: Math.min(unit * UNIT_SIZE, total) };
  }

  function daysInUnit(unit, pace, total) {
    const r = unitRange(unit, total);
    return Math.ceil((r.last - r.first + 1) / normalizePace(pace));
  }

  function totalDays(total, pace) {
    let n = 0;
    for (let u = 1; u <= unitOf(total); u++) n += daysInUnit(u, pace, total);
    return n;
  }

  // Day number the learner is currently ON. null once the syllabus is finished.
  function dayNumber(introduced, pace, total) {
    if (introduced >= total) return null;
    const unit = unitOf(introduced + 1);
    let day = 0;
    for (let u = 1; u < unit; u++) day += daysInUnit(u, pace, total);
    const within = introduced - unitRange(unit, total).first + 1;
    return day + Math.floor(within / normalizePace(pace)) + 1;
  }

  // The next `pace` word ids that have not been introduced yet, stopping at the
  // end of the current unit. Never re-teaches, never skips — which is what makes
  // a mid-course pace change lossless.
  function batchIds(introduced, pace, total) {
    const out = [];
    if (introduced >= total) return out;
    const unitEnd = unitRange(unitOf(introduced + 1), total).last;
    const last = Math.min(introduced + normalizePace(pace), unitEnd);
    for (let id = introduced + 1; id <= last; id++) out.push(id);
    return out;
  }

  /* ---- v2: teaching order. Positions (1-based) replace ids as the cursor. ---- */
  function makeOrder(orderIds) {
    const pos = new Map(orderIds.map((id, i) => [id, i + 1]));
    return { ids: orderIds.slice(), posOf: (id) => pos.get(id), idAt: (p) => orderIds[p - 1], total: orderIds.length };
  }
  const unitOfPos = unitOf;
  const unitPosRange = unitRange;
  const isMet = (words, id) => !!(words[String(id)] && words[String(id)].introducedOn);

  function firstUnmetPos(words, order) {
    for (let p = 1; p <= order.total; p++) if (!isMet(words, order.idAt(p))) return p;
    return null;
  }

  // The next `pace` unmet words in teaching order, never past the current unit's
  // end. Words already met (e.g. from the old alphabetical order) are skipped.
  function nextNewIds(words, order, pace) {
    const p0 = firstUnmetPos(words, order);
    if (p0 === null) return [];
    const last = unitPosRange(unitOfPos(p0), order.total).last;
    const out = [];
    for (let p = p0; p <= last && out.length < normalizePace(pace); p++) {
      const id = order.idAt(p);
      if (!isMet(words, id)) out.push(id);
    }
    return out;
  }

  // Day the learner is on, counting met positions inside the current unit.
  function dayOf(words, order, pace) {
    const p0 = firstUnmetPos(words, order);
    if (p0 === null) return null;
    const unit = unitOfPos(p0);
    let day = 0;
    for (let u = 1; u < unit; u++) day += daysInUnit(u, pace, order.total);
    const r = unitPosRange(unit, order.total);
    let met = 0;
    for (let p = r.first; p <= r.last; p++) if (isMet(words, order.idAt(p))) met++;
    return day + Math.floor(met / normalizePace(pace)) + 1;
  }

  // Words are always introduced in id order, so this count is also the cursor.
  function introducedCount(words) {
    let n = 0;
    for (const k in words) if (words[k] && words[k].introducedOn) n++;
    return n;
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + n);
    const z = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  // v3 -> v4: v2 lessons, settings, streak repair. `today` lets the step give back a
  // streak that one missed day broke before freezes could be earned.
  function toV4(p, today) {
    p.freezes = Math.max(p.freezes || 0, 2);
    const s = p.streak;
    // "One missed day": either today is the day after the miss, or the learner was
    // back (any activity) the day after it — then a later install still counts it.
    const back = s.lastStudyDate && p.log.some((e) => e.date === addDays(s.lastStudyDate, 2) && (e.activeSeconds || 0) > 0);
    if (today && s.count === 0 && s.lastStudyDate && (addDays(s.lastStudyDate, 2) === today || (back && addDays(s.lastStudyDate, 2) < today))) {
      const missed = addDays(s.lastStudyDate, 1);
      const counted = new Set(p.log.filter((e) => e.streakCounted).map((e) => e.date));
      let prev = 0;
      for (let d = s.lastStudyDate; counted.has(d); d = addDays(d, -1)) prev++;
      if (prev > 0 && !counted.has(missed)) {
        let e = p.log.find((x) => x.date === missed);
        if (!e) { e = { date: missed, learned: 0, reviewed: 0, written: 0, activeSeconds: 0, xp: 0, streakCounted: false, perfect: 0, lateMinutes: 0 }; p.log.push(e); p.log.sort((a, b) => (a.date < b.date ? -1 : 1)); }
        e.frozen = true;
        p.freezes--;
        s.count = prev;
        s.lastStudyDate = missed;
        s.usedFreeze = true;
      }
    }
    // v1 already restarted the streak after the miss (count = the run since then):
    // freeze the single missed day before that run and join the two runs.
    if (s.count > 0 && s.lastStudyDate) {
      const counted = new Set(p.log.filter((e) => e.streakCounted).map((e) => e.date));
      let after = 0, d = s.lastStudyDate;
      for (; counted.has(d); d = addDays(d, -1)) after++;
      const gap = d, beforeEnd = addDays(gap, -1);
      let before = 0;
      for (let x = beforeEnd; counted.has(x); x = addDays(x, -1)) before++;
      if (after === s.count && before > 0 && !s.usedFreeze && p.freezes > 0) {
        let e = p.log.find((x) => x.date === gap);
        if (!e) { e = { date: gap, learned: 0, reviewed: 0, written: 0, activeSeconds: 0, xp: 0, streakCounted: false, perfect: 0, lateMinutes: 0 }; p.log.push(e); p.log.sort((a, b) => (a.date < b.date ? -1 : 1)); }
        e.frozen = true;
        p.freezes--;
        s.count = after + before;
        s.usedFreeze = true;
      }
    }
    // v3 lessons were built for the old lesson format and id-based days
    p.lessonInProgress = null;
    for (const k of Object.keys(p.done || {})) if (/^[lc]-/.test(k)) delete p.done[k];
  }

  // v1 (day-keyed) -> v2 (word-keyed) -> v3 (game state) -> v4 (v2 lessons). Pure and idempotent.
  function migrate(progress, today) {
    const p = progress ? JSON.parse(JSON.stringify(progress)) : {};
    const from = p.version || 1;
    if (!p.streak) p.streak = { count: 0, lastStudyDate: null };
    if (!p.words) p.words = {};
    if (!p.log) p.log = [];
    if (!p.settings) p.settings = {};
    p.settings.pace = normalizePace(p.settings.pace);

    if (p.days) {
      for (const key of Object.keys(p.days)) {
        const d = parseInt(key, 10);
        const rec = p.days[key];
        if (!d || !rec) continue;
        const on = rec.learnedOn || (rec.learnedAt ? String(rec.learnedAt).slice(0, 10) : null);
        if (!on) continue;
        for (let id = (d - 1) * LEGACY_PACE + 1; id <= d * LEGACY_PACE; id++) {
          const st = p.words[String(id)];
          if (st && !st.introducedOn) st.introducedOn = on;
        }
      }
      delete p.days;
    }

    // v3: game layer + lesson resume. Defaults only fill what is missing.
    const fill = (obj, defs) => { for (const k in defs) if (obj[k] === undefined) obj[k] = defs[k]; };
    fill(p, {
      freezes: 0, quests: null, monthly: { month: null, count: 0 }, badges: [], crowns: {},
      speedBest: 0, stories: {}, achievements: {}, muted: false, lessonInProgress: null,
      boostUntil: 0, done: {},
    });
    for (const e of p.log) fill(e, { activeSeconds: 0, xp: 0, streakCounted: false, perfect: 0, lateMinutes: 0 });
    for (const k in p.words) if (p.words[k]) fill(p.words[k], { weak: 0 });

    // v4 defaults
    fill(p.settings, { goalMinutes: 20, leniency: "relaxed", reminder: { on: false, time: "12:30", asked: false } });
    fill(p, { legendary: {}, freezeEarn: 0, mistakes: [] });
    fill(p.streak, { repair: null, usedFreeze: false });
    for (const k in p.words) if (p.words[k]) fill(p.words[k], { needsTrace: false });
    if (from < 4) toV4(p, today);

    p.version = 4;
    return p;
  }

  return { PACE_OPTIONS, DEFAULT_PACE, UNIT_SIZE, normalizePace, unitOf, unitRange, makeOrder, unitOfPos, unitPosRange, nextNewIds, dayOf, firstUnmetPos, totalDays, dayNumber, batchIds, introducedCount, migrate };
});
