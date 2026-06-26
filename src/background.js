// Background service worker.
// Receives OTPs found by the Gmail scraper, stores the latest one, and
// keeps a small toolbar badge so you can see at a glance that a code is ready.

const DEBUG = false; // flip to true to log stored codes to the service-worker console
const FRESH_MS = 10 * 60 * 1000; // a code is usable while its email is <10 min old

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "OTP_FOUND" && msg.code) {
    const capturedAt = msg.capturedAt || Date.now();
    const entry = {
      code: String(msg.code),
      source: msg.source || "Gmail",
      account: msg.account || "",
      subject: msg.subject || "",
      hints: Array.isArray(msg.hints) ? msg.hints : [],
      emailTs: msg.emailTs || capturedAt,
      capturedAt,
      id: msg.id || `${msg.code}-${capturedAt}`,
      used: false,
    };

    // Several Gmail tabs (multiple accounts) may report at once. Keep the
    // GLOBALLY newest code by email time — don't let one account's older code
    // clobber another's newer one, and don't resurrect a code already used.
    chrome.storage.local.get("latestOtp", ({ latestOtp: cur }) => {
      const sameEmail = cur && cur.code === entry.code && cur.emailTs === entry.emailTs;
      if (sameEmail) { sendResponse && sendResponse({ ok: true, skipped: "same-email" }); return; }

      const curFresh = cur && !cur.used && Date.now() - (cur.emailTs || cur.capturedAt) < FRESH_MS;
      if (curFresh && (cur.emailTs || 0) >= (entry.emailTs || 0)) {
        sendResponse && sendResponse({ ok: true, skipped: "older-than-current" });
        return; // current code is newer/fresher — keep it
      }

      chrome.storage.local.set({ latestOtp: entry });
      if (DEBUG) console.log("[OTP/bg] stored code", entry.code, "for", entry.hints.join("/") || "(unknown)",
        entry.account ? `(account ${entry.account})` : "");
      chrome.action.setBadgeText({ text: "OTP" });
      chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
      chrome.alarms?.create("clearBadge", { when: Date.now() + FRESH_MS });
      sendResponse && sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (msg && msg.type === "GET_LATEST_OTP") {
    chrome.storage.local.get("latestOtp", ({ latestOtp }) => {
      const anchor = latestOtp && (latestOtp.emailTs || latestOtp.capturedAt);
      const fresh =
        latestOtp && !latestOtp.used && Date.now() - anchor < FRESH_MS ? latestOtp : null;
      sendResponse && sendResponse({ otp: fresh });
    });
    return true; // async response
  }
});

// ---------------------------------------------------------------------------
// Keep the Gmail tab alive & scanning even as a background tab.
// Chrome throttles hidden tabs' timers and can DISCARD inactive tabs entirely
// (Memory Saver), which would silently stop OTP detection. We:
//   1) mark the Gmail tab non-discardable so Memory Saver won't drop it, and
//   2) ping it once a minute to scan — an alarm-driven message runs right away,
//      sidestepping the background-timer throttling.
// Uses only existing permissions (alarms + the mail.google.com host grant).

const KEEPALIVE_ALARM = "gmailKeepAlive";

function ensureKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(ensureKeepAlive);
chrome.runtime.onStartup.addListener(ensureKeepAlive);
ensureKeepAlive(); // also when the service worker first spins up

function keepGmailAlive() {
  chrome.tabs.query({ url: "https://mail.google.com/*" }, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) {
      if (!tab.id) continue;
      // Exclude this inbox from Memory Saver so it isn't discarded while idle.
      chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);
      // Nudge the content script to scan now (runs immediately, unthrottled).
      chrome.tabs.sendMessage(tab.id, { type: "SCAN_NOW" }, () => {
        if (chrome.runtime.lastError && tab.discarded) {
          // Tab was discarded and the scraper is gone — revive it.
          chrome.tabs.reload(tab.id, () => void chrome.runtime.lastError);
        }
      });
    }
  });
}

// Clear the badge once the code goes stale, and run the keep-alive each minute.
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    keepGmailAlive();
    return;
  }
  if (alarm.name === "clearBadge") {
    chrome.storage.local.get("latestOtp", ({ latestOtp }) => {
      const anchor = latestOtp && (latestOtp.emailTs || latestOtp.capturedAt);
      if (!latestOtp || Date.now() - anchor >= FRESH_MS) {
        chrome.action.setBadgeText({ text: "" });
      }
    });
  }
});
