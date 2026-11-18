/* The background: talks to the PC (vision server + LLM) and keeps the saved translations.

   The content script finds the images, cuts each one into pieces the vision server can read well
   (a long webtoon strip becomes several) and sends them here. Two loops work through the queue at
   the same time: one sends images to the vision server, the other sends the text to the LLM.
   Results are saved per image address, so an image is translated only once. */
"use strict";

const DATA_VERSION = 1;
const OFFLINE_RETRY = 15000;  // ms between tries while the PC can't be reached
const IMAGE_TRIES = 2;        // an image that fails this often is given up (until the page is reloaded)
const NOW = 0;                // priority: visible on screen. 1 = ahead

let settings = { ...MT.DEFAULTS };
let offline = "";             // why the PC can't be reached, shown on the page
let last = "";

const jobs = new Map();       // key -> job
const visionQueue = [];
const llmQueue = [];
let order = 0;
let visionBusy = false;
let llmBusy = false;

/* --- saved results ----------------------------------------------------------------------------- */

async function storeKey(key) {
  const bytes = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return "r:" + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSaved(keys) {
  const ids = await Promise.all(keys.map(storeKey));
  const got = await browser.storage.local.get(ids);
  const out = {};
  keys.forEach((k, i) => { if (got[ids[i]]?.v === DATA_VERSION) out[k] = got[ids[i]]; });
  return out;
}

async function save(key, result) {
  await browser.storage.local.set({ [await storeKey(key)]: result });
}

async function forget(keys) {
  await browser.storage.local.remove(await Promise.all(keys.map(storeKey)));
}

async function savedCount() {
  return Object.keys(await browser.storage.local.get(null)).filter((k) => k.startsWith("r:")).length;
}

async function forgetAll() {
  const ids = Object.keys(await browser.storage.local.get(null)).filter((k) => k.startsWith("r:"));
  await browser.storage.local.remove(ids);
  return ids.length;
}

/* --- the queue --------------------------------------------------------------------------------- */

function enqueue(msg) {
  let job = jobs.get(msg.key);
  if (job) {
    job.priority = Math.min(job.priority, msg.priority);
    return job.promise;
  }
  job = { ...msg, order: order++, tries: 0 };
  job.promise = new Promise((resolve) => (job.resolve = resolve));
  jobs.set(job.key, job);
  stayAwake();
  visionQueue.push(job);
  pumpVision();
  return job.promise;
}

function bump(key) {
  const job = jobs.get(key);
  if (job && job.priority > NOW) {
    job.priority = NOW;
    job.order = -order++;  // the newest image on screen goes first
  }
}

function takeNext() {
  visionQueue.sort((a, b) => a.priority - b.priority || a.order - b.order);
  return visionQueue.shift();
}

function finish(job, answer) {
  jobs.delete(job.key);
  job.tiles = null;
  job.resolve(answer);
}

/* Translation paused on a tab: its images that haven't started yet leave the queue. (An image the
   vision server or the LLM is already working on is finished and saved.) */
function cancel(keys) {
  let n = 0;
  for (const key of keys) {
    const job = jobs.get(key);
    if (!job) continue;
    let i = visionQueue.indexOf(job);
    if (i >= 0) visionQueue.splice(i, 1);
    else if ((i = llmQueue.indexOf(job)) > 0) llmQueue.splice(i, 1);  // [0] is being translated
    else continue;
    finish(job, { cancelled: true });
    n++;
  }
  return n;
}

function failed(job, error) {
  job.tries += 1;
  console.warn("Manga Translate: image failed", job.key, error);
  if (job.tries >= IMAGE_TRIES) finish(job, { error: String(error?.message || error).slice(0, 200) });
  else visionQueue.push(job);
}

function isOffline(e) {
  return e instanceof TypeError;  // fetch: the server can't be reached at all
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pumpVision() {
  if (visionBusy) return;
  visionBusy = true;
  try {
    while (visionQueue.length) {
      if (llmQueue.length >= 2) {  // the LLM is behind: don't read more pages than it can take
        await sleep(200);
        continue;
      }
      const job = takeNext();
      try {
        job.page = await readText(job);
        offline = "";
        llmQueue.push(job);
        pumpLlm();
      } catch (e) {
        if (isOffline(e)) {
          wentOffline("vision server", settings.visionUrl, e);
          visionQueue.push(job);
          await sleep(OFFLINE_RETRY);
        } else {
          failed(job, e);
        }
      }
    }
  } finally {
    visionBusy = false;
  }
}

async function pumpLlm() {
  if (llmBusy) return;
  llmBusy = true;
  try {
    while (llmQueue.length) {
      const job = llmQueue[0];
      try {
        let result = await translatePage(job);
        llmQueue.shift();
        offline = "";
        const now = (await getSaved([job.key]))[job.key];
        if (now?.edited) result = now;  // saved in the editor meanwhile: that wins
        else await save(job.key, result);
        last = `last: ${job.key.split("/").pop().slice(0, 60)}`;
        finish(job, { result });
      } catch (e) {
        if (isOffline(e)) {
          wentOffline("LLM server", settings.llmUrl, e);
          await sleep(OFFLINE_RETRY);
        } else {
          llmQueue.shift();
          failed(job, e);
          pumpVision();
        }
      }
    }
  } finally {
    llmBusy = false;
  }
}

function wentOffline(what, url, error) {
  const msg = `Can't reach the ${what} (${url || "no address set"})`;
  if (offline !== msg) console.warn("Manga Translate:", msg, error);
  offline = msg;
}

/* --- talking to the PC ------------------------------------------------------------------------- */

function llmBase() {
  const base = MT.cleanUrl(settings.llmUrl);
  return base.endsWith("/v1") ? base : base + "/v1";
}

/* Chrome stops a background that has been idle for 30 s, even while it waits for a long answer from the
   PC (an LLM can take minutes). While there's work, a small API call every 20 s keeps it running.
   (Firefox keeps its background anyway; there this costs nothing.) */
let working = 0, keepAlive = 0;

function stayAwake() {
  if (keepAlive) return;
  keepAlive = setInterval(() => {
    if (!working && !jobs.size) { clearInterval(keepAlive); keepAlive = 0; return; }
    browser.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
}

async function busy(fn) {
  working++;
  stayAwake();
  try { return await fn(); } finally { working--; }
}

function call(url, options = {}, timeout = 120000) {
  return busy(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal, credentials: "omit" });
      if (!r.ok) {
        const body = (await r.text().catch(() => "")).slice(0, 200);
        const hint = r.status === 403
          ? ` (the server refused the browser. For Ollama: set OLLAMA_ORIGINS=${location.protocol}//* and restart it)`
          : "";
        throw new Error(`HTTP ${r.status} from ${new URL(url).host}${hint} ${body}`.trim());
      }
      return await r.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error(`${new URL(url).host} took too long to answer`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  });
}

/* The Bubble detection setting as ?threshold=; nothing for Normal (the server decides).
   Vision servers older than 1.1.0 ignore it. */
function detectionQuery() {
  const t = parseFloat(settings.threshold);
  return Number.isFinite(t) ? `?threshold=${Math.min(Math.max(t, 0.05), 0.95)}` : "";
}

/* One image piece (a JPEG, as base64) -> [{box: [x1, y1, x2, y2, score], text}] in the piece's pixels. */
async function readPiece(data) {
  const vision = MT.cleanUrl(settings.visionUrl);
  const ocr = MT.cleanUrl(settings.ocrUrl) || vision;
  if (!vision) throw new Error("Set the vision server's address in the extension's settings");
  const headers = { "Content-Type": "image/jpeg" };
  const q = detectionQuery();
  const body = MT.fromBase64(data);
  if (ocr === vision) return (await call(vision + "/page" + q, { method: "POST", headers, body })).blocks;
  const found = await call(vision + "/detect" + q, { method: "POST", headers, body });
  if (!found.boxes.length) return [];
  const { texts } = await call(ocr + "/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: data, boxes: found.boxes }),
  });
  return found.boxes.map((box, i) => ({ box, text: texts[i] || "" }));
}

/* All pieces of an image -> {w, h, blocks} in the image's own pixels. A piece overlaps its
   neighbours, so a bubble on the cut is whole in one of them: each piece keeps only the bubbles whose
   middle lies in its own part. */
async function readText(job) {
  const blocks = [];
  for (const t of job.tiles) {
    for (const b of await readPiece(t.data)) {
      const [x1, y1, x2, y2] = b.box;
      const mid = (y1 + y2) / 2;
      if (mid < (t.ownTop ?? -Infinity) || mid >= (t.ownBottom ?? Infinity)) continue;  // null: no limit
      const box = [x1 / t.scale, (y1 + t.y) / t.scale, x2 / t.scale, (y2 + t.y) / t.scale]
        .map((v, i) => Math.round(Math.min(Math.max(v, 0), i % 2 ? job.h : job.w) * 10) / 10);
      blocks.push({ box, text: b.text });
    }
  }
  return { w: job.w, h: job.h, blocks };
}

async function chat(prompt) {
  const answer = await call(llmBase() + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model || "gemma4",
      messages: [{ role: "user", content: prompt }],
      stream: false,
      reasoning_effort: "none",  // thinking models: answer straight away
    }),
  }, 180000);
  return answer.choices?.[0]?.message?.content || "";
}

function glossaryLines() {
  const out = [];
  for (const item of String(settings.glossary || "").split(";")) {
    const i = item.indexOf("=");
    if (i < 0) continue;
    const src = item.slice(0, i).trim(), dst = item.slice(i + 1).trim();
    if (src && dst) out.push(`${src} translates to ${dst}`);
  }
  return out;
}

/* All bubbles of an image in one request, each wrapped in <bN></bN> (Hy-MT2's "keep the delimiters"
   prompt), with the previous image as background. Tried twice; then one request per bubble, which
   reads worse because the model loses the context. Same prompt as the MangaVibe plugin. */
async function translateLines(lines, previous) {
  const target = settings.target || "English";
  const terms = glossaryLines();
  let prompt = "";
  if (terms.length) prompt += "Reference the following translations:\n" + terms.join("\n") + "\n\n";
  if (previous.length) prompt += "[Background Information]\n" + previous.join("\n") + "\n\n";
  prompt += `Please accurately translate the following text into ${target}`
    + (previous.length ? ", taking the provided background information into consideration" : "")
    + ".\nYou must retain the exact same number of delimiters in the translation.\n"
    + "Strictly do not omit, escape, or translate these symbols, and pay close attention to "
    + "their placement.\n\n" + (previous.length ? "[Source Text]\n" : "")
    + lines.map((t, i) => `<b${i + 1}>${t}</b${i + 1}>`).join("");
  for (let n = 0; n < 2; n++) {
    const got = {};
    for (const m of (await chat(prompt)).matchAll(/<b(\d+)>([\s\S]*?)<\/b\1>/g)) got[m[1]] = m[2];
    if (lines.every((_, i) => i + 1 in got) && Object.keys(got).length === lines.length) {
      return lines.map((_, i) => got[i + 1].trim());
    }
  }
  const single = `Translate the following text into ${target}.\nNote that you should only output the `
    + "translated result without any additional explanation:\n\n";
  const out = [];
  for (const t of lines) out.push((await chat(single + t)).trim());
  return out;
}

async function translatePage(job) {
  const blocks = job.page.blocks.filter((b) => b.text.trim());
  let previous = [];
  if (job.prevKey) {
    const before = (await getSaved([job.prevKey]))[job.prevKey];
    previous = (before?.blocks || []).map((b) => b.src).filter(Boolean).slice(-8);  // not the editor's own boxes
  }
  const english = blocks.length ? await translateLines(blocks.map((b) => b.text), previous) : [];
  return {
    v: DATA_VERSION, w: job.w, h: job.h, model: settings.model, at: Date.now(),
    blocks: blocks.map((b, i) => ({ box: b.box, src: b.text, text: english[i] })),
  };
}

/* --- the editor's questions to the PC ----------------------------------------------------------- */

/* Runs a call to one of the PC's servers; when it can't be reached, says so in words. */
async function asked(what, url, fn) {
  try {
    return await fn();
  } catch (e) {
    if (isOffline(e)) throw new Error(`Can't reach the ${what} (${url || "no address set"})`);
    throw e;
  }
}

/* The Japanese in one part of an image: `data` is that part as a JPEG, `box` where to read in it. */
async function readArea(data, box) {
  const ocr = MT.cleanUrl(settings.ocrUrl) || MT.cleanUrl(settings.visionUrl);
  if (!ocr) throw new Error("Set the vision server's address in the extension's settings");
  const { texts } = await asked("vision server", ocr, () => call(ocr + "/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: data, boxes: [box] }),
  }));
  return String(texts?.[0] || "").trim();
}

/* One text translated on its own, with the image's other texts as background. */
async function translateOne(src, around) {
  src = String(src || "").trim().slice(0, 2000);
  if (!/[\p{L}\p{N}]/u.test(src)) return src;  // only "…" or "!?": stays as it is
  if (!settings.llmUrl) throw new Error("Set the LLM server's address in the extension's settings");
  const background = (around || []).filter((t) => typeof t === "string" && t.trim()).slice(0, 12);
  return (await asked("LLM server", llmBase(), () => translateLines([src], background)))[0];
}

/* How Japanese texts are said, in Latin letters: the vision server (1.2.0 or newer) works it out. */
async function romaji(texts) {
  const vision = MT.cleanUrl(settings.visionUrl);
  if (!vision) throw new Error("Set the vision server's address in the extension's settings");
  return asked("vision server", vision, () => busy(async () => {
    const r = await fetch(vision + "/romaji", {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: texts.slice(0, 300).map((t) => String(t || "").slice(0, 2000)) }),
    });
    if (r.status === 404) {
      throw new Error("Romaji needs the vision server 1.2.0 or newer: download the plugin's ZIP again and restart it");
    }
    if (r.status === 501) throw new Error("The vision server can't make romaji on that computer (see its window)");
    if (!r.ok) throw new Error(`HTTP ${r.status} from the vision server`);
    return (await r.json()).romaji;
  }));
}


async function fetchImage(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for the image`);
  return { data: MT.toBase64(await r.arrayBuffer()), type: r.headers.get("Content-Type") || "" };
}

async function testConnection() {
  const vision = MT.cleanUrl(settings.visionUrl);
  if (!vision) return "Set the vision server's address first";
  let found;
  try {
    const info = await call(vision + "/health", {}, 5000);
    found = `Vision server OK (${info.device || "?"})`;
  } catch (e) {
    return `Can't reach the vision server at ${vision}: ${e.message}. Is it running, and allowed through the firewall?`;
  }
  if (!settings.llmUrl) return found + ". Now set the LLM server's address";
  let names;
  try {
    names = ((await call(llmBase() + "/models", {}, 5000)).data || []).map((m) => m.id);
  } catch (e) {
    return `${found}, but can't reach the LLM server at ${llmBase()}: ${e.message}. `
      + "For Ollama on another PC, set OLLAMA_HOST=0.0.0.0 there and restart it.";
  }
  const model = settings.model || "gemma4";
  if (!names.includes(model) && !names.includes(model + ":latest")) {
    return `${found}. LLM server OK, but it has no model called '${model}'. It has: ${names.slice(0, 8).join(", ")}`;
  }
  return `${found} · LLM server OK, model '${model}' found`;
}

/* --- Ollama refuses requests that come from a browser extension (it checks the Origin header).
   Our own requests to the servers in the settings go without that header. ------------------------- */

let originFix = null;

function matchPattern(url) {
  try {
    const u = new URL(MT.cleanUrl(url));
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

function serverHosts() {
  const hosts = [];
  for (const url of [settings.visionUrl, settings.ocrUrl, settings.llmUrl]) {
    try { if (url) hosts.push(new URL(MT.cleanUrl(url)).hostname); } catch { /* not an address */ }
  }
  return [...new Set(hosts)];
}

/* Chrome (Manifest V3) can't change requests from a listener: a rule does it instead, for the
   requests that don't come from a tab (tabIds -1: the extension's own), to the servers' hosts. */
async function updateOriginRule() {
  const RULE = 1;
  // the hosts are usually IP addresses (192.168.1.50): matched in the address, not as domains
  const hosts = serverHosts().map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE],
      addRules: hosts.length ? [{
        id: RULE,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: {
          regexFilter: `^https?://(${hosts.join("|")})(:[0-9]+)?/`,
          tabIds: [-1],
          resourceTypes: ["xmlhttprequest", "other"],
        },
      }] : [],
    });
  } catch (e) {
    console.warn("Manga Translate: couldn't set up the Origin fix", e);
  }
}

function updateOriginFix() {
  if (!browser.webRequest?.onBeforeSendHeaders) return updateOriginRule();  // Chrome
  if (originFix) browser.webRequest.onBeforeSendHeaders.removeListener(originFix);
  originFix = null;
  const urls = [...new Set([settings.visionUrl, settings.ocrUrl, settings.llmUrl]
    .filter(Boolean).map(matchPattern).filter(Boolean))];
  if (!urls.length) return;
  originFix = (d) => {
    if (d.tabId !== -1) return {};  // only the extension's own requests, never a web page's
    return { requestHeaders: d.requestHeaders.filter((h) => h.name.toLowerCase() !== "origin") };
  };
  try {
    browser.webRequest.onBeforeSendHeaders.addListener(originFix, { urls }, ["blocking", "requestHeaders"]);
  } catch (e) {
    console.warn("Manga Translate: couldn't set up the Origin fix", e);
    originFix = null;
  }
}

/* --- wiring ------------------------------------------------------------------------------------ */

async function start() {
  const got = await browser.storage.local.get("settings");
  settings = MT.withDefaults(got.settings);
  updateOriginFix();
}

const ready = start();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    settings = MT.withDefaults(changes.settings.newValue);
    updateOriginFix();
  }
});

MT.onMessage((msg) => {
  const answer = async () => {
    await ready;
    switch (msg.type) {
      case "lookup": return { results: await getSaved(msg.keys) };
      case "translate": return enqueue(msg);
      case "bump": bump(msg.key); return {};
      case "forget": await forget(msg.keys); return {};
      case "cancel": return { count: cancel(msg.keys) };
      case "saveResult": await save(msg.key, msg.result); return {};
      case "readArea": return { src: await readArea(msg.data, msg.box) };
      case "translateOne": return { text: await translateOne(msg.src, msg.background) };
      case "romaji": return { romaji: await romaji(msg.texts || []) };
      case "status": return { waiting: jobs.size, offline, last };
      case "fetchImage": return fetchImage(msg.url);
      case "test": return { message: await testConnection() };
      case "savedCount": return { count: await savedCount() };
      case "forgetAll": return { count: await forgetAll() };
      default: return undefined;
    }
  };
  return answer().catch((e) => ({ error: String(e?.message || e) }));
});
