/**
 * Exercise DustLens.splitEvenly against the deployed contract.
 *
 * Picks an amount that deliberately does not divide evenly, so the remainder
 * path is the one under test — that is where a naive splitter strands value
 * forever. Asserts the recipients' balances moved by exactly the right amount
 * and that the contract kept nothing.
 */
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, throttledHttp } from "../dist/index.js";

process.loadEnvFile(".env");

const LENS = process.env.DUSTLENS_ADDRESS ?? "0x3813b1dbc6285b9938f01f9055eee81b6495c489";

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const transport = throttledHttp();
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });
const { abi } = JSON.parse(await readFile("artifacts/DustLens.json", "utf8"));

// Two burn-style addresses, so nothing needs recovering afterwards.
// Wrapped rather than passed to map directly: getAddress takes an optional
// chainId second argument, and map would hand it the array index, producing
// an EIP-1191 checksum viem then rejects.
const recipients = [
  "0x0000000000000000000000000000000000000a11",
  "0x0000000000000000000000000000000000000b22",
].map((address) => getAddress(address));

// 3 wei short of a clean split: forces share=…, remainder=1 with 2 recipients.
const total = 1_000_000_000_001n;

console.log(`contract  : ${LENS}`);
console.log(`splitting : ${total} (${formatUnits(total, 18)} USDC) between ${recipients.length}`);
console.log(`  expect  : ${total / 2n} each, remainder ${total % 2n} to the first\n`);

const before = [];
for (const r of recipients) before.push(await publicClient.getBalance({ address: r }));
const contractBefore = await publicClient.getBalance({ address: LENS });

const hash = await walletClient.writeContract({
  address: LENS,
  abi,
  functionName: "splitEvenly",
  args: [recipients],
  value: total,
});
console.log(`tx        : ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("splitEvenly reverted");
console.log(`mined     : block ${receipt.blockNumber}, gas ${receipt.gasUsed}\n`);

let failures = 0;
const share = total / BigInt(recipients.length);
const remainder = total % BigInt(recipients.length);

for (const [i, r] of recipients.entries()) {
  const after = await publicClient.getBalance({ address: r });
  const moved = after - before[i];
  const expected = i === 0 ? share + remainder : share;
  const ok = moved === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r} received ${moved}, expected ${expected}`);
}

const contractAfter = await publicClient.getBalance({ address: LENS });
const stranded = contractAfter - contractBefore;
const ok = stranded === 0n;
if (!ok) failures++;
console.log(`${ok ? "ok  " : "FAIL"} contract kept ${stranded} (must be 0)`);

console.log(failures === 0 ? "\nSPLIT VERIFIED — nothing stranded" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
