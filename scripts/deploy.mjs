/**
 * Deploy DustLens to Arc testnet and prove it works against live state.
 *
 * Deploying is easy; the useful part is the post-deploy check, which compares
 * the contract's on-chain reading against what the RPC reports off-chain. If
 * those disagree, the contract is wrong and should not be published.
 */
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, throttledHttp } from "../dist/index.js";

process.loadEnvFile(".env");

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY missing — run `node scripts/new-wallet.mjs`");

const account = privateKeyToAccount(key);
const transport = throttledHttp();
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

const artifact = JSON.parse(await readFile("artifacts/DustLens.json", "utf8"));

console.log(`deployer : ${account.address}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`balance  : ${formatUnits(balance, 18)} USDC`);

if (balance === 0n) {
  console.error("\nAccount has no USDC for gas.");
  console.error("Fund it at https://faucet.circle.com (choose Arc Testnet), then re-run.");
  process.exit(1);
}

const gas = await publicClient.estimateGas({
  account,
  data: artifact.bytecode,
});
const gasPrice = await publicClient.getGasPrice();
const cost = gas * gasPrice;
console.log(`gas      : ${gas} units at ${gasPrice} -> ${formatUnits(cost, 18)} USDC`);

if (cost > balance) {
  console.error(`\nNot enough for gas: need ${formatUnits(cost, 18)}, have ${formatUnits(balance, 18)}`);
  process.exit(1);
}

console.log("\ndeploying DustLens…");
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
});
console.log(`tx       : ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`deployment reverted in ${receipt.transactionHash}`);

const address = receipt.contractAddress;
console.log(`address  : ${address}`);
console.log(`block    : ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
console.log(`explorer : ${arcTestnet.blockExplorers.default.url}/address/${address}`);

// --- prove the deployed code actually works -------------------------------

console.log("\nverifying against live state…");

const read = (functionName, args) =>
  publicClient.readContract({ address, abi: artifact.abi, functionName, args });

const decimals = await read("erc20Decimals", []);
console.log(`  precompile decimals via contract : ${decimals}`);
if (Number(decimals) !== 6) throw new Error(`expected 6 decimals, contract read ${decimals}`);

const blockNumber = await publicClient.getBlockNumber();
const subject = account.address;

const [onChainNative, onChainErc20, onChainDust, consistent] = await publicClient.readContract({
  address,
  abi: artifact.abi,
  functionName: "inspect",
  args: [subject],
  blockNumber,
});

const rpcNative = await publicClient.getBalance({ address: subject, blockNumber });

console.log(`  contract nativeBalance : ${onChainNative}`);
console.log(`  rpc      getBalance    : ${rpcNative}`);
console.log(`  contract erc20Balance  : ${onChainErc20}`);
console.log(`  contract dust          : ${onChainDust}`);
console.log(`  contract consistent    : ${consistent}`);

if (onChainNative !== rpcNative) {
  throw new Error("contract and RPC disagree on the native balance");
}
if (!consistent) {
  throw new Error("contract reports the two interfaces disagreeing");
}
if (onChainErc20 * 1_000_000_000_000n + onChainDust !== onChainNative) {
  throw new Error("contract arithmetic does not reconstruct the native balance");
}

console.log("\nDEPLOYED AND VERIFIED");
console.log(`\nDustLens: ${address}`);
