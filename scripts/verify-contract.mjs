/**
 * Submit DustLens source to the Arc testnet explorer (Blockscout).
 *
 * Uses standard-JSON-input verification with the exact input recorded at
 * compile time, so the explorer recompiles under identical settings. Anything
 * reconstructed by hand risks a bytecode mismatch.
 */
import { readFile } from "node:fs/promises";

const ADDRESS = process.env.DUSTLENS_ADDRESS ?? "0x3813b1dbc6285b9938f01f9055eee81b6495c489";
const EXPLORER = "https://testnet.arcscan.app";

const standardInput = await readFile("artifacts/standard-input.json", "utf8");
const { explorerVersion } = JSON.parse(await readFile("artifacts/compiler.json", "utf8"));

const status = async () => {
  const res = await fetch(
    `${EXPLORER}/api?module=contract&action=getabi&address=${ADDRESS}`,
  );
  return res.json();
};

const before = await status();
if (before.status === "1") {
  console.log(`${ADDRESS} is already verified.`);
  console.log(`${EXPLORER}/address/${ADDRESS}?tab=contract`);
  process.exit(0);
}

console.log(`address  : ${ADDRESS}`);
console.log(`compiler : ${explorerVersion}`);
console.log("submitting standard JSON inputâ€¦\n");

const form = new FormData();
form.append("compiler_version", explorerVersion);
form.append("license_type", "mit");
form.append(
  "files[0]",
  new Blob([standardInput], { type: "application/json" }),
  "standard-input.json",
);

const res = await fetch(
  `${EXPLORER}/api/v2/smart-contracts/${ADDRESS}/verification/via/standard-input`,
  { method: "POST", body: form },
);

const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);

if (!res.ok) {
  console.error("\nSubmission rejected. Verify manually at:");
  console.error(`${EXPLORER}/address/${ADDRESS}/contract-verification`);
  process.exit(1);
}

// Blockscout verifies asynchronously; poll until the ABI shows up.
for (let attempt = 1; attempt <= 20; attempt++) {
  await new Promise((r) => setTimeout(r, 3000));
  const current = await status();
  if (current.status === "1") {
    console.log(`\nVERIFIED after ${attempt} checks`);
    console.log(`${EXPLORER}/address/${ADDRESS}?tab=contract`);
    process.exit(0);
  }
  process.stdout.write(`  waiting (${attempt}/20)\r`);
}

console.error("\nStill unverified after polling. Check the explorer page directly.");
process.exitCode = 1;

