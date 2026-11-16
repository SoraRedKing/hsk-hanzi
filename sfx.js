/* HSK 汉字 — sound effects, synthesised with WebAudio (no sound files, nothing to license). */
(function () {
  "use strict";
  let ctx = null;
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // one enveloped oscillator note
  function note(c, freq, at, dur, type, gain) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, c.currentTime + at);
    g.gain.setValueAtTime(0.0001, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(gain || 0.18, c.currentTime + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + at);
    o.stop(c.currentTime + at + dur + 0.05);
  }

  const SOUNDS = {
    right: (c) => { note(c, 784, 0, 0.12, "triangle"); note(c, 1175, 0.08, 0.22, "triangle"); },
    wrong: (c) => { note(c, 220, 0, 0.18, "sawtooth", 0.08); note(c, 165, 0.12, 0.28, "sawtooth", 0.08); },
    combo: (c) => [659, 784, 988, 1319].forEach((f, i) => note(c, f, i * 0.06, 0.18, "triangle", 0.14)),
    lessonDone: (c) => [523, 659, 784, 1047].forEach((f, i) => note(c, f, i * 0.11, 0.35, "triangle", 0.16)),
    dayDone: (c) => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => note(c, f, i * 0.09, 0.45, "triangle", 0.15)),
    chest: (c) => [1319, 1568, 2093, 2637].forEach((f, i) => note(c, f, i * 0.07, 0.3, "sine", 0.12)),
    pop: (c) => note(c, 880, 0, 0.08, "sine", 0.12),
  };

  // Returns true when a sound was played, false when muted or unavailable.
  function play(name) {
    const p = window.App && App.state.progress;
    if (!p || p.muted || !SOUNDS[name]) return false;
    const c = ac();
    if (!c) return false;
    try { SOUNDS[name](c); } catch (e) { return false; }
    return true;
  }

  window.Sfx = { play };
})();
