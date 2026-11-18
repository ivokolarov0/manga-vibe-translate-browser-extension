/* The editor: one image with its English boxes on one side, the texts on the other. Change the text,
   move and resize boxes, style them, add your own, or mark text the finder missed to have it read and
   translated. The same editor as in MangaVibe's plugin; what it saves is the image's saved result,
   with a fixed place ("rect") and a "style" per box, and "edited" so "Translate again" leaves it.

   It's drawn in a shadow root over the whole page (the site's CSS can't reach it) and takes all the
   keys while it's open (the site's own shortcuts would turn pages). content.js hands it a host:
     list()               the images of the page that can be edited, in page order
     state(it)            {data, failed, message, w, h}: the saved result (or null) and the image's size
     look()               {bg, stroke}: the box background and outline from the settings
     save(key, it, data)  saves the result for the image address `key`
     scan(key, box)       reads the Japanese in a part of the image ([x1, y1, x2, y2] in fractions)
     translate(src, around), romaji(texts), retranslate(it), model() */
"use strict";

MT.editor = (() => {
  const MIN = 0.012;  // smallest box side, as a fraction of the image
  const { h, icon } = MT;  // elements are built, never parsed from HTML strings
  const path = (d) => ["path", { d }];
  const ring = ["circle", { cx: 11, cy: 11, r: 7 }];
  /* each a function: an element can only be in one place */
  const ICON = {
    close: () => icon(path("M6 6l12 12M18 6L6 18")),
    plus: () => icon(ring, path("M21 21l-5-5M8 11h6M11 8v6")),
    minus: () => icon(ring, path("M21 21l-5-5M8 11h6")),
    left: () => icon(path("M15 6l-6 6 6 6")),
    right: () => icon(path("M9 6l6 6-6 6")),
    keys: () => icon(["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }], path("M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10")),
  };
  /* the shortcuts window: [keys, what they do], or [heading]. In keys, words are keys; + stays as it is */
  const SHORTCUTS = [
    ["The image"],
    ["+", "Zoom in"],
    ["−", "Zoom out"],
    ["0", "Fit the image to the space"],
    ["H", "Hide or show the boxes"],
    ["Shift + →", "Next image (while no box is selected)"],
    ["Shift + ←", "Previous image (while no box is selected)"],
    ["Boxes"],
    ["Shift + click", "A new text box at that place (drag for its size)"],
    ["Ctrl + drag", "Scan text: read and translate what is in the frame"],
    ["← → ↑ ↓", "Move the selected box a little"],
    ["Shift + ← → ↑ ↓", "Move the selected box more"],
    ["Delete", "Delete the selected box"],
    ["Double-click", "Edit the box's translation"],
    ["Editing"],
    ["Ctrl + Z", "Undo"],
    ["Ctrl + S", "Save"],
    ["Esc", "Leave a text field or a tool, then close the editor"],
    ["?", "This list"],
  ];
  const HINTS = {
    move: "Click a box to edit it. Drag it to move it, drag its handles to resize it. Shift + click adds a text box, Ctrl + drag scans text.",
    text: "Drag on the image to draw a text box of your own.",
    scan: "Drag around Japanese text on the image: it is read and translated.",
  };
  /* keys that work whenever nothing is being typed -> what they do (in `actions`) */
  const HOTKEYS = { "+": "zoomin", "=": "zoomin", "-": "zoomout", "_": "zoomout", "0": "fit", "h": "boxes", "?": "keys" };

  const CSS = `
:host { all: initial; }
.mte {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: #101114; color: #eceef2; color-scheme: dark; font: 14px/1.4 system-ui, sans-serif;
  --line: #2b303b; --card: #1a1c22; --accent: #e8336b; --accent-text: #fff;
}
[hidden] { display: none !important; }
* { box-sizing: border-box; }
button, select, input, textarea { font: inherit; color: inherit; }
button, select {
  min-height: 32px; padding: 4px 10px; background: var(--card); border: 1px solid var(--line);
  border-radius: 8px; cursor: pointer;
}
button:hover { border-color: #596072; }
button:disabled { opacity: .45; cursor: default; }
button.on { border-color: var(--accent); color: #ff6f98; }
button.mte-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.mte-top, .mte-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.mte-top { padding-left: 14px; }
.mte-title { font-size: 15px; }
button svg { display: block; flex: none; }
button:has(> svg) { display: inline-flex; align-items: center; gap: 6px; }
button.mte-icon { justify-content: center; width: 32px; padding: 0; }
.mte-top button { background: transparent; border-color: transparent; }
.mte-top button:hover { background: var(--card); }
.mte-pages {
  display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 10px;
  border-top: 1px solid var(--line); font-variant-numeric: tabular-nums;
}
.mte-ask > .mte-keys { width: 100%; max-width: 460px; max-height: 100%; overflow: auto; overscroll-behavior: contain; }
.mte-keys table { width: 100%; border-collapse: collapse; }
.mte-keys th { padding: 12px 0 4px; color: #979eab; font-size: 12px; font-weight: 600; text-align: left; }
.mte-keys td { padding: 4px 0; vertical-align: top; }
.mte-keys td:first-child { padding-right: 14px; white-space: nowrap; }
.mte-keys kbd {
  display: inline-block; min-width: 22px; padding: 1px 6px; border: 1px solid #3a4050; border-bottom-width: 2px;
  border-radius: 6px; background: #0d0e11; font: 12px/18px system-ui, sans-serif; text-align: center;
}
.mte-space { flex: 1; }
.mte-main { flex: 1; display: flex; min-height: 0; }
.mte-work { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.mte-hint { padding: 5px 12px; color: #979eab; font-size: 12px; }
.mte-stage { flex: 1; display: flex; overflow: auto; overscroll-behavior: contain; padding: 14px; background: #000; }
.mte-page { position: relative; flex: none; margin: auto; }
.mte-page > img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
.mte-layer { position: absolute; inset: 0; }
.mte-layer.mte-draw { cursor: crosshair; touch-action: none; }
.mte-layer.mte-off .mte-box { visibility: hidden; }
.mte-box {
  position: absolute; display: flex; align-items: center; justify-content: center; background: #fff; color: #111;
  border-radius: .5em; font-family: "Comic Neue", "Comic Sans MS", "Segoe Print", system-ui, sans-serif;
  font-weight: 600; line-height: 1.12; text-align: center; overflow-wrap: normal;
  cursor: move; touch-action: none; user-select: none;
}
.mte-box > span {
  display: block; max-width: 100%; white-space: pre-line;
  padding: calc(var(--mt-stroke, 0px) / 2) calc(.15em + var(--mt-stroke, 0px) / 2);
  -webkit-text-stroke: var(--mt-stroke, 0px) var(--mt-stroke-color, #fff); paint-order: stroke fill;
}
.mte-layer.mte-draw .mte-box { pointer-events: none; }
.mte-box.sel { z-index: 2; outline: 2px solid var(--accent); outline-offset: 2px; }
.mte-box.mte-empty { box-shadow: none; outline: 1px dashed var(--accent); }
.mte-box.mte-hidden { opacity: .4; }
.mte-n {
  position: absolute; top: -9px; left: -9px; min-width: 18px; padding: 0 5px; border-radius: 9px; background: #14151a;
  color: #fff; font: normal 600 11px/18px system-ui, sans-serif; text-align: center; text-transform: none;
  -webkit-text-stroke: 0; pointer-events: none;
}
.mte-box.sel .mte-n { background: var(--accent); color: var(--accent-text); }
.mte-h {
  position: absolute; width: 12px; height: 12px; background: #fff; border: 2px solid var(--accent); border-radius: 3px;
  transform: translate(-50%, -50%); touch-action: none;
}
.mte-h[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.mte-h[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; }
.mte-h[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.mte-h[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
.mte-h[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.mte-h[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
.mte-h[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.mte-h[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; }
@media (pointer: coarse) {
  .mte-h { width: 22px; height: 22px; border-radius: 50%; }
  .mte-h[data-h="n"], .mte-h[data-h="e"], .mte-h[data-h="s"], .mte-h[data-h="w"] { display: none; }
  .mte-h[data-h="nw"] { transform: translate(-95%, -95%); }
  .mte-h[data-h="ne"] { transform: translate(-5%, -95%); }
  .mte-h[data-h="se"] { transform: translate(-5%, -5%); }
  .mte-h[data-h="sw"] { transform: translate(-95%, -5%); }
}
.mte-rubber, .mte-pending {
  position: absolute; border: 2px dashed var(--accent); background: rgba(232, 51, 107, .15); pointer-events: none;
}
.mte-pending { animation: mte-pulse .7s ease-in-out infinite alternate; }
@keyframes mte-pulse { to { background: rgba(232, 51, 107, .4); } }
.mte-side { display: flex; flex-direction: column; width: 370px; min-height: 0; border-left: 1px solid var(--line); }
.mte-notice { margin: 10px 10px 0; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.mte-notice button { margin-top: 8px; }
.mte-list { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 10px; }
.mte-none { color: #979eab; }
.mte-card { margin-bottom: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.mte-card.sel { border-color: var(--accent); }
.mte-card.hid .mte-n { text-decoration: line-through; }
.mte-card .mte-n { position: static; display: inline-block; background: #343946; }
.mte-card.sel .mte-n { background: var(--accent); color: var(--accent-text); }
.mte-head, .mte-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mte-head { margin-bottom: 6px; }
.mte-head input { flex: 1; min-width: 60px; }
.mte-row { margin-top: 6px; }
.mte-card label { display: block; margin-top: 6px; color: #979eab; font-size: 12px; }
textarea, input[type="text"] {
  display: block; width: 100%; padding: 6px 8px; background: #0d0e11; border: 1px solid var(--line); border-radius: 8px;
  color: #eceef2; font-size: 14px;
}
textarea { resize: vertical; }
.mte-romaji { margin-top: 4px; padding: 0 2px; color: #c9cfda; font-size: 13px; font-style: italic; user-select: text; }
.mte-romaji.mte-none { font-style: normal; font-size: 12px; }
.mte-style { margin-top: 10px; padding-top: 4px; border-top: 1px solid var(--line); }
.mte-lab { width: 44px; color: #979eab; font-size: 12px; }
.mte-style input[type="range"] { flex: 1; min-width: 80px; accent-color: var(--accent); }
.mte-style output { width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
button.mte-sw { width: 26px; min-height: 26px; padding: 0; border-radius: 50%; }
button.mte-sw.on { box-shadow: 0 0 0 2px var(--accent); }
button.mte-sw[data-v="none"] { background: repeating-linear-gradient(45deg, #777 0 4px, #222 4px 8px) !important; }
.mte-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px; border-top: 1px solid var(--line); }
.mte-ask { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .6); }
.mte-ask > div { max-width: 360px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.mte-ask p { margin: 0 0 12px; }
.mte-toast {
  position: absolute; left: 50%; bottom: 64px; z-index: 6; max-width: min(520px, calc(100% - 32px)); transform: translateX(-50%);
  padding: 8px 14px; border: 1px solid var(--line); border-radius: 10px; background: #23262e; box-shadow: 0 4px 18px rgba(0, 0, 0, .5);
  pointer-events: none;
}
.mte-toast.bad { border-color: #b3261e; color: #ffb4ab; }
@media (max-width: 820px) {
  .mte-main { flex-direction: column; }
  .mte-side { width: auto; height: 46%; border-left: 0; border-top: 1px solid var(--line); }
  .mte-hint { display: none; }
  .mte-pages { padding: 4px 8px; }
  .mte-stage { padding: 8px; }
  .mte-top, .mte-tools { padding: 6px 8px; }
}
`;

  const E = { host: null, sr: null, root: null, H: null, it: null, info: null, blocks: [], sel: -1, tool: "move",
    dirty: false, undo: [], zoom: 1, drag: null, poll: 0, pending: [], focusSnap: null, asked: "",
    romaji: new Map(), romajiNote: "", romajiBusy: false, romajiTimer: 0, toastTimer: 0 };
  const busy = new WeakSet();  // blocks waiting for the PC ("Read again", "Translate")

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const q = (sel) => E.sr.querySelector(sel);
  const errorText = (e) => String(e?.message || e || "Something went wrong");

  function toast(text, kind = "") {
    const el = q('[data-r="toast"]');
    el.textContent = text;
    el.className = "mte-toast" + (kind ? " bad" : "");
    el.hidden = false;
    clearTimeout(E.toastTimer);
    E.toastTimer = setTimeout(() => { el.hidden = true; }, kind ? 6000 : 2500);
  }

  /* ---------------- opening and closing ---------------- */

  function open(host, it) {
    E.H = host;
    build();
    Object.assign(E, { info: null, blocks: [], sel: -1, dirty: false, undo: [], zoom: 1, pending: [],
      romajiNote: "", tool: "move", asked: "" });
    q('[data-r="ask"]').hidden = q('[data-r="keys"]').hidden = true;
    E.layer.classList.remove("mte-off");
    q('[data-a="boxes"]').textContent = "Hide boxes";
    E.host.hidden = false;
    load(it);
    q('[data-a="close"]').focus();  // the keys go to the editor, not to something on the page
  }

  const isOpen = () => !!E.host && !E.host.hidden;

  /* the host's news about an image (its translation arrived): a waiting editor shows it */
  function changed(it) {
    if (isOpen() && it === E.it) wait();
  }

  function build() {
    if (E.host) return;
    const host = E.host = document.createElement("mt-editor");
    host.hidden = true;
    E.sr = host.attachShadow({ mode: "open" });
    const space = () => h("span", { class: "mte-space" });
    // a button with an icon only: its title is also what a screen reader says
    const iconButton = (a, title, label, ic) => h("button", { "data-a": a, class: "mte-icon", title, "aria-label": label }, ic());
    // a shortcut's keys: words are keys; a "+" between them stays as it is
    const keysOf = (keys) => keys.split(" ").flatMap((k, n, all) =>
      [n ? " " : null, k === "+" && all.length > 1 ? k : h("kbd", null, k)]);
    E.sr.append(h("style", null, CSS), h("div", { class: "mte", role: "dialog", "aria-label": "Edit the translation" },
      h("div", { class: "mte-top" },
        h("b", { class: "mte-title" }, "Edit translation"),
        space(),
        h("button", { "data-a": "keys", title: "Keyboard and mouse shortcuts (?)" }, ICON.keys(), h("span", null, "Shortcuts")),
        iconButton("close", "Close the editor (Esc)", "Close the editor", ICON.close)),
      h("div", { class: "mte-main" },
        h("section", { class: "mte-work" },
          h("div", { class: "mte-tools" },
            h("button", { "data-tool": "move" }, "Move"),
            h("button", { "data-tool": "text", title: "Draw a text box of your own (or Shift + click on the image)" }, "+ Text box"),
            h("button", { "data-tool": "scan", title: "Mark text that wasn't found: it is read and translated (or Ctrl + drag on the image)" }, "Scan text"),
            space(),
            h("button", { "data-a": "boxes", title: "See the image without the boxes (H)" }, "Hide boxes"),
            iconButton("zoomout", "Zoom out (−)", "Zoom out", ICON.minus),
            h("button", { "data-a": "fit", title: "Fit the image to the space (0)" }, "Fit"),
            iconButton("zoomin", "Zoom in (+)", "Zoom in", ICON.plus)),
          h("div", { class: "mte-hint", "data-r": "hint" }),
          h("div", { class: "mte-stage" },
            h("div", { class: "mte-page" }, h("img", { alt: "The manga image" }), h("div", { class: "mte-layer" }))),
          h("div", { class: "mte-pages" },
            iconButton("prev", "Previous image (Shift + ←)", "Previous image", ICON.left),
            h("span", { "data-r": "pageno" }),
            iconButton("next", "Next image (Shift + →)", "Next image", ICON.right))),
        h("aside", { class: "mte-side", "aria-label": "The texts of this image" },
          h("div", { class: "mte-notice", "data-r": "notice", hidden: true }),
          h("div", { class: "mte-list", "data-r": "list" }),
          h("div", { class: "mte-foot" },
            h("button", { "data-a": "reset", title: "Throw away this image's translation and your changes to it, and translate it again" },
              "Translate this image again"),
            space(),
            h("button", { "data-a": "undo", title: "Undo (Ctrl+Z)" }, "Undo"),
            h("button", { "data-a": "save", class: "mte-primary", title: "Save (Ctrl+S)" }, "Save")))),
      h("div", { class: "mte-ask", "data-r": "ask", hidden: true },
        h("div", { role: "alertdialog", "aria-label": "Unsaved changes" },
          h("p", null, "This image has changes that aren't saved."),
          h("div", { class: "mte-row" },
            h("button", { "data-a": "saveclose", class: "mte-primary" }, "Save and close"),
            h("button", { "data-a": "discard" }, "Discard"),
            h("button", { "data-a": "stay" }, "Keep editing")))),
      h("div", { class: "mte-ask", "data-r": "keys", hidden: true },
        h("div", { class: "mte-keys", role: "dialog", "aria-label": "Shortcuts" },
          h("div", { class: "mte-head" }, h("b", null, "Shortcuts"), space(),
            iconButton("keys", "Close (Esc)", "Close", ICON.close)),
          h("table", null, SHORTCUTS.map(([keys, what]) => (!what
            ? h("tr", null, h("th", { colspan: 2 }, keys))
            : h("tr", null, h("td", null, keysOf(keys)), h("td", null, what))))))),
      h("div", { class: "mte-toast", "data-r": "toast", hidden: true })));
    document.documentElement.append(host);
    E.root = q(".mte");
    E.layer = q(".mte-layer");
    E.img = q(".mte-page > img");
    E.list = q('[data-r="list"]');
    E.img.addEventListener("load", layout);
    E.img.addEventListener("error", () => toast("Couldn't show the image", "error"));
    new ResizeObserver(() => { layout(); fitAll(); }).observe(q(".mte-stage"));
    E.root.addEventListener("click", onClick);
    E.layer.addEventListener("pointerdown", onDown);
    E.layer.addEventListener("pointermove", onMove);
    E.layer.addEventListener("pointerup", onUp);
    E.layer.addEventListener("pointercancel", onUp);
    E.layer.addEventListener("dblclick", () => focusText(E.sel));
    E.list.addEventListener("focusin", onFocus);
    E.list.addEventListener("input", onInput);
    E.list.addEventListener("change", onChange);
    // the wheel scrolls the image and the list, never the page underneath
    E.root.addEventListener("wheel", (e) => {
      if (!e.target.closest?.(".mte-stage, .mte-list, .mte-keys")) e.preventDefault();
    }, { passive: false });
    // the site doesn't get the clicks (a reader could take one as "next page")
    for (const t of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "contextmenu", "wheel"]) {
      host.addEventListener(t, (e) => e.stopPropagation());
    }
  }

  /* ---------------- loading and saving ---------------- */

  /* what the editor shows for an image. state: ready, none (not translated yet) or failed */
  function pageInfo(it) {
    const list = E.H.list(), st = E.H.state(it);
    const out = { it, key: it.key, index: list.indexOf(it), pages: list.length, image: it.key,
      data: st.data, size: { w: st.w, h: st.h }, state: "ready", message: "", edited: false, blocks: [] };
    const data = st.data;
    if (!data) {
      out.state = st.failed ? "failed" : "none";
      out.message = st.message || "";
      return out;
    }
    const { w, h } = data;
    const rects = MT.displayRects(data);
    (data.blocks || []).forEach((b, i) => {
      const [x1, y1, x2, y2] = rects[i], [bx1, by1, bx2, by2] = b.box || rects[i];
      out.blocks.push({
        x: r5(x1 / w), y: r5(y1 / h), w: r5((x2 - x1) / w), h: r5((y2 - y1) / h),
        src: b.src || "", text: b.text || "", who: b.who || "", style: MT.cleanStyle(b.style),
        // where the Japanese was read (for "Read again"); the same as the box for one drawn by hand
        box: [r5(bx1 / w), r5(by1 / h), r5(bx2 / w), r5(by2 / h)], hidden: !!b.hidden,
      });
    });
    out.edited = !!data.edited;
    return out;
  }

  function load(it) {
    clearTimeout(E.poll);
    E.it = it;
    show(pageInfo(it));
  }

  /* put an image as it is saved on the screen */
  function show(info) {
    clearTimeout(E.poll);
    const same = E.info && E.info.it === info.it && E.info.key === info.key;
    Object.assign(E, { info, blocks: info.blocks, dirty: false, pending: [], drag: null });
    if (!same) Object.assign(E, { sel: -1, undo: [], tool: "move" });
    if (E.sel >= E.blocks.length) E.sel = -1;
    if (E.img.getAttribute("src") !== info.image) E.img.src = info.image;
    renderAll();
    if (info.state === "none") E.poll = setTimeout(wait, 2000);
  }

  /* an image that isn't translated yet: look again until it is (not once the owner started on it) */
  function wait() {
    clearTimeout(E.poll);
    if (!isOpen() || !E.info) return;
    if (E.dirty || E.blocks.length || E.pending.length || E.drag) return;
    const info = pageInfo(E.it);
    if (info.state !== E.info.state || info.message !== E.info.message || info.key !== E.info.key) show(info);
    else if (info.state === "none") E.poll = setTimeout(wait, 2000);
  }

  /* the editor's boxes as a saved result: in the image's pixels, every box at its place */
  function toData(blocks) {
    const old = E.info.data;
    const w = old?.w || E.info.size.w, h = old?.h || E.info.size.h;
    if (!w || !h) throw new Error("The image isn't loaded yet");
    const data = old ? { ...old } : { v: 1, w, h, model: E.H.model() };
    const px = (v, n) => Math.round(clamp(v, 0, 1) * n * 10) / 10;
    data.blocks = [];
    for (const b of blocks.slice(0, 300)) {
      const src = String(b.src || "").trim().slice(0, 2000), text = String(b.text || "").trim().slice(0, 2000);
      if (!src && !text) continue;  // nothing in it: left out
      const rect = [px(b.x, w), px(b.y, h), px(b.x + b.w, w), px(b.y + b.h, h)];
      const box = b.box ? [px(b.box[0], w), px(b.box[1], h), px(b.box[2], w), px(b.box[3], h)] : rect;
      const block = { box, rect, src, text };
      const who = String(b.who || "").trim().slice(0, 80);
      if (who) block.who = who;
      const style = MT.cleanStyle(b.style);
      if (Object.keys(style).length) block.style = style;
      if (b.hidden) block.hidden = true;
      data.blocks.push(block);
    }
    data.edited = true;  // "Translate again" leaves the image alone
    data.at = Date.now();
    return data;
  }

  async function save() {
    if (!E.dirty) return true;
    try { await E.H.save(E.info.key, E.it, toData(E.blocks)); }
    catch (e) { toast(errorText(e), "error"); return false; }
    show(pageInfo(E.it));
    toast("Saved");
    return true;
  }

  async function go(step) {
    const list = E.H.list(), i = list.indexOf(E.it), next = list[i + step];
    if (i < 0 || !next) return;
    if (E.dirty && !(await save())) return;
    E.info = null;  // another image: selection and undo start over
    load(next);
  }

  function close() {
    if (E.dirty) q('[data-r="ask"]').hidden = false; else finish();
  }

  function finish() {
    clearTimeout(E.poll);
    E.host.hidden = true;
    E.dirty = false;
    E.drag = null;
    E.H.closed?.();
  }

  function reset() {
    if (E.info.state === "ready" && !confirm("Translate this image again? Its boxes and your changes to them are replaced.")) return;
    E.H.retranslate(E.it);
    E.asked = E.info.key;
    E.info = { ...E.info, it: null };  // starts over: selection and undo too
    show(pageInfo(E.it));
  }

  /* ---------------- undo ---------------- */

  const snap = () => JSON.stringify(E.blocks);

  function pushUndo(before) {
    if (before === null || before === snap()) return;
    E.undo.push(before);
    if (E.undo.length > 60) E.undo.shift();
    E.dirty = true;
    top();
  }

  function change(fn) {
    const before = snap();
    fn();
    pushUndo(before);
  }

  function undo() {
    const before = E.undo.pop();
    if (before === undefined) return;
    E.blocks = JSON.parse(before);
    if (E.sel >= E.blocks.length) E.sel = -1;
    E.dirty = true;
    renderAll();
  }

  /* ---------------- drawing the image ---------------- */

  function renderAll() {
    top();
    notice();
    renderBoxes();
    renderList();
  }

  function top() {
    const { index, pages } = E.info;
    q('[data-r="pageno"]').textContent = index >= 0 ? `Image ${index + 1} / ${pages}` : "Image";
    q('[data-a="prev"]').disabled = index <= 0;
    q('[data-a="next"]').disabled = index < 0 || index >= pages - 1;
    q('[data-a="undo"]').disabled = !E.undo.length;
    q('[data-a="save"]').disabled = !E.dirty;  // lit up: there is something to save
    q('[data-r="hint"]').textContent = HINTS[E.tool];
    for (const b of E.sr.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === E.tool);
    E.layer.classList.toggle("mte-draw", E.tool !== "move");
    q('.mte-foot [data-a="reset"]').hidden = E.info.state !== "ready";  // (the notice has one of its own)
  }

  function notice() {
    const el = q('[data-r="notice"]'), info = E.info;
    el.hidden = info.state === "ready";
    if (el.hidden) return el.replaceChildren();
    const asked = E.asked === info.key;
    el.replaceChildren(...(info.state === "failed"
      ? [h("div", null, `This image couldn't be translated: ${info.message}`), h("button", { "data-a": "reset" }, "Try again")]
      : [h("div", null, info.message || "This image isn't translated yet."),
        h("div", { class: "mte-none" }, "You can also add boxes yourself with “Scan text” and “+ Text box”."),
        !asked && h("button", { "data-a": "reset" }, "Translate it now")].filter(Boolean)));
  }

  /* the image's size on the screen: fitted into the space (a long strip: to the width), times the zoom */
  function layout() {
    const stage = q(".mte-stage"), w = E.img.naturalWidth, h = E.img.naturalHeight;
    if (!w || !h || !stage.clientWidth) return;
    const pad = 2 * parseFloat(getComputedStyle(stage).paddingLeft);
    const room = stage.clientWidth - pad;
    const fit = h / w > 2.5 ? Math.min(room, 900) : Math.min(room, (stage.clientHeight - pad) * w / h);
    q(".mte-page").style.width = `${Math.max(120, Math.round(fit * E.zoom))}px`;
    fitAll();
  }

  const handles = () => ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => h("i", { class: "mte-h", "data-h": d }));

  function paint(el, b, i) {
    el.className = `mte-box${i === E.sel ? " sel" : ""}${b.hidden ? " mte-hidden" : ""}${b.text ? "" : " mte-empty"}`;
    MT.paintBox(el, el.firstChild, b.style, E.H.look());
    if (!b.text) el.style.setProperty("background", "rgba(232, 51, 107, .14)", "important");
    el.firstChild.textContent = b.text;
  }

  function place(el, r) {
    Object.assign(el.style, { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });
  }

  function renderBoxes() {
    const layer = E.layer;
    layer.replaceChildren();
    layer.style.setProperty("--mt-stroke", E.H.look().stroke);
    E.blocks.forEach((b, i) => {
      const el = h("div", { "data-i": i }, h("span"), h("em", { class: "mte-n" }, i + 1), i === E.sel && handles());
      paint(el, b, i);
      place(el, b);
      layer.append(el);
    });
    for (const r of E.pending) {
      const el = document.createElement("div");
      el.className = "mte-pending";
      place(el, r);
      layer.append(el);
    }
    fitAll();
  }

  const boxEl = (i) => E.layer.querySelector(`.mte-box[data-i="${i}"]`);
  const fit = (el) => MT.fitBox(el, E.layer.clientWidth);

  function fitAll() {
    if (E.layer) E.layer.querySelectorAll(".mte-box").forEach(fit);
  }

  /* one box again after its text, style or state changed */
  function redraw(i) {
    const el = boxEl(i), b = E.blocks[i];
    if (!el || !b) return;
    paint(el, b, i);
    fit(el);
  }

  /* ---------------- the list of texts ---------------- */

  function renderList() {
    const scrolled = E.list.scrollTop;  // kept: the list is shorter for a moment while it's rebuilt
    E.list.replaceChildren(...(E.blocks.length ? E.blocks.map(card) : E.info.state === "ready"
      ? [h("p", { class: "mte-none" }, "No text boxes on this image. “Scan text” reads a bubble you mark; “+ Text box” adds one you write yourself.")]
      : []));
    styleRow();
    E.list.scrollTop = scrolled;
    romanize();
  }

  /* ---------------- romaji: how the Japanese is said, under each Japanese text ----------------
     The vision server works it out; what it said is remembered per text, so a text is only asked once. */

  function romajiLines() {
    for (const el of E.list.querySelectorAll('[data-r="romaji"]')) {
      const src = (E.blocks[cardIndex(el)]?.src || "").trim();
      const text = !src ? "" : E.romaji.get(src) ?? (E.romajiNote || "…");
      el.textContent = text;
      el.hidden = !text;
      el.classList.toggle("mte-none", !E.romaji.has(src));
    }
  }

  async function romanize() {
    romajiLines();
    const texts = [...new Set(E.blocks.map((b) => (b.src || "").trim()).filter((s) => s && !E.romaji.has(s)))];
    if (!texts.length || E.romajiBusy || E.romajiNote) return;
    E.romajiBusy = true;
    try {
      const answer = await E.H.romaji(texts);
      texts.forEach((s, n) => E.romaji.set(s, answer[n] || ""));
    } catch (e) {
      E.romajiNote = errorText(e);  // e.g. an older vision server: said once in each line, not asked again
    }
    E.romajiBusy = false;
    if (isOpen()) romanize();  // the lines, and texts typed or read meanwhile
  }

  function card(b, i) {
    const wait = busy.has(b);
    return h("div", { class: `mte-card${i === E.sel ? " sel" : ""}${b.hidden ? " hid" : ""}`, "data-i": i },
      h("div", { class: "mte-head" },
        h("em", { class: "mte-n" }, i + 1),
        h("input", { type: "text", "data-f": "who", value: b.who || "", placeholder: "Who says it", "aria-label": "Who says it" }),
        h("button", { "data-c": "hide", title: b.hidden ? "Show this box on the page again" : "Keep the box but don't show it on the page" },
          b.hidden ? "Show" : "Hide"),
        h("button", { "data-c": "del", title: "Delete this box" }, "Delete")),
      h("label", null, "Japanese (as read)",
        h("textarea", { "data-f": "src", rows: 2, lang: "ja", spellcheck: "false", value: b.src || "" })),
      h("div", { class: "mte-romaji", "data-r": "romaji", title: "How the Japanese is said (romaji)", hidden: true }),
      h("div", { class: "mte-row" },
        h("button", { "data-c": "ocr", disabled: wait, title: "Read the Japanese in this box's place again" }, "Read again"),
        h("button", { "data-c": "tr", disabled: wait || !b.src.trim(), title: "Translate the Japanese above again" },
          wait ? "Working…" : "Translate")),
      h("label", null, "Translation",
        h("textarea", { "data-f": "text", rows: 3, value: b.text || "" })));
  }

  /* the look of the selected box: a row of controls at the end of its card */
  function styleRow() {
    E.list.querySelector(".mte-style")?.remove();
    const b = E.blocks[E.sel], el = E.list.querySelector(`.mte-card[data-i="${E.sel}"]`);
    if (!b || !el) return;
    const s = b.style || {}, o = MT.STYLE;
    const on = (yes) => (yes ? "on" : null);
    const swatch = (key, [v, label, css]) => h("button", { class: `mte-sw${(s[key] || "") === v ? " on" : ""}`,
      "data-o": key, "data-v": v, style: { background: css }, title: label, "aria-label": label });
    const flag = (key, label, title) => h("button", { "data-t": key, class: on(s[key]), title }, label);
    const row = (label, ...items) => h("div", { class: "mte-row" }, label && h("span", { class: "mte-lab" }, label), items);
    el.append(h("div", { class: "mte-style" },
      row("Size",
        h("button", { "data-c": "auto", class: on(!s.size), title: "As large as fits the box" }, "Auto"),
        h("input", { type: "range", "data-f": "size", min: o.size[0], max: o.size[1], step: 1,
          value: String(s.size || fitted(E.sel)), "aria-label": "Font size" }),
        h("output", null, s.size || "Auto")),
      row("Style",
        flag("bold", h("b", null, "B"), "Bold"), flag("italic", h("i", null, "I"), "Italic"), flag("upper", "AA", "Capital letters"),
        h("select", { "data-f": "font", "aria-label": "Font" },
          o.font.map(([v, label]) => h("option", { value: v, selected: (s.font || "") === v }, label)))),
      row("Align", o.align.map(([v, label]) => h("button", { "data-o": "align", "data-v": v, class: on((s.align || "") === v) }, label))),
      row("Text", o.color.map((c) => swatch("color", c))),
      row("Box", o.bg.map((c) => swatch("bg", c))),
      row(null, h("button", { "data-c": "all", title: "Give every box on this image this size and style" }, "Use this look for all boxes"))));
  }

  /* the size a box's fitted text has now, in the size steps (tenths of a percent of the image's width) */
  function fitted(i) {
    const el = boxEl(i), o = MT.STYLE.size;
    const px = el ? parseFloat(getComputedStyle(el.firstChild).fontSize) : 0;
    return clamp(Math.round((px / (E.layer.clientWidth || 1)) * 1000) || 20, o[0], o[1]);
  }

  function select(i, { scroll = false, list = true } = {}) {
    if (i === E.sel) return;
    E.sel = i;
    renderBoxes();
    if (!list) return;
    for (const el of E.list.querySelectorAll(".mte-card")) el.classList.toggle("sel", +el.dataset.i === i);
    styleRow();
    if (scroll) E.list.querySelector(".mte-card.sel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function focusText(i) {
    const ta = E.list.querySelector(`.mte-card[data-i="${i}"] [data-f="text"]`);
    if (!ta) return;
    ta.focus();
    ta.select();
  }

  /* ---------------- typing in the list ---------------- */

  const cardIndex = (el) => +(el.closest(".mte-card")?.dataset.i ?? -1);

  function onFocus(e) {
    if (!e.target.dataset.f) return;
    E.focusSnap = snap();
    select(cardIndex(e.target));
  }

  function onInput(e) {
    const f = e.target.dataset.f, i = cardIndex(e.target), b = E.blocks[i];
    if (!f || !b) return;
    if (f === "size") {
      b.style = { ...b.style, size: +e.target.value };
      e.target.nextElementSibling.textContent = e.target.value;
      e.target.previousElementSibling.classList.remove("on");
    } else if (f === "font") {
      b.style = { ...b.style, font: e.target.value };
    } else {
      b[f] = e.target.value;
      if (f === "src") {
        const tr = e.target.closest(".mte-card").querySelector('[data-c="tr"]');
        if (!busy.has(b)) tr.disabled = !b.src.trim();
        romajiLines();
        clearTimeout(E.romajiTimer);
        E.romajiTimer = setTimeout(romanize, 500);  // once the typing pauses
      }
    }
    E.dirty = true;
    top();
    redraw(i);
  }

  /* a field was left (or a slider let go): what changed since it was entered is one step to undo */
  function onChange(e) {
    if (!e.target.dataset.f) return;
    pushUndo(E.focusSnap);
    E.focusSnap = snap();
  }

  /* ---------------- buttons ---------------- */

  function onClick(e) {
    const b = e.target.closest("button");
    if (!b || b.disabled) {
      const el = e.target.closest(".mte-card");
      if (el && !e.target.closest("input, textarea, select")) select(+el.dataset.i);
      return;
    }
    const d = b.dataset, i = cardIndex(b);
    if (d.tool) { E.tool = d.tool; return top(); }
    if (d.a) return actions[d.a]?.();
    if (d.c) {
      if (d.c !== "del") select(i);  // the box the button is about
      return cardActions[d.c]?.(i, E.blocks[i]);
    }
    const block = E.blocks[i];
    if (!block) return;
    if (d.t) change(() => { block.style = { ...block.style, [d.t]: !(block.style || {})[d.t] }; });
    else if (d.o) change(() => { block.style = { ...block.style, [d.o]: d.v }; });
    else return;
    redraw(i);
    styleRow();
  }

  const actions = {
    close, save, undo, reset,
    prev: () => go(-1),
    next: () => go(1),
    saveclose: async () => { q('[data-r="ask"]').hidden = true; if (await save()) finish(); },
    discard: () => { q('[data-r="ask"]').hidden = true; E.dirty = false; finish(); },
    stay: () => { q('[data-r="ask"]').hidden = true; },
    boxes() {
      const off = E.layer.classList.toggle("mte-off");
      q('[data-a="boxes"]').textContent = off ? "Show boxes" : "Hide boxes";
    },
    keys() {
      const el = q('[data-r="keys"]');
      el.hidden = !el.hidden;
      if (!el.hidden) el.querySelector("button").focus();
    },
    zoomin: () => { E.zoom = Math.min(4, E.zoom * 1.25); layout(); },
    zoomout: () => { E.zoom = Math.max(0.5, E.zoom / 1.25); layout(); },
    fit: () => { E.zoom = 1; layout(); },
  };

  const cardActions = {
    del(i) {
      change(() => { E.blocks.splice(i, 1); E.sel = -1; });
      renderAll();
    },
    hide(i, b) {
      change(() => { b.hidden = !b.hidden; });
      renderAll();
    },
    auto(i, b) {
      const size = (b.style || {}).size ? 0 : fitted(i);
      change(() => { b.style = { ...b.style, size }; });
      redraw(i);
      styleRow();
    },
    all(i, b) {
      change(() => { for (const other of E.blocks) other.style = { ...b.style }; });
      renderBoxes();
      toast("Every box on this image has this look now");
    },
    /* read the Japanese again, where it was read before (or where the box is) */
    ocr: (i, b) => ask(b, () => E.H.scan(E.info.key, b.box || [b.x, b.y, b.x + b.w, b.y + b.h]),
      (src) => { if (src) b.src = src; else toast("No text was read there", "error"); }),
    tr: (i, b) => ask(b, () => E.H.translate(b.src, around(b)), (text) => { b.text = text; }),
  };

  /* the image's other Japanese texts: they tell the model what the talk is about */
  const around = (b) => E.blocks.filter((x) => x !== b && x.src).map((x) => x.src).slice(0, 12);

  /* ask the PC something about block b, and put the answer in with `fill` (one step to undo) */
  async function ask(b, fn, fill) {
    if (busy.has(b)) return;
    const it = E.it, key = E.info.key;
    busy.add(b);
    renderList();
    let answer, ok = false;
    try { answer = await fn(); ok = true; } catch (e) { toast(errorText(e), "error"); }
    busy.delete(b);
    if (E.it !== it || E.info?.key !== key || !E.blocks.includes(b)) return;  // another image, or undone meanwhile
    if (ok) change(() => fill(answer));
    renderAll();
  }

  /* ---------------- the mouse or finger on the image ---------------- */

  function point(e) {
    const r = E.layer.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }

  /* the smallest box height, as a fraction of the image's height: as many pixels as MIN of its width
     (a long strip is many times taller than wide) */
  const minY = () => MIN * (E.layer.clientWidth / (E.layer.clientHeight || 1) || 1);

  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  function onDown(e) {
    if (e.button || E.drag) return;
    const handle = e.target.closest(".mte-h"), el = e.target.closest(".mte-box"), start = point(e);
    // without picking a tool first: Shift + click (or drag) is a text box, Ctrl + drag scans text
    const tool = E.tool !== "move" ? E.tool : e.shiftKey ? "text" : e.ctrlKey || e.metaKey ? "scan" : "";
    if (tool) {
      const rubber = document.createElement("div");
      rubber.className = "mte-rubber";
      E.layer.append(rubber);
      E.drag = { kind: "draw", start, rubber, tool };
    } else if (handle) {
      E.drag = { kind: "size", i: E.sel, h: handle.dataset.h, start, from: { ...E.blocks[E.sel] }, before: snap() };
    } else if (el) {
      const i = +el.dataset.i;
      select(i, { scroll: true });
      E.drag = { kind: "move", i, start, from: { ...E.blocks[i] }, before: snap() };
    } else {
      return select(-1);
    }
    E.drag.pointer = e.pointerId;
    E.layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e) {
    const d = E.drag;
    if (!d || e.pointerId !== d.pointer) return;
    const p = point(e), dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.kind === "draw") return place(d.rubber, rectOf(d.start, p));
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.004) return;  // a click, not a drag
    d.moved = true;
    const b = E.blocks[d.i], f = d.from;
    if (d.kind === "move") {
      b.x = clamp(f.x + dx, 0, 1 - f.w);
      b.y = clamp(f.y + dy, 0, 1 - f.h);
    } else {
      let x1 = f.x, y1 = f.y, x2 = f.x + f.w, y2 = f.y + f.h;
      if (d.h.includes("w")) x1 = clamp(x1 + dx, 0, x2 - MIN);
      if (d.h.includes("e")) x2 = clamp(x2 + dx, x1 + MIN, 1);
      if (d.h.includes("n")) y1 = clamp(y1 + dy, 0, y2 - minY());
      if (d.h.includes("s")) y2 = clamp(y2 + dy, y1 + minY(), 1);
      Object.assign(b, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    const el = boxEl(d.i);
    place(el, b);
    if (d.kind === "size") fit(el);
  }

  function onUp(e) {
    const d = E.drag;
    if (!d || e.pointerId !== d.pointer) return;
    E.drag = null;
    if (d.kind !== "draw") return pushUndo(d.before);
    d.rubber.remove();
    let r = rectOf(d.start, point(e));
    E.tool = "move";
    top();
    if (e.type === "pointercancel") return;
    if (r.w < MIN || r.h < minY()) {
      if (d.tool !== "text") return;
      // a click, not a drag: a text box of a usual size around that place (a page's: 20% x 7%)
      const w = 0.2, h = Math.min(0.07, minY() * 8);
      r = { x: clamp(d.start.x - w / 2, 0, 1 - w), y: clamp(d.start.y - h / 2, 0, 1 - h), w, h };
    }
    if (d.tool === "text") addText(r); else addScan(r);
  }

  function addBlock(r, src, text, box) {
    change(() => {
      E.blocks.push({ x: r.x, y: r.y, w: r.w, h: r.h, src, text, who: "", style: {}, box, hidden: false });
      E.sel = E.blocks.length - 1;
    });
    renderAll();
    E.list.querySelector(".mte-card.sel")?.scrollIntoView({ block: "nearest" });
  }

  function addText(r) {
    addBlock(r, "", "Text", null);
    focusText(E.sel);
  }

  /* text the finder missed: the marked part of the image is read and translated, and becomes a box */
  async function addScan(r) {
    const it = E.it, key = E.info.key, box = [r.x, r.y, r.x + r.w, r.y + r.h];
    E.pending.push(r);
    renderBoxes();
    let src = null, text = "";
    try {
      src = await E.H.scan(key, box);
      if (src) text = await E.H.translate(src, around(null));
    } catch (e) { toast(errorText(e), "error"); }
    if (E.it !== it || E.info?.key !== key) return;
    E.pending = E.pending.filter((x) => x !== r);
    if (src === "") toast("No text was read there. Try a closer frame around the text.", "error");
    if (src) addBlock(r, src, text, box); else renderBoxes();
  }

  /* ---------------- keys: all of them stay in the editor while it's open ---------------- */

  function onKey(e) {
    if (!isOpen()) return;
    e.stopPropagation();  // not the site's (arrows turn its pages, Escape leaves its reader)
    e.stopImmediatePropagation();
    const target = e.composedPath()[0] || e.target;  // inside the shadow root
    const slider = target.type === "range";  // takes the arrow keys itself, nothing else
    const typing = !slider && /^(TEXTAREA|INPUT|SELECT)$/.test(target.tagName || "") && E.sr.contains(target);
    const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    const askEl = q('[data-r="ask"]'), keys = q('[data-r="keys"]');
    if (e.key === "Escape") {
      e.preventDefault();
      if (!keys.hidden) keys.hidden = true;
      else if (!askEl.hidden) askEl.hidden = true;
      else if (E.tool !== "move") { E.tool = "move"; top(); }
      else if (typing) target.blur();
      else close();
    } else if (ctrl && key === "s") {
      e.preventDefault();
      if (typing) target.blur();  // what is being typed counts
      save();
    } else if (ctrl && key === "z" && !typing) {
      e.preventDefault();
      undo();
    } else if (typing || ctrl || e.altKey || !askEl.hidden) {
      // typing, the browser's own shortcuts, or the question about unsaved changes: no hotkeys
    } else if (HOTKEYS[key]) {
      e.preventDefault();
      actions[HOTKEYS[key]]();
    } else if (!keys.hidden || slider) {
      // the shortcuts list is up, or a slider has the arrow keys
    } else if (E.blocks[E.sel]) {
      const b = E.blocks[E.sel], step = e.shiftKey ? 0.01 : 0.002;
      const sy = step * (minY() / MIN);  // the same distance down as across, on a long strip too
      const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -sy], ArrowDown: [0, sy] }[e.key];
      if (by) {
        e.preventDefault();
        change(() => { b.x = clamp(b.x + by[0], 0, 1 - b.w); b.y = clamp(b.y + by[1], 0, 1 - b.h); });
        place(boxEl(E.sel), b);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        cardActions.del(E.sel);
      }
    } else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // no box selected: the images, like the arrows under the image (right is the next one)
      e.preventDefault();
      go(e.key === "ArrowRight" ? 1 : -1);
    }
  }

  addEventListener("keydown", onKey, true);
  for (const type of ["keyup", "keypress"]) {
    addEventListener(type, (e) => {
      if (isOpen()) { e.stopPropagation(); e.stopImmediatePropagation(); }
    }, true);
  }

  return { open, isOpen, changed };
})();
