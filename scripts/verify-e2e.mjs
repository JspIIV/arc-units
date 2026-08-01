/**
 * End-to-end check of the *published artifact*: imports from dist/ exactly as
 * a consumer would, and runs it against live Arc testnet.
 *
 * The unit tests exercise src/ against recorded fixtures, which cannot catch a
 * broken build, a wrong export map, or the chain changing behaviour.
 */
import assert from "node:assert/strict";
import { createPublicClient } from "viem";
import {
  SCALE,
  USDC_ERC20_ADDRESS,
  arcTestnet,
  describeBalance,
  erc20Abi,
  formatNative,
  gasCost,
  largestTransferable,
  native,
  parseNative,
  readUsdcBalance,
  throttledHttp,
  toErc20,
  toErc20Exact,
} from "../dist/index.js";

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
}

const rateLimits = [];
const client = createPublicClient({
  chain: arcTestnet,
  transport: throttledHttp(undefined, {
    onRateLimit: (info) => rateLimits.push(info),
  }),
});

console.log("1. chain identity");
const chainId = await client.getChainId();
check("chainId is 5042002", () => assert.equal(chainId, 5042002));
check("chain config agrees", () => assert.equal(arcTestnet.id, chainId));
check("native currency declared as 18 decimals", () =>
  assert.equal(arcTestnet.nativeCurrency.decimals, 18),
);

console.log("\n2. precompile is really there");
const decimals = await client.readContract({
  address: USDC_ERC20_ADDRESS,
  abi: erc20Abi,
  functionName: "decimals",
});
const symbol = await client.readContract({
  address: USDC_ERC20_ADDRESS,
  abi: erc20Abi,
  functionName: "symbol",
});
check("ERC-20 interface reports 6 decimals", () => assert.equal(Number(decimals), 6));
check("symbol is USDC", () => assert.equal(symbol, "USDC"));
check("SCALE matches the observed gap", () =>
  assert.equal(SCALE, 10n ** BigInt(18 - Number(decimals))),
);

console.log("\n3. live accounts through readUsdcBalance()");
const head = await client.getBlockNumber();
const addresses = new Set();
for (let i = 0n; addresses.size < 5 && i < 20n; i++) {
  const block = await client.getBlock({ blockNumber: head - i, includeTransactions: true });
  for (const tx of block.transactions) {
    if (tx.from) addresses.add(tx.from);
    if (addresses.size >= 5) break;
  }
}
assert.ok(addresses.size > 0, "no active accounts found");

let dusty = 0;
for (const address of addresses) {
  const balance = await readUsdcBalance(client, address);
  check(`${address} consistent across both interfaces`, () =>
    assert.equal(balance.consistent, true),
  );
  check(`${address} reconstructs exactly`, () =>
    assert.equal(balance.erc20 * SCALE + balance.dust, balance.native),
  );
  if (balance.dust > 0n) dusty++;
  console.log(`       ${describeBalance(balance)}`);
}
console.log(`  ${dusty}/${addresses.size} accounts carried dust`);

console.log("\n4. pinning actually prevents a torn read");
const [first] = [...addresses];
const pinned = await readUsdcBalance(client, first, { blockNumber: head });
check("honours an explicit block number", () => assert.equal(pinned.blockNumber, head));
check("both reads came from that block", () =>
  assert.equal(pinned.erc20 * SCALE + pinned.dust, pinned.native),
);

console.log("\n5. gas priced through the wrong interface disappears");
const gasPrice = native(await client.getGasPrice());
const transferCost = gasCost(gasPrice, 21000n);
check("a transfer costs a plausible fraction of a dollar", () => {
  assert.ok(transferCost > 0n, "cost must be positive");
  assert.ok(transferCost < parseNative("1"), `cost ${formatNative(transferCost)} should be under 1 USDC`);
});
check("the gas price itself rounds to zero over ERC-20", () =>
  assert.equal(toErc20(gasPrice).value, 0n),
);
console.log(`       gas price ${gasPrice} -> a transfer costs ${formatNative(transferCost)} USDC`);

console.log("\n6. dust guards");
const withDust = native(parseNative("1") + 1n);
check("toErc20Exact refuses a dusty amount", () =>
  assert.throws(() => toErc20Exact(withDust), /truncated/),
);
check("largestTransferable strips exactly the dust", () =>
  assert.equal(toErc20(largestTransferable(withDust)).dust, 0n),
);

console.log(`\nrate-limit retries handled by the transport: ${rateLimits.length}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
