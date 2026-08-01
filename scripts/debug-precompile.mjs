/** Isolate why the ERC-20 precompile read fails: is there code there at all? */
import { createPublicClient, http, defineChain } from "viem";

const RPC = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const client = createPublicClient({ chain: arcTestnet, transport: http() });

const CANDIDATES = [
  "0x3600000000000000000000000000000000000000",
  "0x0000000000000000000000000000000000000360",
  "0x3600000000000000000000000000000000000001",
];

// keccak selectors for decimals()/symbol()/name()/totalSupply()
const SELECTORS = {
  "decimals()": "0x313ce567",
  "symbol()": "0x95d89b41",
  "name()": "0x06fdde03",
  "totalSupply()": "0x18160ddd",
};

for (const address of CANDIDATES) {
  console.log(`\n=== ${address} ===`);
  try {
    const code = await client.getCode({ address });
    console.log(`code: ${code ? `${code.slice(0, 42)}... (${(code.length - 2) / 2} bytes)` : "none"}`);
  } catch (err) {
    console.log(`getCode error: ${err.shortMessage ?? err.message}`);
  }

  for (const [sig, data] of Object.entries(SELECTORS)) {
    try {
      const res = await client.request({ method: "eth_call", params: [{ to: address, data }, "latest"] });
      console.log(`  ${sig.padEnd(14)} -> ${res}`);
    } catch (err) {
      const detail = err.details ?? err.shortMessage ?? err.message;
      console.log(`  ${sig.padEnd(14)} -> ERROR: ${String(detail).split("\n")[0]}`);
    }
  }
}
