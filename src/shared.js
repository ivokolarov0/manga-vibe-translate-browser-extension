/* Shared by the background, the content script, the popup and the settings page. */
"use strict";

/* Chrome: the same API is called `chrome` (with promises, in Manifest V3) */
if (typeof globalThis.browser === "undefined") globalThis.browser = globalThis.chrome;

var MT = (() => {
  const DEFAULTS = {
    visionUrl: "",          // e.g. http://192.168.1.50:7865 (manga_vision_server.py)
    ocrUrl: "",             // optional: OCR somewhere else than the text finder
    llmUrl: "",             // e.g. http://192.168.1.50:11434 (Ollama) or :1234 (LM Studio)
    model: "gemma4",
    target: "English",
    glossary: "",           // 先輩=senpai; 春香=Haruka
    ahead: 4,               // images after the visible ones translated in advance
    threshold: "normal",    // bubble detection: "normal" (the vision server's own) or 0.05..0.95
    boxBg: 100,             // % background of the English boxes
    outline: "off",         // off | thin | thick
    dock: "right",          // the quick controls on the page: right | left | off
    dockY: 50,              // their place, in % of the window's height
  };

  const SITE_DEFAULTS = { name: "", match: "", selector: "img", minSize: 300, enabled: true };

  function withDefaults(s) {
    return { ...DEFAULTS, ...(s || {}) };
  }

  function newSite(fields) {
    return { id: Math.random().toString(36).slice(2, 10), ...SITE_DEFAULTS, ...fields };
  }

  /* "example.com"               -> that site and its subdomains, any page
     "https://example.com/read/*" -> a pattern; * matches anything */
  function matchUrl(pattern, url) {
    pattern = String(pattern || "").trim();
    if (!pattern) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (!/[/*:]/.test(pattern)) {
      const host = pattern.toLowerCase().replace(/^www\./, "");
      const h = u.hostname.toLowerCase();
      return h === host || h.endsWith("." + host);
    }
    if (!pattern.includes("://")) pattern = "*://" + pattern;
    const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$", "i");
    return re.test(url) || re.test(url.replace(/[?#].*$/, ""));
  }

  function escapeRe(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }

  function findSite(sites, url, includeDisabled = false) {
    return (sites || []).find((s) => (includeDisabled || s.enabled) && matchUrl(s.match, url)) || null;
  }

  function cleanUrl(value) {
    value = String(value || "").trim().replace(/\/+$/, "");
    if (value && !/^https?:\/\//i.test(value)) value = "http://" + value;
    return value;
  }

  /* Bytes go between the page and the background as base64: Chrome's messages are JSON, where an
     ArrayBuffer arrives as {} (Firefox could send it as it is). */
  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromBase64(text) {
    const s = atob(text);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  /* A message listener whose handler returns a promise for the answer, or undefined for "not mine".
     Chrome doesn't take a returned promise: the answer goes through sendResponse. */
  function onMessage(handler) {
    browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const answer = handler(msg, sender);
      if (answer === undefined) return false;
      Promise.resolve(answer).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
      return true;
    });
  }

  /* An element, built without HTML strings (text is never read as HTML):
       h("button", { class: "x", "data-a": "close", title: "Close", disabled: true }, child, "text", …)
     Children: elements, strings (as text), arrays of them, or null / false (left out).
     value, checked, selected, disabled and hidden are set as properties, style can be an object, everything
     else is an attribute; on* with a function is an event listener. */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_TAGS = new Set(["svg", "path", "circle", "rect"]);
  const PROPS = new Set(["value", "checked", "selected", "disabled", "hidden"]);

  function h(tag, props, ...children) {
    const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (typeof v === "function" && k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);  // not an attribute: a site's CSP allows it
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
    }
    return el;
  }

  /* An 18 px line icon: shapes are [tag, attributes], e.g. ["path", { d: "M6 6l12 12" }] */
  function icon(...shapes) {
    return h("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    shapes.map(([tag, attrs]) => h(tag, attrs)));
  }

  return { DEFAULTS, SITE_DEFAULTS, withDefaults, newSite, matchUrl, findSite, cleanUrl, toBase64, fromBase64,
    onMessage, h, icon };
})();
