// Makes the folders to load or publish, one per browser:
//   dist/firefox  manifest.json (Manifest V2)
//   dist/chrome   manifest.chrome.json (Manifest V3), as manifest.json
// The code is the same; Firefox can also load this folder as it is (manifest.json is Firefox's).
//
//   node build.mjs           both
//   node build.mjs chrome    one of them
//
// Chrome's version is taken from manifest.json, so there is one version number to change.
// sign.mjs uses build() too.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

/* Builds dist/<name> for each browser asked (all without names); returns the version. */
export function build(names = []) {
  const firefox = read("manifest.json");  // read now: sign.mjs may just have raised the version
  const chrome = { ...read("manifest.chrome.json"), version: firefox.version };
  const targets = {
    // Firefox's background page loads the scripts itself; sw.js is Chrome's
    firefox: { manifest: firefox, skip: (path) => path.endsWith("sw.js") },
    // Chrome can't show SVG icons
    chrome: { manifest: chrome, skip: (path) => path.endsWith(".svg") },
  };
  for (const name of names.length ? names : Object.keys(targets)) {
    const target = targets[name];
    if (!target) throw new Error(`Unknown browser "${name}": use ${Object.keys(targets).join(" or ")}`);
    const out = join(root, "dist", name);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const part of ["src", "icons", "LICENSE"]) {
      cpSync(join(root, part), join(out, part), { recursive: true, filter: (path) => !target.skip(path) });
    }
    writeFileSync(join(out, "manifest.json"), JSON.stringify(target.manifest, null, 2) + "\n");
    console.log(`dist/${name}: version ${target.manifest.version}`);
  }
  return firefox.version;
}

// run as `node build.mjs …` (not when sign.mjs imports it)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    build(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
