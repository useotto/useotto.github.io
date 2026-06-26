const FRESH_MS = 10 * 60 * 1000;

function titleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function render(otp) {
  const el = document.getElementById("content");
  const anchor = otp && (otp.emailTs || otp.capturedAt);
  if (!otp || Date.now() - anchor >= FRESH_MS) {
    el.innerHTML = `<div class="empty">No recent code.<br>Waiting for one in Gmail…</div>`;
    return;
  }

  const ageMin = Math.max(0, Math.round((Date.now() - anchor) / 60000));
  const when = ageMin === 0 ? "just now" : ageMin + " min ago";
  const service = otp.hints && otp.hints[0] ? titleCase(otp.hints[0]) : null;
  const source = service ? `${service} · ${otp.source}` : otp.source;
  const usedBadge = otp.used ? `<div class="used">✓ already used</div>` : "";

  el.innerHTML = `
    <div class="code ${otp.used ? "is-used" : ""}">${otp.code}</div>
    <div class="meta">${source} · ${when}</div>
    ${usedBadge}
    <button id="copy">${otp.used ? "Copy anyway" : "Copy code"}</button>`;

  document.getElementById("copy").addEventListener("click", () => {
    navigator.clipboard.writeText(otp.code);
    document.getElementById("copy").textContent = "Copied ✓";
  });
}

function renderStatus(status) {
  const el = document.getElementById("status");
  const state = (status && status.state) || "none";
  const label =
    state === "active"
      ? "Watching your inbox"
      : state === "reviving"
        ? "Reconnecting to Gmail…"
        : "No Gmail tab open";
  el.className = `status ${state}`;
  el.innerHTML = `<span class="dot"></span> ${label}`;

  if (state === "none") {
    const btn = document.createElement("button");
    btn.className = "open-gmail";
    btn.textContent = "Open Gmail";
    btn.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://mail.google.com/" });
      window.close();
    });
    el.after(btn);
  }
}

chrome.storage.local.get(["latestOtp", "gmailStatus"], ({ latestOtp, gmailStatus }) => {
  renderStatus(gmailStatus);
  render(latestOtp);
});

// Live-update the status if it changes while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.gmailStatus) {
    document.querySelectorAll(".open-gmail").forEach((b) => b.remove());
    renderStatus(changes.gmailStatus.newValue);
  }
});
