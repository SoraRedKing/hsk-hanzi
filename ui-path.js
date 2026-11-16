/* HSK 汉字 — the path (home screen). */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const ICON = { lesson: "学", checkpoint: "🏁", review: "忆", boss: "🐉", story: "📖", soon: "⏳", practice: "练", component: "部", legendary: "💜", mistakes: "🩹", listen: "🎧", testout: "🚀", hard: "🏁" };
  let startFn = () => {};

  function label(stop) {
    const words = stop.wordIds.map((id) => App.word(id)).filter(Boolean);
    switch (stop.kind) {
      case "lesson": return words.map((w) => w.hanzi).join(" ");
      case "checkpoint": return "Day check · hard";
      case "component": return "Character parts";
      case "legendary": return stop.status === "done" ? "Legendary 💜" : "Legendary";
      case "review": return `Review · ${stop.wordIds.length} words`;
      case "boss": return stop.crowned ? "Boss beaten 👑" : "Boss level";
      case "story": return "Story";
      case "soon": return "Story coming soon";
      case "practice": return "Resume extra practice";
      case "mistakes": return "Resume mistakes";
      case "listen": return "Resume listening";
      case "testout": return `Resume test-out · unit ${stop.unit}`;
      case "hard": return "Resume day check";
    }
    return "";
  }

  function icon(stop) {
    if (stop.status === "locked") return "🔒";
    if (stop.status === "done" && stop.kind !== "boss") return "✓";
    return ICON[stop.kind];
  }

  function header(stop) {
    if (stop.kind === "review") return `<div class="unit-head"><div class="u-eyebrow">Due today</div><div class="u-title">Reviews · 忆</div></div>`;
    if (stop.kind === "practice") return `<div class="unit-head past"><div class="u-eyebrow">Fill your hour</div><div class="u-title">Extra practice · 练</div></div>`;
    return unitHead(stop.unit);
  }

  // A unit's header: its HSK levels and first few words, from teaching positions.
  function unitHead(u, extra) {
    const ids = App.unitIds(u);
    const levels = [...new Set(ids.map((id) => App.word(id).level))].filter(Boolean).sort();
    const first = Syllabus.firstUnmetPos(App.state.progress.words, App.state.order);
    const past = first === null || Syllabus.unitOfPos(first) > u;
    const ch = App.chapter(u);
    if (ch) {
      return `<div class="unit-head${past ? " past" : ""}"><div class="u-eyebrow">Unit ${u} · ${App.esc(ch.titleEn)}</div><div class="u-title">${App.esc(ch.title)}</div>${extra || ""}</div>`;
    }
    const sample = ids.slice(0, 6).map((id) => App.word(id).hanzi).join(" ");
    return `<div class="unit-head${past ? " past" : ""}"><div class="u-eyebrow">Unit ${u} · HSK ${levels.join("–")}</div><div class="u-title">${App.esc(sample)} …</div>${extra || ""}</div>`;
  }

  // Inside a themed chapter, each topic day gets a small heading before its first lesson.
  function dayHead(d) {
    return `<div class="day-head"><span class="d-n">Day ${d.n}</span> ${App.esc(d.title)} · ${App.esc(d.titleEn)}</div>`;
  }

  // opts.pop: key of a stop that was just completed (plays the pop animation)
  function render(opts) {
    const P = App.buildPath();
    const box = $("#path-scroll");
    let html = "", group = null, i = 0, topic = null;
    for (const s of P.stops) {
      const g = s.kind === "review" || s.kind === "practice" ? s.kind : "u" + s.unit;
      if (g !== group) { html += header(s); group = g; i = 0; topic = null; }
      if (s.kind === "lesson" && g !== "review" && s.wordIds.length) {
        const d = App.chapterDay(s.wordIds[0]);
        if (d && d.n !== topic) { html += dayHead(d); topic = d.n; }
      }
      const x = Math.round(Math.sin(i++ * 0.9) * 80);
      const cls = ["stop", s.status, "kind-" + s.kind, s.crowned ? "crowned" : "", opts && opts.pop === s.key ? "pop" : ""].join(" ");
      html += `<div class="stop-row"><div class="stop-wrap${s.status === "current" ? " is-current" : ""}" style="transform:translateX(${x}px)">
        <button class="${cls}" data-key="${App.esc(s.key)}" title="${App.esc(label(s))}">${icon(s)}${s.resume ? '<span class="resume">Resume</span>' : ""}</button>
        <div class="stop-label">${App.esc(label(s))}</div></div></div>`;
    }
    // the next few units, collapsed, each with a test-out
    for (const u of P.units.filter((x) => x.testOut).slice(0, 3)) {
      html += unitHead(u.unit, `<button class="btn3d jump" data-unit="${u.unit}">Jump here</button>`).replace('class="unit-head', 'class="unit-head future');
    }
    if (!P.stops.length) html = `<p class="path-empty">Nothing on the path yet.</p>`;
    box.innerHTML = html;
    box._stops = P.stops;
    const cur = box.querySelector(".stop.current") || box.querySelector(".stop.open");
    if (cur) cur.scrollIntoView({ block: "center", behavior: "instant" });
    return P;
  }

  $("#path-scroll").addEventListener("click", (e) => {
    const j = e.target.closest(".jump");
    if (j) {
      const u = Number(j.dataset.unit);
      App.toast(`Test out of unit ${u}: 20 questions, 80% to pass. Passing adds its words to your reviews.`, 4500);
      return startFn({ key: `testout-u${u}`, kind: "testout", unit: u, wordIds: App.unitIds(u) });
    }
    const b = e.target.closest(".stop");
    if (!b) return;
    const stop = ($("#path-scroll")._stops || []).find((s) => s.key === b.dataset.key);
    if (!stop) return;
    if (stop.kind === "soon") return App.toast("This unit's story is still being written.");
    if (stop.status === "locked") {
      return App.toast(stop.kind === "lesson" && App.buildPath().stops.some((s) => s.kind === "review" && s.status === "current")
        ? "Lots of reviews waiting — clear a review first, then new words open again."
        : "Finish the stop before this one first.");
    }
    if (stop.status === "done" && stop.kind === "lesson") return App.toast("Already learned — these words come back in reviews.");
    startFn(stop);
  });

  window.UIPath = { render, onStart: (fn) => { startFn = fn; } };
})();
