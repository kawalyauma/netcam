import { api, type Package } from "./api";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const connectedView = $("connected-view");
const connectedDetails = $("connected-details");
const appView = $("app-view");
const subtitle = $("subtitle");
const packageList = $("package-list");

let selectedPackageId: string | null = null;
let payPollTimer: number | undefined;

function setMsg(id: string, text: string, kind: "error" | "ok" | "" = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind}`;
}

function formatUgx(amount: number): string {
  return `UGX ${amount.toLocaleString()}`;
}

function renderPackages(packages: Package[]) {
  if (packages.length === 0) {
    packageList.innerHTML = `<p class="subtitle">No packages available right now.</p>`;
    return;
  }
  packageList.innerHTML = packages
    .map(
      (p) => `
      <div class="pkg" data-id="${p.id}">
        <span>${p.name}</span>
        <span class="price">${formatUgx(p.priceUgx)}</span>
      </div>`,
    )
    .join("");

  packageList.querySelectorAll<HTMLElement>(".pkg").forEach((el) => {
    el.addEventListener("click", () => {
      selectedPackageId = el.dataset.id ?? null;
      packageList.querySelectorAll(".pkg").forEach((p) => p.classList.remove("selected"));
      el.classList.add("selected");
    });
  });
}

function showConnected(status: { voucherCode?: string; expiresAt?: string; remainingDataMb?: number }) {
  appView.classList.add("hidden");
  connectedView.classList.remove("hidden");
  subtitle.textContent = "You're online";
  const parts: string[] = [];
  if (status.voucherCode) parts.push(`Code: ${status.voucherCode}`);
  if (status.expiresAt) parts.push(`Expires: ${new Date(status.expiresAt).toLocaleString()}`);
  if (status.remainingDataMb !== undefined) parts.push(`${Math.round(status.remainingDataMb)} MB left`);
  connectedDetails.textContent = parts.join(" · ");
}

function setupTabs() {
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      $(`tab-${tab.dataset.tab}`).classList.remove("hidden");
    });
  });
}

function pollPayment(paymentId: string) {
  clearInterval(payPollTimer);
  payPollTimer = window.setInterval(async () => {
    try {
      const result = await api.payStatus(paymentId);
      if (result.status === "SUCCESS" && result.voucherCode) {
        clearInterval(payPollTimer);
        setMsg("buy-msg", `Payment received! Connecting with code ${result.voucherCode}…`, "ok");
        const redeemResult = await api.redeem(result.voucherCode);
        if (redeemResult.ok) {
          showConnected({ voucherCode: result.voucherCode });
        }
      } else if (result.status === "FAILED") {
        clearInterval(payPollTimer);
        setMsg("buy-msg", "Payment failed or was cancelled. Please try again.", "error");
      }
    } catch {
      // transient network hiccup — keep polling silently
    }
  }, 3000);
}

function setupBuy() {
  $("buy-submit").addEventListener("click", async () => {
    const phone = ($("buy-phone") as HTMLInputElement).value.trim();
    if (!selectedPackageId) {
      setMsg("buy-msg", "Pick a package first.", "error");
      return;
    }
    if (!phone) {
      setMsg("buy-msg", "Enter the phone number you'll pay with.", "error");
      return;
    }
    const btn = $("buy-submit") as HTMLButtonElement;
    btn.disabled = true;
    setMsg("buy-msg", "Starting payment — check your phone for the Mobile Money prompt…");
    try {
      const result = await api.pay(selectedPackageId, phone);
      pollPayment(result.paymentId);
    } catch (err) {
      setMsg("buy-msg", (err as Error).message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function setupCode() {
  $("code-submit").addEventListener("click", async () => {
    const code = ($("code-input") as HTMLInputElement).value.trim();
    if (!code) return;
    const btn = $("code-submit") as HTMLButtonElement;
    btn.disabled = true;
    setMsg("code-msg", "Connecting…");
    try {
      const result = await api.redeem(code);
      if (result.ok) {
        showConnected({ voucherCode: code });
      } else {
        setMsg("code-msg", result.message, "error");
      }
    } catch (err) {
      setMsg("code-msg", (err as Error).message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function setupRecover() {
  $("recover-request").addEventListener("click", async () => {
    const phone = ($("recover-phone") as HTMLInputElement).value.trim();
    if (!phone) return;
    try {
      await api.recover(phone);
      $("recover-otp-block").classList.remove("hidden");
      setMsg("recover-msg", "If that number has a voucher, a code was sent by SMS.", "ok");
    } catch (err) {
      setMsg("recover-msg", (err as Error).message, "error");
    }
  });

  $("recover-confirm").addEventListener("click", async () => {
    const phone = ($("recover-phone") as HTMLInputElement).value.trim();
    const otp = ($("recover-otp") as HTMLInputElement).value.trim();
    try {
      const result = await api.recoverConfirm(phone, otp);
      setMsg("recover-msg", `Your voucher: ${result.voucherCode}. Connecting…`, "ok");
      const redeemResult = await api.redeem(result.voucherCode);
      if (redeemResult.ok) showConnected({ voucherCode: result.voucherCode });
    } catch (err) {
      setMsg("recover-msg", (err as Error).message, "error");
    }
  });
}

async function init() {
  setupTabs();
  setupBuy();
  setupCode();
  setupRecover();

  try {
    const status = await api.status();
    if (status.authorized) {
      showConnected(status);
      return;
    }
  } catch {
    // fall through to the buy/code/recover screen
  }

  appView.classList.remove("hidden");
  try {
    renderPackages(await api.getPackages());
  } catch {
    packageList.innerHTML = `<p class="subtitle">Couldn't load packages. Pull down to refresh.</p>`;
  }
}

init();
