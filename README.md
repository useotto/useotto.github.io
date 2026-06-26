# Otto — Email OTP Autofill

**The verification code, already typed.**

Otto is a Chrome / Chromium (Chrome, Arc, Edge, Brave) extension that brings
Safari's seamless email-OTP autofill to any browser.

It watches your **open Gmail tab**, grabs verification codes the moment they
arrive, and shows a one-click **"Fill code 157004"** chip next to the
verification field on whatever site you're on.

No backend, no OAuth, no Google Cloud setup — everything runs locally in your
browser. Free and open source (MIT).

## Repo layout

```
manifest.json, src/, popup/   the extension
docs/                          the marketing site (static — open docs/index.html;
                               served by GitHub Pages at the site root)
LICENSE                        MIT
```

## Install (load unpacked)

1. Open `chrome://extensions` (or `arc://extensions`, `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension if you like. Done.

## Use it

1. Keep a **Gmail tab open** (`mail.google.com`) — it can be in the background.
2. On any site, trigger a code (login, signup, 2FA, etc.).
3. When the email lands in Gmail, a chip appears next to the code field:
   click it to fill. The toolbar badge shows **OTP** while a code is fresh,
   and the popup always shows the latest code with a **Copy** button.

A code is offered for **10 minutes** after it arrives.

## How it works

- `src/gmail-scraper.js` runs inside Gmail, reads the inbox row subjects +
  snippet previews (so it never opens an email), extracts the code, **and works
  out which service it's for** (from the sender domain + wording like "sign in
  to SuperDM"). Each capture is stamped with `capturedAt` and a unique `id`.
- `src/background.js` stores the latest code in `chrome.storage.local`, and runs
  a **1-minute keep-alive**: it marks the Gmail tab non-discardable (so Chrome's
  Memory Saver won't drop it) and pings the scraper to scan — which keeps
  detection working even when Gmail is a backgrounded tab whose own timers are
  throttled. Uses only the existing `alarms` + `mail.google.com` host grant.
- `src/autofill.js` runs on every page, detects verification-code inputs
  (including split single-digit box layouts and React/Vue controlled inputs),
  and renders the suggestion chip in a shadow DOM so site styles can't break it.

### Source-aware suggestions
The chip only appears on a page whose hostname/title matches the OTP's source
hints — so a SuperDM code won't be offered on an unrelated tab. When the source
can't be determined, Otto falls back to showing it anywhere (so it never breaks).

### Used-once + re-issue
Filling a code marks it `used` and Otto stops suggesting it. Because de-dupe
keys on the **email signature** (not the digits), a re-sent code — even with
identical numbers — is captured fresh with a new `id`/timestamp and becomes
active again.

## Limitations (first draft)

- **Gmail only**, and the Gmail tab must be open. Outlook/iCloud/Proton would
  each need their own scraper module (easy to add — mirror `gmail-scraper.js`).
- Reads codes from the inbox **snippet/subject**. Some senders bury the code
  deeper in the body; those won't be caught until we add "open newest email".
- Code detection is a weighted scorer: candidates are ranked by length
  (6 preferred), proximity to a code word, and formatting, and it rejects
  years, phone numbers, prices/decimals and order numbers. Covered by
  `node /tmp/otp-test.mjs`-style cases.
- Field detection uses positive + negative signals (attributes, `<label>`,
  nearby copy) so it finds split-box / `input-otp` / React fields while
  avoiding CVV, zip, phone and quantity inputs.
- A used code is retired globally — it retracts from every tab the moment it's
  filled and never reappears until a newer code arrives.
- No icons bundled yet — Chrome shows a default puzzle-piece icon.

## Extending to other providers

Add a content script like `gmail-scraper.js` matched to the provider's webmail
host (e.g. `https://outlook.live.com/*`), reuse the same `extractOtp()` +
`extractServiceHints()` logic, and send the same `{ type: "OTP_FOUND", code,
source, hints, capturedAt, id }` message. Everything downstream already works.
