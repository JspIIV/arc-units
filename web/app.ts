/**
 * Interactive demo for arc-units.
 *
 * Everything here runs against live Arc testnet through the same library the
 * package ships — the point is to show the two interfaces disagreeing on real
 * data, not to describe it.
 */
import { createPublicClient, isAddress, type Address } from "viem";
import {
  ERC20_DECIMALS,
  NATIVE_DECIMALS,
  SCALE,
  arcTestnet,
  formatErc20,
  formatNative,
  parseNative,
  readUsdcBalance,
  throttledHttp,
  toErc20,
} from "../src/index.ts";

const client = createPublicClient({ chain: arcTestnet, transport: throttledHttp() });

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** Build a definition row; `lost` tints the value as money that disappears. */
function row(term: string, value: string, unit?: string, lost = false): string {
  const suffix = unit ? `<span class="unit">${unit}</span>` : "";
  return `<dt>${term}</dt><dd${lost ? ' class="lost"' : ""}>${value}${suffix}</dd>`;
}

function show(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.hidden = false;
}

function hide(el: HTMLElement): void {
  el.hidden = true;
}

// --- converter -------------------------------------------------------------

const amountInput = $<HTMLInputElement>("amount");
const convertOut = $("convert-out");
const convertError = $("convert-error");

function renderConversion(): void {
  const raw = amountInput.value.trim();
  if (raw === "") {
    convertOut.innerHTML = "";
    hide(convertError);
    return;
  }

  let amount: ReturnType<typeof parseNative>;
  try {
    amount = parseNative(raw);
  } catch (error) {
    convertOut.innerHTML = "";
    show(convertError, error instanceof Error ? error.message : String(error));
    return;
  }
  hide(convertError);

  const { value, dust } = toErc20(amount);

  let banner = "";
  if (value === 0n && amount > 0n) {
    banner = `<div class="banner">The ERC-20 interface reports <strong>zero</strong> for this
      amount. Anything below 0.000001 USDC is entirely invisible to it — which is why a gas price
      read as a 6-decimal amount rounds away to nothing.</div>`;
  } else if (dust > 0n) {
    banner = `<div class="banner">Sending this over ERC-20 strands
      <strong>${formatNative(dust)} USDC</strong>. The most you can move in one transfer is
      ${formatErc20(value)} USDC.</div>`;
  } else {
    banner = `<div class="banner">Exactly representable — this amount survives a round trip through
      the ERC-20 interface with nothing left behind.</div>`;
  }

  convertOut.innerHTML =
    row("native", amount.toString(), `raw, ${NATIVE_DECIMALS}d`) +
    row("", `${formatNative(amount)} USDC`) +
    row("ERC-20", value.toString(), `raw, ${ERC20_DECIMALS}d`) +
    row("", `${formatErc20(value)} USDC`) +
    row("dust", dust === 0n ? "0" : `${dust} (${formatNative(dust)} USDC)`, undefined, dust > 0n) +
    banner;
}

amountInput.addEventListener("input", renderConversion);

for (const button of document.querySelectorAll<HTMLButtonElement>(".presets button[data-amount]")) {
  button.addEventListener("click", () => {
    amountInput.value = button.dataset.amount ?? "";
    renderConversion();
  });
}

renderConversion();

// --- live lookup -----------------------------------------------------------

const addressInput = $<HTMLInputElement>("address");
const lookupButton = $<HTMLButtonElement>("lookup");
const sampleButton = $<HTMLButtonElement>("sample");
const lookupOut = $("lookup-out");
const lookupError = $("lookup-error");
const lookupStatus = $("lookup-status");

function setBusy(busy: boolean): void {
  lookupButton.disabled = busy;
  sampleButton.disabled = busy;
}

async function lookup(address: Address): Promise<void> {
  setBusy(true);
  hide(lookupError);
  show(lookupStatus, "reading both interfaces at one block…");

  try {
    const balance = await readUsdcBalance(client, address);
    hide(lookupStatus);

    const explorer = `${arcTestnet.blockExplorers.default.url}/address/${address}`;
    const consistency = balance.consistent
      ? `<div class="banner">Both interfaces agree: ERC-20 is exactly
         <code>floor(native / ${SCALE})</code>.</div>`
      : `<div class="banner">The two interfaces disagreed. That is not routine — it suggests Arc
         changed how the precompile behaves.</div>`;

    lookupOut.innerHTML =
      row("account", `<a href="${explorer}" target="_blank" rel="noopener">${address}</a>`) +
      row("block", balance.blockNumber.toString()) +
      row("native", `${formatNative(balance.native)} USDC`, `${NATIVE_DECIMALS}d`) +
      row("ERC-20", `${formatErc20(balance.erc20)} USDC`, `${ERC20_DECIMALS}d`) +
      row(
        "hidden dust",
        balance.dust === 0n ? "none" : `${formatNative(balance.dust)} USDC`,
        undefined,
        balance.dust > 0n,
      ) +
      consistency;
  } catch (error) {
    lookupOut.innerHTML = "";
    hide(lookupStatus);
    show(lookupError, error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

lookupButton.addEventListener("click", () => {
  const value = addressInput.value.trim();
  if (!isAddress(value)) {
    lookupOut.innerHTML = "";
    show(lookupError, "That is not a valid address — expected 0x followed by 40 hex characters.");
    return;
  }
  void lookup(value);
});

addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lookupButton.click();
});

sampleButton.addEventListener("click", async () => {
  setBusy(true);
  hide(lookupError);
  show(lookupStatus, "finding a recently active account…");

  try {
    // Walk back from the head until a block actually contains transactions.
    let blockNumber = await client.getBlockNumber();
    for (let i = 0; i < 20; i++) {
      const block = await client.getBlock({ blockNumber, includeTransactions: true });
      const senders = block.transactions.map((tx) => tx.from).filter(Boolean);
      const pick = senders[Math.floor(Math.random() * senders.length)];
      if (pick) {
        addressInput.value = pick;
        await lookup(pick);
        return;
      }
      blockNumber -= 1n;
    }
    hide(lookupStatus);
    show(lookupError, "No transactions in the last 20 blocks — try again in a moment.");
  } catch (error) {
    hide(lookupStatus);
    show(lookupError, error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
});
