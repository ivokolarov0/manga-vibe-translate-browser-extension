# Manga Translate for Firefox and Chrome

Read Japanese manga in English on any website, in Firefox, Chrome, Edge or another Chromium browser. You tell the extension **which site** and **which
images** to translate, and English text appears on top of the Japanese speech bubbles, just like the
[Manga Translate plugin](https://github.com/ivokolarov0/manga-vibe-ext-translate) does in MangaVibe.

**How it works, in one sentence:** the browser sends each manga image to your **computer**, your computer
finds the text, reads it and translates it, and sends the English back. Each image is translated only
once and then saved in the browser.

**Free and private.** It uses the same programs on your own computer as the MangaVibe plugin: no
account, no AI service on the internet.

## What you need

The two programs from the MangaVibe plugin, on a computer with a graphics card:

- **Ollama** with a translation model (`gemma4` or `manga-translate`)
- **The text reader** (`manga_vision_server.py`)

If you already use the MangaVibe plugin, you have both. If not, do **steps 1–6** of the
[plugin's README](https://github.com/ivokolarov0/manga-vibe-ext-translate#part-1-on-your-computer).
The browser can run on that same computer or on another one in your home network.

## Install the extension

### Firefox

**To try it (until Firefox closes):**

1. Download this folder (green **Code** button → **Download ZIP**, then unzip it).
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and choose `manifest.json` in the folder.

**To keep it:** Firefox only keeps add-ons that Mozilla has signed. Signing is free and stays
private ("unlisted": it isn't published, only you can download it). It needs
[Node.js](https://nodejs.org/) 20.12 or newer:

1. Get an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/).
2. Copy `.env.example` to `.env` and fill in the **JWT issuer** (`AMO_API_KEY`) and the
   **JWT secret** (`AMO_API_SECRET`). `.env` is in `.gitignore`, so the key is never committed.
3. Run `node sign.mjs`. It builds `dist/firefox`, signs it, and puts the `.xpi` in
   `web-ext-artifacts/`. Open that file in Firefox to install it.

Mozilla signs each version only once: for the next one, run `node sign.mjs --bump`, which raises the
version first (0.3.1 → 0.3.2). Or let GitHub do it: see [Releases](#releases). Signing usually takes a few minutes; the script waits up to an hour.
If it stops waiting, Mozilla carries on, and the `.xpi` can be downloaded later from the
[Developer Hub](https://addons.mozilla.org/developers/addons) → **Manage Status & Versions**.

(Firefox Developer Edition or Nightly can also install it unsigned after setting
`xpinstall.signatures.required` to `false` in `about:config`.)

### Chrome, Edge and other Chromium browsers

Chrome needs its own version of the extension (Manifest V3); the code is the same. Making it needs
[Node.js](https://nodejs.org/):

1. Download this folder (green **Code** button → **Download ZIP**, then unzip it).
2. In the folder, run `node build.mjs chrome`. It makes the folder `dist/chrome`.
3. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
4. Click **Load unpacked** and choose the folder `dist/chrome`.

It stays installed. After you download a newer version, run step 2 again and click the reload arrow
on the extension's card.

In Chrome, the extension's settings are under its card → **Details** → **Extension options**.
Everything else works as described below.

## Set it up

1. Click the extension's button (the speech bubble in the toolbar) → **Settings**.
2. Fill in **Your PC**, with your own numbers:

   | Box | What to type | Example |
   |---|---|---|
   | **Vision server** | the address the text reader prints | `http://192.168.1.50:7865` |
   | **LLM server** | the same numbers, with `:11434` at the end | `http://192.168.1.50:11434` |
   | **Model** | the model you downloaded | `gemma4` or `manga-translate` |

   Everything on this one computer? Use `http://localhost:7865` and `http://localhost:11434`.
3. Click **Test connection**. It should say *Vision server OK · LLM server OK, model found*.

## Add a site

1. Open a chapter on the site you read.
2. Click the extension's button. It says *Not on this site yet*.
3. Click **Pick on the page**, then click one of the manga pages.
4. The extension outlines every image it would translate. If that's right, click **Save for this site**.
   If it outlines too much or too little, change the selector in the box first (you see the result
   at once).

The English appears after a second or two ("Translating…" shows at the bottom right). The images
after the ones on screen are translated in the background, so scrolling doesn't wait.

You can also add and change sites by hand in **Settings → Sites**. Each site has:

| Field | What it means | Example |
|---|---|---|
| **Pages** | where to work: a domain (every page on it and its subdomains), or a pattern where `*` matches anything | `example.com` or `https://example.com/chapter/*` |
| **Images** | which images: a CSS selector. A selector for a container means all the images inside it | `#reader img` or `.page-container` |
| **Min size** | smaller images (icons, ads, thumbnails) are skipped, in pixels | `300` |
| **On** | switch the site off without deleting it | |
| **Keys** | the [keys](#keys) on this site: as in **Settings → Keys**, off, or keys of its own | |

## Reading

### Pause, Hide and Edit

Three things you can do on a site's pages, with [keys](#keys) of your own or from the extension's
button:

| | What it does |
|---|---|
| **Pause** | Translates no more images on this tab: images waiting in the queue are dropped, and the chapters you open next in this tab stay paused too. Press it again to go on. Translations saved earlier still show. |
| **Hide** | Hides the English on this tab (press again to show it). |
| **Edit** | Opens [the editor](#fix-an-image-yourself-the-editor) for the image in the middle of the window. |

**For a manga the site already has in English:** press **Pause**, and **Hide** if it had already
translated some pages. Both stay on for that tab until you switch them back, and other tabs aren't
affected. A short message at the bottom right says what you just switched.

### Keys

No keys are set at first, so nothing clashes with the browser or a site until you choose. In **Settings → Keys**, click a box and press the key you want
(one key like `P`, or a combination like `Shift+P`); **✕** removes it.

- They only work on the pages of your sites, and not while you type in a text field.
- Letters are the key's place on the keyboard, so they also work with another keyboard layout.
- A key that does nothing is taken by the browser itself: pick another.
- **A site uses the same key itself?** Under **Settings → Sites**, open that site's **Keys**. For each
  one choose **As in Keys** (the general key), **Off on this site**, or **Its own key**.

### Fix an image yourself: the editor

A translation is wrong, a bubble was missed, or a box sits badly? Press **Edit** (or [its key](#keys))
while the image is on screen. It opens in the editor, the same one as in the MangaVibe plugin: the
image with its boxes on one side, the texts on the other.

- **Change the text:** every box has a card with the **Japanese (as read)** and the **Translation**.
  Type in either. **Translate** translates the Japanese again (after you fixed a misread letter, for
  example); **Read again** reads the Japanese from the image again. Enter makes a new line.
- **Can't read Japanese?** Under each Japanese text is its **romaji** (今日はいい天気だね →
  *kyō wa ii tenki da ne*). It needs vision server **1.2.0** or newer (from the plugin's ZIP).
- **Move and resize:** drag a box, or drag its handles. The arrow keys move the selected box a little
  (Shift: more).
- **Change the look:** select a box: **Size** (Auto fits the text to the box), bold, italic, capitals,
  font, alignment, and the colour of the text and of the box. **Use this look for all boxes** copies it.
- **Text that wasn't found:** **Scan text**, then drag a frame around the Japanese (or hold **Ctrl**
  and drag). It is read and translated, and becomes a new box.
- **A box of your own:** **+ Text box**, then drag where it goes (or **Shift** + click).
- **Hide or delete:** **Hide** keeps a box but doesn't show it on the page; **Delete** removes it.
- **Other images:** the arrows under the image (**Shift + ←/→**). Going to another image saves the
  one you leave.
- **Undo** and **Save** (Ctrl+Z, Ctrl+S). **Esc** leaves a field or a tool, then closes the editor;
  with unsaved changes it asks first. **?** lists all the shortcuts.
- **Start over:** **Translate this image again** throws away its boxes, your changes too.

Images you edited are yours: the extension's button → **Translate again** leaves them as they are
and redoes only the others.

### More

- **Show or hide the English:** [its key](#keys), or the extension's button →
  **Hide English**. Handy to see the art under a box.
- **See the Japanese:** in **Settings → Look**, pick a see-through **Box background**, and turn on
  the **White outline** to keep the English readable over the art.
- **A wrong translation:** fix it in [the editor](#fix-an-image-yourself-the-editor), or the
  extension's button → **Translate again** (all images on the page you didn't edit). To try another
  model, change the **Model** first.
- **Missed bubbles:** in **Settings → Translation**, set **Bubble detection** to **More**, then the
  extension's button → **Translate again**. The choices:

  | Choice | Threshold | What it does |
  |---|---|---|
  | **Normal** | the vision server's own (0.3, or what it was started with `--threshold`) | as before |
  | **More** | 0.2 | also finds faint or odd-shaped bubbles |
  | **Most** | 0.1 | finds even more, along with more wrong boxes |
  | **Fewer** | 0.45 | only bubbles the text finder is sure about |

  Needs vision server 1.1.0 or newer; older ones ignore the setting.
- **Names:** add them under **Settings → Names and terms**, like `春香=Haruka; 先輩=senpai`.
- **Long strips (webtoons):** a tall image is cut into overlapping pieces for the text reader, so
  small text at the bottom of a long strip is still found.
- **Computer switched off?** Already translated images still show. New ones wait, and the page says
  *Can't reach the vision server*. When the computer is back it carries on by itself.

## Something doesn't work

| What you see | What to do |
|---|---|
| *Can't reach the vision server* | Is the text reader's window open? In the browser, open `http://<computer address>:7865/health`. If nothing loads: the firewall (plugin README step 6.4), or the computer's address changed (step 7). |
| *HTTP 403 … OLLAMA_ORIGINS* | Ollama refused the browser. The extension tries to avoid this by itself; if it still happens, set the environment variable `OLLAMA_ORIGINS` to `moz-extension://*` (Chrome: `chrome-extension://*`) the same way as `OLLAMA_HOST` (plugin README step 4) and restart Ollama. |
| *Can't reach the LLM server* | `OLLAMA_HOST=0.0.0.0` wasn't set, or Ollama wasn't restarted after it (plugin README step 4). |
| Nothing happens on the site | The extension's button: does it show the site? Do the counts say *0 of 0 images*? Then the **Images** selector matches nothing: click **Pick images again**. Pages open from before the extension was installed need a reload. |
| *Couldn't load the image* | Some sites only send their images to their own pages. Reload the page; if it keeps happening, the site isn't supported yet. |
| Boxes in the wrong place | The site moves the images in an unusual way (zoom, transforms). Scroll a little or resize the window; if they stay wrong, please open an issue with the site. |

**Not supported (yet):** sites that draw pages on a `<canvas>` or as CSS background images instead
of normal images; boxes are only drawn over `<img>` elements.

## How it works

| File | What it does |
|---|---|
| `src/content.js` | runs on every page: if the address matches a site, finds its images, fetches them, shrinks them to 1600 px wide (and cuts long strips into pieces), and draws the English on top; also the image picker |
| `src/background.js` | the queue: sends pieces to the vision server (`/page`) and the text to the LLM (`/v1/chat/completions`) at the same time, and saves the results |
| `src/layout.js` | grows each text box to fit English without covering its neighbours (same rules as the plugin), and the box styles |
| `src/editor.js` | the editor (the same as the plugin's), drawn over the page in a shadow root |
| `manifest.json`, `manifest.chrome.json` | Firefox's (Manifest V2) and Chrome's (Manifest V3); Chrome's background is `src/sw.js`, which loads the same scripts |
| `build.mjs` | makes `dist/firefox` and `dist/chrome`; Chrome's version number is taken from `manifest.json` |
| `sign.mjs` | builds and signs the Firefox version with the AMO key from `.env` (see `.env.example`) or the environment |
| `version.mjs` | sets the version in both manifests |
| `.github/workflows/release.yml` | a release on GitHub: signs the Firefox version and attaches it with the Chrome zip |

## Releases

GitHub can sign and publish a version for you: a release with the signed Firefox `.xpi` and the
Chrome `.zip`, under **Releases** on the repository's page.

**Once:** in the repository on GitHub, **Settings → Secrets and variables → Actions → New repository
secret**, add two: `AMO_API_KEY` (the JWT issuer) and `AMO_API_SECRET` (the JWT secret), the same as
in `.env`. Or, with the [GitHub CLI](https://cli.github.com/), from this folder: `gh secret set -f .env`.

**Each release:**

```
node version.mjs patch
git commit -am "Version 0.3.2" && git tag v0.3.2 && git push origin main v0.3.2
```

The tag starts the workflow (**Actions → Release**): it checks that the tag is the version in
`manifest.json`, signs the Firefox version with Mozilla (unlisted; it waits up to 45 minutes),
builds the Chrome zip, and creates the release. It can also be started by hand: **Actions → Release →
Run workflow** releases the version in `manifest.json`.

If the repository is public, so are its releases: anyone can download the signed `.xpi` from there.

### Updates in Firefox

From version 0.3.3 on, Firefox updates the extension from this repository's releases: each release
has an `updates.json` next to the `.xpi`, and the extension's `update_url` points to the newest
release's one. Firefox checks about once a day; right after a release, `about:addons` → the gear →
**Check for Updates** installs it at once. Your settings and saved translations stay.

This needs the repository to be public (Firefox downloads without a GitHub login). Chrome can't do
this for an unpacked extension: there, unzip the new version and click the reload arrow on its card.
| `src/options.*`, `src/popup.*` | the settings page and the toolbar button |

The translation prompt, the box layout and the text fitting are the same as in the MangaVibe plugin
and reader, so the results look the same. Saved translations stay in the browser
(**Settings → Saved translations** deletes them).

## Legal

A tool for reading manga **you can already read** on your own computer. It doesn't download or share
any manga, and the translations are only shown to you.

- Don't use it to share or publish translated pages.
- Please support the creators: buy the manga you read, and the official translations when they come out.

The models are made by others and keep their own licences (see the plugin's README). The text
reading model is free for personal use only, **not for commercial use**.

**Licence:** [MIT](LICENSE).
