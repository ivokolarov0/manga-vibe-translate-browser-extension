/* Saved result -> boxes in fractions of the image (0..1). Same rules as MangaVibe's plugin:
   the text box is grown a little, because English needs more room than a column of Japanese and the
   bubble around it is bigger anyway. Tall thin boxes (vertical Japanese) are widened to at least 2/3
   of their height. A box never grows into a neighbour: where two would overlap, both grow less on the
   sides that face each other. A box placed in the editor ("rect") stays exactly where it was put.

   Also the box styles of the editor ("style" per block), shared by the boxes on the page and the
   editor's: {size, bold, italic, upper, font, align, color, bg}. "size" is the font size in tenths
   of a percent of the image's width, so it's the same at every zoom; without it the text is fitted
   to the box. */
"use strict";

(() => {
  /* [x1, y1, x2, y2] per block, in the saved image's pixels: where its English box goes. */
  function displayRects(data) {
    const { w, h } = data;
    const blocks = data.blocks || [];
    const gap = 4 * Math.max(1, w / 1600); // pixels left between two grown boxes
    const rects = blocks.map((b) => b.rect || b.box);
    const grow = blocks.map((b, i) => {
      if (b.rect) return [0, 0, 0, 0];  // placed by hand
      const [x1, y1, x2, y2] = rects[i];
      const gx = Math.max((x2 - x1) * 0.25, ((y2 - y1) * 0.66 - (x2 - x1)) / 2);
      const gy = (y2 - y1) * 0.08;
      return [Math.min(gx, x1), Math.min(gy, y1), Math.min(gx, w - x2), Math.min(gy, h - y2)];
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) makeRoom(rects[i], grow[i], rects[j], grow[j], gap);
    }
    return rects.map(([x1, y1, x2, y2], i) => {
      const [gl, gt, gr, gb] = grow[i];
      return [x1 - gl, y1 - gt, x2 + gr, y2 + gb];
    });
  }

  /* The boxes to draw: not the hidden ones, nor those without English. */
  function boxesFor(data) {
    const { w, h } = data;
    const rects = displayRects(data);
    const out = [];
    (data.blocks || []).forEach((b, i) => {
      if (!b.text || b.hidden) return;
      const [l, t, r, btm] = rects[i];
      const who = b.who || "", src = b.src || "";
      out.push({
        x: l / w, y: t / h, w: (r - l) / w, h: (btm - t) / h, text: b.text,
        title: who && src ? `${who}: ${src}` : src || who, style: cleanStyle(b.style),
      });
    });
    return out;
  }

  /* If boxes a and b would overlap once grown, cut the growth of the sides facing each other (both in
     proportion) on the axis where that takes the least away. Only ever shrinks, so pairs fixed earlier
     stay apart. Boxes whose text already overlaps are left alone. */
  function makeRoom(a, ga, b, gb, GAP) {
    let best = null;
    for (const [lo, hi] of [[0, 2], [1, 3]]) {
      let gap, sa, sb;
      if (a[hi] <= b[lo]) { gap = b[lo] - a[hi]; sa = hi; sb = lo; }
      else if (b[hi] <= a[lo]) { gap = a[lo] - b[hi]; sa = lo; sb = hi; }
      else continue;
      const need = ga[sa] + gb[sb] - Math.max(0, gap - GAP);
      if (need <= 0) return;
      if (!best || need < best[0]) best = [need, gap, sa, sb];
    }
    if (!best) return;
    const [, gap, sa, sb] = best;
    const total = ga[sa] + gb[sb];
    const scale = total > 0 ? Math.max(0, gap - GAP) / total : 0;
    ga[sa] *= scale;
    gb[sb] *= scale;
  }

  /* --- box styles ----------------------------------------------------------------------------------- */

  const STYLE = {
    size: [6, 80],
    font: [["", "Comic (default)", ""],
      ["sans", "Plain", 'system-ui, "Segoe UI", Arial, sans-serif'],
      ["serif", "Serif", 'Georgia, "Times New Roman", serif'],
      ["hand", "Handwriting", '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive'],
      ["heavy", "Heavy", 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'],
      ["mono", "Typewriter", '"Courier New", ui-monospace, monospace']],
    align: [["", "Centre"], ["left", "Left"], ["right", "Right"]],
    color: [["", "Black", "#111111"], ["white", "White", "#ffffff"], ["red", "Red", "#c62828"],
      ["blue", "Blue", "#1e50c8"], ["green", "Green", "#1b7a3d"], ["purple", "Purple", "#7b2fbf"],
      ["orange", "Orange", "#c85a00"], ["gray", "Grey", "#6b7280"]],
    bg: [["", "White", "#ffffff"], ["black", "Black", "#111111"], ["yellow", "Yellow", "#fff2a8"],
      ["pink", "Pink", "#ffd9e6"], ["blue", "Blue", "#d9ecff"], ["none", "None", "transparent"]],
  };
  const FLAGS = ["bold", "italic", "upper"];
  const CHOICES = ["font", "align", "color", "bg"];

  /* A style as it's saved: only what is known, nothing for the defaults. */
  function cleanStyle(style) {
    if (!style || typeof style !== "object") return {};
    const out = {};
    const size = Math.round(+style.size || 0);
    if (size) out.size = Math.min(Math.max(size, STYLE.size[0]), STYLE.size[1]);
    for (const k of FLAGS) if (style[k] === true) out[k] = true;
    for (const k of CHOICES) if (style[k] && STYLE[k].some((o) => o[0] === style[k])) out[k] = style[k];
    return out;
  }

  const pick = (key, v) => STYLE[key].find((o) => o[0] === (v || "")) || STYLE[key][0];

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /* Gives a box (and its text element) its style, as inline !important styles, so a site's CSS can't
     change them. look: {bg: 0..1, the background's opacity from the settings}. */
  function paintBox(box, text, style, look) {
    const s = cleanStyle(style);
    const set = (el, k, v) => (v == null ? el.style.removeProperty(k) : el.style.setProperty(k, v, "important"));
    const bg = pick("bg", s.bg)[2];
    set(box, "background", bg === "transparent" ? "transparent" : rgba(bg, look?.bg ?? 1));
    set(box, "color", pick("color", s.color)[2]);
    set(box, "font-family", s.font ? pick("font", s.font)[2] : null);
    set(box, "font-weight", s.bold ? "800" : null);
    set(box, "font-style", s.italic ? "italic" : null);
    set(box, "text-transform", s.upper ? "uppercase" : null);
    set(box, "justify-content", s.align === "left" ? "flex-start" : s.align === "right" ? "flex-end" : null);
    set(text, "text-align", s.align || null);
    set(box, "--mt-stroke-color", s.color === "white" ? "#111" : null);  // light text: a dark outline
    box._mtSize = s.size || 0;
  }

  /* The font size for a box: its own size, or the largest at which the text fits inside the box
     (as in MangaVibe's reader). imageWidth: the picture's width on the screen. */
  function fitBox(box, imageWidth) {
    const span = box.firstChild;
    if (box._mtSize) {
      box.style.setProperty("font-size", `${((box._mtSize / 1000) * imageWidth).toFixed(2)}px`, "important");
      return;
    }
    const h = box.clientHeight, w = box.clientWidth;
    if (!h || !w || !span) return;
    let lo = 5, hi = Math.max(6, Math.min(h * 0.6, 64));
    for (let n = 0; n < 7; n++) {
      const mid = (lo + hi) / 2;
      box.style.setProperty("font-size", `${mid}px`, "important");
      if (span.offsetHeight <= h && span.scrollWidth <= w) lo = mid; else hi = mid;
    }
    box.style.setProperty("font-size", `${lo}px`, "important");
  }

  Object.assign(MT, { boxesFor, displayRects, STYLE, cleanStyle, paintBox, fitBox });
})();
