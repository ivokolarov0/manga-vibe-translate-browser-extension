// Sets the version in both manifests (only the number is changed in the files).
//
//   node version.mjs patch    0.3.1 -> 0.3.2  (also: minor, major)
//   node version.mjs 0.4.0    that version
//
// Then, for a release on GitHub (.github/workflows/release.yml signs and publishes it):
//   git commit -am "Version 0.3.2" && git tag v0.3.2 && git push origin main v0.3.2

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const MANIFESTS = ["manifest.json", "manifest.chrome.json"];

export function currentVersion() {
  return JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
}

/* spec: "patch", "minor", "major" or a version like 0.4.0 -> { from, to } */
export function setVersion(spec) {
  const from = currentVersion();
  let to = spec;
  if (["major", "minor", "patch"].includes(spec)) {
    const [a, b, c] = from.split(".").map(Number);
    to = spec === "major" ? `${a + 1}.0.0` : spec === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${(c || 0) + 1}`;
  }
  if (!/^\d+(\.\d+){0,3}$/.test(to || "")) throw new Error(`"${spec}" isn't a version: use patch, minor, major or a number like 0.4.0`);
  for (const file of MANIFESTS) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, "utf8").replace(/("version":\s*")[^"]*(")/, `$1${to}$2`));
  }
  return { from, to };
}

// run as `node version.mjs …` (not when sign.mjs imports it)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const spec = process.argv[2];
  if (!spec) {
    console.log(`Version ${currentVersion()}. To change it: node version.mjs patch | minor | major | 0.4.0`);
    process.exit(0);
  }
  try {
    const { from, to } = setVersion(spec);
    console.log(`version ${from} -> ${to}\n\nFor a release on GitHub:\n`
      + `  git commit -am "Version ${to}" && git tag v${to} && git push origin main v${to}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
