/* HSK 汉字 — mini stories: line by line in each character's voice, then 3 questions. */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const WHO = { teacher: "晓", hero: "希", yueB: "月", yueA: "月", panda: "🐼" };
  let S = null; // { story, shown, q, correct, answered }

  const lineUrl = (unit, i) => `${App.state.storiesBase}u${unit}-${i}.mp3`;

  function start(unit) {
    const story = App.state.stories.find((s) => s.unit === unit);
    if (!story) return App.toast("This story is still being written.");
    S = { story, shown: 1, q: -1, correct: 0, answered: false };
    App.go("story");
    $("#story-title").textContent = `${story.title} · ${story.titleEn}`;
    $("#story-body").innerHTML = story.lines.map((l, i) => `
      <div class="sline${i === 0 ? " seen" : ""}" data-i="${i}">
        <div class="who ${l.speaker}">${WHO[l.speaker] || "?"}</div>
        <div class="txt"><div class="hz">${App.esc(l.hanzi)}</div><div class="py">${App.esc(l.pinyin)}</div><div class="en">${App.esc(l.en)}</div></div>
      </div>`).join("") + `<div class="story-q" id="story-q"></div>`;
    $("#story-msg").textContent = "Tap a line to hear it again.";
    $("#story-bar").className = "check-bar";
    $("#story-next").textContent = "Continue";
    $("#story-next").disabled = false;
    Mascot.say("panda-story").then(() => playLine(0));
  }

  function playLine(i) {
    if (!S) return Promise.resolve();
    return App.playUrl(lineUrl(S.story.unit, i));
  }

  $("#story-body").addEventListener("click", (e) => {
    const line = e.target.closest(".sline.seen");
    if (line) playLine(Number(line.dataset.i));
    const opt = e.target.closest(".opt");
    if (opt) answer(Number(opt.dataset.v));
  });

  function next() {
    if (!S) return;
    const n = S.story.lines.length;
    if (S.shown < n) {
      const el = document.querySelector(`#story-body .sline[data-i="${S.shown}"]`);
      el.classList.add("seen");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      playLine(S.shown);
      S.shown++;
      return;
    }
    if (S.q === -1 || S.answered) {
      S.q++;
      if (S.q >= S.story.questions.length) return finish();
      return renderQuestion();
    }
  }

  function renderQuestion() {
    const q = S.story.questions[S.q];
    S.answered = false;
    $("#story-bar").className = "check-bar";
    $("#story-msg").textContent = `Question ${S.q + 1} of ${S.story.questions.length}`;
    $("#story-next").disabled = true;
    $("#story-q").innerHTML = `
      <h3><span style="font-family:var(--kai);font-size:26px">${App.esc(q.q)}</span><br><small style="color:var(--muted)">${App.esc(q.qEn)}</small></h3>
      <div class="options">${q.options.map((o, i) => `<button class="opt" data-v="${i}"><span class="k">${i + 1}</span><span>${App.esc(o)}</span></button>`).join("")}</div>`;
    $("#story-q").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function answer(i) {
    if (!S || S.q < 0 || S.answered) return;
    const q = S.story.questions[S.q];
    S.answered = true;
    const right = i === q.answer;
    if (right) S.correct++;
    document.querySelectorAll("#story-q .opt").forEach((o) => {
      const v = Number(o.dataset.v);
      if (v === q.answer) o.classList.add("right");
      else if (v === i) o.classList.add("wrong");
      o.disabled = true;
    });
    Sfx.play(right ? "right" : "wrong");
    $("#story-bar").className = "check-bar " + (right ? "right" : "wrong");
    $("#story-msg").textContent = right ? "对了！" : `Answer: ${q.options[q.answer]}`;
    $("#story-next").disabled = false;
  }

  function finish() {
    const unit = S.story.unit, total = S.story.questions.length, correct = S.correct;
    S = null;
    const p = App.state.progress;
    App.set(Object.assign({}, p, { stories: Object.assign({}, p.stories, { [unit]: App.todayStr() }) }));
    const xp = (App.boosted() ? 2 : 1) * (10 + correct * 2);
    App.bumpLog("xp", xp);
    App.refreshAchievements();
    App.flushSave();
    UIExtras.finish({ kind: "story", key: `u${unit}-story`, xp, correct, total, perfect: correct === total, maxCombo: 0, newWords: 0 });
  }

  function quit() {
    S = null;
    App.go("path");
  }

  $("#story-next").addEventListener("click", next);
  $("#story-quit").addEventListener("click", quit);
  $("#story-pinyin").addEventListener("click", () => { document.body.classList.toggle("show-pinyin"); $("#story-pinyin").classList.toggle("on"); });
  $("#story-en").addEventListener("click", () => { document.body.classList.toggle("show-en"); $("#story-en").classList.toggle("on"); });

  function onKey(e) {
    if (e.key === "Escape") return quit();
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!$("#story-next").disabled) next(); return; }
    const n = Number(e.key);
    if (S && S.q >= 0 && n >= 1 && n <= 4) answer(n - 1);
  }

  window.UIStory = {
    start, onKey,
    _finishAll: () => {
      while (S && S.shown < S.story.lines.length) next();
      while (S) { next(); if (S && S.q >= 0 && !S.answered) answer(S.story.questions[S.q].answer); }
    },
    _shot: () => { start(1); next(); next(); next(); document.body.classList.add("show-pinyin", "show-en"); },
  };
})();
