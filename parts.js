// Character parts — what each character is built from, with component meanings.
// Works in browser (window.Parts, data via Parts.load) and Node (require loads the data).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./components.json"), require("./component-meanings.json"));
  } else root.Parts = factory({}, {});
})(typeof self !== "undefined" ? self : this, function (components, meanings) {
  let data = components, names = meanings;

  function load(c, m) { data = c || {}; names = m || {}; }

  function partsOf(ch) {
    const d = data[ch];
    if (!d) return { parts: [], meanings: {} };
    const m = {};
    for (const p of d.parts) if (names[p]) m[p] = names[p];
    return { parts: d.parts.slice(), meanings: m };
  }

  function sharesPart(a, b) {
    const pa = (data[a] || { parts: [] }).parts, pb = (data[b] || { parts: [] }).parts;
    return pa.find((p) => pb.includes(p)) || null;
  }

  // "爱 = 爫 + 冖 + 友 · claw / cover / friend" for multi-part characters, else "".
  function line(ch) {
    const { parts, meanings: m } = partsOf(ch);
    if (parts.length < 2) return "";
    const gl = parts.map((p) => m[p]).filter(Boolean);
    return `${ch} = ${parts.join(" + ")}${gl.length ? " · " + parts.map((p) => m[p] || "?").join(" / ") : ""}`;
  }

  // The data map in the shape lesson.js expects for ctx.parts.
  function table() { return data; }

  return { load, partsOf, sharesPart, line, table };
});
