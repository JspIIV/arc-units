/**
 * End-to-end check of the built library against live Arc testnet.
 *
 * Uses the package's own throttled transport and pinned-block reader, so a
 * clean run also demonstrates that the rate limiting and block-pinning work.
 */
import { createPublicClient } from "viem";
import {
  arcTestnet,
  describeBalance,
  formatNative,
  gasCost,
  largestTransferable,
  native,
  readUsdcBalance,
  throttledHttp,
  toErc20,
} from "../dist/index.js";

const client = createPublicClient({
  chain: arcTestnet,
  transport: throttledHttp(undefined, {
    onRateLimit: ({ method, waitMs }) => console.log(`  [throttle] ${method} backing off ${waitMs}ms`),
  }),
});

const head = await client.getBlockNumber();
const block = await client.getBlock({ blockNumber: head, includeTransactions: true });
const addresses = [...new Set(block.transactions.map((tx) => tx.from).filter(Boolean))].slice(0, 5);

console.log(`Arc testnet @ block ${head}, sampling ${addresses.length} accounts\n`);

let inconsistent = 0;
for (const address of addresses) {
  const balance = await readUsdcBalance(client, address, { blockNumber: head });
  console.log(describeBalance(balance));
  if (!balance.consistent) inconsistent++;
}

const gasPrice = native(await client.getGasPrice());
const transferCost = gasCost(gasPrice, 21_000n);

console.log(`\ngas price          : ${formatNative(gasPrice)} USDC per gas unit`);
console.log(`21000-gas transfer : ${formatNative(transferCost)} USDC`);
console.log(`same fee via ERC-20: ${toErc20(transferCost).value} (6-decimal units)`);

const wallet = native(1_234_567_890_123_456_789n);
console.log(`\nsending a full balance of ${formatNative(wallet)} USDC over ERC-20:`);
console.log(`  largest transferable : ${formatNative(largestTransferable(wallet))} USDC`);
console.log(`  stranded as dust     : ${formatNative(toErc20(wallet).dust)} USDC`);

console.log(inconsistent === 0 ? "\nOK: all accounts consistent" : `\nFAIL: ${inconsistent} inconsistent`);
process.exitCode = inconsistent === 0 ? 0 : 1;
