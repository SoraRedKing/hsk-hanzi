// Active time, the 10-minute streak, streak freezes and date rollover — pure logic, no DOM.
// Works in browser (window.Activity) and Node (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./scheduler.js"));
  else root.Activity = factory(root.Scheduler);
})(typeof self !== "undefined" ? self : this, function (S) {
  const IDLE_MS = 30000;
  const STREAK_SECONDS = 600;
  const GOAL_SECONDS = 3600;
  const FREEZE_CAP = 2;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function localDate(d) {
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function newEntry(date) {
    return { date, learned: 0, reviewed: 0, written: 0, activeSeconds: 0, xp: 0, streakCounted: false, perfect: 0, lateMinutes: 0 };
  }

  function entryFor(p, date) {
    let e = p.log.find((x) => x.date === date);
    if (!e) { e = newEntry(date); p.log.push(e); }
    return e;
  }

  function todaySeconds(progress, today) {
    const e = progress.log.find((x) => x.date === today);
    return e ? e.activeSeconds || 0 : 0;
  }

  const REPAIR_SECONDS = 1200;
  const MILESTONES = [7, 30, 100, 365];

  function goalSeconds(progress) {
    return ((progress.settings && progress.settings.goalMinutes) || 20) * 60;
  }
  const milestoneFor = (count) => (MILESTONES.includes(count) ? count : null);

  // `hour` is the local hour the time was earned in (for the night-owl achievement).
  // Counting a day also earns toward a freeze (one per 3 counted days, cap 2), and
  // 20 minutes on the day after a miss repairs a broken streak (once per break).
  function creditActive(progress, today, seconds, hour) {
    const p = clone(progress);
    const e = entryFor(p, today);
    e.activeSeconds = (e.activeSeconds || 0) + seconds;
    if (hour !== undefined && hour >= 23) e.lateMinutes = (e.lateMinutes || 0) + seconds / 60;
    if (!e.streakCounted && e.activeSeconds >= STREAK_SECONDS) {
      e.streakCounted = true;
      const last = p.streak.lastStudyDate;
      if (last !== today) {
        p.streak.count = last === S.addDays(today, -1) ? p.streak.count + 1 : 1;
        p.streak.lastStudyDate = today;
        if (p.streak.count === 1) p.streak.usedFreeze = false;
      }
      p.freezeEarn = (p.freezeEarn || 0) + 1;
      if (p.freezeEarn >= 3) { p.freezes = Math.min(FREEZE_CAP, (p.freezes || 0) + 1); p.freezeEarn = 0; }
    }
    const rep = p.streak.repair;
    if (rep) {
      if (today !== S.addDays(rep.brokenOn, 1)) p.streak.repair = null;
      else if (e.activeSeconds >= REPAIR_SECONDS) {
        p.streak.count = rep.count + 1;
        p.streak.lastStudyDate = today;
        p.streak.repair = null;
      }
    }
    return p;
  }

  // Settle every missed day between the last counted day and yesterday: a held
  // freeze covers one day (and becomes the new "last counted" day), otherwise the
  // streak breaks — and a single missed day leaves a repair open for the next day.
  // Running it again for the same `today` changes nothing.
  function rollover(progress, today) {
    const p = clone(progress);
    const rep = p.streak.repair;
    if (rep && today > S.addDays(rep.brokenOn, 1)) p.streak.repair = null;
    const last = p.streak.lastStudyDate;
    if (!last || p.streak.count === 0) return p;
    const yesterday = S.addDays(today, -1);
    for (let d = S.addDays(last, 1); d <= yesterday; d = S.addDays(d, 1)) {
      if ((p.freezes || 0) > 0) {
        p.freezes--;
        entryFor(p, d).frozen = true;
        p.streak.lastStudyDate = d;
        p.streak.usedFreeze = true;
      } else {
        p.streak.repair = d === yesterday ? { brokenOn: d, count: p.streak.count } : null;
        p.streak.count = 0;
        break;
      }
    }
    return p;
  }

  // The midday reminder fires only while today isn't counted yet.
  function shouldRemind(progress, today) {
    const e = (progress.log || []).find((x) => x.date === today);
    return !(e && e.streakCounted);
  }

  // Counts whole seconds while a study screen is active and the learner gave
  // input within the last IDLE_MS. drain() hands back the seconds earned so far.
  class Tracker {
    constructor(nowFn) {
      this.now = nowFn || (() => Date.now());
      this.active = false;
      this.lastInput = -Infinity;
      this.lastTick = this.now();
      this.carryMs = 0;
    }
    accrue() {
      const now = this.now();
      if (this.active) {
        const end = Math.min(now, this.lastInput + IDLE_MS);
        if (end > this.lastTick) this.carryMs += end - this.lastTick;
      }
      this.lastTick = now;
    }
    input() { this.accrue(); this.lastInput = this.now(); }
    setActive(on) { this.accrue(); this.active = !!on; }
    drain() {
      this.accrue();
      const s = Math.floor(this.carryMs / 1000);
      this.carryMs -= s * 1000;
      return s;
    }
  }

  return { IDLE_MS, STREAK_SECONDS, GOAL_SECONDS, FREEZE_CAP, REPAIR_SECONDS, localDate, todaySeconds, goalSeconds, milestoneFor, creditActive, rollover, shouldRemind, Tracker };
});
