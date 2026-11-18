/* The quick controls on a page with a site: a small tab at the edge of the window, faded until the
   mouse is on it, so it doesn't cover the manga. Opened (mouse over it, or a tap), it has Pause,
   Hide and Edit. Its tab can be dragged up and down. Its insides are in a shadow root, so the site's
   CSS doesn't change it. */
"use strict";

MT.createDock = (actions) => {
  const { h, icon } = MT;
  const path = (d) => ["path", { d }];
  /* each a function: an element can only be in one place */
  const ICON = {
    logo: () => icon(path("M4 5h16v11H9l-5 4z"), path("M8.5 13l2.5-6 2.5 6M9.4 11h3.2")),
    pause: () => icon(path("M9 5v14M15 5v14")),
    play: () => icon(path("M7 5l12 7-12 7z")),
    eye: () => icon(path("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"), ["circle", { cx: 12, cy: 12, r: 3 }]),
    eyeOff: () => icon(path("M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2")),
    edit: () => icon(path("M4 20h4L19 9l-4-4L4 16z"), path("M13.5 6.5l4 4")),
  };
  const CSS = `
:host { all: initial; }
.dock {
  position: fixed; top: var(--y, 50%); right: 0; z-index: 2147483500; transform: translateY(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px;
  background: rgba(20, 21, 26, .86); border: 1px solid rgba(255, 255, 255, .12); border-right: 0;
  border-radius: 10px 0 0 10px; box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
  color: #e6e7ea; font: 12px/1.3 system-ui, sans-serif; opacity: .3; transition: opacity .15s;
  user-select: none; -webkit-user-select: none;
}
.dock.left { right: auto; left: 0; border-right: 1px solid rgba(255, 255, 255, .12); border-left: 0; border-radius: 0 10px 10px 0; }
.dock.alert { opacity: .75; }
.dock:hover, .dock.open, .dock:focus-within { opacity: 1; }
.more { display: none; flex-direction: column; gap: 2px; padding-top: 2px; border-top: 1px solid rgba(255, 255, 255, .14); }
.dock:hover .more, .dock.open .more, .dock:focus-within .more { display: flex; }
button {
  all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px;
  color: inherit; cursor: pointer; box-sizing: border-box;
}
button:hover { background: rgba(255, 255, 255, .13); }
button:focus-visible { outline: 2px solid #e8336b; outline-offset: -2px; }
button.on { color: #ff6f98; }
button:disabled { opacity: .35; cursor: default; background: none; }
.grip { cursor: grab; touch-action: none; }
.grip.dragging { cursor: grabbing; }
svg { display: block; }
`;
  const host = document.createElement("mt-dock");
  const root = host.attachShadow({ mode: "open" });
  const dock = h("div", { class: "dock", role: "toolbar", "aria-label": "Manga Translate" },
    h("button", { class: "grip", "data-a": "grip" }),
    h("div", { class: "more" },
      h("button", { "data-a": "pause" }),
      h("button", { "data-a": "hide" }),
      h("button", { "data-a": "edit" })));
  root.append(h("style", null, CSS), dock);
  const btn = (a) => root.querySelector(`[data-a="${a}"]`);
  let state = { paused: false, shown: true, canEdit: false };
  let keys = {};
  const key = (name) => (keys[name] ? ` (${keys[name]})` : "");

  let drawn = "";
  function update(next = {}) {
    state = { ...state, ...next };
    const sig = JSON.stringify([state, keys]);
    if (sig === drawn) return;  // asked often (every half second): only redrawn when something changed
    drawn = sig;
    const { paused, shown, canEdit } = state;
    const grip = btn("grip");
    // closed, the tab shows what's unusual: paused or hidden; else the extension's sign
    grip.replaceChildren((paused ? ICON.pause : !shown ? ICON.eyeOff : ICON.logo)());
    grip.classList.toggle("on", paused || !shown);
    grip.title = `Manga Translate${paused ? ": paused" : ""}${!shown ? ": English hidden" : ""} (drag to move)`;
    dock.classList.toggle("alert", paused || !shown);
    const pause = btn("pause");
    pause.replaceChildren((paused ? ICON.play : ICON.pause)());
    pause.classList.toggle("on", paused);
    pause.title = (paused ? "Translate again on this tab" : "Pause: translate no more images on this tab") + key("toggle-pause");
    const hide = btn("hide");
    hide.replaceChildren((shown ? ICON.eye : ICON.eyeOff)());
    hide.classList.toggle("on", !shown);
    hide.title = (shown ? "Hide the English" : "Show the English") + key("toggle-overlay");
    const edit = btn("edit");
    edit.replaceChildren(ICON.edit());
    edit.disabled = !canEdit;
    edit.title = (canEdit ? "Edit the translation of the image on screen" : "No manga image on screen to edit") + key("edit-translation");
    for (const a of ["grip", "pause", "hide", "edit"]) btn(a).setAttribute("aria-label", btn(a).title);
  }

  function place(settings) {
    dock.classList.toggle("left", settings.dock === "left");
    dock.style.setProperty("--y", `${Math.min(Math.max(+settings.dockY || 50, 5), 95)}%`);
  }

  /* the tab: a click opens and closes (for fingers; a mouse opens it by pointing), a drag moves it */
  let drag = null;
  const grip = btn("grip");
  grip.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    drag = { y: e.clientY, moved: false, touch: e.pointerType !== "mouse" };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y) < 5) return;
    drag.moved = true;
    grip.classList.add("dragging");
    dock.style.setProperty("--y", `${Math.min(Math.max((e.clientY / innerHeight) * 100, 5), 95)}%`);
  });
  const up = (e) => {
    if (!drag) return;
    const { moved, touch } = drag;
    drag = null;
    grip.classList.remove("dragging");
    if (moved) actions.moved(Math.round(Math.min(Math.max((e.clientY / innerHeight) * 100, 5), 95)));
    else if (e.type === "pointerup" && touch) dock.classList.toggle("open");  // a mouse opens it by pointing
  };
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", up);
  grip.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dock.classList.toggle("open"); }
  });

  root.addEventListener("click", (e) => {
    const a = e.target.closest?.("button")?.dataset.a;
    if (a && a !== "grip" && actions[a]) actions[a]();
  });
  // the site doesn't get the clicks (a reader could take one as "next page")
  for (const t of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "contextmenu"]) {
    host.addEventListener(t, (e) => e.stopPropagation());
  }

  browser.runtime.sendMessage({ type: "shortcuts" }).then((k) => { keys = k || {}; update(); }).catch(() => {});
  update();
  document.documentElement.append(host);

  return {
    update,
    place,
    remove: () => host.remove(),
    get element() { return host; },
  };
};
