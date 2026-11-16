// Lesson outcomes -> word state — pure logic, no DOM. Works in browser (window.Outcome) and Node (require).
// Only review lessons change the schedule; every other kind touches the writing flags and `weak` only.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./scheduler.js"));
  else root.Outcome = factory(root.Scheduler);
})(typeof self !== "undefined" ? self : this, function (S) {
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // A write is clean with no hint, no reveal and no stroke mistakes.
  function firstTryVerdict(res) {
    if (res.type === "write") {
      if (res.revealed || res.mistakes > 3 || !res.correct) return "again";
      if (res.hinted || res.mistakes > 0) return "hard";
      return "clean";
    }
    if (!res.correct) return "again";
    return res.hinted ? "hard" : "clean";
  }

  function gradeFor(results) {
    const first = results.filter((r) => r.firstTry);
    const verdicts = first.map(firstTryVerdict);
    if (!verdicts.length) return "good";
    if (verdicts.includes("again")) return "again";
    if (verdicts.includes("hard")) return "hard";
    return first.some((r) => r.type === "write") ? "easy" : "good";
  }

  function introduce(progress, wordIds, today) {
    const p = clone(progress);
    for (const id of wordIds) {
      const cur = p.words[String(id)];
      if (cur && cur.introducedOn) continue;
      const st = S.scheduleAfterLearn(Object.assign(S.newWordState(), cur || {}), today);
      st.introducedOn = today;
      st.weak = st.weak || 0;
      p.words[String(id)] = st;
    }
    return p;
  }

  // `lessonWordIds` (optional) limits grading and introducing to the lesson's own
  // words: a match exercise may top up its pairs with other known words.
  function applyOutcome(progress, kind, results, today, lessonWordIds) {
    let p = clone(progress);
    const own = lessonWordIds ? new Set(lessonWordIds) : null;
    const isOwn = (id) => !own || own.has(id);
    const byWord = new Map();
    for (const r of results) {
      if (!byWord.has(r.wordId)) byWord.set(r.wordId, []);
      byWord.get(r.wordId).push(r);
    }
    if (kind === "new") p = introduce(p, [...byWord.keys()].filter(isOwn), today);

    for (const [id, rs] of byWord) {
      let st = p.words[String(id)];
      if (!st) continue;
      if (kind === "review" && isOwn(id)) st = S.gradeWord(st, gradeFor(rs), today);

      const writes = rs.filter((r) => r.type === "write");
      if (writes.length) {
        st.writeRetry = writes.some((r) => r.revealed || r.mistakes > 3);
        st.writeErrors = (st.writeErrors || 0) + writes.reduce((a, r) => a + (r.mistakes || 0), 0);
      }
      if (rs.some((r) => (r.type === "traceFaded" || r.type === "write") && r.correct)) st.needsTrace = false;
      let weak = st.weak || 0;
      for (const r of rs.filter((x) => x.firstTry)) weak = firstTryVerdict(r) === "clean" ? Math.max(0, weak - 1) : weak + 1;
      st.weak = weak;
      p.words[String(id)] = st;
    }
    // rolling 7-day log of first-try misses, for the Mistakes practice
    const since = S.addDays(today, -7);
    p.mistakes = (p.mistakes || []).filter((m) => m.date > since)
      .concat(results.filter((r) => r.firstTry && !r.correct).map((r) => ({ wordId: r.wordId, date: today, type: r.type })));
    return p;
  }

  // Test-out: every unmet word of the unit becomes met with a 7-day interval, due
  // dates spread over days 3-10 so there's no review spike, and a faded-outline
  // trace before any writing from memory.
  function applyTestOut(progress, unitIds, today, rng) {
    const p = clone(progress);
    const fresh = unitIds.filter((id) => !(p.words[String(id)] && p.words[String(id)].introducedOn));
    const order = fresh.map((id) => [rng(), id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    order.forEach((id, i) => {
      const st = Object.assign(S.newWordState(), p.words[String(id)] || {});
      st.introducedOn = today;
      st.interval = 7;
      st.due = S.addDays(today, 3 + Math.floor((i * 8) / Math.max(1, order.length)));
      st.needsTrace = true;
      st.weak = 0;
      p.words[String(id)] = st;
    });
    return p;
  }

  return { gradeFor, applyOutcome, introduce, applyTestOut };
});
