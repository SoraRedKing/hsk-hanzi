// Pinyin tone segmentation — pure logic. Maps each character of a word to its tone (1-4, 0 = neutral).
// Returns null when syllables can't be confidently aligned to characters (caller falls back to ink color).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Tones = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TONED = {
    "ā": 1, "á": 2, "ǎ": 3, "à": 4,
    "ē": 1, "é": 2, "ě": 3, "è": 4,
    "ī": 1, "í": 2, "ǐ": 3, "ì": 4,
    "ō": 1, "ó": 2, "ǒ": 3, "ò": 4,
    "ū": 1, "ú": 2, "ǔ": 3, "ù": 4,
    "ǖ": 1, "ǘ": 2, "ǚ": 3, "ǜ": 4,
    "ń": 2, "ň": 3, "ǹ": 4, // syllabic nasals: 嗯 ǹg
  };
  const PLAIN = new Set(["a", "e", "i", "o", "u", "ü", "v"]);
  const isVowel = (ch) => PLAIN.has(ch) || TONED[ch] !== undefined;

  function toneOfSyllable(s) {
    for (const ch of s.toLowerCase().normalize("NFC")) {
      if (TONED[ch] !== undefined) return TONED[ch];
    }
    return 0;
  }

  // Split a pinyin string into vowel groups; each group ~ one syllable's nucleus.
  function vowelGroups(pinyin) {
    const groups = [];
    let cur = null;
    for (const ch of pinyin.toLowerCase().normalize("NFC")) {
      if (isVowel(ch)) {
        if (cur === null) cur = "";
        cur += ch;
      } else {
        if (cur !== null) groups.push(cur);
        cur = null;
      }
    }
    if (cur !== null) groups.push(cur);
    return groups;
  }

  function tonesForWord(hanzi, pinyin) {
    const chars = Array.from(hanzi).filter((c) => c >= "一" && c <= "鿿");
    const first = pinyin.split("/")[0]; // dual readings like shéi/shuí: color by the first
    const tokens = first.split(/[\s'’\-·，,]+/).filter(Boolean);
    const tones = [];
    for (const tok of tokens) {
      for (const g of vowelGroups(tok)) tones.push(toneOfSyllable(g));
    }
    if (tones.length !== chars.length) {
      // erhua: 玩儿 wánr — the trailing 儿 fuses into the previous syllable's 'r'
      if (chars[chars.length - 1] === "儿" && /r$/i.test(first.trim()) && tones.length === chars.length - 1) {
        return tones.concat([0]);
      }
      return null;
    }
    return tones;
  }

  return { toneOfSyllable, tonesForWord, vowelGroups };
});
