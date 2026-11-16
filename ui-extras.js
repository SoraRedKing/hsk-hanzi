/* HSK 汉字 — finish screen, quests panel, chest, goal celebration (speed round and stats below). */
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  let lastKey = null;
  let pendingChest = false;

  /* ---------- confetti ---------- */
  function confetti() {
    const cv = $("#confetti");
    const ctx = cv.getContext("2d");
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    const colors = ["#e0443a", "#ffc800", "#58a700", "#1cb0f6", "#7b4fd6"];
    const parts = Array.from({ length: 120 }, () => ({
      x: cv.width / 2 + (Math.random() - 0.5) * 200, y: cv.height * 0.35,
      vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 4,
      s: 5 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6,
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.1;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      }
      if (t - t0 < 2000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  /* ---------- quests ---------- */
  function questRows() {
    const p = App.state.progress;
    const items = p.quests && p.quests.date === App.todayStr() ? p.quests.items : [];
    return items.map((it) => {
      const q = Rewards.QUEST_POOL.find((x) => x.id === it.id);
      if (!q) return "";
      const target = it.target || q.target;
      const pct = Math.round((it.progress / target) * 100);
      const shown = q.event === "active" ? `${Math.floor(it.progress / 60)}/${Math.round(target / 60)} min` : `${it.progress}/${target}`;
      return `<div class="quest${it.done ? " done" : ""}"><span class="q-text">${it.done ? "✅" : "🎯"} ${App.esc(Rewards.questText(q.id, target))}</span><span class="q-bar"><i style="width:${pct}%"></i></span><small>${shown}</small></div>`;
    }).join("");
  }

  function openQuests() {
    App.refreshToday();
    const p = App.state.progress;
    $("#quests-list").innerHTML = questRows();
    const month = App.todayStr().slice(0, 7);
    const ch = Rewards.MONTH_BADGES[Number(month.slice(5)) - 1];
    const count = p.monthly && p.monthly.month === month ? p.monthly.count : 0;
    const earned = p.badges.some((b) => b.month === month);
    $("#monthly").innerHTML = `Monthly challenge: <b>${Math.min(count, Rewards.MONTHLY_TARGET)}/${Rewards.MONTHLY_TARGET}</b> quests → badge <span style="font-family:var(--kai);font-size:22px">${ch}</span>${earned ? " ✅ earned!" : ""}`;
    $("#quests-panel").hidden = false;
  }
  $("#quests-close").addEventListener("click", () => { $("#quests-panel").hidden = true; });

  function onQuests(r) {
    const items = (r.progress.quests && r.progress.quests.items) || [];
    App.toast("🎯 Quest done: " + r.completed.map((q) => Rewards.questText(q.id, (items.find((i) => i.id === q.id) || {}).target)).join(" · "));
    if (r.chest) {
      pendingChest = true;
      if (!["lesson", "speed", "story"].includes(document.body.dataset.screen)) showChest();
    }
  }

  // A chest earned but never opened is saved as quests.chest === "ready", so it
  // survives quitting mid-lesson or closing the app; the path shows it again.
  function showReadyChest() {
    const q = App.state.progress.quests;
    if (q && q.date === App.todayStr() && q.chest === "ready" && $("#chest-dialog").hidden) showChest();
  }

  function showChest() {
    pendingChest = false;
    $("#chest-art").textContent = "🎁";
    $("#chest-art").classList.remove("opened");
    $("#chest-title").textContent = "All 3 quests done!";
    $("#chest-text").textContent = "Open your chest.";
    $("#chest-open").textContent = "Open";
    $("#chest-open").dataset.state = "closed";
    $("#chest-dialog").hidden = false;
    Mascot.say("panda-chest");
  }
  $("#chest-open").addEventListener("click", () => {
    const b = $("#chest-open");
    if (b.dataset.state === "opened") { $("#chest-dialog").hidden = true; return; }
    const r = Rewards.openChest(App.state.progress, Date.now());
    App.set(r.progress);
    App.flushSave();
    Sfx.play("chest");
    $("#chest-art").textContent = r.reward === "freeze" ? "❄️" : "⚡";
    $("#chest-art").classList.add("opened");
    $("#chest-title").textContent = r.reward === "freeze" ? "Streak freeze!" : "Double XP for 15 minutes!";
    $("#chest-text").textContent = r.reward === "freeze"
      ? `It protects your streak on a day you can't study. You hold ${r.progress.freezes} of 2.`
      : "You already hold 2 freezes, so here's a boost instead.";
    b.textContent = "Nice!";
    b.dataset.state = "opened";
    App.renderHud();
  });

  function goalComplete() {
    Sfx.play("dayDone");
    Mascot.react("cheer");
    Mascot.say("panda-goal");
    App.toast(`🎉 ${Activity.goalSeconds(App.state.progress) / 60} active minutes — daily goal complete! 太棒了！`, 5000);
  }

  /* ---------- finish screen ---------- */
  function finish(s) {
    lastKey = s.key;
    App.go("finish");
    const acc = s.total ? Math.round((s.correct / s.total) * 100) : 100;
    let zh = s.perfect ? "完美！" : "好！", title = s.perfect ? "Perfect lesson!" : "Lesson complete";
    if (s.kind === "boss") {
      zh = s.crowned ? "👑" : "加油";
      title = s.crowned ? "Boss beaten — crown earned!" : "Almost — try again any time";
    } else if (s.kind === "review") title = s.perfect ? "Perfect review!" : "Review done";
    else if (s.kind === "checkpoint") title = "Day check done";
    else if (s.kind === "practice") title = "Practice done";
    else if (s.kind === "story") { zh = "📖"; title = "Story finished"; }
    else if (s.kind === "hard") title = s.perfect ? "Day check — perfect!" : "Day check done";
    else if (s.kind === "legendary") { zh = s.passed ? "💜" : "加油"; title = s.passed ? "Legendary!" : "Legendary needs 90% — try again any time"; }
    else if (s.kind === "testout") { zh = s.passed ? "🚀" : "加油"; title = s.passed ? "Unit tested out — those words join your reviews" : "Not quite — keep going through the path"; }
    else if (s.kind === "radio") { zh = "📻"; title = "Radio episode done"; }
    else if (s.kind === "mistakes") title = "Mistakes cleared";
    else if (s.kind === "listen") title = "Listening done";
    else if (s.kind === "component") title = "Character parts done";
    else if (s.kind === "speed") { zh = "⚡"; title = `${s.score} pairs in 60 seconds${s.newBest ? " — new best!" : ` · best ${s.best}`}`; }
    const box = $("#finish");
    box.dataset.xp = String(s.xp);
    $("#finish-body").innerHTML = `
      ${Mascot.el("big")}
      <div class="zh">${zh}</div>
      <h2>${title}</h2>
      <div class="finish-stats">
        <div class="fstat xp"><b>+${s.xp}</b><span>XP${App.boosted() ? " · 2×" : ""}</span></div>
        ${s.total ? `<div class="fstat acc"><b>${acc}%</b><span>first try</span></div>` : ""}
        ${s.maxCombo ? `<div class="fstat combo"><b>${s.maxCombo}</b><span>best combo</span></div>` : ""}
        ${s.newWords ? `<div class="fstat"><b>${s.newWords}</b><span>new words</span></div>` : ""}
      </div>
      <div class="quest-ticks">${questRows()}</div>
      <button class="btn3d green big" id="finish-continue">Continue</button>`;
    $("#finish-continue").addEventListener("click", finishContinue);
    const good = s.perfect || s.crowned || acc >= 70;
    Sfx.play("lessonDone");
    if (good) { confetti(); Mascot.react("cheer"); }
    Mascot.say(s.kind === "boss" ? (s.crowned ? "yueA-boss-pass" : "yueA-boss-fail") : s.perfect ? "panda-perfect" : "panda-done");
    if (pendingChest) setTimeout(showChest, 900);
  }

  function finishContinue() {
    $("#chest-dialog").hidden = true;
    App.go("path");
    if (lastKey) { UIPath.render({ pop: lastKey }); Sfx.play("pop"); }
    lastKey = null;
    if (pendingChest) showChest();
  }

  /* ---------- speed round: 60 s of match madness over known words ---------- */
  const SPEED_SECONDS = 60, SPEED_ROWS = 5;
  let speed = null;

  function speedAvailable() { return App.introducedCount() >= 8; }

  function startSpeed() {
    if (!speedAvailable()) return App.toast("Meet 8 words first — then speed rounds open.");
    const known = App.knownIds();
    speed = { score: 0, left: SPEED_SECONDS, misses: {}, board: [], pick: null, pool: known, timer: null };
    for (let i = 0; i < SPEED_ROWS; i++) speed.board.push(drawWord());
    App.go("speed");
    renderSpeed();
    Mascot.say("yueA-speed-start");
    speed.timer = setInterval(() => {
      if (!speed) return;
      speed.left--;
      $("#speed-time").textContent = speed.left;
      if (speed.left <= 0) speedFinish(speed.score);
    }, 1000);
  }

  // a known word whose hanzi and meaning aren't already on the board
  function drawWord() {
    const onBoard = new Set(speed.board.filter(Boolean).map((id) => App.word(id).hanzi));
    const glosses = new Set(speed.board.filter(Boolean).map((id) => App.gloss(App.word(id))));
    for (let t = 0; t < 50; t++) {
      const id = speed.pool[Math.floor(Math.random() * speed.pool.length)];
      const w = App.word(id);
      if (!onBoard.has(w.hanzi) && !glosses.has(App.gloss(w))) return id;
    }
    return speed.pool[0];
  }

  function renderSpeed() {
    const right = speed.board.slice().sort(() => Math.random() - 0.5);
    $("#speed-time").textContent = speed.left;
    $("#speed-score").textContent = speed.score;
    $("#speed-board").innerHTML =
      speed.board.map((id, i) => `<button class="match-btn hz" style="grid-column:1;grid-row:${i + 1}" data-side="L" data-id="${id}">${App.esc(App.word(id).hanzi)}</button>`).join("") +
      right.map((id, i) => `<button class="match-btn" style="grid-column:2;grid-row:${i + 1}" data-side="R" data-id="${id}">${App.esc(App.gloss(App.word(id)))}</button>`).join("");
  }

  $("#speed-board").addEventListener("click", (e) => {
    const b = e.target.closest(".match-btn");
    if (!b || !speed || b.classList.contains("matched")) return;
    if (!speed.pick || speed.pick.dataset.side === b.dataset.side) {
      document.querySelectorAll("#speed-board .selected").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      speed.pick = b;
      return;
    }
    const a = speed.pick;
    speed.pick = null;
    a.classList.remove("selected");
    if (a.dataset.id === b.dataset.id) {
      speed.score++;
      Sfx.play(speed.score % 5 === 0 ? "combo" : "right");
      $("#speed-score").textContent = speed.score;
      // swap the matched word for a fresh one, in place on both sides
      const id = Number(a.dataset.id);
      const row = speed.board.indexOf(id);
      speed.board[row] = null;
      const next = drawWord();
      speed.board[row] = next;
      const w = App.word(next);
      a.dataset.id = next; a.textContent = w.hanzi;
      b.dataset.id = next; b.textContent = App.gloss(w);
      [a, b].forEach((x) => { x.classList.remove("miss"); x.classList.add("pop"); setTimeout(() => x.classList.remove("pop"), 300); });
    } else {
      Sfx.play("wrong");
      [a, b].forEach((x) => { speed.misses[x.dataset.id] = (speed.misses[x.dataset.id] || 0) + 1; x.classList.remove("miss"); void x.offsetWidth; x.classList.add("miss"); });
    }
  });

  function speedFinish(score) {
    if (speed && speed.timer) clearInterval(speed.timer);
    const misses = speed ? speed.misses : {};
    speed = null;
    const results = Object.keys(misses).map((id) => ({ exId: "speed", wordId: Number(id), type: "speed", correct: false, firstTry: true, hinted: false, revealed: false, mistakes: 0 }));
    let p = Outcome.applyOutcome(App.state.progress, "speed", results, App.todayStr());
    const best = Math.max(p.speedBest || 0, score);
    p = Object.assign({}, p, { speedBest: best });
    App.set(p);
    const xp = (App.boosted() ? 2 : 1) * Math.ceil(score / 2);
    App.bumpLog("xp", xp);
    App.track({ type: "speed", score });
    App.refreshAchievements();
    App.flushSave();
    Mascot.say("yueA-speed-end");
    finish({ kind: "speed", key: null, xp, correct: 0, total: 0, perfect: false, maxCombo: 0, newWords: 0, score, best, newBest: score >= best && score > 0 });
  }

  $("#speed-quit").addEventListener("click", () => speed && speedFinish(speed.score));
  function onSpeedKey(e) {
    if (e.key === "Escape" && speed) speedFinish(speed.score);
  }

  /* ---------- stats ---------- */
  function renderStats() {
    const p = App.state.progress, words = App.state.words, today = App.todayStr();
    const seen = App.introducedCount();
    const mastered = words.filter((w) => (App.wordState(w.id)?.interval || 0) >= 21).length;
    const leeches = words.filter((w) => App.wordState(w.id)?.leech).length;
    const sum = (f) => p.log.reduce((a, e) => a + (e[f] || 0), 0);
    const pace = Syllabus.normalizePace(p.settings.pace);
    const totalDays = Syllabus.totalDays(words.length, pace);
    const dayN = Syllabus.dayOf(p.words, App.state.order, pace);
    const box = (v, label) => `<div class="statbox"><b>${v}</b><span>${label}</span></div>`;

    // heatmap: last 120 days of active minutes, oldest first
    const byDate = new Map(p.log.map((e) => [e.date, e]));
    let cells = "";
    for (let i = 119; i >= 0; i--) {
      const date = Scheduler.addDays(today, -i);
      const e = byDate.get(date) || {};
      const m = (e.activeSeconds || 0) / 60;
      const cls = e.frozen && !m ? "frozen" : m === 0 ? "" : m < 10 ? "q1" : m < 30 ? "q2" : m < 60 ? "q3" : "q4";
      cells += `<i class="hm-cell ${cls}" title="${date}: ${Math.round(m)} active min${e.frozen ? " · ❄ freeze used" : ""}"></i>`;
    }

    const lvlBars = [...new Set(words.map((w) => w.level))].sort((a, b) => (a || 99) - (b || 99)).map((lv) => {
      const all = words.filter((w) => w.level === lv);
      const met = all.filter((w) => App.wordState(w.id)?.introducedOn).length;
      return `<div class="lvl-bar"><span>${App.levelName(lv)}</span><span class="track"><i style="width:${Math.round((met / all.length) * 100)}%"></i></span><span class="nums">${met} / ${all.length}</span></div>`;
    }).join("");

    const badges = Rewards.MONTH_BADGES.map((ch, i) => {
      const got = p.badges.find((b) => Number(b.month.slice(5)) === i + 1);
      return `<span class="badge${got ? " earned" : ""}" title="${got ? "Earned " + got.month : "Finish 40 quests in this month"}">${ch}</span>`;
    }).join("");

    const ach = Rewards.ACHIEVEMENTS.map((a) => {
      const when = p.achievements[a.id];
      return `<div class="ach${when ? " earned" : ""}" data-id="${a.id}"><b>${when ? "🏆" : "🔒"} ${App.esc(a.title)}</b><small>${when ? "Unlocked " + when : "Not yet"}</small></div>`;
    }).join("");

    $("#stats-body").innerHTML = `
      <div class="statrow">
        ${box("🔥 " + p.streak.count, "day streak")}
        ${box("❄ " + (p.freezes || 0), "freezes held")}
        ${box(dayN ? `${dayN} / ${totalDays}` : "完", "plan day")}
        ${box(seen.toLocaleString(), "words met")}
        ${box(mastered.toLocaleString(), "mastered (21d+)")}
        ${box(leeches, "stubborn words")}
        ${box(sum("written").toLocaleString(), "characters written")}
        ${box(sum("xp").toLocaleString(), "total XP")}
        ${box(Object.keys(p.crowns).length, "crowns 👑")}
        ${box(p.speedBest || 0, "speed best ⚡")}
      </div>
      <div class="settings">
        <div class="stats-h">⚙ Settings</div>
        <div class="set-row"><span>Daily goal</span><div class="pace-pick">${[10, 20, 30, 60].map((n) => `<button class="btn3d${n === (p.settings.goalMinutes || 20) ? " on" : ""}" data-goal="${n}">${n} min</button>`).join("")}</div></div>
        <div class="set-row"><span>Stroke checking</span><div class="pace-pick">${[["strict", "Strict"], ["normal", "Normal"], ["relaxed", "Relaxed"]].map(([k, l]) => `<button class="btn3d${k === (p.settings.leniency || "relaxed") ? " on" : ""}" data-leniency="${k}">${l}</button>`).join("")}</div></div>
        <div class="set-row"><span>New words per day</span><div class="pace-pick">${Syllabus.PACE_OPTIONS.map((n) => `<button class="btn3d${n === pace ? " on" : ""}" data-pace="${n}">${n} / day</button>`).join("")}</div></div>
        <div class="set-row"><span>Midday reminder</span><div class="pace-pick"><button class="btn3d${p.settings.reminder && p.settings.reminder.on ? " on" : ""}" data-reminder="toggle">${p.settings.reminder && p.settings.reminder.on ? "On" : "Off"}</button>
          <select data-reminder-time>${REMINDER_TIMES.map((t) => `<option${t === ((p.settings.reminder && p.settings.reminder.time) || "12:30") ? " selected" : ""}>${t}</option>`).join("")}</select></div></div>
      </div>
      <div><div class="stats-h">Last 120 days · active minutes</div><div class="heatmap">${cells}</div></div>
      <div><div class="stats-h">Syllabus coverage</div>${lvlBars}</div>
      <div><div class="stats-h">Monthly badges</div><div class="badges">${badges}</div></div>
      <div><div class="stats-h">Achievements</div><div class="ach-wall">${ach}</div></div>
      ${seen === 0 ? '<p style="color:var(--muted)">Nothing here yet — finish your first lesson and this page starts filling in. 加油！</p>' : ""}`;
  }
  $("#stats-body").addEventListener("click", (e) => {
    const b = e.target.closest(".pace-pick button");
    if (!b) return;
    const p = App.state.progress;
    const set = (patch) => App.set(Object.assign({}, p, { settings: Object.assign({}, p.settings, patch) }));
    if (b.dataset.pace) set({ pace: Syllabus.normalizePace(Number(b.dataset.pace)) });
    if (b.dataset.goal) set({ goalMinutes: Number(b.dataset.goal) });
    if (b.dataset.leniency) set({ leniency: b.dataset.leniency });
    if (b.dataset.reminder) return reminderToggle(false);
    App.flushSave();
    App.renderHud();
    renderStats();
  });

  const REMINDER_TIMES = [];
  for (let h = 7; h <= 21; h++) for (const m of ["00", "30"]) REMINDER_TIMES.push(`${String(h).padStart(2, "0")}:${m}`);

  $("#stats-body").addEventListener("change", async (e) => {
    if (!e.target.matches("[data-reminder-time]")) return;
    const p = App.state.progress;
    const rem = Object.assign({ on: false, asked: true }, p.settings.reminder, { time: e.target.value });
    if (rem.on) {
      const r = await window.api.reminder(true, rem.time);
      if (!r.ok) return App.toast("Couldn't move the reminder: " + r.error);
    }
    App.set(Object.assign({}, p, { settings: Object.assign({}, p.settings, { reminder: rem }) }));
    App.flushSave();
    App.toast(rem.on ? `⏰ Reminder moved to ${rem.time}` : `Reminder time set to ${rem.time}`);
  });

  // Offered once, at the first launch after the update.
  function maybeAskReminder() {
    const r = App.state.progress.settings.reminder || {};
    if (r.asked || r.on) return;
    $("#reminder-when").textContent = r.time || "12:30";
    $("#reminder-dialog").hidden = false;
  }
  const remember = () => App.set(Object.assign({}, App.state.progress, { settings: Object.assign({}, App.state.progress.settings, { reminder: Object.assign({ on: false, time: "12:30" }, App.state.progress.settings.reminder, { asked: true }) }) }));
  $("#reminder-later").addEventListener("click", () => { $("#reminder-dialog").hidden = true; remember(); App.flushSave(); });
  $("#reminder-yes").addEventListener("click", async () => { $("#reminder-dialog").hidden = true; remember(); await reminderToggle(true); });

  // Turning the reminder on registers a scheduled task and a Start-menu shortcut,
  // so it asks first (unless the learner just said yes in the offer); off removes both.
  async function reminderToggle(confirmed) {
    const p = App.state.progress;
    const on = !(p.settings.reminder && p.settings.reminder.on);
    const time = (p.settings.reminder && p.settings.reminder.time) || "12:30";
    if (on && confirmed !== true && !window.confirm(`Turn on the ${time} reminder?\n\nThis adds two things to your Windows account:\n• an "HSK 汉字" Start-menu shortcut (so the notification can open the app)\n• a daily scheduled task "HSK Hanzi Reminder" at ${time}\n\nIt only notifies on days you haven't studied 10 minutes yet. Turning it off removes both.`)) return;
    const r = window.api.reminder ? await window.api.reminder(on, time) : { ok: false, error: "not available" };
    if (!r.ok) return App.toast("Couldn't change the reminder: " + r.error);
    App.set(Object.assign({}, App.state.progress, { settings: Object.assign({}, App.state.progress.settings, { reminder: { on, time, asked: true } }) }));
    App.flushSave();
    App.toast(on ? `⏰ Reminder on at ${time}` : "Reminder off");
    renderStats();
  }

  let lastMilestone = null;
  function milestone(n) {
    lastMilestone = n;
    Sfx.play("dayDone");
    Mascot.react("cheer");
    App.toast(`🎉 ${n}-day streak! 太棒了！`, 5000);
  }

  window.UIExtras = {
    onQuests, goalComplete, openQuests, finish, finishContinue, showReadyChest,
    speedAvailable, startSpeed, onSpeedKey, renderStats, milestone, reminderToggle, maybeAskReminder,
    _lastMilestone: () => lastMilestone,
    _shotStats: () => {
      let p = Outcome.introduce(App.state.progress, Array.from({ length: 48 }, (_, i) => i + 1), App.todayStr());
      for (let i = 1; i <= 30; i++) p = Activity.creditActive(p, Scheduler.addDays(App.todayStr(), -i * 2), 300 + i * 120);
      p = Object.assign({}, p, { streak: { count: 7, lastStudyDate: App.todayStr() } });
      App.set(p);
      App.refreshAchievements();
      renderStats();
      App.go("stats");
    },
    _speedFinish: (score) => { if (!speed) speed = { misses: {}, timer: null }; speedFinish(score); },
    _shotSpeed: () => { App.set(Outcome.introduce(App.state.progress, Array.from({ length: 20 }, (_, i) => i + 1), App.todayStr())); startSpeed(); },
    _shot: () => finish({ kind: "new", key: "l-1-4", xp: 17, correct: 14, total: 14, perfect: true, maxCombo: 14, newWords: 4 }),
  };
})();
