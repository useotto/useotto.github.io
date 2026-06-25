# Otto — Privacy Policy

_Last updated: 2026-06-25_

Otto is a browser extension that fills email one-time passcodes (OTPs) into
verification fields. **Otto is built so that your data never leaves your
device.**

## What Otto does

- Otto reads the **inbox list** of an open Gmail tab (`mail.google.com`) to find
  the verification code in the newest matching email.
- It stores that code **locally** in your browser (`chrome.storage.local`) for a
  short time (10 minutes) so it can be suggested on the page you're logging into.
- When you click the suggestion (or press Enter), Otto types the code into the
  verification field on the current page.

## What Otto does NOT do

- **No servers.** Otto has no backend. Nothing you do is sent anywhere.
- **No analytics, no tracking, no advertising, no telemetry.**
- **No account.** Otto never asks you to sign in and collects no identity.
- **No selling or sharing of data**, because no data is ever collected off-device.
- Otto does **not** read your full mailbox, open emails, or access message bodies
  beyond the inbox subject/preview text needed to find a code.

## Data storage & retention

The only data Otto stores is the most recent detected code and minimal metadata
(the code, the detected service name, timestamps, and a "used" flag), kept in
`chrome.storage.local` on your machine. It is overwritten by the next code and
is never transmitted. Removing the extension deletes it.

## Permissions

- **`storage`** — to hold the latest code locally between the email tab and the
  login page.
- **`alarms`** — to clear the toolbar badge when a code expires.
- **Host access to `https://mail.google.com/*`** — to read the inbox list and
  detect the code.
- **Access to the page you're on (`<all_urls>` content script)** — to detect the
  verification field and offer/fill the code. Otto only acts on inputs that look
  like OTP fields and never reads or transmits page content.

## Contact

Otto is free and open source (MIT). Questions or concerns: open an issue on the
project's GitHub repository.
