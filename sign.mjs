// Signs the Firefox version with Mozilla, so Firefox keeps it installed. "Unlisted": it isn't
// published on addons.mozilla.org; only you can download it. The signed .xpi lands in web-ext-artifacts/.
//
//   node sign.mjs           builds dist/firefox and signs it
//   node sign.mjs --bump    first raises the version (0.3.1 -> 0.3.2): Mozilla signs each version once
//
// The key: AMO_API_KEY and AMO_API_SECRET, from the environment (GitHub's secrets, in the release
// workflow) or from .env (in .gitignore, never committed; .env.example shows what goes in it).
// Needs Node.js 20.12 or newer.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";
import { setVersion } from "./version.mjs";

const root = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* --- the key: the environment, or .env (which doesn't override what the environment has) ----------- */

const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const key = (process.env.AMO_API_KEY || "").trim();
const secret = (process.env.AMO_API_SECRET || "").trim();
if (!key || !secret || key === "user:12345678:123") {
  fail("No AMO key. Copy .env.example to .env and fill in AMO_API_KEY (the JWT issuer, like "
    + "user:12345678:123) and AMO_API_SECRET (the JWT secret); on GitHub they are repository secrets "
    + "of the same names.\n  https://addons.mozilla.org/developers/addon/api/key/");
}

/* --- --bump: the next version first (Mozilla signs each version once) ------------------------------ */

if (process.argv.includes("--bump")) {
  const { from, to } = setVersion("patch");
  console.log(`version ${from} -> ${to}`);
}

/* --- build and sign -------------------------------------------------------------------------------- */

const version = build(["firefox"]);
// how long to wait for Mozilla to sign it (ms): 0 = only upload, and download it from the
// Developer Hub later. Default: an hour.
const wait = (process.env.AMO_APPROVAL_TIMEOUT || "3600000").trim();
console.log(`Signing ${version} (unlisted)…`);

// the key goes to web-ext in its environment, not on the command line
const result = spawnSync("npx", ["--yes", "web-ext@8", "sign", "--channel=unlisted",
  "--source-dir", "dist/firefox", "--artifacts-dir", "web-ext-artifacts", `--approval-timeout=${wait}`], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",  // npx is npx.cmd on Windows
  env: { ...process.env, WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret },
});

if (result.status !== 0) {
  fail(`\nSigning didn't finish. If it says the version already exists, run: node sign.mjs --bump\n`
    + "If it timed out, Mozilla goes on with it: download the .xpi from "
    + "https://addons.mozilla.org/developers/addons → Manga Translate → Manage Status & Versions.");
}
console.log(`\nSigned: the .xpi for ${version} is in web-ext-artifacts/. Open it in Firefox to install it.`);
