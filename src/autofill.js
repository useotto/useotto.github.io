// Runs on every page. Detects verification-code inputs and, when a fresh OTP
// is available from your email, shows a clickable "Fill code" chip next to the
// field — like Safari's QuickType OTP suggestion.

(function () {
  const DEBUG = false; // flip to true for field-detection / suggestion logs
  const log = (...a) => DEBUG && console.log("[OTP/fill]", ...a);

  const FRESH_MS = 10 * 60 * 1000; // offer a code while its email is <10 min old

  let chipHost = null;       // the floating chip element (shadow DOM host)
  let chipField = null;      // field the chip is currently attached to
  let chipOtp = null;        // the OTP object currently shown in the chip
  let chipOtpId = null;      // id of the OTP currently shown in the chip
  let removeTimer = null;

  // ---------- OTP field detection ----------------------------------------

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return !(s.visibility === "hidden" || s.display === "none" || s.opacity === "0");
  }

  function isOneCharBox(el) {
    return el.tagName === "INPUT" && parseInt(el.getAttribute("maxlength"), 10) === 1;
  }

  // Positive: words that mean "this is an OTP field".
  const OTP_POS = /otp|o\.t\.p|one[-\s]?time|verif|2fa|mfa|two[-\s]?factor|auth[\s-]?code|authcode|security[\s-]?code|passcode|confirmation[\s-]?code|\bcode\b|\bpin\b/;
  // Negative: words that mean "this is definitely NOT an OTP field".
  const OTP_NEG = /phone|mobile|\btel\b|card|cc-|cvv|cvc|csc|expiry|zip|postal|amount|price|qty|quantity|search|e-?mail|user-?name|street|address|\bdob\b|birth|\bssn\b|routing|iban|account[\s-]?number/;
  const NEG_AUTOCOMPLETE = /^(cc-|tel|email|username|street-address|postal-code|address|name|given-name|family-name|organization|country)/;

  // Text from a field's <label>, wrapping label, and aria-labelledby targets.
  function labelTextFor(el) {
    let t = "";
    try {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) t += " " + lab.textContent;
      }
      const wrap = el.closest("label");
      if (wrap) t += " " + wrap.textContent;
      const lb = el.getAttribute("aria-labelledby");
      if (lb) lb.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) t += " " + n.textContent;
      });
    } catch (e) { /* CSS.escape / DOM edge — ignore */ }
    return t.toLowerCase();
  }

  // Short text from the nearest container (heading/instructions near the field).
  function nearbyText(el) {
    const cont = el.closest("form,[role=dialog],[role=form],section,fieldset,div");
    return cont ? (cont.textContent || "").slice(0, 320).toLowerCase() : "";
  }

  function isOtpField(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    if (["checkbox", "radio", "submit", "button", "file", "hidden", "range", "color",
         "date", "datetime-local", "month", "week", "time"].includes(type)) {
      return false;
    }

    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "one-time-code") return true;          // the gold standard
    if (NEG_AUTOCOMPLETE.test(ac)) return false;      // clearly something else

    const attrHay = [
      el.name, el.id, ac, el.getAttribute("aria-label"), el.placeholder,
      el.className, el.getAttribute("data-testid"), el.title,
    ].map((x) => (x || "").toLowerCase()).join(" ");

    // Hard negative — unless the field also explicitly screams OTP.
    if (OTP_NEG.test(attrHay) && !/otp|one[-\s]?time|verif|passcode|2fa/.test(attrHay)) {
      return false;
    }

    if (OTP_POS.test(attrHay)) return true;
    if (OTP_POS.test(labelTextFor(el))) return true;

    const ml = parseInt(el.getAttribute("maxlength"), 10);
    const pattern = el.getAttribute("pattern") || "";
    const numericish =
      el.inputMode === "numeric" || type === "tel" || type === "number" ||
      pattern.includes("\\d") || pattern.includes("[0-9]") || /^\d*$/.test(el.value || "");

    // Single-char numeric boxes (split OTP layouts).
    if (isOneCharBox(el) && numericish) return true;

    // A medium numeric input (4–8 chars) counts only if the surrounding copy
    // talks about codes — keeps us off zip/CVV/quantity boxes.
    if (numericish && ml >= 4 && ml <= 8 && OTP_POS.test(nearbyText(el))) return true;

    return false;
  }

  // An input that holds a single OTP digit. Detected by maxlength=1, a
  // "Digit N of 6"-style aria-label, OR being one of a row of one-time-code
  // inputs (Spotify-style boxes have NO maxlength at all).
  function isDigitBox(el) {
    if (!el || el.tagName !== "INPUT") return false;
    if (parseInt(el.getAttribute("maxlength"), 10) === 1) return true;
    if (/\bdigit\b/i.test(el.getAttribute("aria-label") || "")) return true;
    return false;
  }

  // Find the row of digit inputs around `field` (split OTP layout).
  function findBoxGroup(field) {
    let node = field.parentElement;
    for (let i = 0; i < 7 && node; i++) {
      const inputs = [...node.querySelectorAll("input")].filter(isVisible);
      let boxes = inputs.filter(isDigitBox);
      // Fallback: a cluster of 2+ one-time-code inputs is a split layout even
      // when none declare maxlength (e.g. Spotify).
      if (boxes.length < 2) {
        const otc = inputs.filter((x) => (x.getAttribute("autocomplete") || "") === "one-time-code");
        if (otc.length >= 2) boxes = otc;
      }
      if (boxes.length >= 2 && boxes.includes(field)) return boxes;
      node = node.parentElement;
    }
    return null;
  }

  // ---------- Filling -----------------------------------------------------

  // Set a value in a way React / Vue / Angular controlled inputs will notice.
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function typeInto(el, ch) {
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    el.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true }));
    setNativeValue(el, ch);
    el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
  }

  function fillBoxes(group, code) {
    const n = Math.min(group.length, code.length);
    for (let i = 0; i < n; i++) typeInto(group[i], code[i]);
    (group[n - 1] || group[group.length - 1]).focus();
  }

  function fill(field, code) {
    const group = findBoxGroup(field);
    if (group) {
      fillBoxes(group, code);            // split layout (incl. no-maxlength boxes)
    } else if (isOneCharBox(field)) {
      typeInto(field, code[0]);          // lone single-char box — don't dump the whole code
    } else {
      field.focus();
      setNativeValue(field, code);       // single combined input (incl. input-otp hidden field)
    }
  }

  // Is the code already sitting in the field/boxes? (so Enter can submit
  // instead of re-filling).
  function fieldHasCode(field, code) {
    const group = findBoxGroup(field);
    if (group) {
      return group.map((b) => (b.value || "").trim()).join("").length >= code.length;
    }
    return (field.value || "").replace(/\s/g, "").length >= code.length;
  }

  // Fill + retire + dismiss. Shared by the chip click and the Enter shortcut.
  function commitFill(field, otp) {
    fill(field, otp.code);
    markUsed(otp);
    removeChip();
  }

  // ---------- Suggestion chip --------------------------------------------

  function removeChip() {
    if (chipHost) {
      chipHost.remove();
      chipHost = null;
      chipField = null;
      chipOtp = null;
      chipOtpId = null;
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition, true);
    }
  }

  function reposition() {
    if (!chipHost || !chipField) return;
    const r = chipField.getBoundingClientRect();
    chipHost.style.left = `${Math.max(8, r.left)}px`;
    chipHost.style.top = `${Math.max(8, r.top - 46)}px`;
  }

  function showChip(field, otp) {
    if (chipHost && chipField === field) return; // already showing
    removeChip();
    chipField = field;
    chipOtp = otp;
    chipOtpId = otp.id || null;

    chipHost = document.createElement("div");
    chipHost.style.cssText = "position:fixed; z-index:2147483647;";
    const shadow = chipHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .chip {
          display:flex; align-items:center; gap:8px;
          font:500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background:#1f1f23; color:#fff; border:none; cursor:pointer;
          padding:8px 12px; border-radius:10px;
          box-shadow:0 6px 20px rgba(0,0,0,.28); white-space:nowrap;
        }
        .chip:hover { background:#2c2c33; }
        .key {
          display:inline-flex; align-items:center; justify-content:center;
          width:18px; height:18px; border-radius:5px;
          background:#3a3a42; font-size:11px;
        }
        .code { font-variant-numeric:tabular-nums; letter-spacing:1px; font-weight:700; }
        .src { color:#9aa0a6; font-size:11px; }
        .close { color:#9aa0a6; padding-left:2px; font-size:14px; }
        .close:hover { color:#fff; }
      </style>
      <button class="chip" type="button" title="Click or press Enter to fill">
        <span class="key">↵</span>
        <span>Fill code <span class="code"></span></span>
        <span class="src"></span>
        <span class="close" data-close="1">×</span>
      </button>`;

    shadow.querySelector(".code").textContent = otp.code;
    const service = (otp.hints && otp.hints[0])
      ? otp.hints[0].charAt(0).toUpperCase() + otp.hints[0].slice(1)
      : null;
    shadow.querySelector(".src").textContent = service
      ? `${service} · ${otp.source}`
      : `from ${otp.source}`;

    const chip = shadow.querySelector(".chip");
    // mousedown preventDefault keeps the field focused so it isn't blurred away.
    chip.addEventListener("mousedown", (e) => e.preventDefault());
    chip.addEventListener("click", (e) => {
      if (e.target && e.target.dataset && e.target.dataset.close) {
        removeChip();
        return;
      }
      commitFill(field, otp);
    });

    document.documentElement.appendChild(chipHost);
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition, true);
  }

  // ---------- Wiring ------------------------------------------------------

  // True only while this content script is still connected to a live extension.
  // After the extension is reloaded/updated, already-open tabs keep running the
  // OLD script whose context is dead — guard every chrome.* call with this.
  function extensionAlive() {
    return !!(chrome.runtime && chrome.runtime.id);
  }

  // Identifiers for the current page — its hostname labels + words in the title.
  function pageTokens() {
    const tokens = new Set();
    const host = location.hostname.replace(/^www\./, "");
    host.split(".").forEach((p) => { if (p.length >= 3) tokens.add(p.toLowerCase()); });
    (document.title || "").toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
      if (w.length >= 3) tokens.add(w);
    });
    return [...tokens];
  }

  // Does this OTP's source service match the page we're on? Unknown source
  // (no hints) never blocks — it just falls back to showing.
  function matchesSource(otp) {
    const hints = (otp.hints || []).map((h) => h.toLowerCase()).filter((h) => h.length >= 3);
    if (!hints.length) return true;
    const toks = pageTokens();
    return hints.some((h) =>
      toks.some((t) => t === h || (t.length >= 4 && h.includes(t)) || (h.length >= 4 && t.includes(h)))
    );
  }

  // A code is offerable only if it's fresh, unused, AND meant for this page.
  function offerableOtp(otp, explain) {
    if (!otp) return null;
    let reason = null;
    const anchor = otp.emailTs || otp.capturedAt; // freshness from EMAIL time
    if (otp.used) reason = "already used";
    else if (Date.now() - anchor >= FRESH_MS) reason = `stale (email ${Math.round((Date.now() - anchor) / 60000)}m old)`;
    else if (!matchesSource(otp)) reason = `source ${JSON.stringify(otp.hints)} != page tokens ${JSON.stringify(pageTokens())}`;
    if (reason) {
      if (explain) log(`code ${otp.code} not offered here — ${reason}`);
      return null;
    }
    return otp;
  }

  function getFreshOtp(cb) {
    if (!extensionAlive()) { cb(null); return; }
    try {
      chrome.storage.local.get("latestOtp", ({ latestOtp }) => {
        if (chrome.runtime.lastError) { cb(null); return; }
        cb(offerableOtp(latestOtp, true));
      });
    } catch (e) {
      cb(null); // "Extension context invalidated" after a reload — refresh the page.
    }
  }

  // Mark a code as used so it's never suggested again (until a new one arrives).
  function markUsed(otp) {
    if (!extensionAlive() || !otp) return;
    try {
      chrome.storage.local.get("latestOtp", ({ latestOtp }) => {
        if (chrome.runtime.lastError || !latestOtp) return;
        if (latestOtp.id === otp.id) {
          chrome.storage.local.set({ latestOtp: { ...latestOtp, used: true, usedAt: Date.now() } });
        }
      });
    } catch (e) { /* context gone — ignore */ }
  }

  // Show chip when an OTP field gains focus.
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && el.tagName === "INPUT") {
        log("focus on input", { name: el.name, id: el.id, type: el.type,
          autocomplete: el.getAttribute("autocomplete"), isOtpField: isOtpField(el) });
      }
      if (!isOtpField(el)) return;
      getFreshOtp((otp) => {
        log("field is OTP-like; fresh code available?", !!otp, otp && otp.code);
        if (otp) showChip(el, otp);
      });
    },
    true
  );

  // When focus leaves the field, retire the chip shortly after (unless the
  // user is interacting with the chip itself).
  document.addEventListener(
    "focusout",
    (e) => {
      if (e.target !== chipField) return;
      clearTimeout(removeTimer);
      removeTimer = setTimeout(removeChip, 250);
    },
    true
  );

  // Make the ↵ affordance real: when the chip is showing and the cursor is in
  // the code field, Enter FILLS the code — and we stop it from submitting the
  // empty form (the cause of "enter the code first" errors). If the code is
  // already in the field, we step aside and let Enter submit normally.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (!chipHost || !chipOtp) return;
      const ae = document.activeElement;
      if (!(ae === chipField || isOtpField(ae))) return;
      if (fieldHasCode(chipField, chipOtp.code)) { removeChip(); return; } // already filled → submit
      e.preventDefault();
      e.stopPropagation();
      commitFill(chipField, chipOtp);
    },
    true
  );

  // Pick the best field to suggest on: the one the cursor is already in (the
  // common case on an OTP page), else the first visible OTP field on the page.
  function findTargetField() {
    const active = document.activeElement;
    if (isOtpField(active) && isVisible(active)) return active;
    return [...document.querySelectorAll("input")].find(
      (el) => isOtpField(el) && isVisible(el)
    ) || null;
  }

  // Auto-suggest (non-focus path). Suppressed per OTP *id* (not numeric value),
  // so a re-issued code with the same digits but a new id will still pop.
  let lastAutoId = null;
  function trySuggest() {
    getFreshOtp((otp) => {
      if (!otp || otp.id === lastAutoId) return;
      const field = findTargetField();
      if (!field) return;
      lastAutoId = otp.id;
      showChip(field, otp);
    });
  }

  // React to any change in the stored code (used, replaced, expired, new).
  if (extensionAlive()) chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.latestOtp) return;
    const nv = changes.latestOtp.newValue;

    // Global used-once: if the code currently shown here just became used /
    // was replaced / is no longer offerable, retract the chip immediately.
    // This fires in EVERY tab, so a code consumed in one tab vanishes in all.
    if (chipOtpId && (!nv || nv.id !== chipOtpId || !offerableOtp(nv))) {
      removeChip();
    }

    const otp = offerableOtp(nv);
    if (!otp) return;
    lastAutoId = null; // a fresh, offerable code overrides suppression
    trySuggest();
  });

  // OTP fields on SPA logins often render AFTER page load — watch for them and
  // suggest as soon as one appears (if we already have a fresh code waiting).
  // Debounced; only does storage work when a chip isn't already showing.
  let moTimer = null;
  new MutationObserver(() => {
    if (chipHost) return; // already suggesting — nothing to do
    clearTimeout(moTimer);
    moTimer = setTimeout(trySuggest, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // And try once on load, for the case where the field + a fresh code both
  // already exist (e.g. you opened the page right after the email arrived).
  trySuggest();

  // ---------- Debug helpers ----------------------------------------------
  // Content scripts run in an isolated world, so a `window.x` global is NOT
  // visible from the DevTools console. DOM events, however, ARE shared across
  // worlds — so trigger these from the console by dispatching an event:
  //   window.dispatchEvent(new Event("otpfields"))  -> list detected OTP fields
  //   window.dispatchEvent(new Event("otpfake"))    -> force a dummy chip

  function debugFields() {
    const all = [...document.querySelectorAll("input")];
    const hits = all.filter(isOtpField);
    log(`${all.length} inputs on page, ${hits.length} detected as OTP fields`, hits);
    hits.forEach((el, i) =>
      log(`  OTP field #${i}:`, { name: el.name, id: el.id, type: el.type,
        autocomplete: el.getAttribute("autocomplete"), maxlength: el.getAttribute("maxlength"),
        placeholder: el.placeholder, ariaLabel: el.getAttribute("aria-label") }));
    return hits;
  }

  function debugFake(code = "123456") {
    const field =
      (isOtpField(document.activeElement) && document.activeElement) ||
      [...document.querySelectorAll("input")].find((el) => isOtpField(el) && isVisible(el));
    if (!field) { log("FAKE: no OTP field detected on this page"); return; }
    showChip(field, { code, source: "test" });
    log("FAKE: forced chip on", field);
  }

  // Debug back-doors and the load-time scan only exist when DEBUG is on — they
  // must not run (or be reachable from the page) in a published build.
  if (DEBUG) {
    window.addEventListener("otpfields", () => debugFields());
    window.addEventListener("otpfake", () => debugFake());
    log(`content script loaded — ${location.href} (frame: ${window === window.top ? "top" : "iframe"})`);
    debugFields();
  }
})();
