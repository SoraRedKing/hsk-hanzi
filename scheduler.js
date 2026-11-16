// SM-2 variant scheduler — pure logic, no DOM. Works in browser (window.Scheduler) and Node (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scheduler = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const CAP = 180;

  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function newWordState() {
    return { ease: 2.5, interval: 1, due: null, reps: 0, lapses: 0, leech: false, goodStreak: 0, writeRetry: false, writeErrors: 0 };
  }

  function scheduleAfterLearn(state, todayStr) {
    const s = Object.assign({}, state);
    s.interval = 1;
    s.due = addDays(todayStr, 1);
    return s;
  }

  function gradeWord(state, grade, todayStr) {
    const s = Object.assign({}, state);
    s.ease = s.ease || 2.5;
    s.interval = s.interval || 1;
    s.reps = (s.reps || 0) + 1;

    if (grade === "again") {
      s.lapses = (s.lapses || 0) + 1;
      s.goodStreak = 0;
      s.interval = 1;
      s.ease = Math.max(1.3, s.ease - 0.2);
    } else if (grade === "hard") {
      s.goodStreak = 0;
      s.interval = Math.max(1, Math.round(s.interval * 1.2));
      s.ease = Math.max(1.3, s.ease - 0.15);
    } else if (grade === "good") {
      s.goodStreak = (s.goodStreak || 0) + 1;
      s.interval = s.interval <= 1 ? 3 : Math.round(s.interval * s.ease);
    } else if (grade === "easy") {
      s.goodStreak = (s.goodStreak || 0) + 1;
      s.interval = Math.max(2, Math.round(s.interval * s.ease * 1.3));
      s.ease = s.ease + 0.15;
    }

    s.interval = Math.min(s.interval, CAP);
    if (grade === "again" && s.lapses >= 4) s.leech = true;
    if (s.leech && s.goodStreak >= 2) { s.leech = false; s.lapses = 0; }
    s.due = addDays(todayStr, s.interval);
    return s;
  }

  function isDue(state, todayStr) {
    return !!state.due && state.due <= todayStr;
  }

  return { newWordState, scheduleAfterLearn, gradeWord, isDue, addDays };
});
