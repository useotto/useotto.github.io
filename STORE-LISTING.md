# Chrome Web Store — submission notes

Paste these into the Web Store developer dashboard. Keep answers honest and
specific; the review team scrutinises Gmail access and broad host permissions.

## Single purpose
Otto detects email one-time passcodes (OTPs) from your open Gmail tab and fills
them into verification-code fields on the site you're logging into.

## Permission justifications

- **storage** — Stores the most recently detected code locally so it can be
  offered on the login page. No remote storage.
- **alarms** — Clears the toolbar badge when the code's 10-minute window ends.
- **Host permission `https://mail.google.com/*`** — Required to read the inbox
  list and extract the verification code. Otto reads only the inbox subject and
  preview text; it does not open emails or read full message bodies. This grant
  also lets the extension keep that one Gmail tab alive (non-discardable) and
  ping it to scan once a minute so detection keeps working while it's a
  background tab. (No broad `tabs` permission is requested — only the Gmail tab
  is touched, via this host grant.)
- **`<all_urls>` content script** — Required because a verification code can be
  requested on any website, so Otto must be able to detect the code field and
  offer to fill it anywhere. Otto only interacts with inputs that look like OTP
  fields and never reads or transmits page content.

## Data use disclosures (check these in the dashboard)
- Does NOT collect or transmit any user data.
- Does NOT use data for anything other than the single purpose above.
- Does NOT sell or share data with third parties.
- All processing happens locally in the browser.

## Privacy policy
Host `PRIVACY.md` at a public URL (e.g. GitHub Pages alongside the marketing
site) and link it in the listing.

## Pre-submit checklist
- [ ] `DEBUG = false` in `src/gmail-scraper.js`, `src/autofill.js`, `src/background.js`
- [ ] Icons present (16/32/48/128) and referenced in `manifest.json`
- [ ] Bump `version` in `manifest.json` for each upload
- [ ] Real GitHub / sponsor / Web Store links filled into `docs/`
- [ ] Screenshots (1280×800 or 640×400) of the chip in action for the listing
- [ ] Privacy policy URL live
