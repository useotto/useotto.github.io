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

chrome.storage.local.get("latestOtp", ({ latestOtp }) => render(latestOtp));
