/* On every page: if the address matches one of the sites in the settings, finds the images that
   match the site's selector, has them translated (the ones on screen first, then the next few) and
   draws the English on top of them. Also: the picker that helps choose the selector. */
"use strict";

(() => {
  if (window.__mangaTranslate) return;
  window.__mangaTranslate = true;

  const SEND_WIDTH = 1600;   // images are shrunk to this width before they go to the PC
  const PIECE_RATIO = 1.5;   // a taller image is cut into pieces this tall (x width), e.g. webtoons
  const OVERLAP = 0.2;       // of a piece's height, shared with the next piece
  const PREPARING = 2;       // images fetched and cut at the same time
  const STROKE = { off: "0px", thin: "0.12em", thick: "0.22em" };
  const NEXT_PAGES = 10;     // at most this many pages followed ahead (sites with one image per page)
  const NEXT_PRIORITY = 2;   // in the queue: after the images on screen (0) and ahead on this page (1)

  let sites = [];
  let settings = { ...MT.DEFAULTS };
  let site = null;
  let shown = true;          // the English boxes are on the page (Hide: Alt+Shift+T)
  let paused = false;        // no more images are translated on this tab (Pause: Alt+Shift+P)
  let preparing = 0;
  let lastUrl = location.href;
  let mo = null, io = null, ro = null, scanTimer = null, placeTimer = null, statusTimer = null;
  let status = null;
  let picker = null;
  const items = new Map();   // <img> -> item
  const onScreen = new Set();

  /* Pause and Hide stay for this tab (the chapters after this one too, until they're switched back),
     not for other tabs: e.g. a series the site already has in English. */
  const TAB_STATE = "__mangaTranslate";
  try {
    const s = JSON.parse(sessionStorage.getItem(TAB_STATE) || "{}");
    shown = !s.hidden;
    paused = !!s.paused;
  } catch { /* no storage on this page */ }

  function saveTabState() {
    try { sessionStorage.setItem(TAB_STATE, JSON.stringify({ hidden: !shown, paused })); } catch { /* as above */ }
  }

  /* --- which site, if any ------------------------------------------------------------------------- */

  async function load() {
    const got = await browser.storage.local.get(["sites", "settings"]);
    sites = got.sites || [];
    settings = MT.withDefaults(got.settings);
  }

  function evaluate() {
    const next = MT.findSite(sites, location.href);
    if (next?.id === site?.id && next?.selector === site?.selector && next?.minSize === site?.minSize) {
      site = next;
      return;
    }
    teardown();
    site = next;
    if (site) setup();
  }

  function setup() {
    mo = new MutationObserver(() => { scheduleScan(); follow(); });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"],
    });
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target);
      }
      pump();
    }, { rootMargin: "200px 0px" });
    ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const it = items.get(e.target);
        if (it?.layer) place(it);
      }
    });
    placeTimer = setInterval(() => {  // layout changes nothing else tells us about
      sweep();
      if (placeAll()) follow();
    }, 500);
    scheduleScan();
  }

  function teardown() {
    mo?.disconnect();
    io?.disconnect();
    ro?.disconnect();
    clearInterval(placeTimer);
    clearTimeout(scanTimer);
    cancelAnimationFrame(followFrame);
    followFrame = 0;
    mo = io = ro = null;
    stopUpcoming(true);
    items.clear();
    sweep();
    onScreen.clear();
    setStatus("");
  }

  /* --- finding the images ------------------------------------------------------------------------- */

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function matching() {
    let found;
    try { found = document.querySelectorAll(site.selector || "img"); } catch { return []; }
    const out = [];
    for (const el of found) {
      if (el instanceof HTMLImageElement) out.push(el);
      else out.push(...el.querySelectorAll("img"));  // a selector for the container: its images
    }
    return [...new Set(out)];
  }

  function imageUrl(img) {
    return img.currentSrc || img.src || "";
  }

  function bigEnough(img) {
    const min = +site.minSize || 0;
    return img.complete && img.naturalWidth >= min * 0.5 && Math.max(img.naturalWidth, img.naturalHeight) >= min;
  }

  function scan() {
    if (!site) return;
    const imgs = matching();
    const seen = new Set(imgs);
    for (const [img, it] of items) {
      if (!seen.has(img) || !img.isConnected) {
        it.layer?.remove();
        io.unobserve(img);
        ro.unobserve(img);
        onScreen.delete(img);
        items.delete(img);
      }
    }
    const lookup = [];
    for (const img of imgs) {
      let it = items.get(img);
      if (!it) {
        it = { img, key: "", state: "wait", result: null, layer: null, lastKey: "", priority: 9 };
        items.set(img, it);
        io.observe(img);
        ro.observe(img);
        img.addEventListener("load", scheduleScan);
      }
      const url = bigEnough(img) ? imageUrl(img) : "";
      if (url !== it.key) {  // new image, or the reader swapped the picture in the same <img>
        if (it.key) it.lastKey = it.key;
        it.key = url;
        it.result = null;
        it.state = url ? "lookup" : "wait";
        it.layer?.remove();
        it.layer = null;
      }
      if (it.state === "lookup") lookup.push(it);
    }
    sweep();
    if (lookup.length) lookUp(lookup);
    pump();
  }

  async function lookUp(list) {
    for (const it of list) it.state = "looking";
    const keys = [...new Set(list.map((it) => it.key))];
    let results = {};
    try { ({ results } = await browser.runtime.sendMessage({ type: "lookup", keys })); } catch { /* reloaded */ }
    for (const it of list) {
      if (it.state !== "looking") continue;
      if (results?.[it.key]) done(it, results[it.key]);
      else it.state = "missing";
    }
    pump();
  }

  /* --- what to translate now: what's on screen, then the next few --------------------------------- */

  function pump() {
    if (!site) return;
    const list = [...items.values()].filter((it) => it.key && document.contains(it.img));
    list.sort((a, b) => (a.img.compareDocumentPosition(b.img) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    let lastVisible = -1;
    const wanted = [];
    list.forEach((it, i) => {
      if (onScreen.has(it.img)) {
        lastVisible = i;
        wanted.push([it, 0, list[i - 1]?.key || it.lastKey]);
      }
    });
    if (lastVisible >= 0) {
      const ahead = Math.max(0, +settings.ahead || 0);
      for (let i = lastVisible + 1; i < Math.min(list.length, lastVisible + 1 + ahead); i++) {
        wanted.push([list[i], 1, list[i - 1]?.key || ""]);
      }
    }
    for (const [it, priority, prevKey] of wanted) {
      if (paused) break;  // saved translations still show; nothing new is started
      if (it.state === "missing" && preparing < PREPARING) {
        work(it, priority, prevKey);
      } else if (it.state === "working" && priority < it.priority) {
        it.priority = priority;
        browser.runtime.sendMessage({ type: "bump", key: it.key }).catch(() => {});
      }
    }
    readNext();
    watchStatus();
  }

  function byPosition(a, b) {
    return a.img.compareDocumentPosition(b.img) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  /* forced: asked for in the editor, so it's translated even while paused */
  async function work(it, priority, prevKey, forced = false) {
    const key = it.key;
    it.state = "working";
    it.priority = priority;
    it.forced = forced;
    let piece;
    preparing++;
    try {
      piece = await prepare(key);
    } catch (e) {
      if (it.key === key) failedImage(it, `Couldn't load the image: ${e.message || e}`);
      return;
    } finally {
      preparing--;
      setTimeout(pump, 0);
    }
    if (paused && !it.forced) {  // paused while the image was being fetched
      if (it.key === key) it.state = "missing";
      return;
    }
    let answer;
    try {
      answer = await browser.runtime.sendMessage({ type: "translate", key, prevKey, priority: it.priority, ...piece });
    } catch (e) {
      answer = { error: String(e.message || e) };
    }
    if (it.key !== key) return;  // the picture changed meanwhile: the result is saved for later
    if (answer?.cancelled) it.state = "missing";  // paused: it waits until Resume
    else if (answer?.result) done(it, answer.result);
    else failedImage(it, answer?.error || "no answer");
    pump();
  }

  function failedImage(it, error) {
    it.state = "failed";
    it.error = error;
    console.warn("Manga Translate:", error, it.key);
    MT.editor.changed(it);
  }

  /* --- preparing an image: fetch it, shrink it, cut a tall one into pieces -------------------------- */

  async function getBlob(url) {
    try {
      const r = await fetch(url, { credentials: "include", cache: "force-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.blob();
    } catch (first) {
      if (/^(blob|data):/.test(url)) throw first;
      // e.g. a site that refuses this way: the background tries without the page's context
      const got = await browser.runtime.sendMessage({ type: "fetchImage", url });
      if (!got?.data) throw new Error(got?.error || first.message);
      return new Blob([MT.fromBase64(got.data)], { type: got.type });
    }
  }

  async function prepare(url) {
    const bmp = await createImageBitmap(await getBlob(url));
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, SEND_WIDTH / w);
    const W = Math.round(w * scale), H = Math.round(h * scale);
    const pieceH = Math.round(W * PIECE_RATIO);
    const bounds = [];
    if (H <= pieceH * 1.3) {
      bounds.push([0, H]);
    } else {
      const step = Math.round(pieceH * (1 - OVERLAP));
      for (let y = 0; ; y += step) {
        const bottom = Math.min(H, y + pieceH);
        bounds.push([y, bottom]);
        if (bottom >= H) break;
      }
    }
    const tiles = [];
    for (let i = 0; i < bounds.length; i++) {
      const [top, bottom] = bounds[i];
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = bottom - top;
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, canvas.height);
      g.drawImage(bmp, 0, top / scale, w, (bottom - top) / scale, 0, 0, W, bottom - top);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      // each piece keeps the bubbles whose middle is in its own part: up to the middle of each overlap
      // (null: no limit. Not Infinity: Chrome's messages are JSON, where it would turn into null anyway)
      const ownTop = i === 0 ? null : (bounds[i - 1][1] - top) / 2;
      const ownBottom = i === bounds.length - 1 ? null : (bottom - top) - (bottom - bounds[i + 1][0]) / 2;
      tiles.push({ data: await MT.blobToBase64(blob), y: top, scale, ownTop, ownBottom });
    }
    bmp.close?.();
    return { w, h, tiles };
  }

  /* --- the next page: its images are translated before it's opened ---------------------------------
     Once the reader is near the end of this page (the images ahead reach its last one), the page the
     site's next-page link leads to is downloaded, its images are found with the site's selector and
     they go into the queue after this page's. A site with one image per page: the links are followed
     further, until there are as many images as "Images to translate ahead". Works when the page's
     HTML has the image addresses; not for pages that are built by scripts. */

  let upcomingGen = 0;
  let upcoming = { url: "", gen: 0 };

  /* the <a> an element is in, or holds */
  function linkOf(el) {
    if (!el) return null;
    return el.closest?.("a[href]") || el.querySelector?.("a[href]") || null;
  }

  /* the next-page link in a document (this page, or one downloaded) */
  function nextLink(selector, doc = document) {
    let el;
    try { el = doc.querySelector(selector); } catch { return null; }
    return linkOf(el);
  }

  /* the address a link leads to, or "" when it isn't another web page */
  function pageAddress(a, base = document.baseURI, from = location.href) {
    if (!a) return "";
    let u;
    try { u = new URL(a.getAttribute("href"), base); } catch { return ""; }
    if (!/^https?:$/.test(u.protocol)) return "";
    u.hash = "";
    const here = new URL(from);
    here.hash = "";
    return u.href === here.href ? "" : u.href;
  }

  async function fetchPage(url) {
    let html;
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    } catch (first) {
      // e.g. Chrome refuses another site's page to a content script: the background asks for it
      const got = await browser.runtime.sendMessage({ type: "fetchPage", url });
      if (typeof got?.html !== "string") throw new Error(got?.error || first.message);
      html = got.html;
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    let base = url;
    try { base = new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url).href; } catch { /* as it is */ }
    return { doc, base };
  }

  /* Where an image of a downloaded page comes from. Lazy loading keeps the address in an attribute
     of its own until the image is near the screen; then it's put into src, so it's the same address. */
  const LAZY = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-url", "data-echo", "data-cfsrc"];
  function imageSource(img) {
    const ok = (v) => (v && !/^(data|blob|about|javascript):/i.test(v.trim()) ? v.trim() : "");
    for (const a of LAZY) {
      const v = ok(img.getAttribute(a));
      if (v) return v;
    }
    const src = ok(img.getAttribute("src"));
    if (src) return src;
    const set = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    return ok(set.split(",")[0].trim().split(/\s+/)[0]);
  }

  function pageImages(doc, base) {
    let found;
    try { found = doc.querySelectorAll(site.selector || "img"); } catch { return []; }
    const out = [];
    for (const el of found) {
      for (const img of el.localName === "img" ? [el] : el.querySelectorAll("img")) {
        const src = imageSource(img);
        if (!src) continue;
        try { out.push(new URL(src, base).href); } catch { /* not an address */ }
      }
    }
    return [...new Set(out)];
  }

  /* called with every pump: starts on the next page once the reader is near the end of this one */
  function readNext() {
    if (paused || !site?.next) return;
    const all = [...items.values()].filter((it) => it.img.isConnected).sort(byPosition);
    let last = -1;
    all.forEach((it, i) => { if (onScreen.has(it.img)) last = i; });
    if (last < 0 || last + Math.max(0, +settings.ahead || 0) < all.length - 1) return;
    const url = pageAddress(nextLink(site.next));
    if (!url || url === upcoming.url) return;
    stopUpcoming(false);  // the next page changed (a reader that changes pages without loading them)
    upcoming = { url, gen: upcomingGen, pages: 0, total: 0, done: 0, failed: 0, error: "", keys: new Set() };
    readUpcoming(upcoming, all.findLast((it) => it.key)?.key || "", new Set(all.map((it) => it.key)));
  }

  /* cancel: its images waiting in the queue leave it too (Pause, or not a site's page any more) */
  function stopUpcoming(cancel) {
    upcomingGen++;
    const keys = [...(upcoming.keys || [])];
    if (cancel && keys.length) browser.runtime.sendMessage({ type: "cancel", keys }).catch(() => {});
    upcoming = { url: "", gen: upcomingGen };
  }

  async function readUpcoming(up, prevKey, here) {
    const current = () => up.gen === upcomingGen && !paused && !!site;
    const want = Math.max(1, +settings.ahead || 0);
    const list = [];  // [key, the image before it]
    const visited = new Set([location.href.replace(/#.*$/, "")]);
    let url = up.url, from = location.href;
    while (url && !visited.has(url) && up.pages < NEXT_PAGES && (!up.pages || list.length < want)) {
      visited.add(url);
      let page;
      try {
        page = await fetchPage(url);
      } catch (e) {
        up.error = `Couldn't load the next page: ${e.message || e}`;
        break;
      }
      if (!current()) return;
      up.pages++;
      const found = pageImages(page.doc, page.base).filter((k) => !here.has(k) && !list.some(([l]) => l === k));
      if (!found.length) break;  // e.g. the last chapter's link goes to the series page
      for (const key of found) {
        list.push([key, prevKey]);
        prevKey = key;
      }
      from = url;
      url = pageAddress(nextLink(site.next, page.doc), page.base, from);
    }
    up.total = list.length;
    if (!list.length) {
      up.error ||= "No images found on the next page (the site may build its pages with scripts)";
      console.warn("Manga Translate:", up.error, up.url);
      return;
    }
    let saved = {};
    try { ({ results: saved } = await browser.runtime.sendMessage({ type: "lookup", keys: list.map(([k]) => k) })); } catch { /* reloaded */ }
    const todo = list.filter(([k]) => !saved?.[k]);
    up.done = list.length - todo.length;
    const worker = async () => {
      while (todo.length && current()) {
        const [key, prev] = todo.shift();
        await translateUpcoming(up, key, prev);
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async function translateUpcoming(up, key, prevKey) {
    let piece;
    try {
      piece = await prepare(key);
    } catch (e) {
      up.failed++;
      console.warn("Manga Translate: couldn't load an image of the next page:", e.message || e, key);
      return;
    }
    if (up.gen !== upcomingGen || paused || !site) return;
    const min = +site.minSize || 0;
    if (piece.w < min * 0.5 || Math.max(piece.w, piece.h) < min) {  // an icon or an ad
      up.total--;
      return;
    }
    up.keys.add(key);
    let answer;
    try {
      answer = await browser.runtime.sendMessage({ type: "translate", key, prevKey, priority: NEXT_PRIORITY, ...piece });
    } catch (e) {
      answer = { error: String(e.message || e) };
    }
    up.keys.delete(key);
    if (answer?.result) up.done++;
    else if (!answer?.cancelled) up.failed++;
  }

  /* --- drawing the English ------------------------------------------------------------------------- */

  function done(it, result) {
    it.state = "done";
    it.result = result;
    render(it);
    MT.editor.changed(it);
  }

  /* the box background and outline from the settings (the editor's boxes look the same) */
  function look() {
    const bg = Math.min(100, Math.max(0, +settings.boxBg));
    return { bg: (Number.isFinite(bg) ? bg : 100) / 100, stroke: STROKE[settings.outline] || "0px" };
  }

  function render(it) {
    it.layer?.remove();
    it.layer = null;
    if (!it.result?.blocks?.length) return;
    const layer = document.createElement("mt-layer");
    const lk = look();
    layer.style.setProperty("--mt-stroke", lk.stroke);
    layer.hidden = !shown;
    for (const b of MT.boxesFor(it.result)) {
      const box = document.createElement("mt-box");
      const pct = (v) => `${(v * 100).toFixed(3)}%`;
      // !important: overlay.css resets everything with !important, which beats plain inline styles
      box.style.setProperty("left", pct(b.x), "important");
      box.style.setProperty("top", pct(b.y), "important");
      box.style.setProperty("width", pct(b.w), "important");
      box.style.setProperty("height", pct(b.h), "important");
      box.title = b.title || "";
      const text = document.createElement("mt-text");
      text.textContent = b.text;
      box.append(text);
      MT.paintBox(box, text, b.style, lk);
      layer.append(box);
    }
    it.layer = layer;
    place(it);
  }

  /* The part of the <img> the picture is drawn in (object-fit: contain leaves bars at the sides). */
  function pictureRect(img) {
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const px = (v) => parseFloat(v) || 0;
    let left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    let top = r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
    let width = r.width - px(cs.borderLeftWidth) - px(cs.paddingLeft) - px(cs.borderRightWidth) - px(cs.paddingRight);
    let height = r.height - px(cs.borderTopWidth) - px(cs.paddingTop) - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (nw && nh && width > 0 && height > 0 && /contain|scale-down/.test(cs.objectFit)) {
      let s = Math.min(width / nw, height / nh);
      if (cs.objectFit === "scale-down") s = Math.min(s, 1);
      const dw = nw * s, dh = nh * s;
      left += (width - dw) / 2;  // object-position other than "center" is rare in readers
      top += (height - dh) / 2;
      width = dw;
      height = dh;
    }
    return { left, top, width, height, fixed: cs.position === "fixed" };
  }

  /* What of the picture can be seen, as the clip-path for its layer, or null when nothing shows:
     the image (or a parent) is hidden, or a gallery's frame (overflow: hidden) cuts it off, e.g. the
     slides before and after the current one. */
  function visibleClip(img, p) {
    if (img.checkVisibility && !img.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    let l = p.left, t = p.top, r = p.left + p.width, b = p.top + p.height;
    for (let el = img.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const er = el.getBoundingClientRect();
        if (cs.overflowX !== "visible") {
          l = Math.max(l, er.left + el.clientLeft);
          r = Math.min(r, er.left + el.clientLeft + el.clientWidth);
        }
        if (cs.overflowY !== "visible") {
          t = Math.max(t, er.top + el.clientTop);
          b = Math.min(b, er.top + el.clientTop + el.clientHeight);
        }
        if (r - l < 1 || b - t < 1) return null;
      }
      if (cs.position === "fixed") break;  // nothing above a fixed box clips it
    }
    const n = (v) => `${Math.max(0, v).toFixed(1)}px`;
    const inset = [t - p.top, p.left + p.width - r, p.top + p.height - b, l - p.left];
    return inset.every((v) => v < 0.5) ? "none" : `inset(${inset.map(n).join(" ")})`;
  }

  function hide(layer) {
    if (layer.style.getPropertyValue("display") === "none") return false;
    layer.style.setProperty("display", "none", "important");
    return true;
  }

  /* Puts the layer exactly over the picture. It goes into the image's offset parent, so it scrolls
     with the image without any lag. Returns whether anything changed. */
  function place(it) {
    const { img, layer } = it;
    if (!layer) return false;
    if (!img.isConnected || items.get(img) !== it) { layer.remove(); it.layer = null; return true; }
    const p = pictureRect(img);
    // far off screen: hidden (it can't be seen, and checking what clips it costs time)
    const far = p.top > innerHeight * 2 || p.top + p.height < -innerHeight
      || p.left > innerWidth * 2 || p.left + p.width < -innerWidth;
    const clip = p.width < 2 || p.height < 2 || far ? null : visibleClip(img, p);
    if (!clip) return hide(layer);
    let moved = false;
    if (layer.style.getPropertyValue("display")) { layer.style.removeProperty("display"); moved = true; }
    let parent, left, top;
    if (p.fixed) {
      parent = document.body;
      layer.style.setProperty("position", "fixed", "important");
      left = p.left; top = p.top;
    } else {
      layer.style.removeProperty("position");
      const op = img.offsetParent;
      if (!op || (op === document.body && getComputedStyle(op).position === "static")) {
        parent = document.body;
        left = p.left + scrollX;
        top = p.top + scrollY;
      } else {
        parent = op;
        const pr = op.getBoundingClientRect();
        left = p.left - pr.left - op.clientLeft + op.scrollLeft;
        top = p.top - pr.top - op.clientTop + op.scrollTop;
      }
    }
    if (layer.parentNode !== parent) { parent.append(layer); moved = true; }
    const set = (k, s) => {
      if (layer.style.getPropertyValue(k) === s) return;
      layer.style.setProperty(k, s, "important");
      moved = true;
    };
    set("left", `${left.toFixed(2)}px`);
    set("top", `${top.toFixed(2)}px`);
    set("width", `${p.width.toFixed(2)}px`);
    set("height", `${p.height.toFixed(2)}px`);
    set("clip-path", clip);
    if (layer._w !== Math.round(p.width) || layer._h !== Math.round(p.height)) {
      layer._w = Math.round(p.width);
      layer._h = Math.round(p.height);
      if (shown) fit(layer);
    }
    return moved;
  }

  function placeAll() {
    let moved = false;
    for (const it of items.values()) if (it.layer && place(it)) moved = true;
    return moved;
  }

  /* Layers nobody owns any more: the image was swapped or removed while we weren't looking, or the
     page copied a layer along with a slide (carousels clone their slides). */
  function sweep() {
    const owned = new Set([...items.values()].map((it) => it.layer).filter(Boolean));
    for (const l of document.querySelectorAll("mt-layer")) if (!owned.has(l)) l.remove();
  }

  /* While the page moves (scrolling, a gallery sliding to the next page), the layers follow every
     frame; once nothing has moved for a moment, this stops. */
  let followFrame = 0, stillFrames = 0;
  function follow() {
    stillFrames = 0;
    if (followFrame || !site) return;
    const step = () => {
      stillFrames = placeAll() ? 0 : stillFrames + 1;
      followFrame = site && stillFrames < 30 ? requestAnimationFrame(step) : 0;
    };
    followFrame = requestAnimationFrame(step);
  }

  /* Each box's font size: its own from the editor, or the largest at which its text fits. */
  function fit(layer) {
    for (const box of layer.children) MT.fitBox(box, layer._w || layer.clientWidth);
  }

  function refitAll() {
    for (const it of items.values()) {
      if (!it.layer) continue;
      it.layer.hidden = !shown;
      if (shown) fit(it.layer);
    }
  }

  /* the look in the settings changed: the boxes are drawn again */
  function restyleAll() {
    for (const it of items.values()) if (it.layer) render(it);
  }

  for (const type of ["scroll", "resize", "wheel", "keydown", "pointerup", "transitionrun", "animationstart"]) {
    addEventListener(type, follow, { capture: true, passive: true });
  }

  /* --- the status line ----------------------------------------------------------------------------- */

  function setStatus(text) {
    if (!text) { status?.remove(); status = null; return; }
    if (!status) {
      status = document.createElement("mt-status");
      document.documentElement.append(status);
    }
    status.hidden = !shown;
    if (status.textContent !== text) status.textContent = text;
  }

  function watchStatus() {
    if (statusTimer) return;
    const tick = async () => {
      statusTimer = null;
      if (flashTimer) { statusTimer = setTimeout(tick, 400); return; }  // a message is showing
      if (!site) return setStatus("");
      const its = [...items.values()];
      const working = its.filter((it) => it.state === "working").length;
      const visibleFailed = its.find((it) => it.state === "failed" && onScreen.has(it.img));
      if (!working) {
        setStatus(visibleFailed ? `Couldn't translate this image: ${visibleFailed.error}` : "");
        return;
      }
      let s = {};
      try { s = await browser.runtime.sendMessage({ type: "status" }); } catch { /* reloaded */ }
      setStatus(s?.offline || `Translating… (${s?.waiting ?? working} waiting)`);
      statusTimer = setTimeout(tick, 1000);
    };
    statusTimer = setTimeout(tick, 300);
  }

  /* --- the picker: click an image, get a selector for all the images like it ----------------------- */

  function describe(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id)) return "#" + CSS.escape(el.id);
    const classes = [...el.classList]
      .filter((c) => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{3,}/.test(c) && c.length < 40
        && !/^(active|selected|current|show|hidden|loaded|lazy|is-|js-)/.test(c))
      .slice(0, 2);
    if (!classes.length) return null;
    return el.localName + classes.map((c) => "." + CSS.escape(c)).join("");
  }

  function bigImages(selector) {
    let found;
    try { found = document.querySelectorAll(selector); } catch { return []; }
    return [...found].flatMap((el) => (el instanceof HTMLImageElement ? [el] : [...el.querySelectorAll("img")]))
      .filter((img) => Math.max(img.naturalWidth, img.naturalHeight) >= 200 || img.offsetWidth >= 200);
  }

  /* The selector (an ancestor + " img") that matches the clicked image and as many other big images
     as possible: in a reader, that's usually the box holding all the pages. */
  function suggest(img) {
    const candidates = [];
    let el = img.parentElement;
    for (let d = 0; el && el !== document.body && el !== document.documentElement && d < 8; d++) {
      const part = describe(el);
      if (part) candidates.push(part + " img");
      if (part?.startsWith("#")) break;  // an id is unique: higher up won't be better
      el = el.parentElement;
    }
    let best = null;
    for (const c of candidates) {
      const found = bigImages(c);
      if (!found.includes(img)) continue;
      if (!best || found.length > best.n) best = { c, n: found.length };
    }
    return best?.c || "img";
  }

  /* A path from the nearest element with an id (or the body) down to the element, for a link that has
     nothing of its own to tell it apart. */
  function cssPath(el) {
    const parts = [];
    for (; el && el.parentElement && el !== document.body; el = el.parentElement) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id)) return ["#" + CSS.escape(el.id), ...parts].join(" > ");
      const same = [...el.parentElement.children].filter((c) => c.localName === el.localName);
      parts.unshift(same.length > 1 ? `${el.localName}:nth-of-type(${same.indexOf(el) + 1})` : el.localName);
    }
    return ["body", ...parts].join(" > ");
  }

  /* The selector for the clicked next-page link: the first link it matches must be that one, and it
     should still fit on the next page, so classes and rel="next" go before a path. */
  function suggestLink(a) {
    const candidates = [];
    if ((a.getAttribute("rel") || "").split(/\s+/).includes("next")) candidates.push('a[rel~="next"]');
    const own = describe(a);
    if (own) candidates.push(own);
    let el = a.parentElement;
    for (let d = 0; el && el !== document.body && el !== document.documentElement && d < 6; d++) {
      const part = describe(el);
      if (part) candidates.push(`${part} ${own || "a"}`);
      if (part?.startsWith("#")) break;
      el = el.parentElement;
    }
    return candidates.find((c) => nextLink(c) === a) || cssPath(a);
  }

  /* mode: "images" (the manga pages) or "next" (the link to the next page or chapter) */
  function startPicker(mode = "images") {
    if (picker?.mode === mode) return;
    picker?.stop();
    const forLink = mode === "next";
    const bar = document.createElement("mt-picker");
    const msg = document.createElement("mt-msg");
    const input = document.createElement("input");
    const saveBtn = document.createElement("button");
    const cancelBtn = document.createElement("button");
    const intro = forLink
      ? "Manga Translate: click the link to the next page or chapter. (Esc to cancel)"
      : "Manga Translate: click one of the manga pages. (Esc to cancel)";
    msg.textContent = intro;
    input.spellcheck = false;
    input.placeholder = forLink ? "CSS selector of the next-page link" : "CSS selector of the images";
    input.hidden = true;
    saveBtn.textContent = forLink ? "Save as the next-page link" : "Save for this site";
    saveBtn.className = "mt-primary";
    saveBtn.hidden = true;
    cancelBtn.textContent = "Cancel";
    bar.append(msg, input, saveBtn, cancelBtn);
    document.documentElement.append(bar);

    let hovered = null;
    let marked = [];
    const unmark = () => { for (const m of marked) m.removeAttribute("data-mt-match"); marked = []; };
    const unhover = () => { hovered?.removeAttribute("data-mt-hover"); hovered = null; };
    const targetAt = (x, y) => (forLink
      ? document.elementsFromPoint(x, y).map((el) => el.closest?.("a[href]")).find((a) => a && !bar.contains(a))
      : document.elementsFromPoint(x, y).find((el) => el instanceof HTMLImageElement && !bar.contains(el)));

    const show = () => {
      unmark();
      const selector = input.value.trim() || "-";
      if (forLink) {
        const a = nextLink(selector);
        const url = pageAddress(a);
        marked = a ? [a] : [];
        msg.textContent = !a ? "No link matches this selector."
          : !url ? "That link doesn't lead to another page."
          : `Next page: ${url} (outlined). Change the selector if that's not the right link, then save.`;
        saveBtn.disabled = !url;
      } else {
        marked = bigImages(selector);
        msg.textContent = marked.length
          ? `${marked.length} image${marked.length > 1 ? "s" : ""} match (outlined). Change the selector if that's not right, then save.`
          : "No images match this selector.";
        saveBtn.disabled = !marked.length;
      }
      for (const m of marked) m.setAttribute("data-mt-match", "");
    };
    const onMove = (e) => {
      if (!input.hidden) return;
      const el = targetAt(e.clientX, e.clientY);
      if (el === hovered) return;
      unhover();
      if (el) { hovered = el; el.setAttribute("data-mt-hover", ""); }
    };
    const onClick = (e) => {
      if (bar.contains(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!input.hidden) return;
      const el = targetAt(e.clientX, e.clientY);
      if (!el) {
        msg.textContent = forLink ? `That's not a link. ${intro.replace(/^Manga Translate: c/, "C")}`
          : "That's not an image. Click one of the manga pages. (Esc to cancel)";
        return;
      }
      unhover();
      input.value = forLink ? suggestLink(el) : suggest(el);
      input.hidden = saveBtn.hidden = false;
      show();
      input.focus();
    };
    const swallow = (e) => { if (!bar.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };
    const onKey = (e) => { if (e.key === "Escape") stop(); };
    const stop = () => {
      unmark();
      unhover();
      bar.remove();
      removeEventListener("mousemove", onMove, true);
      removeEventListener("click", onClick, true);
      for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) removeEventListener(t, swallow, true);
      removeEventListener("keydown", onKey, true);
      picker = null;
    };
    input.addEventListener("input", show);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !saveBtn.disabled) saveBtn.click(); });
    cancelBtn.addEventListener("click", stop);
    saveBtn.addEventListener("click", async () => {
      const selector = input.value.trim();
      await saveToSite(forLink ? { next: selector } : { selector });
      stop();
      if (forLink) flash("Next-page link saved: its images are translated when you near the end of this page");
    });
    addEventListener("mousemove", onMove, true);
    addEventListener("click", onClick, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) addEventListener(t, swallow, true);
    addEventListener("keydown", onKey, true);
    picker = { stop, mode };
  }

  /* fields: { selector } or { next }, for this page's site (a new one if there's none yet) */
  async function saveToSite(fields) {
    const got = await browser.storage.local.get("sites");
    const list = got.sites || [];
    const existing = MT.findSite(list, location.href, true);
    if (existing) {
      Object.assign(existing, fields);
      existing.enabled = true;
    } else {
      list.push(MT.newSite({ name: location.hostname, match: location.hostname.replace(/^www\./, ""), ...fields }));
    }
    await browser.storage.local.set({ sites: list });
  }

  /* --- the editor: what it needs from the page (see editor.js) -------------------------------------- */

  /* the images that can be edited, in page order */
  function editable() {
    const list = [...items.values()].filter((it) => it.key && it.img.isConnected);
    return list.sort((a, b) => (a.img.compareDocumentPosition(b.img) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  /* the image the reader is looking at: the one in the middle of the window, else the one that shows most */
  function imageOnScreen() {
    let best = null, most = 0;
    for (const it of editable()) {
      if (!onScreen.has(it.img)) continue;
      const r = it.img.getBoundingClientRect();
      if (r.left <= innerWidth / 2 && r.right >= innerWidth / 2 && r.top <= innerHeight / 2 && r.bottom >= innerHeight / 2
        && it.img.checkVisibility?.({ visibilityProperty: true }) !== false) return it;
      const seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0))
        * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (seen > most) { most = seen; best = it; }
    }
    return best;
  }

  /* the image's full picture, for reading a part of it again: kept for the last image asked */
  let bitmap = { key: "", bmp: null };
  async function pictureOf(key) {
    if (bitmap.key !== key) {
      bitmap.bmp?.close?.();
      bitmap = { key, bmp: await createImageBitmap(await getBlob(key)) };
    }
    return bitmap.bmp;
  }

  /* a part of the image ([x1, y1, x2, y2] in fractions) as a JPEG, at most SEND_WIDTH wide */
  async function cropArea(key, [x1, y1, x2, y2]) {
    const bmp = await pictureOf(key);
    const W = bmp.width, H = bmp.height;
    const L = Math.max(0, x1 * W), T = Math.max(0, y1 * H), R = Math.min(W, x2 * W), B = Math.min(H, y2 * H);
    if (R - L < 2 || B - T < 2) throw new Error("That frame is too small");
    const scale = Math.min(1, SEND_WIDTH / (R - L));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((R - L) * scale);
    canvas.height = Math.round((B - T) * scale);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, L, T, R - L, B - T, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    return { data: await MT.blobToBase64(blob), box: [0, 0, canvas.width, canvas.height] };
  }

  /* the background answers {error} when something went wrong: thrown, for the editor to show */
  async function ask(msg) {
    const answer = await browser.runtime.sendMessage(msg);
    if (answer?.error) throw new Error(answer.error);
    return answer;
  }

  const editorHost = {
    list: editable,
    state(it) {
      const data = it.result?.blocks ? it.result : null;
      const message = it.state === "failed" ? it.error
        : it.state === "working" || it.state === "looking" ? "Translating this image…"
        : paused ? "Translation is paused on this tab." : "This image isn't translated yet.";
      return { data, failed: it.state === "failed", message, w: it.img.naturalWidth, h: it.img.naturalHeight };
    },
    look,
    model: () => settings.model,
    async save(key, it, data) {
      await ask({ type: "saveResult", key, result: data });
      if (it.key === key) done(it, data);
    },
    async scan(key, box) {
      const area = await cropArea(key, box);
      return (await ask({ type: "readArea", ...area })).src;
    },
    async translate(src, background) {
      return (await ask({ type: "translateOne", src, background })).text;
    },
    async romaji(texts) {
      return (await ask({ type: "romaji", texts })).romaji;
    },
    async retranslate(it) {
      const key = it.key, list = editable();
      it.layer?.remove();
      it.layer = null;
      it.result = null;
      it.state = "working";  // until the old translation is forgotten
      await browser.runtime.sendMessage({ type: "forget", keys: [key] }).catch(() => {});
      if (it.key !== key) return;
      work(it, 0, list[list.indexOf(it) - 1]?.key || it.lastKey, true);
    },
  };

  function openEditor(it = imageOnScreen()) {
    if (!site || MT.editor.isOpen()) return false;
    if (!it) {
      flash("No manga image on screen to edit");
      return false;
    }
    picker?.stop();
    MT.editor.open(editorHost, it);
    return true;
  }

  /* --- Pause and Hide (from the keys or the extension's button) ------------------------------------ */

  function toggle(on = !shown) {
    shown = on;
    saveTabState();
    refitAll();
    if (status) status.hidden = !shown;
    flash(shown ? "English shown" : "English hidden on this tab");
  }

  function setPaused(on = !paused) {
    paused = on;
    saveTabState();
    if (paused) {
      // the images waiting in the queue leave it; one the PC is already on is finished
      const keys = [...items.values()].filter((it) => it.state === "working" && !it.forced).map((it) => it.key);
      if (keys.length) browser.runtime.sendMessage({ type: "cancel", keys }).catch(() => {});
      stopUpcoming(true);  // the next page too; Resume starts it again
    }
    flash(paused ? "Translating paused on this tab" : "Translating again");
    pump();
  }

  /* a short message in the status line, for a moment */
  let flashTimer = 0;
  function flash(text) {
    clearTimeout(flashTimer);
    setStatus(text);
    status.hidden = false;  // also while the English is hidden: it says what just happened
    flashTimer = setTimeout(() => {
      flashTimer = 0;
      if (status?.textContent === text) setStatus("");
      watchStatus();
    }, 1800);
  }

  /* --- the keys set in Settings → Keys (or the site's own): only on a site's pages, never while
     typing in a field or while the editor is open (it has keys of its own) -------------------------- */

  function typingIn(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|image|color|file)$/i.test(el.type);
  }

  addEventListener("keydown", (e) => {
    if (!site || e.repeat || e.isComposing || MT.editor.isOpen() || picker) return;
    if (typingIn(e.composedPath()[0] || e.target)) return;
    const combo = MT.comboOf(e);
    if (!combo) return;
    const keys = MT.keysFor(settings, site);
    const action = MT.KEY_ACTIONS.map(([a]) => a).find((a) => keys[a] === combo);
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();  // the site doesn't act on it too
    if (action === "pause") setPaused();
    else if (action === "hide") toggle();
    else openEditor();
  }, true);

  /* --- messages from the popup ---------------------------------------------------------------------- */

  MT.onMessage((msg) => {
    switch (msg.type) {
      case "pick":
        startPicker(msg.mode === "next" ? "next" : "images");
        return Promise.resolve({});
      case "toggle":
        if (!site) return undefined;
        toggle(msg.on);
        return Promise.resolve({ shown });
      case "pause":
        if (!site) return undefined;
        setPaused(msg.on);
        return Promise.resolve({ paused });
      case "edit":
        return Promise.resolve({ opened: openEditor() });
      case "again": {
        // images changed by hand in the editor stay: redoing them would throw that work away
        const its = [...items.values()].filter((it) => it.key && !it.result?.edited);
        const kept = new Set([...items.values()].filter((it) => it.key && it.result?.edited).map((it) => it.key)).size;
        const keys = [...new Set(its.map((it) => it.key))];
        return browser.runtime.sendMessage({ type: "forget", keys }).then(() => {
          for (const it of its) {
            it.layer?.remove();
            it.layer = null;
            it.result = null;
            if (it.state !== "working") it.state = "missing";
          }
          pump();
          return { count: keys.length, kept, paused };
        });
      }
      case "info": {
        const its = [...items.values()].filter((it) => it.key);
        return Promise.resolve({
          site, shown, paused,
          keys: MT.keysFor(settings, site),
          canEdit: !!site && !!imageOnScreen(),
          images: its.length,
          done: its.filter((it) => it.state === "done").length,
          working: its.filter((it) => it.state === "working").length,
          failed: its.filter((it) => it.state === "failed").length,
          next: site?.next ? {
            found: !!pageAddress(nextLink(site.next)),
            started: !!upcoming.url,
            pages: upcoming.pages || 0,
            total: upcoming.total || 0,
            done: upcoming.done || 0,
            failed: upcoming.failed || 0,
            error: upcoming.error || "",
          } : null,
        });
      }
      default:
        return undefined;
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.sites) {
      sites = changes.sites.newValue || [];
      evaluate();
      if (site) pump();  // e.g. a next-page link was just set
    }
    if (changes.settings) {
      const old = settings;
      settings = MT.withDefaults(changes.settings.newValue);
      if (old.boxBg !== settings.boxBg || old.outline !== settings.outline) restyleAll();
    }
  });

  // single-page apps change the address without loading a new page
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      evaluate();
      if (site) scheduleScan();
    }
  }, 1000);

  load().then(evaluate);
})();
