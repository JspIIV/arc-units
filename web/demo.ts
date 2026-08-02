/**
 * Self-running walkthrough, built to be screen-recorded.
 *
 * Every figure on screen comes from live Arc testnet through the same library
 * the package ships — but all of it is fetched *before* the first scene, so the
 * recording never stalls on a slow RPC. If the chain is unreachable the demo
 * still plays with the measurements captured earlier, because a failed fetch
 * mid-take is worse than a slightly stale number.
 */
import { createPublicClient, formatUnits, type Address } from "viem";
import {
  DUST_LENS_TESTNET,
  arcTestnet,
  dustLensAbi,
  formatErc20,
  formatNative,
  gasCost,
  native,
  readUsdcBalance,
  throttledHttp,
} from "../src/index.ts";

const client = createPublicClient({ chain: arcTestnet, transport: throttledHttp() });

interface Readings {
  address: string;
  block: string;
  native: string;
  erc20: string;
  nativeRaw: string;
  erc20Raw: string;
  dustRaw: string;
  dustFmt: string;
  gasCost: string;
  lensNative: string;
  lensErc20: string;
  lensDust: string;
  lensOk: string;
}

/** Values recorded from a real run, used only if the chain cannot be reached. */
const FALLBACK: Readings = {
  address: "0xcf6d6cff…ae54c",
  block: "54743611",
  native: "124.524738542129438985",
  erc20: "124.524738",
  nativeRaw: "124524738542129438985",
  erc20Raw: "124524738",
  dustRaw: "542129438985",
  dustFmt: "0.000000542129438985",
  gasCost: "0.000483 USDC",
  lensNative: "124524738542129438985",
  lensErc20: "124524738",
  lensDust: "542129438985",
  lensOk: "true",
};

const short = (address: string) => `${address.slice(0, 10)}…${address.slice(-5)}`;

/** Walk back from the head until a block with transactions turns up. */
async function findActiveAccount(): Promise<Address | null> {
  const head = await client.getBlockNumber();
  for (let i = 0n; i < 20n; i++) {
    const block = await client.getBlock({ blockNumber: head - i, includeTransactions: true });
    for (const tx of block.transactions) {
      if (tx.from) {
        const balance = await client.getBalance({ address: tx.from });
        // Skip near-empty accounts: a row of zeros makes a dull frame.
        if (balance > 1_000_000_000_000_000n) return tx.from;
      }
    }
  }
  return null;
}

async function collect(): Promise<Readings> {
  const address = await findActiveAccount();
  if (!address) throw new Error("no active account found");

  const balance = await readUsdcBalance(client, address);
  const price = native(await client.getGasPrice());

  const [lensNative, lensErc20, lensDust, lensOk] = (await client.readContract({
    address: DUST_LENS_TESTNET,
    abi: dustLensAbi,
    functionName: "inspect",
    args: [address],
    blockNumber: balance.blockNumber,
  })) as [bigint, bigint, bigint, boolean];

  return {
    address: short(address),
    block: balance.blockNumber.toString(),
    native: `${formatNative(balance.native)} USDC`,
    erc20: `${formatErc20(balance.erc20)} USDC`,
    nativeRaw: balance.native.toString(),
    erc20Raw: balance.erc20.toString(),
    dustRaw: balance.dust.toString(),
    dustFmt: formatNative(balance.dust),
    gasCost: `${formatUnits(gasCost(price, 21_000n), 18)} USDC`,
    lensNative: lensNative.toString(),
    lensErc20: lensErc20.toString(),
    lensDust: lensDust.toString(),
    lensOk: String(lensOk),
  };
}

function paint(readings: Readings): void {
  for (const [key, value] of Object.entries(readings)) {
    for (const node of document.querySelectorAll(`[data-live="${key}"]`)) {
      node.textContent = value;
    }
  }
}

// --- playback ---------------------------------------------------------------

const gate = document.getElementById("gate")!;
const stage = document.getElementById("stage")!;
const startButton = document.getElementById("start") as HTMLButtonElement;
const preload = document.getElementById("preload")!;
const bar = document.getElementById("bar")!;
const scenes = [...document.querySelectorAll<HTMLElement>(".scene")];

const durations = scenes.map((scene) => Number(scene.dataset.seconds) * 1000);
const total = durations.reduce((sum, ms) => sum + ms, 0);

/** Cumulative end time of each scene, so position is a pure function of elapsed. */
const marks = durations.reduce<number[]>((acc, ms) => [...acc, (acc.at(-1) ?? 0) + ms], []);

let index = -1;
let elapsed = 0;
let paused = false;
let lastTick = 0;
let timer: number | undefined;

function show(next: number): void {
  if (next === index) return;
  scenes[index]?.classList.remove("active");
  index = next;
  scenes[index]?.classList.add("active");
}

/**
 * Driven by setInterval rather than requestAnimationFrame: rAF stops entirely
 * when the page is not compositing (background tab, minimised window, some
 * capture setups), which would freeze a recording mid-take. Intervals get
 * throttled but keep firing, and elapsed time is measured from the clock, so
 * scene changes stay on schedule either way.
 */
function tick(): void {
  const now = performance.now();
  const delta = now - lastTick;
  lastTick = now;
  if (paused) return;

  elapsed = Math.min(total, elapsed + delta);
  bar.style.width = `${(elapsed / total) * 100}%`;

  const next = marks.findIndex((mark) => elapsed < mark);
  show(next === -1 ? scenes.length - 1 : next);

  if (elapsed >= total) {
    clearInterval(timer);
    timer = undefined;
  }
}

function play(): void {
  gate.hidden = true;
  stage.hidden = false;
  elapsed = 0;
  paused = false;
  index = -1;
  for (const scene of scenes) scene.classList.remove("active");
  show(0);
  bar.style.width = "0%";
  lastTick = performance.now();
  clearInterval(timer);
  timer = setInterval(tick, 100);
}

startButton.addEventListener("click", play);

addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "f") {
    event.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }
  if (key === " " && timer !== undefined) {
    event.preventDefault();
    paused = !paused;
  }
  if (key === "r") {
    event.preventDefault();
    play();
  }
});

// Signal to the inline watchdog in the page that this module actually ran.
(window as unknown as { __demoReady: boolean }).__demoReady = true;

/*
 * Start is never disabled. Gating it on the network meant a slow or wedged RPC
 * left a dead button with no way to begin, which is a worse failure than
 * opening with the recorded readings. Live values are painted first from the
 * fallback and overwritten if the chain answers in time.
 */
paint(FALLBACK);
preload.textContent = "loading live readings…";

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);

void withTimeout(collect(), 15_000).then(
  (readings) => {
    paint(readings);
    preload.textContent = `live data loaded · ${Math.round(total / 1000)}s runtime`;
  },
  (error) => {
    preload.textContent = "chain unreachable — playing with previously recorded readings";
    console.warn("live fetch failed, using fallback", error);
  },
);
