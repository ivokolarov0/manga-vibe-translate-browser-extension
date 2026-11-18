"use strict";

const $ = (id) => document.getElementById(id);
let settings, sites;

async function load() {
  const got = await browser.storage.local.get(["settings", "sites"]);
  settings = MT.withDefaults(got.settings);
  sites = got.sites || [];
  for (const el of document.querySelectorAll("[data-key]")) {
    el.value = settings[el.dataset.key] ?? "";
    el.onchange = saveSettings;
  }
  renderSites();
  countSaved();
}

async function saveSettings() {
  for (const el of document.querySelectorAll("[data-key]")) {
    let v = el.value.trim();
    if (el.type === "number" || el.dataset.key === "boxBg") v = Number(v) || 0;
    if (/Url$/.test(el.dataset.key)) v = MT.cleanUrl(v);
    settings[el.dataset.key] = v;
    if (el.value !== String(v) && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") el.value = v;
  }
  await browser.storage.local.set({ settings });
}

function renderSites() {
  const box = $("sites");
  box.replaceChildren();
  if (!sites.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No sites yet.";
    box.append(p);
  }
  for (const site of sites) {
    const row = $("site-row").content.firstElementChild.cloneNode(true);
    for (const el of row.querySelectorAll("[data-f]")) {
      const f = el.dataset.f;
      if (el.type === "checkbox") el.checked = !!site[f]; else el.value = site[f] ?? "";
      el.onchange = async () => {
        site[f] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) || 0 : el.value.trim();
        await saveSites();
      };
    }
    row.querySelector("[data-delete]").onclick = async () => {
      if (!confirm(`Remove ${site.name || site.match}?`)) return;
      sites = sites.filter((s) => s !== site);
      await saveSites();
      renderSites();
    };
    box.append(row);
  }
}

async function saveSites() {
  await browser.storage.local.set({ sites });
}

async function countSaved() {
  const { count } = await browser.runtime.sendMessage({ type: "savedCount" });
  $("saved").textContent = `${count} image${count === 1 ? "" : "s"} saved now.`;
}

$("add-site").onclick = async () => {
  sites.push(MT.newSite({ name: "New site", match: "" }));
  await saveSites();
  renderSites();
  $("sites").lastElementChild.querySelector('[data-f="match"]').focus();
};

$("test").onclick = async () => {
  await saveSettings();
  const msg = $("test-msg");
  msg.className = "msg";
  msg.textContent = "Testing…";
  const { message, error } = await browser.runtime.sendMessage({ type: "test" });
  const text = message || error;
  msg.textContent = text;
  msg.className = "msg " + (/·.*found$/.test(text) ? "ok" : "bad");
};

$("forget-all").onclick = async () => {
  if (!confirm("Delete every saved translation? Images will be translated again when you see them.")) return;
  await browser.runtime.sendMessage({ type: "forgetAll" });
  countSaved();
};

browser.storage.onChanged.addListener((changes, area) => {
  // the quick controls dragged on a page: not overwritten with the place from when this page opened
  if (area === "local" && changes.settings && settings) settings.dockY = changes.settings.newValue?.dockY ?? settings.dockY;
  if (area === "local" && changes.sites && document.activeElement?.closest?.("#sites") == null) {
    sites = changes.sites.newValue || [];
    renderSites();
  }
});

load();
