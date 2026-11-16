/* iPad/web-only additions: no Windows reminder, and a backup/restore row in Stats. */
(function () {
  const stats = document.getElementById("stats-body");
  if (window.UIExtras) window.UIExtras.maybeAskReminder = function () {};
  if (!stats) return;

  const KEY = "hsk-hanzi-progress-v1";
  const rowHTML = `<div class="set-row" id="web-backup"><span>Progress backup</span><div class="pace-pick">
    <button class="btn3d" data-web="export">Save backup</button>
    <button class="btn3d" data-web="import">Restore…</button>
    <input type="file" accept="application/json,.json" id="web-import-file" hidden></div></div>`;

  function inject() {
    const box = stats.querySelector(".settings");
    if (box && !box.querySelector("#web-backup")) box.insertAdjacentHTML("beforeend", rowHTML);
  }
  new MutationObserver(inject).observe(stats, { childList: true, subtree: true });

  stats.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-web]");
    if (!b) return;
    if (b.dataset.web === "export") {
      await App.flushSave();
      const blob = new Blob([JSON.stringify(App.state.progress, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hsk-progress-${App.todayStr()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      App.toast("Backup saved — check Files / Downloads");
    } else {
      document.getElementById("web-import-file").click();
    }
  });

  stats.addEventListener("change", async (e) => {
    if (e.target.id !== "web-import-file" || !e.target.files[0]) return;
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data || typeof data !== "object" || !data.words || !data.settings) throw new Error("not a progress file");
      const n = Object.keys(data.words).length;
      if (!window.confirm(`Replace the progress on this iPad with the backup (${n} words)?`)) return;
      localStorage.setItem(KEY, JSON.stringify(data));
      location.reload();
    } catch (err) {
      App.toast("Couldn't read that file: " + err.message);
    }
  });
})();
