/**
 * Generate a throwaway deployer key for Arc testnet and write it to .env.
 *
 * Testnet only. Never fund this address on a mainnet, and never reuse a key
 * that has ever held real value.
 */
import { existsSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

if (existsSync(".env")) {
  const { readFile } = await import("node:fs/promises");
  const current = await readFile(".env", "utf8");
  if (current.includes("DEPLOYER_PRIVATE_KEY=")) {
    const account = privateKeyToAccount(
      current.match(/DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1],
    );
    console.log(`.env already holds a deployer key for ${account.address}`);
    console.log("Delete that line first if you really want a new one.");
    process.exit(0);
  }
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const line = `DEPLOYER_PRIVATE_KEY=${privateKey}\n`;
if (existsSync(".env")) await appendFile(".env", line);
else await writeFile(".env", `# Arc testnet only. Never put a funded mainnet key here.\n${line}`);

console.log(`new testnet deployer: ${account.address}`);
console.log("private key written to .env (gitignored)");
console.log("\nFund it at https://faucet.circle.com — choose Arc Testnet.");
