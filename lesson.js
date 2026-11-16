// Lesson builder — pure logic, no DOM. Turns word ids into exercise sequences.
// Works in browser (window.Lesson) and Node (require).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Lesson = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const isCJK = (c) => c >= "一" && c <= "鿿";
  const RECOGNITION = ["pickMeaning", "listen", "tones"];

  function writable(word, strokes) {
    return Array.from(word.hanzi).some((c) => isCJK(c) && !!strokes[c]);
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Candidates come from the pool in order (known, then upcoming, then the whole
  // word list as a last resort), so a first lesson with nothing known still works.
  function pickDistractors(word, pool, n, rng) {
    const seenHanzi = new Set([word.hanzi]), seenMeaning = new Set([word.meaning]);
    const ok = (w) => w && w.id !== word.id && !seenHanzi.has(w.hanzi) && !seenMeaning.has(w.meaning);
    const sameLevel = shuffle(pool.filter((w) => ok(w) && w.level === word.level), rng);
    const other = shuffle(pool.filter((w) => ok(w) && w.level !== word.level), rng);
    const out = [];
    for (const w of sameLevel.concat(other)) {
      if (out.length >= n) break;
      if (!ok(w)) continue;
      out.push(w.id);
      seenHanzi.add(w.hanzi); seenMeaning.add(w.meaning);
    }
    return out;
  }

  /* ---- tone variants ---- */
  const MARKS = { 1: "̄", 2: "́", 3: "̌", 4: "̀", 0: "" };
  const TONE_MARK_RE = /[̄́̌̀]/g;
  const isBaseVowel = (c) => "aeiouüv".includes(c.toLowerCase());

  // Positions (in the de-toned NFD string) where each syllable carries its mark.
  function markSlots(base) {
    const slots = [];
    let i = 0;
    while (i < base.length) {
      if (!isBaseVowel(base[i])) { i++; continue; }
      let j = i;
      while (j < base.length && (isBaseVowel(base[j]) || base[j] === "̈")) j++;
      const group = base.slice(i, j).toLowerCase();
      let at = group.search(/[ae]/);
      if (at === -1) at = group.indexOf("ou");
      if (at === -1) {
        // last vowel letter; step back over a diaeresis
        at = group.length - 1;
        if (group[at] === "̈") at--;
      }
      slots.push(i + at);
      i = j;
    }
    return slots;
  }

  function render(base, slots, tones) {
    let out = "";
    for (let i = 0; i < base.length; i++) {
      out += base[i];
      if (base[i + 1] === "̈") { out += base[++i]; }
      const k = slots.indexOf(i - (base[i] === "̈" ? 1 : 0));
      if (k !== -1) out += MARKS[tones[k]];
    }
    return out.normalize("NFC");
  }

  function toneVariants(pinyin, n, rng) {
    const answer = pinyin.normalize("NFC");
    const base = answer.normalize("NFD").replace(TONE_MARK_RE, "");
    const slots = markSlots(base);
    const out = [answer];
    if (!slots.length) return out;
    const space = Math.pow(5, slots.length);
    for (let tries = 0; out.length < n && tries < 200; tries++) {
      const tones = slots.map(() => Math.floor(rng() * 5));
      const v = render(base, slots, tones);
      if (!out.includes(v)) out.push(v);
      if (out.length >= space) break;
    }
    return shuffle(out, rng);
  }

  /* ---- exercise construction ---- */
  function makeBuilder(kind, ctx) {
    let seq = 0;
    const pool = () => {
      const ids = ctx.known.concat(ctx.upcoming);
      const seen = new Set(ids);
      const words = ids.map((id) => ctx.byId.get(id));
      for (const w of ctx.byId.values()) if (!seen.has(w.id) && w.id < 9000) words.push(w);
      return words.filter(Boolean);
    };
    let cachedPool = null;
    const choicePool = () => (cachedPool = cachedPool || pool());
    return function ex(type, wordId, extra) {
      const e = Object.assign({ id: `${kind}-${type}-${wordId}-${seq++}`, type, wordId }, extra || {});
      const w = ctx.byId.get(wordId);
      if (type === "pickMeaning" || type === "pickWord" || type === "listen" || type === "fillGap") {
        e.options = shuffle([wordId].concat(pickDistractors(w, choicePool(), 3, ctx.rng)), ctx.rng);
        e.answer = wordId;
      } else if (type === "tones") {
        e.options = toneVariants(w.pinyin, 4, ctx.rng);
        e.answer = w.pinyin.normalize("NFC");
      }
      return e;
    };
  }

  // Pairs for a match: the given words first, topped up from known words with
  // distinct hanzi and meanings. Never tops up with unmet words.
  function matchPairs(ids, ctx, size) {
    const out = [], hz = new Set(), mn = new Set();
    const add = (id) => {
      const w = ctx.byId.get(id);
      if (!w || out.length >= size || hz.has(w.hanzi) || mn.has(w.meaning)) return;
      out.push(id); hz.add(w.hanzi); mn.add(w.meaning);
    };
    ids.forEach(add);
    shuffle(ctx.known, ctx.rng).forEach(add);
    return out;
  }

  // A tones exercise is only useful when the variants actually differ.
  function recognitionType(w, i, ctx) {
    const t = RECOGNITION[i % RECOGNITION.length];
    if (t === "tones" && toneVariants(w.pinyin, 3, ctx.rng).length < 3) return "pickMeaning";
    return t;
  }

  /* ---- v2 rules ---- */
  const CAST = ["云希", "晓晓", "月"];
  const stateOf = (ctx, id) => (ctx.states || {})[String(id)] || null;
  const canWrite = (ctx, id) => writable(ctx.byId.get(id), ctx.strokes);
  // Day-1 rule: from-memory writing only for words met on an earlier day.
  function allowWrite(ctx, id) {
    const st = stateOf(ctx, id);
    return !!(st && st.introducedOn && st.introducedOn < ctx.today && !st.needsTrace && canWrite(ctx, id));
  }
  // production exercise for a word in reviews and practice
  function production(ctx, id, i) {
    const st = stateOf(ctx, id);
    if (allowWrite(ctx, id)) return i % 2 === 0 ? "write" : "pickWord";
    if (st && st.needsTrace && canWrite(ctx, id)) return "traceFaded";
    return "pickWord";
  }

  function usableSentences(ctx, allowed) {
    return (ctx.sentences || []).filter((s) => s.words.every((t) => typeof t === "string" ? CAST.includes(t) : allowed.has(t)));
  }
  const tokenText = (ctx, t) => (typeof t === "string" ? t : ctx.byId.get(t).hanzi);

  // Sentence exercises: build / listen-and-tap (tiles), meaning (English options), fill the gap.
  function sentenceEx(ex, type, s, focusId, ctx) {
    const answer = s.words.map((t) => tokenText(ctx, t));
    if (type === "buildSentence" || type === "listenTap") {
      const extra = shuffle(ctx.known.filter((id) => !s.words.includes(id)).map((id) => ctx.byId.get(id).hanzi)
        .filter((h) => !answer.includes(h)), ctx.rng).slice(0, 2);
      const fallback = extra.length ? extra : pickDistractors(ctx.byId.get(focusId), [...ctx.byId.values()].filter((w) => w.id < 9000), 2, ctx.rng).map((id) => ctx.byId.get(id).hanzi);
      return ex(type, focusId, { sentenceId: s.id, answer, tiles: shuffle(answer.concat(fallback), ctx.rng) });
    }
    if (type === "sentenceMeaning") {
      const others = shuffle((ctx.sentences || []).filter((o) => o.id !== s.id && o.en !== s.en).map((o) => o.en), ctx.rng).slice(0, 2);
      return ex(type, focusId, { sentenceId: s.id, answer: s.en, options: shuffle([s.en].concat(others), ctx.rng) });
    }
    return ex("fillGap", focusId, { sentenceId: s.id, gapWordId: focusId });
  }

  function sentenceFor(ctx, id, allowed, used) {
    const pool = usableSentences(ctx, allowed).filter((s) => s.words.includes(id) && !used.has(s.id));
    if (!pool.length) return null;
    const s = pool[Math.floor(ctx.rng() * pool.length)];
    used.add(s.id);
    return s;
  }

  // New-word lesson: 2 new words (meet → recognise → trace → sentence/tones → faded
  // trace) with review words folded into one match and one recognition exercise.
  function buildNewLesson(newIds, reviewIds, ctx) {
    const ex = makeBuilder("new", ctx);
    const out = [], used = new Set();
    const allowed = new Set(ctx.known.concat(newIds));
    newIds.forEach((id, i) => {
      out.push(ex("meet", id));
      out.push(ex(i % 2 === 0 ? "pickMeaning" : "listen", id));
      out.push(ex(canWrite(ctx, id) ? "trace" : "pickWord", id));
    });
    const pairs = matchPairs(newIds.concat(reviewIds), Object.assign({}, ctx, { known: reviewIds.length ? ctx.known : [] }), 5);
    if (pairs.length >= 3) out.push(ex("match", pairs[0], { pairs }));
    if (reviewIds.length) {
      const r = reviewIds[Math.floor(ctx.rng() * reviewIds.length)];
      out.push(ex(recognitionType(ctx.byId.get(r), Math.floor(ctx.rng() * 3), ctx), r));
    }
    newIds.forEach((id, i) => {
      const s = sentenceFor(ctx, id, allowed, used);
      if (s) out.push(sentenceEx(ex, i % 2 === 0 ? "buildSentence" : "listenTap", s, id, ctx));
      else out.push(ex(recognitionType(ctx.byId.get(id), 2, ctx) === "tones" ? "tones" : "pickWord", id));
    });
    newIds.forEach((id) => out.push(ex(canWrite(ctx, id) ? "traceFaded" : "listen", id)));
    if (newIds.length === 1) { out.push(ex("pickWord", newIds[0])); out.push(ex("listen", newIds[0])); }
    return out;
  }

  // Review recipe: one recognition (or sentence) + one production per word, a match per 5.
  function reviewRecipe(kind, wordIds, ctx) {
    const ex = makeBuilder(kind, ctx);
    const rec = [], prod = [], matches = [], used = new Set();
    const allowed = new Set(ctx.known);
    wordIds.forEach((id, i) => {
      const w = ctx.byId.get(id);
      const s = i % 3 === 2 ? sentenceFor(ctx, id, allowed, used) : null;
      rec.push(s ? sentenceEx(ex, i % 2 ? "sentenceMeaning" : "fillGap", s, id, ctx) : ex(recognitionType(w, i, ctx), id));
      prod.push(ex(production(ctx, id, i), id));
    });
    for (let i = 0; i + 4 <= wordIds.length; i += 5) {
      const pairs = matchPairs(wordIds.slice(i, i + 5), ctx, 5);
      if (pairs.length >= 4) matches.push(ex("match", pairs[0], { pairs }));
    }
    return rec.concat(matches, prod);
  }

  function buildReviewLesson(wordIds, ctx) { return reviewRecipe("review", wordIds, ctx); }
  function buildMistakes(wordIds, ctx) { return reviewRecipe("mistakes", wordIds, ctx); }
  function buildPractice(wordIds, ctx) {
    const weak = ctx.weak || {};
    return reviewRecipe("practice", wordIds.slice().sort((a, b) => (weak[b] || 0) - (weak[a] || 0)), ctx);
  }

  // Recall without hints: no meet or trace; writing only where the day-1 rule allows.
  function recallRecipe(kind, wordIds, ctx) {
    const ex = makeBuilder(kind, ctx);
    const used = new Set(), allowed = new Set(ctx.known);
    return wordIds.map((id, i) => {
      if (allowWrite(ctx, id)) return ex("write", id);
      const s = i % 2 ? sentenceFor(ctx, id, allowed, used) : null;
      return s ? sentenceEx(ex, "fillGap", s, id, ctx) : ex(i % 3 === 0 ? "listen" : "pickWord", id);
    });
  }
  function buildHard(wordIds, ctx) { return recallRecipe("hard", shuffle(wordIds, ctx.rng), ctx); }
  function buildCheckpoint(wordIds, ctx) { return buildHard(wordIds, ctx); }

  // Weighted sample without replacement: weight = 1 + weak score.
  function weightedSample(ids, k, weightOf, rng) {
    const left = ids.slice(), out = [];
    while (out.length < k && left.length) {
      const total = left.reduce((s, id) => s + weightOf(id), 0);
      let r = rng() * total, i = 0;
      while (i < left.length - 1 && (r -= weightOf(left[i])) > 0) i++;
      out.push(left.splice(i, 1)[0]);
    }
    return out;
  }

  // Boss: 20 words, mostly written from memory (day-1 rule applies).
  function buildBoss(unitWordIds, ctx) {
    const weak = ctx.weak || {};
    const ex = makeBuilder("boss", ctx);
    const picked = weightedSample(unitWordIds, 20, (id) => 1 + (weak[id] || 0), ctx.rng);
    const out = picked.map((id) => ex(allowWrite(ctx, id) || (!ctx.states && canWrite(ctx, id)) ? "write" : "pickWord", id));
    shuffle(picked, ctx.rng).slice(0, 3).forEach((id) => out.push(ex("listen", id)));
    return shuffle(out, ctx.rng);
  }

  function buildLegendary(unitWordIds, ctx) {
    const weak = ctx.weak || {};
    const picked = weightedSample(unitWordIds, 24, (id) => 1 + (weak[id] || 0), ctx.rng);
    return recallRecipe("legendary", picked, ctx);
  }

  // Test-out: 20 recognition exercises sampled from a unit not yet reached.
  function buildTestOut(unitWordIds, ctx) {
    const ex = makeBuilder("testout", ctx);
    const pool = Object.assign({}, ctx, { known: unitWordIds });
    const types = ["pickMeaning", "listen", "pickWord", "pickMeaning", "tones"];
    return shuffle(unitWordIds, ctx.rng).slice(0, 20).map((id, i) => {
      const t = types[i % types.length];
      return makeBuilder("testout", pool)(t === "tones" ? recognitionType(ctx.byId.get(id), 2, ctx) : t, id);
    }).map((e, i) => Object.assign(e, { id: `testout-${e.type}-${e.wordId}-${i}` }));
  }

  // Listening practice: audio-only exercise types.
  function buildListen(wordIds, ctx) {
    const ex = makeBuilder("listen", ctx);
    const used = new Set(), allowed = new Set(ctx.known);
    return wordIds.map((id, i) => {
      const s = sentenceFor(ctx, id, allowed, used);
      if (s) return sentenceEx(ex, i % 2 ? "sentenceMeaning" : "listenTap", s, id, ctx);
      return ex("listen", id);
    });
  }

  // Component lesson: pick the met characters that contain a shared component.
  function buildComponent(unitWordIds, ctx) {
    const ex = makeBuilder("component", ctx);
    const chars = [...new Set(ctx.known.flatMap((id) => Array.from(ctx.byId.get(id).hanzi)).filter((c) => (ctx.parts || {})[c]))];
    const byPart = new Map();
    for (const c of chars) for (const part of ctx.parts[c].parts) {
      if (!byPart.has(part)) byPart.set(part, []);
      if (!byPart.get(part).includes(c)) byPart.get(part).push(c);
    }
    const comps = shuffle([...byPart.entries()].filter(([, cs]) => cs.length >= 2), ctx.rng).slice(0, 3);
    const out = [];
    for (const [component, has] of comps) {
      const answer = shuffle(has, ctx.rng).slice(0, 3);
      const others = shuffle(chars.filter((c) => !ctx.parts[c].parts.includes(component)), ctx.rng).slice(0, 6 - answer.length);
      const wordId = ctx.known.find((id) => ctx.byId.get(id).hanzi.includes(answer[0]));
      out.push(ex("component", wordId, { component, answer, options: shuffle(answer.concat(others), ctx.rng) }));
    }
    unitWordIds.filter((id) => ctx.known.includes(id)).slice(0, 3).forEach((id) => out.push(ex("pickMeaning", id, { fromParts: true })));
    return out;
  }

  /* ---- explain my answer ---- */
  const ORD = ["neutral", "1st", "2nd", "3rd", "4th"];
  const gloss = (w) => { const i = w.meaning.indexOf("; "); return i > 0 && i < 40 ? w.meaning.slice(i + 2) : w.meaning; };
  function toneOf(p) {
    const m = { "̄": 1, "́": 2, "̌": 3, "̀": 4 };
    for (const ch of p.normalize("NFD")) if (m[ch]) return m[ch];
    return 0;
  }
  function explain(ex, chosen, byId, parts) {
    if (chosen === null || chosen === undefined) return "";
    const w = ex.wordId ? byId.get(ex.wordId) : null;
    if (ex.type === "tones" && w) {
      const one = Array.from(w.hanzi).length === 1;
      return `${w.hanzi} is ${ex.answer}${one ? ` (${ORD[toneOf(ex.answer)]} tone)` : ""} — you chose ${chosen}`;
    }
    if (["pickMeaning", "pickWord", "listen", "fillGap"].includes(ex.type)) {
      const c = byId.get(Number(chosen));
      if (!c || !w) return "";
      if (parts && ex.type !== "pickMeaning") {
        for (const a of Array.from(w.hanzi)) for (const b of Array.from(c.hanzi)) {
          const pa = (parts[a] || {}).parts || [], pb = (parts[b] || {}).parts || [];
          const shared = pa.find((x) => pb.includes(x));
          if (shared) return `${w.hanzi} and ${c.hanzi} both contain ${shared}`;
        }
      }
      return `you picked ${c.hanzi} = ${gloss(c)}`;
    }
    return "";
  }

  function requeue(exercises, index) {
    const src = exercises[index];
    const base = src.id.split("~")[0];
    const n = exercises.filter((e) => e.id.split("~")[0] === base).length;
    const copy = Object.assign({}, src, { id: `${base}~${n}`, retry: true });
    return exercises.concat([copy]);
  }

  return {
    writable, pickDistractors, toneVariants, usableSentences, allowWrite, explain,
    buildNewLesson, buildReviewLesson, buildCheckpoint, buildHard, buildBoss, buildLegendary,
    buildTestOut, buildPractice, buildMistakes, buildListen, buildComponent, requeue,
  };
});
