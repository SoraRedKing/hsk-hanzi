/* HSK 汉字 — the panda mascot: inline SVG, CSS-animated, voiced by pre-generated lines. */
(function () {
  "use strict";
  const SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><g class="panda">
    <circle cx="24" cy="24" r="13" fill="#2b2420"/><circle cx="76" cy="24" r="13" fill="#2b2420"/>
    <ellipse cx="50" cy="54" rx="38" ry="35" fill="#fffaf1" stroke="#2b2420" stroke-width="3"/>
    <ellipse cx="35" cy="50" rx="10" ry="13" fill="#2b2420" transform="rotate(-20 35 50)"/>
    <ellipse cx="65" cy="50" rx="10" ry="13" fill="#2b2420" transform="rotate(20 65 50)"/>
    <circle cx="37" cy="49" r="4" fill="#fff"/><circle cx="63" cy="49" r="4" fill="#fff"/>
    <circle cx="38" cy="50" r="2" fill="#2b2420"/><circle cx="62" cy="50" r="2" fill="#2b2420"/>
    <ellipse cx="50" cy="64" rx="6" ry="4" fill="#2b2420"/>
    <path d="M43 72 Q50 78 57 72" stroke="#2b2420" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="26" cy="66" r="5" fill="#f7b4a7" opacity="0.7"/><circle cx="74" cy="66" r="5" fill="#f7b4a7" opacity="0.7"/>
  </g></svg>`;

  function el(extraClass) {
    return `<span class="mascot ${extraClass || ""}">${SVG}</span>`;
  }

  function mount(target) {
    if (!target) return;
    target.innerHTML = SVG;
    target.classList.add("mascot");
  }

  // kind: cheer | sad | wave — animates every panda on screen for a moment
  function react(kind) {
    document.querySelectorAll(".mascot").forEach((m) => {
      m.classList.remove("cheer", "sad", "wave");
      void m.offsetWidth;
      m.classList.add(kind);
      clearTimeout(m._t);
      m._t = setTimeout(() => m.classList.remove(kind), 1400);
    });
  }

  // speaks a pre-generated voice line (silent until the line's mp3 exists)
  function say(lineId) {
    if (!window.App || !App.state.progress || App.state.progress.muted) return Promise.resolve();
    return App.playLine(lineId);
  }

  window.Mascot = { el, mount, react, say };
})();
