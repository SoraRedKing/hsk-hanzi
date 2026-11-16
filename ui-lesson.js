/* HSK 汉字 — lesson player: one exercise at a time, Duolingo-style check bar.
   The lesson lives in progress.lessonInProgress and is saved after every answer,
   so quitting (or a crash) resumes at the same exercise. */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const KIND = {
    lesson: "new", review: "review", checkpoint: "hard", practice: "practice", boss: "boss", legendary: "legendary",
    component: "component", testout: "testout", mistakes: "mistakes", listen: "listen",
  };
  // kinds that are tests: no hints, no show-me, no requeue
  const TEST_KINDS = ["boss", "hard", "legendary", "testout"];
  const LENIENCY = { strict: 1.0, normal: 1.3, relaxed: 1.7 };
  let lastWriterOptions = null;
  const isCJK = (c) => c >= "一" && c <= "鿿";

  // runtime-only state for the exercise on screen (never saved)
  let view = { selected: null, checked: false, lastResult: null, writer: null, chars: [], charIdx: 0, mistakes: 0, hinted: false, revealed: false, match: null, placed: [], picked: new Set() };

  const L = () => App.state.progress.lessonInProgress;
  function setL(next) {
    App.set(Object.assign({}, App.state.progress, { lessonInProgress: next }));
  }
  const cur = () => (L() ? L().exercises[L().idx] : null);
  const isBoss = () => !!(L() && TEST_KINDS.includes(L().kind));

  /* ---------- start / resume / quit ---------- */

  function exercisesFor(stop, kind) {
    const ctx = App.lessonCtx();
    switch (kind) {
      case "new": return Lesson.buildNewLesson(stop.wordIds, reviewWords(stop.wordIds, ctx), ctx);
      case "review": return Lesson.buildReviewLesson(stop.wordIds, ctx);
      case "hard": return Lesson.buildHard(stop.wordIds, ctx);
      case "boss": return Lesson.buildBoss(stop.wordIds, ctx);
      case "legendary": return Lesson.buildLegendary(stop.wordIds, ctx);
      case "component": return Lesson.buildComponent(stop.wordIds, ctx);
      case "testout": return Lesson.buildTestOut(stop.wordIds, ctx);
      case "mistakes": return Lesson.buildMistakes(stop.wordIds, ctx);
      case "listen": return Lesson.buildListen(stop.wordIds, ctx);
    }
    return Lesson.buildPractice(stop.wordIds && stop.wordIds.length ? stop.wordIds : practiceWords(ctx), ctx);
  }

  // 2-3 earlier words to mix into a new-word lesson: the most recent first, then weak ones
  function reviewWords(newIds, ctx) {
    const known = ctx.known.filter((id) => !newIds.includes(id));
    const st = (id) => App.wordState(id) || {};
    return known.slice().sort((a, b) => (st(b).introducedOn || "").localeCompare(st(a).introducedOn || "") || (ctx.weak[b] || 0) - (ctx.weak[a] || 0))
      .slice(0, known.length >= 3 ? 3 : known.length);
  }

  // extra practice: the 12 weakest known words (leeches and writeRetry count extra)
  function practiceWords(ctx) {
    const score = (id) => {
      const st = App.wordState(id);
      return (ctx.weak[id] || 0) + (st.leech ? 5 : 0) + (st.writeRetry ? 3 : 0) + (2.5 - (st.ease || 2.5)) * 4 + Math.random();
    };
    return ctx.known.slice().sort((a, b) => score(b) - score(a)).slice(0, 12);
  }

  function start(stop) {
    if (L() && L().key === stop.key) return resume();
    const kind = KIND[stop.kind] || "practice";
    const wordIds = (stop.wordIds || []).slice();
    const exercises = exercisesFor(stop, kind);
    if (!exercises.length) return App.toast("Nothing to practise yet.");
    setL({
      key: stop.key, kind, unit: stop.unit, wordIds: wordIds.length ? wordIds : [...new Set(exercises.map((e) => e.wordId))],
      exercises, idx: 0, results: [], combo: 0, maxCombo: 0, startedAt: Date.now(),
    });
    App.flushSave();
    open();
    if (kind === "boss" || kind === "legendary" || kind === "testout") {
      App.toast("月 Yuè: 准备好了吗？这一关，不能看提示。 — Ready? No hints on this level.", 5000);
      Mascot.say("yueA-boss-intro");
    }
  }

  function resume() {
    if (!L()) return;
    open();
  }

  function open() {
    App.go("lesson");
    $("#lesson").classList.toggle("boss", isBoss());
    render();
  }

  function askQuit() { $("#quit-dialog").hidden = false; }
  function quit() {
    $("#quit-dialog").hidden = true;
    destroyWriter();
    App.flushSave();
    App.go("path");
  }
  $("#lesson-quit").addEventListener("click", askQuit);
  $("#quit-stay").addEventListener("click", () => { $("#quit-dialog").hidden = true; });
  $("#quit-confirm").addEventListener("click", quit);

  /* ---------- rendering ---------- */

  function destroyWriter() {
    if (view.writer) { try { view.writer.cancelQuiz(); } catch (e) { /* already gone */ } }
    view.writer = null;
  }

  function render() {
    destroyWriter();
    const ex = cur();
    view = { selected: null, checked: false, lastResult: view.lastResult, writer: null, chars: [], charIdx: 0, mistakes: 0, hinted: false, revealed: false, match: null };
    const l = L();
    $("#lesson-bar").style.width = `${Math.round((l.idx / l.exercises.length) * 100)}%`;
    $("#combo").hidden = l.combo < 3;
    $("#combo-n").textContent = l.combo;
    const bar = $("#check-bar");
    bar.className = "check-bar";
    $("#check-msg").innerHTML = "";
    const btn = $("#check-btn");
    btn.className = "btn3d green big";
    btn.textContent = "Check";
    btn.disabled = true;
    const w = App.word(ex.wordId);
    const stage = $("#ex-stage");
    switch (ex.type) {
      case "meet": return renderMeet(stage, w);
      case "pickMeaning": return renderChoice(stage, ex, w, ex.fromParts ? "Guess from its parts" : "What does this mean?", `<div class="big-hanzi">${App.hanziHTML(w)}</div>${ex.fromParts ? partsHTML(w) : ""}`, (id) => App.meaningHTML(App.word(id)), false);
      case "pickWord": return renderChoice(stage, ex, w, "Which word means…", `<div class="meaning" style="font-size:26px">${App.meaningHTML(w)}</div>`, (id) => App.esc(App.word(id).hanzi), true);
      case "listen": return renderChoice(stage, ex, w, "What did you hear?", `<button class="speaker" id="ex-play">🔊</button>`, (id) => App.esc(App.word(id).hanzi), true, () => App.playAudio(w.id));
      case "tones": return renderTones(stage, ex, w);
      case "match": return renderMatch(stage, ex);
      case "trace": return renderWriter(stage, ex, w, true, false);
      case "traceFaded": return renderWriter(stage, ex, w, true, true);
      case "write": return renderWriter(stage, ex, w, false, false);
      case "buildSentence": case "listenTap": return renderTiles(stage, ex);
      case "sentenceMeaning": return renderSentenceMeaning(stage, ex);
      case "fillGap": return renderFillGap(stage, ex);
      case "component": return renderComponent(stage, ex);
    }
  }

  function renderMeet(stage, w) {
    stage.innerHTML = `
      <div class="new-tag">NEW WORD</div>
      <div class="big-hanzi">${App.hanziHTML(w)}</div>
      <div class="pinyin">${App.esc(w.pinyin)}</div>
      <div class="meaning">${App.meaningHTML(w)}</div>
      <button class="speaker small" id="ex-play" title="Play again">🔊</button>
      ${partsHTML(w)}
      <div class="teacher-line">晓晓 · ${App.levelName(w.level)}</div>`;
    $("#ex-play").addEventListener("click", () => App.playAudio(w.id));
    App.playAudio(w.id);
    const btn = $("#check-btn");
    btn.textContent = "Continue";
    btn.disabled = false;
  }

  function renderChoice(stage, ex, w, title, prompt, optHTML, hz, onShow) {
    stage.innerHTML = `
      <div class="ex-title">${title}</div>
      ${prompt}
      <div class="options">${ex.options.map((id, i) => `<button class="opt${hz ? " hz" : ""}" data-v="${id}"><span class="k">${i + 1}</span><span>${optHTML(id)}</span></button>`).join("")}</div>`;
    stage.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(b)));
    if ($("#ex-play")) $("#ex-play").addEventListener("click", () => App.playAudio(w.id));
    if (onShow) onShow();
  }

  // "爱 = 爫 + 冖 + 友 · claw / cover / friend" for each multi-part character
  function partsHTML(w) {
    const lines = Array.from(w.hanzi).filter(isCJK).map((c) => Parts.line(c)).filter(Boolean);
    return lines.length ? `<div class="parts-line">${lines.map(App.esc).join("<br>")}</div>` : "";
  }

  const tokText = (t) => (typeof t === "number" ? App.word(t).hanzi : t);

  // Stroke order for tracing, dictionary-style: one small 楷体 box per stroke, showing
  // the strokes so far with the new one in red.
  function strokeOrderHTML(chars) {
    const boxes = chars.filter((c) => App.state.strokes[c]).map((c) => {
      const d = App.state.strokes[c];
      return d.strokes.map((_, k) => {
        const paths = d.strokes.slice(0, k + 1).map((p, i) => `<path d="${p}" fill="${i === k ? "#e0443a" : "#3b2f24"}"/>`).join("");
        return `<div class="so-num"><svg viewBox="0 0 1024 1024"><g transform="matrix(1 0 0 -1 0 900)">${paths}</g></svg><span>${k + 1}</span></div>`;
      }).join("");
    }).join("");
    return boxes ? `<div class="stroke-order" id="stroke-order" title="Stroke order">${boxes}</div>` : "";
  }

  /* build the sentence / listen and tap: tap tiles into the answer line */
  function renderTiles(stage, ex) {
    const s = App.sentence(ex.sentenceId);
    const listen = ex.type === "listenTap";
    view.placed = [];
    stage.innerHTML = `
      <div class="ex-title">${listen ? "Tap what you hear" : "Build the sentence"}</div>
      ${listen ? `<button class="speaker" id="ex-play">🔊</button>` : `<div class="meaning" style="font-size:24px">${App.esc(s.en)}</div>`}
      <div class="tile-line" id="tile-line"></div>
      <div class="tile-bank" id="tile-bank">${ex.tiles.map((t, i) => `<button class="tile" data-i="${i}">${App.esc(t)}</button>`).join("")}</div>`;
    if (listen) { $("#ex-play").addEventListener("click", () => App.playSentence(s.id)); App.playSentence(s.id); }
    stage.querySelector("#tile-bank").addEventListener("click", (e) => { const t = e.target.closest(".tile"); if (t) placeTile(Number(t.dataset.i)); });
    stage.querySelector("#tile-line").addEventListener("click", (e) => { const t = e.target.closest(".tile"); if (t) unplaceTile(Number(t.dataset.i)); });
  }
  function drawTiles() {
    const ex = cur();
    $("#tile-line").innerHTML = view.placed.map((i) => `<button class="tile" data-i="${i}">${App.esc(ex.tiles[i])}</button>`).join("");
    document.querySelectorAll("#tile-bank .tile").forEach((b) => b.classList.toggle("used", view.placed.includes(Number(b.dataset.i))));
    $("#check-btn").disabled = view.placed.length === 0;
  }
  function placeTile(i) { if (view.checked || view.placed.includes(i)) return; view.placed.push(i); drawTiles(); }
  function unplaceTile(i) { if (view.checked) return; view.placed = view.placed.filter((x) => x !== i); drawTiles(); }

  function renderSentenceMeaning(stage, ex) {
    const s = App.sentence(ex.sentenceId);
    stage.innerHTML = `
      <div class="ex-title">What does this mean?</div>
      <div class="mid-hanzi sentence">${App.esc(s.hanzi)}</div>
      <button class="speaker small" id="ex-play">🔊</button>
      <div class="options">${ex.options.map((o, i) => `<button class="opt" data-v="${App.esc(o)}"><span class="k">${i + 1}</span><span>${App.esc(o)}</span></button>`).join("")}</div>`;
    $("#ex-play").addEventListener("click", () => App.playSentence(s.id));
    App.playSentence(s.id);
    stage.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(b)));
  }

  function renderFillGap(stage, ex) {
    const s = App.sentence(ex.sentenceId);
    let gapped = false;
    const text = s.words.map((t) => { if (!gapped && t === ex.gapWordId) { gapped = true; return "＿＿"; } return tokText(t); }).join("");
    stage.innerHTML = `
      <div class="ex-title">Fill the gap</div>
      <div class="mid-hanzi sentence">${App.esc(text)}</div>
      <div class="meaning">${App.esc(s.en)}</div>
      <div class="options">${ex.options.map((id, i) => `<button class="opt hz" data-v="${id}"><span class="k">${i + 1}</span><span>${App.esc(App.word(id).hanzi)}</span></button>`).join("")}</div>`;
    stage.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(b)));
  }

  /* component: pick every character that contains the part */
  function renderComponent(stage, ex) {
    view.picked = new Set();
    const meaning = (Parts.partsOf(ex.answer[0]).meanings || {})[ex.component];
    stage.innerHTML = `
      <div class="ex-title">Which characters contain <span class="big-part">${App.esc(ex.component)}</span>${meaning ? ` <small>(${App.esc(meaning)})</small>` : ""}?</div>
      <div class="options comp">${ex.options.map((c) => `<button class="opt hz" data-c="${App.esc(c)}"><span>${App.esc(c)}</span></button>`).join("")}</div>`;
    stage.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      if (view.checked) return;
      const c = b.dataset.c;
      if (view.picked.has(c)) view.picked.delete(c); else view.picked.add(c);
      b.classList.toggle("selected", view.picked.has(c));
      $("#check-btn").disabled = view.picked.size === 0;
    }));
  }

  function renderTones(stage, ex, w) {
    stage.innerHTML = `
      <div class="ex-title">Pick the right tones</div>
      <div class="big-hanzi">${App.esc(w.hanzi)}</div>
      <div class="options">${ex.options.map((p, i) => `<button class="opt" data-v="${App.esc(p)}"><span class="k">${i + 1}</span><span style="font-size:24px">${App.esc(p)}</span></button>`).join("")}</div>`;
    stage.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(b)));
  }

  function select(b) {
    if (view.checked) return;
    document.querySelectorAll("#ex-stage .opt").forEach((o) => o.classList.toggle("selected", o === b));
    view.selected = b.dataset.v;
    $("#check-btn").disabled = false;
    const ex = cur();
    if (ex.type === "pickWord") App.playAudio(Number(b.dataset.v)); // never for listen: it would give the answer away
  }

  /* match: tap a hanzi then its meaning; a miss shakes and counts against that pair */
  function renderMatch(stage, ex) {
    const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const left = shuffle(ex.pairs.slice()), right = shuffle(ex.pairs.slice());
    view.match = { pick: null, matched: new Set(), missed: new Set() };
    stage.innerHTML = `
      <div class="ex-title">Tap the matching pairs</div>
      <div class="match-grid">
        <div class="match-col">${left.map((id) => `<button class="match-btn hz" data-side="L" data-id="${id}">${App.esc(App.word(id).hanzi)}</button>`).join("")}</div>
        <div class="match-col">${right.map((id) => `<button class="match-btn" data-side="R" data-id="${id}">${App.esc(App.gloss(App.word(id)))}</button>`).join("")}</div>
      </div>`;
    stage.querySelectorAll(".match-btn").forEach((b) => b.addEventListener("click", () => matchTap(b)));
  }

  function matchTap(b) {
    const M = view.match, id = Number(b.dataset.id);
    if (view.checked || M.matched.has(id) && b.classList.contains("matched")) return;
    if (b.dataset.side === "L") App.playAudio(id);
    if (!M.pick || M.pick.dataset.side === b.dataset.side) {
      document.querySelectorAll(".match-btn.selected").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      M.pick = b;
      return;
    }
    const a = M.pick;
    M.pick = null;
    a.classList.remove("selected");
    if (Number(a.dataset.id) === id) {
      a.classList.add("matched"); b.classList.add("matched");
      M.matched.add(id);
      Sfx.play("right");
      if (M.matched.size === cur().pairs.length) {
        const results = cur().pairs.map((pid) => ({ wordId: pid, correct: !M.missed.has(pid) }));
        record(results.every((r) => r.correct), { pairResults: results });
      }
    } else {
      M.missed.add(Number(a.dataset.id)); M.missed.add(id);
      [a, b].forEach((x) => { x.classList.remove("miss"); void x.offsetWidth; x.classList.add("miss"); });
      Sfx.play("wrong");
    }
  }

  /* trace (outline shown) and write (from memory) */
  function renderWriter(stage, ex, w, outline, faded) {
    view.chars = Array.from(w.hanzi).filter(isCJK);
    view.faded = faded;
    const boss = isBoss();
    stage.innerHTML = `
      <div class="write-wrap">
        <div class="write-prompt">
          <div class="ex-eyebrow">${faded ? "Trace it — the outline is fading" : outline ? "Trace it" : boss ? "No hints · from memory" : "Write it from memory"}</div>
          ${outline && !faded ? `<div class="mid-hanzi">${App.hanziHTML(w)}</div>` : ""}
          <div class="meaning">${App.meaningHTML(w)}</div>
          <div class="pinyin">${App.esc(w.pinyin)}</div>
          ${boss ? "" : partsHTML(w)}
          ${outline ? strokeOrderHTML(view.chars) : ""}
          <div class="dots" id="write-dots">${view.chars.map(() => "<i></i>").join("")}</div>
          <div class="write-tools">
            ${boss ? "" : `<button class="btn3d" id="write-hint" title="Hear the word">🔊 Hint</button>`}
            ${boss || outline ? "" : `<button class="btn3d" id="write-show" title="Watch the character — this word comes back sooner">👁 Show me</button>`}
          </div>
        </div>
        <div class="pad-wrap"><div class="pad-grid"></div><div class="pad-diag"></div><div id="writer-target"></div></div>
      </div>
      <div class="write-msg" id="write-msg">${outline ? "Trace over the outline, stroke by stroke." : ""}</div>`;
    if ($("#write-hint")) $("#write-hint").addEventListener("click", () => { view.hinted = true; App.playAudio(w.id); });
    if ($("#write-show")) $("#write-show").addEventListener("click", revealChar);
    $("#check-btn").textContent = "Writing…";
    if (outline) App.playAudio(w.id);
    startChar(outline);
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function updateDots() {
    document.querySelectorAll("#write-dots i").forEach((d, i) => { d.className = i < view.charIdx ? "done" : i === view.charIdx ? "cur" : ""; });
  }

  function startChar(outline) {
    updateDots();
    const target = $("#writer-target");
    if (!target) return;
    target.innerHTML = "";
    const pad = target.closest(".pad-wrap");
    if (pad) pad.classList.remove("char-ok");
    const ch = view.chars[view.charIdx];
    if (!App.state.strokes[ch]) {
      // no stroke data: show the character for copying and move on
      target.innerHTML = `<div class="copy-char">${ch}</div>`;
      $("#write-msg").textContent = `No stroke data for ${ch} — shown for copying practice.`;
      setTimeout(() => nextChar(outline), 1600);
      return;
    }
    const opts = {
      width: 318, height: 318, padding: 12,
      showCharacter: false, showOutline: outline,
      showHintAfterMisses: isBoss() ? false : view.faded ? 1 : 2,
      drawingWidth: 20,
      leniency: LENIENCY[App.state.progress.settings.leniency] || LENIENCY.relaxed,
      strokeColor: cssVar("--ink"), drawingColor: cssVar("--ink"),
      highlightColor: cssVar("--red"), outlineColor: view.faded ? "rgba(201, 187, 164, 0.35)" : cssVar("--line-deep"),
      charDataLoader: (c, done) => done(App.state.strokes[c]),
    };
    lastWriterOptions = opts;
    const writer = HanziWriter.create(target, ch, opts);
    view.writer = writer;
    writer.quiz({
      onMistake: () => { view.mistakes++; $("#write-msg").textContent = "Not quite — try that stroke again."; },
      onCorrectStroke: (d) => { $("#write-msg").textContent = `Stroke ${d.strokeNum + 1} ✓`; },
      onComplete: () => {
        if (view.writer !== writer) return;
        $("#write-msg").textContent = "对了！";
        if (!view.revealed) {
          writer.updateColor("strokeColor", cssVar("--green"));
          const pad = $("#writer-target") && $("#writer-target").closest(".pad-wrap");
          if (pad) { pad.classList.remove("char-ok"); void pad.offsetWidth; pad.classList.add("char-ok"); }
        }
        if (!outline && !view.revealed) { App.track({ type: "write" }); App.bumpLog("written", 1); }
        setTimeout(() => nextChar(outline), 850);
      },
    });
  }

  function revealChar() {
    if (!view.writer || view.checked) return;
    view.revealed = true;
    $("#write-msg").textContent = "Watch carefully — this word comes back sooner.";
    const writer = view.writer;
    writer.cancelQuiz();
    writer.animateCharacter({ onComplete: () => setTimeout(() => { if (view.writer === writer) nextChar(false); }, 600) });
  }

  function nextChar(outline) {
    if (view.checked) return;
    view.charIdx++;
    if (view.charIdx < view.chars.length) return startChar(outline);
    destroyWriter();
    updateDots();
    const ok = !view.revealed && view.mistakes <= 3;
    record(ok, { mistakes: view.mistakes, hinted: view.hinted, revealed: view.revealed });
  }

  /* ---------- answering ---------- */

  function check() {
    const ex = cur();
    if (view.checked) return advance();
    if (ex.type === "meet") return meetDone();
    if (ex.type === "buildSentence" || ex.type === "listenTap") return checkTiles(ex);
    if (ex.type === "component") return checkComponent(ex);
    if (view.selected === null) return;
    const right = String(ex.answer) === String(view.selected);
    document.querySelectorAll("#ex-stage .opt").forEach((o) => {
      if (String(o.dataset.v) === String(ex.answer)) o.classList.add("right");
      else if (o.dataset.v === view.selected) o.classList.add("wrong");
      o.disabled = true;
    });
    if (ex.sentenceId) App.playSentence(ex.sentenceId);
    record(right, {});
  }

  function checkTiles(ex) {
    if (!view.placed.length) return;
    const right = view.placed.map((i) => ex.tiles[i]).join("") === ex.answer.join("");
    document.querySelectorAll("#tile-line .tile").forEach((t) => t.classList.add(right ? "right" : "wrong"));
    App.playSentence(ex.sentenceId);
    record(right, {});
  }

  function checkComponent(ex) {
    const want = new Set(ex.answer);
    const right = view.picked.size === want.size && [...view.picked].every((c) => want.has(c));
    document.querySelectorAll("#ex-stage .opt").forEach((o) => {
      const c = o.dataset.c;
      if (want.has(c)) o.classList.add("right");
      else if (view.picked.has(c)) o.classList.add("wrong");
      o.disabled = true;
    });
    record(right, {});
  }

  function meetDone() {
    const ex = cur();
    if (L().kind === "new") {
      const before = App.wordState(ex.wordId)?.introducedOn;
      App.set(Outcome.introduce(App.state.progress, [ex.wordId], App.todayStr()));
      if (!before) App.bumpLog("learned", 1);
    }
    advance();
  }

  // Records the outcome of the exercise on screen and shows the check bar.
  function record(correct, extra) {
    const ex = cur(), l = L();
    view.checked = true;
    const firstTry = !ex.retry;
    const base = { exId: ex.id, type: ex.type, firstTry, hinted: !!extra.hinted, revealed: !!extra.revealed, mistakes: extra.mistakes || 0 };
    const rows = extra.pairResults
      ? extra.pairResults.map((r) => Object.assign({}, base, { wordId: r.wordId, correct: r.correct }))
      : [Object.assign({}, base, { wordId: ex.wordId, correct })];
    let exercises = l.exercises;
    if (!correct && !/^trace/.test(ex.type) && !isBoss()) exercises = Lesson.requeue(exercises, l.idx);
    const combo = correct ? l.combo + 1 : 0;
    setL(Object.assign({}, l, { exercises, results: l.results.concat(rows), combo, maxCombo: Math.max(l.maxCombo, combo) }));
    view.lastResult = rows[0];
    App.flushSave();

    if (correct) {
      Sfx.play(combo > 0 && combo % 5 === 0 ? "combo" : "right");
      App.track({ type: "combo", n: combo });
      if ([5, 10, 20].includes(combo)) { Mascot.react("cheer"); setTimeout(() => Mascot.say(`panda-combo${combo}`), 500); }
    } else {
      Sfx.play("wrong");
      Mascot.react("sad");
    }
    $("#combo").hidden = combo < 3;
    $("#combo-n").textContent = combo;

    const w = App.word(ex.wordId);
    const bar = $("#check-bar");
    bar.className = "check-bar " + (correct ? "right" : "wrong");
    const s = ex.sentenceId ? App.sentence(ex.sentenceId) : null;
    const answerLine = s ? `${App.esc(s.hanzi)} · ${App.esc(s.pinyin)} · ${App.esc(s.en)}`
      : ex.type === "component" ? `${App.esc(ex.answer.join(" "))} contain ${App.esc(ex.component)}`
      : `${App.esc(w.hanzi)} · ${App.esc(w.pinyin)} · ${App.esc(App.gloss(w))}`;
    const why = correct ? "" : Lesson.explain(ex, view.selected, App.state.byId, Parts.table());
    const praise = ["对了！", "很好！", "太棒了！", "Nice!", "Great!"][Math.floor(Math.random() * 5)];
    $("#check-msg").innerHTML = correct
      ? `${praise}${ex.type === "match" ? "" : `<small>${answerLine}</small>`}`
      : `Correct answer:<small>${answerLine}${isBoss() ? "" : " — it comes back at the end"}</small>${why ? `<small class="explain">💡 ${App.esc(why)}</small>` : ""}`;
    const btn = $("#check-btn");
    btn.className = "btn3d big " + (correct ? "green" : "red");
    btn.textContent = "Continue";
    btn.disabled = false;
  }

  function advance() {
    const l = L();
    if (!l) return;
    if (l.idx + 1 >= l.exercises.length) return finish();
    setL(Object.assign({}, l, { idx: l.idx + 1 }));
    App.flushSave();
    render();
  }

  function finish() {
    destroyWriter();
    const l = L(), today = App.todayStr();
    const graded = l.results.filter((r) => r.firstTry);
    const correctFirst = graded.filter((r) => r.correct).length;
    const perfect = graded.length > 0 && correctFirst === graded.length;
    let p = Outcome.applyOutcome(App.state.progress, l.kind, l.results, today, l.wordIds);
    const ratio = graded.length ? correctFirst / graded.length : 0;
    let crowned = false, passed = null;
    if (l.kind === "boss" && ratio >= 0.8) {
      p = Object.assign({}, p, { crowns: Object.assign({}, p.crowns, { [l.unit]: today }) });
      crowned = true;
    }
    if (l.kind === "legendary") {
      passed = ratio >= 0.9;
      if (passed) p = Object.assign({}, p, { legendary: Object.assign({}, p.legendary, { [l.unit]: today }) });
    }
    if (l.kind === "testout") {
      passed = ratio >= 0.8;
      if (passed) p = Outcome.applyTestOut(p, l.wordIds, today, Math.random);
    }
    const xp = l.kind === "legendary" && !passed ? 10 : Rewards.lessonXp({ correct: correctFirst, total: graded.length, perfect, maxCombo: l.maxCombo, boosted: App.boosted(), kind: l.kind });
    if (l.kind !== "new" && l.kind !== "review") p = Object.assign({}, p, { done: Object.assign({}, p.done, { [l.key]: today }) });
    p = Object.assign({}, p, { lessonInProgress: null });
    App.set(p);
    if (l.kind === "review") App.bumpLog("reviewed", new Set(l.results.map((r) => r.wordId)).size);
    App.bumpLog("xp", xp);
    App.bumpLog("lessons", 1);
    if (perfect) App.bumpLog("perfect", 1);
    App.set(Rewards.earlyBird(App.state.progress, new Date()));
    App.track({ type: "lesson", perfect });
    App.refreshAchievements();
    App.flushSave();
    const summary = {
      kind: l.kind, key: l.key, unit: l.unit, xp, correct: correctFirst, total: graded.length, perfect, maxCombo: l.maxCombo,
      newWords: l.kind === "new" ? l.wordIds.length : 0, crowned, passed, ratio,
    };
    view.lastResult = null;
    UIExtras.finish(summary);
  }

  $("#check-btn").addEventListener("click", check);

  function onKey(e) {
    if (!$("#quit-dialog").hidden) {
      if (e.key === "Escape") $("#quit-dialog").hidden = true;
      return;
    }
    if (e.key === "Escape") return askQuit();
    const ex = cur();
    if (!ex) return;
    if (e.key === "Enter" || (e.key === " " && (ex.type === "meet" || view.checked))) {
      e.preventDefault();
      if (!$("#check-btn").disabled) check();
      return;
    }
    const n = Number(e.key);
    if (!view.checked && ex.type === "component" && n >= 1 && n <= 9) {
      const opt = document.querySelectorAll("#ex-stage .opt")[n - 1];
      if (opt) opt.click();
      return;
    }
    if (!view.checked && n >= 1 && n <= 4) {
      const opt = document.querySelectorAll("#ex-stage .opt")[n - 1];
      if (opt) select(opt);
    }
  }

  // hooks for the smoke test
  function testAnswer(correct) {
    const ex = cur();
    if (ex.type === "meet") return meetDone();
    if (ex.type === "match") { record(correct, { pairResults: ex.pairs.map((id) => ({ wordId: id, correct })) }); return advance(); }
    if (/trace|write/i.test(ex.type)) { destroyWriter(); record(correct, { mistakes: correct ? 0 : 5, revealed: !correct }); return advance(); }
    if (ex.type === "buildSentence" || ex.type === "listenTap") {
      tapTiles(correct ? ex.answer : ex.tiles.slice().reverse());
      checkTiles(ex); return advance();
    }
    if (ex.type === "component") {
      view.picked = new Set(correct ? ex.answer : ex.options.filter((c) => !ex.answer.includes(c)).slice(0, 1));
      checkComponent(ex); return advance();
    }
    view.selected = String(correct ? ex.answer : ex.options.find((o) => String(o) !== String(ex.answer)));
    check();
    advance();
  }

  // place tiles by their text, in order (smoke hook)
  function tapTiles(tokens) {
    view.placed = [];
    const used = new Set();
    for (const t of tokens) {
      const i = cur().tiles.findIndex((x, k) => x === t && !used.has(k));
      if (i !== -1) { used.add(i); view.placed.push(i); }
    }
    drawTiles();
  }

  window.UILesson = {
    start, resume, onKey, askQuit,
    _answer: testAnswer, _answerWrong: () => testAnswer(false), _quit: quit, _current: cur,
    _checked: () => view.checked, _continue: () => view.checked && advance(), _lastResult: () => view.lastResult,
    _writerChar: () => view.chars[view.charIdx],
    _tapTiles: tapTiles,
    _writerOptions: () => lastWriterOptions,
    // finish a boss run with `firstTry` of `graded` exercises right on the first try
    _finishKind: ({ kind, unit, firstTry, graded }) => {
      const ids = App.unitIds(unit);
      const results = ids.slice(0, graded).map((id, i) => ({ exId: "k" + i, wordId: id, type: "pickMeaning", correct: i < firstTry, firstTry: true, hinted: false, revealed: false, mistakes: 0 }));
      setL({ key: `${kind}-u${unit}`, kind, unit, wordIds: ids, exercises: [], idx: 0, results, combo: 0, maxCombo: 0, startedAt: Date.now() });
      finish();
    },
    _finishBoss: ({ unit, firstTry, graded }) => {
      const ids = App.unitIds(unit).slice(0, graded);
      const results = ids.map((id, i) => ({ exId: "b" + i, wordId: id, type: "write", correct: i < firstTry, firstTry: true, hinted: false, revealed: i >= firstTry, mistakes: 0 }));
      setL({ key: `u${unit}-boss`, kind: "boss", unit, wordIds: ids, exercises: [], idx: 0, results, combo: 0, maxCombo: 0, startedAt: Date.now() });
      finish();
    },
    _shot: () => { start(App.buildPath().stops.find((s) => s.kind === "lesson" && s.status === "current")); meetDone(); },
    _shotTrace: (ok) => {
      const ai = App.state.words.find((w) => w.hanzi === "爱");
      setL({ key: "shot", kind: "practice", wordIds: [ai.id], exercises: [{ id: "shot-tr", type: "trace", wordId: ai.id }], idx: 0, results: [], combo: 0, maxCombo: 0, startedAt: 0 });
      open();
      if (ok) setTimeout(() => { view.writer.showCharacter(); view.writer.updateColor("strokeColor", cssVar("--green")); $(".pad-wrap").classList.add("char-ok"); }, 600);
    },
    _shotSentence: () => {
      const s = App.state.sentences.find((x) => x.hanzi === "你叫什么名字？");
      const toks = s.words.map(tokText);
      setL({ key: "shot", kind: "practice", wordIds: [s.words[0]], exercises: [{ id: "shot-bs", type: "buildSentence", wordId: s.words[0], sentenceId: s.id, answer: toks, tiles: toks.concat(["我", "好"]).reverse() }], idx: 0, results: [], combo: 0, maxCombo: 0, startedAt: 0 });
      open();
      tapTiles(toks.slice(0, 2));
    },
    _shotWrite: () => {
      start(App.buildPath().stops.find((s) => s.kind === "lesson" && s.status === "current"));
      const l = L();
      setL(Object.assign({}, l, { idx: l.exercises.findIndex((e) => e.type === "write") }));
      render();
    },
  };
})();
