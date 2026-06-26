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
keepGmailAlive(); // check health right away, don't wait for the first alarm

const RELOAD_COOLDOWN_MS = 2 * 60 * 1000; // don't reload the same tab more often

// Ping a tab's content script. Resolves true if it answered (reachable),
// false if there's no receiver (discarded, crashed, or script not injected).
function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: "SCAN_NOW" }, () => resolve(!chrome.runtime.lastError));
    } catch (e) {
      resolve(false);
    }
  });
}

async function reviveTab(tabId) {
  const { lastGmailReloadAt = 0 } = await chrome.storage.local.get("lastGmailReloadAt");
  if (Date.now() - lastGmailReloadAt < RELOAD_COOLDOWN_MS) return; // cooldown: avoid reload loops
  await chrome.storage.local.set({ lastGmailReloadAt: Date.now() });
  try {
    await chrome.tabs.reload(tabId);
  } catch (e) {
    /* tab vanished mid-flight — ignore */
  }
}

function setStatus(state) {
  chrome.storage.local.set({ gmailStatus: { state, ts: Date.now() } });
}

// Detect the Gmail tab's health and auto-fix what we can:
//   - no tab open      -> status "none" (popup invites the user to open Gmail)
//   - discarded/crashed-> reload to revive the scraper (with a cooldown)
//   - reachable        -> keep it non-discardable and ask it to scan
async function keepGmailAlive() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  } catch (e) {
    return;
  }

  if (!tabs || tabs.length === 0) {
    setStatus("none");
    return;
  }

  let anyReachable = false;
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.update(tab.id, { autoDiscardable: false }, () => void chrome.runtime.lastError);

    const reachable = await pingTab(tab.id);
    if (reachable) {
      anyReachable = true;
      continue;
    }
    // Unreachable: revive if it's discarded, or finished loading but the script
    // is gone (a crash). Skip tabs still loading — they'll come up on their own.
    if (tab.discarded || tab.status === "complete") {
      await reviveTab(tab.id);
    }
  }
  setStatus(anyReachable ? "active" : "reviving");
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
