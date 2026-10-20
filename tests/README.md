# Website validation

Serve the checkout from its root with `python3 -m http.server 8000 --bind 127.0.0.1`.

- `python3 tests/check_site.py` checks all eight HTML pages, relative paths, fragments, assets, duplicate IDs/imports and merge markers with the Python standard library.
- `python3 tests/browser_smoke.py` uses Python Playwright and `/usr/bin/chromium` to check mobile/desktop navigation, responsive widths, local logos, all program filters, photo dialogs, quick trial, five program-to-full-trial flows, invalid input and privacy fallback. Pass another server origin as its first argument if needed. Override the Chromium path with `CHROMIUM_PATH`. WhatsApp navigation is intercepted locally; no messages are sent.
- Run `node --check` on `premium.js`, `navigation.js`, and `trial.js`.
- HTML conformance: install the validator outside the checkout with `npm install --prefix /tmp/etu-html-tools --cache /tmp/etu-npm-cache --no-save --package-lock=false html-validate@10.4.0`, then run `/tmp/etu-html-tools/node_modules/.bin/html-validate index.html small-talker.html 'programs/*.html' trial/index.html`. No rules are disabled.

The homepage uses `premium.css` and `premium.js`; shared navigation lives in `navigation.js`. All five program pages share `programs.css` and `navigation.css`. The full booking page loads `trial.css`, `trial.js`, and shared navigation. Homepage program details use `programs/*-talker.html`; `small-talker.html` remains available for older links and retains its original information. Program booking links pass `program=*-talker` to `trial/`; the homepage also retains its quick trial and links to the complete form.

The official ETU logo and five Cambridge award photographs are local assets. Other original ETU photos remain at their existing Google-hosted URLs; the Cambridge brand logo remains at its official URL. Tests report externally blocked image hosts separately from local checks. Verify those external images with network access to `lh3.googleusercontent.com` and `www.cambridgeenglish.org` before claiming they load successfully. Do not substitute stock imagery to make the checks pass.
