/* HSK 汉字 — Practice tab: mistakes, words list, listening, radio, extra practice, speed. */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  let radio = null; // { lines: Sentence[], i, qs, q, correct, playing }

  const mistakeWords = () => [...new Set((App.state.progress.mistakes || []).map((m) => m.wordId))].filter((id) => App.wordState(id)).slice(0, 12);

  function open() {
    App.go("practice");
    const known = App.knownIds().length;
    const mis = mistakeWords().length;
    const radioOk = radioQueue().length >= 6;
    const card = (id, icon, title, sub, enabled) =>
      `<button class="pcard" id="${id}"${enabled ? "" : " disabled"}><span class="pc-icon">${icon}</span><b>${title}</b><small>${sub}</small></button>`;
    $("#practice-body").innerHTML = `
      <div class="pcards">
        ${card("pc-mistakes", "🩹", "Mistakes", mis ? `${mis} words you missed this week` : "No mistakes this week 🎉", mis > 0)}
        ${card("pc-words", "📚", "Words", `${known} words met`, known > 0)}
        ${card("pc-listen", "🎧", "Listen", "Audio only — great on the walking pad", known >= 4)}
        ${card("pc-radio", "📻", "Radio", radioOk ? "Hands-free: the cast talks, you listen" : "Meet a few more words first", radioOk)}
        ${card("pc-practice", "练", "Extra practice", "Your weakest words", known >= 4)}
        ${card("pc-speed", "⚡", "Speed round", "60 seconds of matching", UIExtras.speedAvailable())}
      </div>
      <div id="practice-detail"></div>`;
  }

  $("#practice-body").addEventListener("click", (e) => {
    const b = e.target.closest(".pcard");
    if (b && !b.disabled) {
      const today = App.todayStr();
      if (b.id === "pc-mistakes") UILesson.start({ key: `mistakes-${today}`, kind: "mistakes", unit: 0, wordIds: mistakeWords() });
      if (b.id === "pc-words") showWords();
      if (b.id === "pc-listen") UILesson.start({ key: `listen-${today}`, kind: "listen", unit: 0, wordIds: shuffle(App.knownIds()).slice(0, 10) });
      if (b.id === "pc-radio") startRadio();
      if (b.id === "pc-practice") UILesson.start({ key: `practice-${today}`, kind: "practice", unit: 0, wordIds: [] });
      if (b.id === "pc-speed") UIExtras.startSpeed();
      return;
    }
    const row = e.target.closest(".wrow");
    if (row) {
      const id = Number(row.dataset.id);
      App.playAudio(id);
      row.classList.toggle("open");
    }
  });
  $("#practice-body").addEventListener("change", (e) => {
    if (e.target.id === "words-sort") showWords(e.target.value);
  });

  /* ---------- words list ---------- */
  const strength = (st) => Math.min(1, (st.interval || 0) / 21);
  function showWords(sort) {
    if (document.body.dataset.screen !== "practice") open();
    sort = sort || "weakest";
    const ids = App.knownIds();
    const st = (id) => App.wordState(id);
    ids.sort(sort === "newest"
      ? (a, b) => (st(b).introducedOn || "").localeCompare(st(a).introducedOn || "")
      : (a, b) => strength(st(a)) - strength(st(b)) || (st(b).weak || 0) - (st(a).weak || 0));
    const sentencesFor = (id) => App.state.sentences.filter((s) => s.words.includes(id) && s.words.every((t) => typeof t === "string" || App.wordState(t)?.introducedOn)).slice(0, 2);
    $("#practice-detail").innerHTML = `
      <div class="words-head"><h3>Words you've met</h3>
        <select id="words-sort"><option value="weakest"${sort === "weakest" ? " selected" : ""}>Weakest first</option><option value="newest"${sort === "newest" ? " selected" : ""}>Newest first</option></select></div>
      <div class="wlist">${ids.map((id) => {
        const w = App.word(id), s = st(id);
        const parts = Array.from(w.hanzi).map((c) => Parts.line(c)).filter(Boolean);
        const sents = sentencesFor(id);
        return `<div class="wrow" data-id="${id}">
          <span class="w-hz">${App.hanziHTML(w)}</span><span class="w-py">${App.esc(w.pinyin)}</span><span class="w-gl">${App.esc(App.gloss(w))}</span>
          <span class="w-lv">${App.levelName(w.level)}</span><span class="w-bar"><i style="width:${Math.round(strength(s) * 100)}%"></i></span>
          <div class="w-more">${parts.map(App.esc).join("<br>")}${sents.map((x) => `<div class="w-sent">${App.esc(x.hanzi)} <small>${App.esc(x.en)}</small></div>`).join("")}<small>met ${s.introducedOn} · next review ${s.due || "—"}</small></div>
        </div>`;
      }).join("")}</div>`;
  }

  /* ---------- radio: a short hands-free episode from known-word sentences ---------- */
  function radioQueue() {
    const known = new Set(App.knownIds());
    const usable = App.state.sentences.filter((s) => s.words.every((t) => typeof t === "string" || known.has(t)));
    return shuffle(usable).slice(0, 8);
  }

  async function startRadio() {
    const lines = radioQueue();
    if (lines.length < 6) return App.toast("Meet a few more words first — radio needs sentences you know.");
    radio = { lines, i: 0, q: -1, correct: 0, qs: [] };
    App.go("radio");
    $("#radio-body").innerHTML = lines.map((s, i) => `
      <div class="sline" data-i="${i}"><div class="who ${s.speaker}">${{ teacher: "晓", hero: "希", yueB: "月" }[s.speaker] || "?"}</div>
      <div class="txt"><div class="hz">${App.esc(s.hanzi)}</div><div class="py">${App.esc(s.pinyin)}</div><div class="en">${App.esc(s.en)}</div></div></div>`).join("") + `<div class="story-q" id="radio-q"></div>`;
    $("#radio-next").disabled = true;
    $("#radio-msg").textContent = "Just listen 🎧";
    for (let i = 0; i < lines.length && radio; i++) {
      radio.i = i;
      const el = document.querySelector(`#radio-body .sline[data-i="${i}"]`);
      el.classList.add("seen");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await App.playSentence(lines[i].id);
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!radio) return;
    // two meaning questions about lines from the episode
    radio.qs = shuffle(lines).slice(0, 2).map((s) => {
      const others = shuffle(App.state.sentences.filter((o) => o.id !== s.id && o.en !== s.en)).slice(0, 2).map((o) => o.en);
      return { s, options: shuffle([s.en].concat(others)) };
    });
    nextQuestion();
  }

  function nextQuestion() {
    radio.q++;
    if (radio.q >= radio.qs.length) return finishRadio(radio.correct);
    const q = radio.qs[radio.q];
    $("#radio-msg").textContent = `Question ${radio.q + 1} of ${radio.qs.length}`;
    $("#radio-next").disabled = true;
    $("#radio-q").innerHTML = `<h3>What did you hear? <button class="speaker small" id="radio-replay">🔊</button></h3>
      <div class="options">${q.options.map((o, i) => `<button class="opt" data-i="${i}"><span class="k">${i + 1}</span><span>${App.esc(o)}</span></button>`).join("")}</div>`;
    $("#radio-replay").addEventListener("click", () => App.playSentence(q.s.id));
    App.playSentence(q.s.id);
    $("#radio-q").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  $("#radio-body").addEventListener("click", (e) => {
    const o = e.target.closest("#radio-q .opt");
    if (o && radio && !o.disabled) {
      const q = radio.qs[radio.q];
      const right = q.options[Number(o.dataset.i)] === q.s.en;
      if (right) radio.correct++;
      document.querySelectorAll("#radio-q .opt").forEach((b) => {
        if (q.options[Number(b.dataset.i)] === q.s.en) b.classList.add("right");
        else if (b === o) b.classList.add("wrong");
        b.disabled = true;
      });
      Sfx.play(right ? "right" : "wrong");
      $("#radio-next").disabled = false;
      return;
    }
    const line = e.target.closest(".sline.seen");
    if (line && radio) App.playSentence(radio.lines[Number(line.dataset.i)].id);
  });
  $("#radio-next").addEventListener("click", () => radio && nextQuestion());
  $("#radio-quit").addEventListener("click", () => { radio = null; open(); });

  function finishRadio(correct) {
    radio = null;
    const xp = (App.boosted() ? 2 : 1) * (10 + correct * 2);
    App.bumpLog("xp", xp);
    App.refreshAchievements();
    App.flushSave();
    UIExtras.finish({ kind: "radio", key: null, xp, correct, total: 2, perfect: correct === 2, maxCombo: 0, newWords: 0 });
  }

  function onKey(e) {
    if (e.key === "Escape") { if (document.body.dataset.screen === "radio") radio = null; App.go("path"); }
  }

  window.UIPractice = { open, showWords, onKey, _radioQueue: radioQueue, _finishRadio: finishRadio };
})();
