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
  renderKeys();
  renderSites();
  countSaved();
}

/* --- keys --------------------------------------------------------------------------------------- */

const { h } = MT;

/* A key box: click it and press the key (or a combination); ✕ or Backspace removes it, Esc leaves it
   as it was. set(combo) is called with the new key ("" for none). */
function keyBox(value, empty, set) {
  let current = value;
  const input = h("input", { readonly: true, value, placeholder: empty, "aria-label": "Press a key" });
  input.addEventListener("focus", () => { input.value = ""; input.placeholder = "Press a key…"; });
  input.addEventListener("blur", () => { input.placeholder = empty; input.value = current; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return;  // moving on with the keyboard
    e.preventDefault();
    if (e.key === "Escape") return input.blur();
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    const combo = plain && (e.key === "Backspace" || e.key === "Delete") ? "" : MT.comboOf(e);
    if (combo === "" && !(plain && (e.key === "Backspace" || e.key === "Delete"))) return;  // a modifier alone: wait
    current = combo;
    input.blur();
    set(combo);
  });
  const clear = h("button", { type: "button", title: "No key", "aria-label": "Remove the key" }, "✕");
  clear.addEventListener("click", () => { current = ""; input.value = ""; set(""); });
  return h("div", { class: "key" }, input, clear);
}

/* the same key for two things: only the first would work */
function clashes(keys) {
  const seen = {}, out = [];
  for (const [action, label] of MT.KEY_ACTIONS) {
    const k = keys[action];
    if (!k) continue;
    if (seen[k]) out.push(`${k} is set for both ${seen[k]} and ${label}`);
    else seen[k] = label;
  }
  return out;
}

async function saveKeys() {
  await browser.storage.local.set({ settings });
}

/* Settings → Keys: the general keys */
function renderKeys() {
  const box = $("keys");
  box.replaceChildren(...MT.KEY_ACTIONS.map(([action, label, what]) => h("label", null,
    h("span", null, label),
    keyBox(settings.keys?.[action] || "", "No key", async (combo) => {
      const keys = { ...settings.keys };
      if (combo) keys[action] = combo; else delete keys[action];
      settings.keys = keys;
      await saveKeys();
      renderKeys();
      renderSites();  // their "As in Keys" choice shows the general key
    }),
    h("small", null, what))));
  const warn = clashes(settings.keys || {});
  if (warn.length) box.append(h("p", { class: "warn" }, warn.join(". ")));
}

/* A site's own keys, under its row: as the general one, off there, or a key of its own */
const openKeys = new Set();  // sites whose Keys are open: kept open when the list is drawn again

function siteKeys(site, row) {
  const details = row.querySelector(".site-keys");
  const box = row.querySelector("[data-keys]");
  const summary = row.querySelector("[data-keys-summary]");
  details.open = openKeys.has(site.id);
  details.addEventListener("toggle", () => { if (details.open) openKeys.add(site.id); else openKeys.delete(site.id); });

  const setOwn = async (action, value) => {  // value: undefined = as the general one, "none" = off, or a key
    const keys = { ...site.keys };
    if (value) keys[action] = value; else delete keys[action];
    site.keys = keys;
    await saveSites();
    draw();
  };

  function draw() {
    const now = MT.keysFor(settings, site);
    const parts = MT.KEY_ACTIONS.filter(([a]) => now[a]).map(([a, label]) => `${label} ${now[a]}`);
    summary.textContent = `Keys here: ${parts.join(" · ") || "none"}${Object.keys(site.keys || {}).length ? " (its own)" : ""}`;
    box.replaceChildren(...MT.KEY_ACTIONS.map(([action, label]) => {
      const own = site.keys?.[action];
      const mode = own === "none" ? "off" : own ? "own" : "general";
      const key = keyBox(mode === "own" ? own : "", "Press its key", (combo) => setOwn(action, combo || undefined));
      key.hidden = mode !== "own";
      const select = h("select", { "aria-label": `${label} on this site` },
        h("option", { value: "general", selected: mode === "general" }, `As in Keys (${settings.keys?.[action] || "none"})`),
        h("option", { value: "off", selected: mode === "off" }, "Off on this site"),
        h("option", { value: "own", selected: mode === "own" }, "Its own key"));
      select.addEventListener("change", () => {
        if (select.value === "general") setOwn(action, undefined);
        else if (select.value === "off") setOwn(action, "none");
        else { key.hidden = false; key.querySelector("input").focus(); }  // saved once a key is pressed
      });
      return h("label", null, h("span", null, label), h("div", { class: "key" }, select, key));
    }));
    const warn = clashes(now);
    if (warn.length) box.append(h("p", { class: "warn" }, warn.join(". ")));
  }
  draw();
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
    siteKeys(site, row);
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
  if (area === "local" && changes.sites && document.activeElement?.closest?.("#sites") == null) {
    sites = changes.sites.newValue || [];
    renderSites();
  }
});

load();
