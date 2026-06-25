// Runs inside your open Gmail tab (mail.google.com).
// It watches the inbox list and pulls OTP / verification codes straight out of
// the row subjects + snippet previews — so it never has to open an email.
//
// Behaviour: on every scan it picks the single newest email-fresh code (within
// RECENT_MS, by the email's own timestamp) and emits it — so a stale code is
// never surfaced and a freshly-arrived one always wins.

(function () {
  const DEBUG = false; // flip to true to log scans/decisions to the Gmail console
  const log = (...a) => DEBUG && console.log("[OTP/gmail]", ...a);

  const POLL_MS = 2500;
  const RECENT_MS = 10 * 60 * 1000; // ignore emails older than this


  // Broad gate: the email must read like an auth message at all.
  const KEYWORDS = [
    "code", "verification", "verify", "otp", "one-time", "one time",
    "passcode", "2fa", "mfa", "authentication", "authenticate", "security",
    "sign in", "sign-in", "log in", "login", "confirm", "access code", "pin",
  ];
  // Strong words that tend to sit right next to the actual code.
  const CODE_WORDS = ["code", "otp", "passcode", "pin", "password", "one-time", "one time"];

  const isYear = (v) => v.length === 4 && /^(19|20)\d\d$/.test(v);

  // A candidate is phone-like if it sits inside a longer phone-shaped run.
  function looksLikePhone(text, index, raw) {
    const start = Math.max(0, index - 6);
    const win = text.slice(start, index + raw.length + 6);
    return /\+?\d[\d\s().-]{8,}\d/.test(win) && /[\s().+-]/.test(win.replace(raw, ""));
  }
  // Money / percentages / decimals are never OTPs.
  function looksLikeAmount(text, index, raw) {
    const before = text[index - 1];
    const after = text[index + raw.length];
    if (before === "$" || before === "€" || before === "£" || before === "₹") return true;
    if (after === "%" || after === "." || after === ",") return /\d/.test(text[index + raw.length + 1] || "");
    return false;
  }

  // Pull the most plausible code out of a chunk of email text, using a
  // weighted score (length + proximity to a code word + formatting) and
  // rejecting years, phone numbers, prices and dates.
  function extractOtp(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (!KEYWORDS.some((k) => lower.includes(k))) return null;

    const cands = [];
    const push = (value, index, raw) => cands.push({ value, index, raw });
    for (const m of text.matchAll(/\b(\d{3})[\s-](\d{3})\b/g)) push(m[1] + m[2], m.index, m[0]); // 123-456
    for (const m of text.matchAll(/\b(\d{4})[\s-](\d{4})\b/g)) push(m[1] + m[2], m.index, m[0]); // 1234-5678
    for (const m of text.matchAll(/\b(\d{4,8})\b/g)) push(m[1], m.index, m[0]);                  // plain run
    for (const m of text.matchAll(/\b([A-Z0-9]{5,8})\b/g)) {                                      // alnum
      if (/\d/.test(m[1]) && /[A-Z]/.test(m[1])) push(m[1], m.index, m[0]);
    }
    if (!cands.length) return null;

    // Positions just after each code word, for proximity scoring.
    const kwPos = [];
    for (const k of CODE_WORDS) {
      let i = lower.indexOf(k);
      while (i !== -1) { kwPos.push(i + k.length); i = lower.indexOf(k, i + 1); }
    }

    let best = null, bestScore = -Infinity;
    for (const c of cands) {
      if (isYear(c.value)) continue;
      if (looksLikePhone(text, c.index, c.raw)) continue;
      if (looksLikeAmount(text, c.index, c.raw)) continue;

      const len = c.value.length;
      let score = len === 6 ? 6 : len === 8 ? 4 : len === 4 || len === 5 || len === 7 ? 3 : 1;
      if (kwPos.length) {
        const d = Math.min(...kwPos.map((p) => Math.abs(c.index - p)));
        score += d < 20 ? 6 : d < 50 ? 3 : d < 120 ? 1 : 0;
      }
      if (/[\s-]/.test(c.raw)) score += 2;       // explicitly formatted code
      if (/[A-Z]/.test(c.value)) score += 1;     // alnum codes are intentional

      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best ? best.value : null;
  }

  function rowText(row) {
    const subject = textOf(row, ".bog");
    const snippet = textOf(row, ".y2");
    const senderEl = row.querySelector("span[email], .yX, .zF, .bA4");
    const senderName = senderEl ? (senderEl.getAttribute("name") || senderEl.innerText || senderEl.textContent || "").trim() : "";
    const senderEmail = senderEl ? senderEl.getAttribute("email") || "" : "";
    return { subject, snippet, senderName, senderEmail, combined: `${subject} ${snippet}` };
  }

  function textOf(root, sel) {
    const el = root.querySelector(sel);
    return el ? (el.innerText || el.textContent || "").trim() : "";
  }

  // Generic words that say nothing about *which* service sent the code.
  const STOP = new Set([
    "code","codes","verification","verify","verifying","your","you","the","for","and",
    "account","accounts","login","log","logging","sign","signin","signing","one","time",
    "onetime","otp","password","passcode","security","authentication","authenticate","auth",
    "confirm","confirmation","email","mail","noreply","reply","notifications","notification",
    "team","support","hello","info","admin","app","apps","inc","llc","ltd","com","net","org",
    "www","please","use","here","below","new","two","factor","2fa","mfa","access","number",
    "with","this","that","into","from","get","are","our","now","via","not",
  ]);

  function addToken(set, raw) {
    if (!raw) return;
    const t = String(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (t.length >= 3 && !STOP.has(t)) set.add(t);
  }

  // Figure out which service an OTP email is for, from the sender + wording.
  // Returns a list of lowercase identifier hints (e.g. ["superdm"]).
  function extractServiceHints({ subject, snippet, senderName, senderEmail }) {
    const hints = new Set();

    if (senderEmail && senderEmail.includes("@")) {
      const domain = (senderEmail.split("@")[1] || "").toLowerCase();
      const parts = domain.split(".").filter(Boolean);
      parts.slice(0, -1).forEach((p) => addToken(hints, p)); // drop the TLD
    }
    (senderName || "").split(/\s+/).forEach((w) => addToken(hints, w));

    const text = `${subject} ${snippet}`;
    const patterns = [
      /(?:sign in to|signin to|log in to|login to|log into|sign into|access|join|verify your)\s+([A-Za-z0-9][\w.&-]{1,30})/i,
      /your\s+([A-Za-z0-9][\w.&-]{1,30})\s+(?:code|verification|login|account|sign-?in|one-?time)/i,
      /\bto your\s+([A-Za-z0-9][\w.&-]{1,30})\s+account/i,
      /\b([A-Za-z0-9][\w.&-]{1,30})\s+verification code\b/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) addToken(hints, m[1]);
    }
    return [...hints];
  }

  let loggedTimeSample = false;
  function rowTimeMs(row) {
    const el = row.querySelector("td.xW span[title], .xW span[title], .xW [title]");
    const raw = el ? el.getAttribute("title") || el.textContent : null;
    if (!loggedTimeSample && raw) {
      log("sample row time string =", JSON.stringify(raw), "-> parses?", !Number.isNaN(Date.parse(raw)));
      loggedTimeSample = true;
    }
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function scan() {
    const rows = document.querySelectorAll("tr.zA");
    if (!rows.length) {
      log("no inbox rows found (selector 'tr.zA' matched nothing) — are you on the inbox list view?");
      return;
    }

    // Rows are in DOM order, so index 0 is the newest email in the list.
    const candidates = [];
    rows.forEach((row, idx) => {
      const t = rowText(row);
      const code = extractOtp(t.combined);
      if (!code) return;
      const timeMs = rowTimeMs(row);
      // Signature leads with the email's timestamp so a *re-sent* code (new
      // send time) is a new signature — while the same email stays de-duped.
      const sig = `${timeMs}|${t.senderEmail || t.senderName}|${t.subject}|${t.snippet}`.slice(0, 260);
      const hints = extractServiceHints(t);
      candidates.push({ sig, code, subject: t.subject, hints, timeMs, idx });
    });
    // Always converge on the NEWEST email-fresh code. Anchoring to each email's
    // own timestamp means a stale code (old email) is never surfaced, and a
    // freshly-arrived one always wins — no fragile seed/seen bookkeeping that
    // could leave the newest code stuck behind an old one.
    const now = Date.now();
    const top = candidates[0];
    const fresh = candidates.filter((c) => c.timeMs != null && now - c.timeMs < RECENT_MS);
    // Fallback only when a timestamp couldn't be read: trust the very top row.
    if (!fresh.length && top && top.timeMs == null && top.idx === 0) fresh.push(top);

    fresh.sort((a, b) => (b.timeMs || 0) - (a.timeMs || 0)); // newest first
    const best = fresh[0];

    // The debug list shows ALL code-shaped matches in the inbox; the ones
    // outside the freshness window are ignored — only `using` is acted on.
    log(
      `scanned ${rows.length} rows · found ${candidates.length}` +
      ` [${candidates.map((c) => `${c.code}@${c.timeMs ? ageMin(c.timeMs) + "m" : "?"}`).join(", ")}]` +
      ` · using ${best ? `${best.code} (${ageMin(best.timeMs)}m)` : `none (nothing < ${RECENT_MS / 60000}m)`}`
    );

    if (best) emit(best);
  }

  function ageMin(ms) {
    return Math.round((Date.now() - ms) / 60000);
  }

  // De-dupe on the email signature (NOT the numeric value): if a site re-sends
  // a code — even identical digits — it's a new email, a new signature, and
  // therefore a fresh, active OTP.
  // Which logged-in Gmail account this tab is (the /mail/u/N/ index). Lets the
  // background tell codes from different accounts apart.
  const ACCOUNT = (location.pathname.match(/\/u\/(\d+)\//) || [])[1] || "0";

  let lastEmittedSig = null;
  function emit(c) {
    if (c.sig === lastEmittedSig) return;
    lastEmittedSig = c.sig;
    const capturedAt = Date.now();
    const entry = {
      code: c.code,
      source: "Gmail",
      account: ACCOUNT,
      subject: c.subject || "",
      hints: c.hints || [],
      emailTs: c.timeMs || capturedAt, // when the email arrived (best effort)
      capturedAt,                       // when Otto saw it — drives freshness
      id: `${c.code}-${capturedAt}`,    // unique even if digits repeat
      used: false,
    };
    log("EMIT code", c.code, "for", c.hints && c.hints.length ? c.hints.join("/") : "(unknown source)",
        "captured", new Date(capturedAt).toLocaleTimeString());
    try {
      // The no-op callback swallows "receiving end does not exist" when the
      // service worker is briefly asleep.
      chrome.runtime.sendMessage({ type: "OTP_FOUND", ...entry }, () => void chrome.runtime.lastError);
    } catch (e) {
      // Extension context invalidated after a reload — ignore.
    }
  }

  setInterval(scan, POLL_MS);
  scan();
})();
