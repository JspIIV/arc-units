/**
 * Render the three-minute walkthrough straight to an MP4.
 *
 * The browser version of this demo turned out to be unrecordable on the
 * machine that needed to record it, and a submission deadline is a bad place
 * to keep debugging someone else's rendering stack. This path never opens a
 * browser: scenes are drawn as SVG, rasterised with sharp, and sequenced by a
 * bundled ffmpeg. Same content, same live measurements, no capture step.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import { createPublicClient, formatUnits } from "viem";
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
} from "../dist/index.js";

const run = promisify(execFile);

const W = 1920;
const H = 1080;
const FPS = 30;
const OUT = "video";
const MARGIN = 150;

const C = {
  bg: "#0c0e12",
  panel: "#151922",
  ink: "#eef0f5",
  dim: "#8d95a8",
  line: "#262c37",
  accent: "#6b9bff",
  ok: "#55c98d",
  hot: "#ffab5e",
};

const SANS = "Segoe UI, Helvetica, Arial, sans-serif";
const MONO = "Consolas, Courier New, monospace";

const esc = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rough width estimate, good enough to catch lines that will overflow. */
const approxWidth = (text, size, mono) => text.length * size * (mono ? 0.6 : 0.5);

// --- live data --------------------------------------------------------------

const client = createPublicClient({ chain: arcTestnet, transport: throttledHttp() });

async function collect() {
  const head = await client.getBlockNumber();
  let subject = null;

  for (let i = 0n; i < 25n && !subject; i++) {
    const block = await client.getBlock({ blockNumber: head - i, includeTransactions: true });
    for (const tx of block.transactions) {
      if (!tx.from) continue;
      const balance = await client.getBalance({ address: tx.from });
      if (balance > 1_000_000_000_000_000n) {
        subject = tx.from;
        break;
      }
    }
  }
  if (!subject) throw new Error("no funded account found in recent blocks");

  const balance = await readUsdcBalance(client, subject);
  const price = native(await client.getGasPrice());
  const [lensNative, lensErc20, lensDust, lensOk] = await client.readContract({
    address: DUST_LENS_TESTNET,
    abi: dustLensAbi,
    functionName: "inspect",
    args: [subject],
    blockNumber: balance.blockNumber,
  });

  return {
    address: subject,
    shortAddress: `${subject.slice(0, 10)}…${subject.slice(-6)}`,
    block: balance.blockNumber.toString(),
    native: formatNative(balance.native),
    erc20: formatErc20(balance.erc20),
    nativeRaw: balance.native.toString(),
    erc20Raw: balance.erc20.toString(),
    dustRaw: balance.dust.toString(),
    dustFmt: formatNative(balance.dust),
    gas: formatUnits(gasCost(price, 21_000n), 18),
    lensNative: lensNative.toString(),
    lensErc20: lensErc20.toString(),
    lensDust: lensDust.toString(),
    lensOk: String(lensOk),
  };
}

// --- drawing ----------------------------------------------------------------

/**
 * Scenes are described as a flat list of blocks and laid out top-down. Keeping
 * the vocabulary small (heading, line, code, cards) is what makes the SVG
 * simple enough for librsvg to render identically every time.
 */
function draw(blocks) {
  const parts = [`<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  const heights = blocks.map(measure);
  const totalHeight = heights.reduce((a, b) => a + b, 0);
  let y = Math.max(120, (H - totalHeight) / 2);

  for (const [i, block] of blocks.entries()) {
    parts.push(render(block, y));
    y += heights[i];
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

function measure(block) {
  switch (block.type) {
    case "kicker": return 70;
    case "title": return block.text.length > 22 ? 210 : 170;
    case "heading": return 130;
    case "line": return (block.gap ?? 0) + 66;
    case "spacer": return block.size;
    case "code": return block.lines.length * 58 + 80;
    case "cards": return 300;
    default: return 0;
  }
}

function render(block, y) {
  switch (block.type) {
    case "kicker":
      return text(block.text, MARGIN, y + 40, {
        size: 30, fill: C.accent, weight: 600, spacing: 5,
      });

    case "title":
      return block.text
        .split("\n")
        .map((line, i) =>
          text(line, MARGIN, y + 110 + i * 105, { size: 108, fill: C.ink, weight: 700, spacing: -3 }),
        )
        .join("");

    case "heading":
      return text(block.text, MARGIN, y + 80, { size: 66, fill: C.ink, weight: 650, spacing: -1.5 });

    case "line":
      return text(block.text, MARGIN, y + (block.gap ?? 0) + 46, {
        size: block.size ?? 40,
        fill: block.fill ?? C.dim,
        mono: block.mono,
        weight: block.weight ?? 400,
      });

    case "spacer":
      return "";

    case "code": {
      const height = block.lines.length * 58 + 44;
      const box = `<rect x="${MARGIN}" y="${y}" width="${W - MARGIN * 2}" height="${height}" rx="18" fill="${C.panel}" stroke="${C.line}"/>`;
      const rows = block.lines
        .map((row, i) =>
          text(row.text, MARGIN + 44, y + 62 + i * 58, {
            size: 38, fill: row.fill ?? C.ink, mono: true,
          }),
        )
        .join("");
      return box + rows;
    }

    case "cards": {
      const gap = 40;
      const width = (W - MARGIN * 2 - gap) / 2;
      return block.items
        .map((card, i) => {
          const x = MARGIN + i * (width + gap);
          return (
            `<rect x="${x}" y="${y}" width="${width}" height="260" rx="20" fill="${C.panel}" stroke="${C.line}"/>` +
            text(card.label, x + 40, y + 62, { size: 26, fill: C.dim, weight: 600, spacing: 3 }) +
            text(card.value, x + 40, y + 150, {
              size: card.value.length > 18 ? 46 : 62,
              fill: card.fill ?? C.ink,
              mono: true,
              weight: 600,
            }) +
            text(card.note, x + 40, y + 215, { size: 28, fill: C.dim })
          );
        })
        .join("");
    }

    default:
      return "";
  }
}

function text(content, x, y, options = {}) {
  const { size = 40, fill = C.ink, weight = 400, mono = false, spacing = 0 } = options;
  const family = mono ? MONO : SANS;
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${family}"`,
    `font-size="${size}"`,
    `fill="${fill}"`,
    `font-weight="${weight}"`,
    // Without this SVG collapses runs of spaces, which silently destroys the
    // column alignment that makes the code and output blocks readable.
    `xml:space="preserve"`,
  ];
  if (spacing) attrs.push(`letter-spacing="${spacing}"`);

  if (approxWidth(content, size, mono) > W - MARGIN * 2) {
    console.warn(`  ! line may overflow: "${String(content).slice(0, 60)}…"`);
  }
  return `<text ${attrs.join(" ")}>${esc(content)}</text>`;
}

// --- scenes -----------------------------------------------------------------

function scenes(d) {
  return [
    {
      seconds: 9,
      blocks: [
        { type: "kicker", text: "ARC  ·  CIRCLE'S STABLECOIN-NATIVE L1" },
        { type: "title", text: "One balance.\nTwo answers." },
        { type: "line", text: "On Arc, USDC is the gas token.", gap: 30 },
        { type: "line", text: "That has a consequence almost nobody types correctly." },
      ],
    },
    {
      seconds: 20,
      blocks: [
        { type: "heading", text: "The same account, read two ways" },
        {
          type: "cards",
          items: [
            { label: "NATIVE  ·  getBalance()", value: `${d.native}`, note: "18 decimals · gas is priced here" },
            { label: "ERC-20  ·  balanceOf()", value: `${d.erc20}`, fill: C.hot, note: "6 decimals · truncates" },
          ],
        },
        { type: "line", text: `${d.shortAddress}  ·  both reads pinned to block ${d.block}`, gap: 40, size: 34 },
        { type: "line", text: "Live from Arc testnet.", size: 34 },
      ],
    },
    {
      seconds: 20,
      blocks: [
        { type: "heading", text: "They are not two tokens" },
        { type: "line", text: "A precompile forwards ERC-20 calls to the native balance." },
        { type: "line", text: "Same money — so a wallet showing both counts it twice." },
        {
          type: "code",
          lines: [{ text: "balanceOf()  ===  floor( getBalance() / 1e12 )", fill: C.accent }],
        },
        { type: "line", text: "Measured across every live account sampled. It held every time.", size: 34 },
      ],
    },
    {
      seconds: 22,
      blocks: [
        { type: "heading", text: "Which means money you cannot see" },
        { type: "line", text: "Anything below 0.000001 USDC exists, but no token transfer can move it." },
        {
          type: "code",
          lines: [
            { text: `native  ${d.nativeRaw.padStart(24)}` },
            { text: `erc20   ${d.erc20Raw.padStart(24)}` },
            { text: `dust    ${d.dustRaw.padStart(24)}`, fill: C.hot },
          ],
        },
        { type: "line", text: `Stranded on this account alone: ${d.dustFmt} USDC`, fill: C.hot, gap: 20 },
      ],
    },
    {
      seconds: 18,
      blocks: [
        { type: "heading", text: "And fees that round to nothing" },
        {
          type: "cards",
          items: [
            { label: "A TRANSFER, PRICED NATIVELY", value: `${d.gas}`, fill: C.ok, note: "correct" },
            { label: "THE SAME GAS, READ AS ERC-20", value: "0", fill: C.hot, note: "gone" },
          ],
        },
        {
          type: "line",
          text: "Gas runs three orders of magnitude below what the token interface can express.",
          gap: 40,
          size: 34,
        },
      ],
    },
    {
      seconds: 18,
      blocks: [
        { type: "heading", text: "Even the logs disagree" },
        { type: "line", text: "Under EIP-7708 a native USDC movement emits a Transfer at 18 decimals" },
        { type: "line", text: "from a system address. The ERC-20 contract emits its own at 6." },
        { type: "spacer", size: 30 },
        { type: "line", text: "One payment, two log streams, two scales.", fill: C.ink },
        { type: "line", text: "An indexer treating them as one token double-counts, or is off by a trillion." },
      ],
    },
    {
      seconds: 26,
      blocks: [
        { type: "heading", text: "arc-units makes the mistake impossible" },
        {
          type: "code",
          lines: [
            { text: "const balance = native(await client.getBalance({ address }));" },
            { text: "" },
            { text: "const { value, dust } = toErc20(balance);" },
            { text: "// value -> what the recipient actually receives", fill: C.dim },
            { text: "// dust  -> what would have vanished silently", fill: C.dim },
            { text: "" },
            { text: "toErc20Exact(balance);   // throws instead of losing it", fill: C.ok },
            { text: "balance + erc20Amount;   // compile error", fill: C.hot },
          ],
        },
        { type: "line", text: "The conversion hands you the dust. You cannot drop it by accident.", gap: 20 },
      ],
    },
    {
      seconds: 26,
      blocks: [
        { type: "heading", text: "And a contract that proves it on-chain" },
        { type: "line", text: "DustLens · deployed and verified on Arc testnet", size: 36 },
        { type: "line", text: DUST_LENS_TESTNET, mono: true, size: 32, fill: C.accent },
        {
          type: "code",
          lines: [
            { text: "inspect(account) returns" },
            { text: `  nativeBalance   ${d.lensNative}` },
            { text: `  erc20Balance    ${d.lensErc20}` },
            { text: `  dust            ${d.lensDust}`, fill: C.hot },
            { text: `  consistent      ${d.lensOk}`, fill: C.ok },
          ],
        },
        { type: "line", text: "One call, one block — the two readings can never straddle a 500 ms block.", size: 34 },
      ],
    },
    {
      seconds: 21,
      blocks: [
        { type: "title", text: "Correct by\nconstruction." },
        { type: "line", text: "Library · live demo · verified contract · reproducible measurement.", gap: 30 },
        { type: "spacer", size: 20 },
        { type: "line", text: "arc-units.vercel.app", mono: true, fill: C.accent, size: 44 },
        { type: "line", text: "github.com/JspIIV/arc-units", mono: true, fill: C.accent, size: 44 },
        { type: "spacer", size: 20 },
        { type: "line", text: "Programmable Money Hackathon · DeFi Track", size: 30 },
      ],
    },
  ];
}

// --- build ------------------------------------------------------------------

console.log("reading live Arc testnet state…");
const data = await collect();
console.log(`  account ${data.shortAddress} at block ${data.block}`);
console.log(`  native ${data.native} / erc20 ${data.erc20} / dust ${data.dustFmt}`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const list = scenes(data);
const totalSeconds = list.reduce((sum, s) => sum + s.seconds, 0);
console.log(`\nrendering ${list.length} scenes, ${totalSeconds}s total`);

const frames = [];
for (const [i, scene] of list.entries()) {
  const file = path.join(OUT, `scene-${String(i + 1).padStart(2, "0")}.png`);
  await sharp(Buffer.from(draw(scene.blocks))).png().toFile(file);
  frames.push({ file: path.basename(file), seconds: scene.seconds });
  console.log(`  scene ${i + 1}  ${scene.seconds}s  -> ${file}`);
}

// The concat demuxer ignores the final entry's duration, so the last frame is
// listed twice to hold it on screen for its full time.
const manifest =
  frames.map((f) => `file '${f.file}'\nduration ${f.seconds}`).join("\n") +
  `\nfile '${frames.at(-1).file}'\n`;
await writeFile(path.join(OUT, "scenes.txt"), manifest);

const output = path.join(OUT, "arc-units-demo.mp4");
console.log("\nencoding…");
await run(ffmpeg, [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", path.join(OUT, "scenes.txt"),
  "-vf", `fps=${FPS},format=yuv420p`,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-movflags", "+faststart",
  output,
]);

const { stdout } = await run(ffmpeg, ["-i", output]).catch((error) => ({ stdout: error.stderr ?? "" }));
const duration = stdout.match(/Duration: (\d+:\d+:\d+\.\d+)/)?.[1];
console.log(`\nwrote ${output}`);
console.log(`duration: ${duration ?? "unknown"} (expected ${totalSeconds}s)`);
