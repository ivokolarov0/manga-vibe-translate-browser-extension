"use strict";

const $ = (id) => document.getElementById(id);
let tab, sites, site;

async function send(msg) {
  return browser.tabs.sendMessage(tab.id, msg);
}

function say(text, ok = true) {
  $("msg").textContent = text;
  $("msg").className = "msg " + (ok ? "ok" : "bad");
}

async function render() {
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const got = await browser.storage.local.get(["sites", "settings"]);
  sites = got.sites || [];
  const settings = MT.withDefaults(got.settings);
  $("setup").hidden = !!(settings.visionUrl && settings.llmUrl);

  let info = null;
  try { info = await send({ type: "info" }); } catch { /* no content script here */ }
  for (const id of ["off", "on", "restricted"]) $(id).hidden = true;
  if (!info) { $("restricted").hidden = false; return; }

  site = MT.findSite(sites, tab.url, true);
  if (!site) {
    const host = new URL(tab.url).hostname;
    if (!$("new-match").value) {  // only once: this runs again every 2 s while the popup is open
      $("new-name").value = host;
      $("new-match").value = host.replace(/^www\./, "");
    }
    $("off").hidden = false;
    return;
  }
  $("on").hidden = false;
  $("site-name").textContent = site.name || site.match;
  $("site-selector").textContent = site.selector;
  $("enabled").checked = site.enabled;
  $("toggle").textContent = info.shown ? "Hide English" : "Show English";
  $("pause").textContent = info.paused ? "Resume" : "Pause";
  $("pause").title = info.paused ? "Translate images on this tab again" : "Translate no more images on this tab";
  $("pause").className = info.paused ? "primary" : "";
  $("edit").disabled = !info.canEdit;
  $("counts").textContent = !site.enabled ? "Switched off"
    : !info.images ? "No matching images on screen yet"
    : `${info.done} of ${info.images} images translated`
      + (info.working ? ` · ${info.working} working` : "") + (info.failed ? ` · ${info.failed} failed` : "")
      + (info.paused ? " · paused on this tab" : "");
  if (!$("keys").textContent) {
    const k = await browser.runtime.sendMessage({ type: "shortcuts" }).catch(() => ({}));
    const parts = [["toggle-pause", "pause"], ["toggle-overlay", "hide"], ["edit-translation", "edit"]]
      .filter(([name]) => k?.[name]).map(([name, what]) => `${k[name]} ${what}`);
    $("keys").textContent = parts.length ? `Keys: ${parts.join(" · ")}` : "";
  }

  const s = await browser.runtime.sendMessage({ type: "status" });
  $("queue").textContent = s.offline || (s.waiting ? `Queue: ${s.waiting}` : "");
}

async function saveSites() {
  await browser.storage.local.set({ sites });
}

async function addSite() {
  const match = $("new-match").value.trim();
  if (!match) return say("Fill in the pages", false);
  sites.push(MT.newSite({
    name: $("new-name").value.trim() || match, match, selector: $("new-selector").value.trim() || "img",
  }));
  await saveSites();
}

$("add").onclick = async () => {
  await addSite();
  say("Added. Translating the images on screen…");
  setTimeout(render, 800);
};

$("pick-new").onclick = async () => {
  await send({ type: "pick" });
  window.close();  // the picker is on the page
};

$("pick").onclick = $("pick-new").onclick;

$("toggle").onclick = async () => {
  const r = await send({ type: "toggle" });
  $("toggle").textContent = r.shown ? "Hide English" : "Show English";
};

$("pause").onclick = async () => {
  const r = await send({ type: "pause" });
  say(r.paused ? "Paused: no more images are translated on this tab" : "Translating again");
  render();
};

$("edit").onclick = async () => {
  const r = await send({ type: "edit" });
  if (r.opened) window.close(); else say("No manga image on screen to edit", false);
};

$("again").onclick = async () => {
  const r = await send({ type: "again" });
  const kept = r.kept ? ` (${r.kept} you edited ${r.kept === 1 ? "was" : "were"} kept)` : "";
  say(`Translating ${r.count} images again${kept}${r.paused ? ". Paused: press Resume to start" : ""}`);
};

$("enabled").onchange = async () => {
  site.enabled = $("enabled").checked;
  await saveSites();
  setTimeout(render, 300);
};

for (const id of ["open-settings", "open-settings-1"]) {
  $(id).onclick = () => { browser.runtime.openOptionsPage(); window.close(); };
}

render().catch((e) => say(String(e.message || e), false));
setInterval(() => render().catch(() => {}), 2000);
