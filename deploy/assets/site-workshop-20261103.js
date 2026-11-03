(() => {
  const tabs = [...document.querySelectorAll(".preview-tab")];
  const descriptions = {
    files:
      "The biggest files, across your scan. No opening twenty folders to find the one you need.",
    map: "The whole picture. Larger blocks represent larger files and folders.",
    preview:
      "A closer look before you decide. Preview supported files alongside their size and full path.",
  };
  function select(tab, focus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden =
        !active;
    }
    document.getElementById("screen-description").textContent =
      descriptions[tab.dataset.view];
    document.getElementById("full-preview").href = document.getElementById(
      "screen-" + tab.dataset.view,
    ).src;
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        select(tabs[next], true);
      }
    });
  });
})();
