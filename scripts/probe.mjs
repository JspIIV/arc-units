/**
 * Ground-truth probe for Arc testnet's dual USDC interface.
 *
 * Docs and third-party sources disagree on how many decimals the native gas
 * token uses (6 vs 18), so we measure it instead of trusting either. The probe
 * reads the same balance through both interfaces and reports the empirical
 * ratio between them.
 */
import { createPublicClient, http, defineChain, formatUnits } from "viem";

const RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

/** ERC-20 view onto the native balance, per Circle's docs. */
const USDC_PRECOMPILE = "0x3600000000000000000000000000000000000000";

const erc20Abi = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const client = createPublicClient({ chain: arcTestnet, transport: http() });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The public endpoint answers "request limit reached" under even modest load,
 * so every call goes through here: one at a time, spaced out, with backoff.
 */
let chain = Promise.resolve();
function rpc(label, fn) {
  const run = chain.then(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const out = await fn();
        await sleep(250);
        return out;
      } catch (err) {
        const limited = String(err.details ?? err.message).includes("request limit");
        if (!limited || attempt === 5) throw err;
        const backoff = 1000 * 2 ** attempt;
        process.stderr.write(`  (rate limited on ${label}, retrying in ${backoff}ms)\n`);
        await sleep(backoff);
      }
    }
  });
  chain = run.catch(() => {});
  return run;
}

const read = (functionName, args = [], blockNumber) =>
  rpc(functionName, () =>
    client.readContract({ address: USDC_PRECOMPILE, abi: erc20Abi, functionName, args, blockNumber }),
  );

/** Collect distinct transacting addresses by walking back from the head block. */
async function findActiveAddresses(want, maxBlocksBack = 20) {
  const head = await rpc("getBlockNumber", () => client.getBlockNumber());
  const seen = new Set();
  for (let i = 0n; i < BigInt(maxBlocksBack) && seen.size < want; i++) {
    const block = await rpc("getBlock", () =>
      client.getBlock({ blockNumber: head - i, includeTransactions: true }),
    );
    for (const tx of block.transactions) {
      if (tx.from) seen.add(tx.from);
      if (seen.size >= want) break;
    }
  }
  return [...seen];
}

async function main() {
  console.log(`RPC: ${RPC}\n`);

  const chainId = await rpc("getChainId", () => client.getChainId());
  const blockNumber = await rpc("getBlockNumber", () => client.getBlockNumber());
  const gasPrice = await rpc("getGasPrice", () => client.getGasPrice());

  console.log("--- chain ---");
  console.log(`chainId      : ${chainId}${chainId === 5042002 ? " (matches docs)" : " (MISMATCH vs docs: 5042002)"}`);
  console.log(`block number : ${blockNumber}`);
  console.log(`gas price    : ${gasPrice} raw units`);
  console.log(`  a 21000-gas transfer costs ${formatUnits(gasPrice * 21000n, 18)} USDC if native is 18-decimal`);
  console.log(`  a 21000-gas transfer costs ${formatUnits(gasPrice * 21000n, 6)} USDC if native is 6-decimal`);

  // Measure block time rather than quoting the marketing number.
  const b0 = await rpc("getBlock", () => client.getBlock({ blockNumber: blockNumber - 10n }));
  const b1 = await rpc("getBlock", () => client.getBlock({ blockNumber }));
  console.log(`avg block    : ${(Number(b1.timestamp - b0.timestamp) * 1000) / 10} ms (over 10 blocks)`);

  console.log("\n--- USDC precompile ---");
  const name = await read("name");
  const symbol = await read("symbol");
  const erc20Decimals = await read("decimals");
  const totalSupply = await read("totalSupply");

  console.log(`address      : ${USDC_PRECOMPILE}`);
  console.log(`name/symbol  : ${name} / ${symbol}`);
  console.log(`decimals     : ${erc20Decimals}`);
  console.log(`totalSupply  : ${totalSupply}`);
  console.log(`  = ${formatUnits(totalSupply, erc20Decimals)} read as ${erc20Decimals}-decimal`);
  console.log(`  = ${formatUnits(totalSupply, 18)} read as 18-decimal`);

  console.log("\n--- dual-interface comparison ---");
  const addresses = await findActiveAddresses(8);
  if (addresses.length === 0) {
    console.log("no transacting address found; skipping comparison");
    return;
  }

  // Both reads are pinned to one block: these accounts are active, and a
  // balance change between the two calls would look like a broken invariant.
  const at = await rpc("getBlockNumber", () => client.getBlockNumber());
  const factor = 10n ** BigInt(18 - Number(erc20Decimals));
  console.log(`pinned at block ${at}, testing  erc20 === native / ${factor}  (floor)\n`);

  let checked = 0;
  let matched = 0;
  let dustSeen = 0n;

  for (const address of addresses) {
    const native = await rpc("getBalance", () => client.getBalance({ address, blockNumber: at }));
    const erc20 = await read("balanceOf", [address], at);

    if (native === 0n) {
      console.log(`${address}  empty account, skipped`);
      continue;
    }

    checked++;
    const dust = native % factor; // value the ERC-20 view cannot represent
    const ok = erc20 === native / factor;
    if (ok) matched++;
    if (dust > 0n) dustSeen++;

    console.log(
      `${address}  native=${native}  erc20=${erc20}  dust=${dust}  ${ok ? "OK" : "MISMATCH"}`,
    );
  }

  console.log(`\n${matched}/${checked} accounts satisfy erc20 === floor(native / 1e12)`);
  console.log(`${dustSeen}/${checked} accounts hold sub-6-decimal dust invisible to the ERC-20 view`);
  if (matched === checked && checked > 0) {
    console.log("CONFIRMED: native is 18-decimal, ERC-20 view is a truncating 6-decimal projection");
  } else {
    console.log("NOT CONFIRMED: investigate the mismatching accounts before relying on the factor");
  }
}

main().catch((err) => {
  console.error(`\nprobe failed: ${err.shortMessage ?? err.message}`);
  console.error(`details: ${err.details ?? "(none)"}`);
  process.exitCode = 1;
});
