/** Arc chain definitions and the addresses that matter. */
import { defineChain } from "viem";

/**
 * ERC-20 view onto the native USDC balance.
 *
 * Verified on Arc testnet: 1798 bytes of code, reports name/symbol `USDC` and
 * `decimals() == 6`. It is not a separate token — `balanceOf` forwards to the
 * account's native balance, so a UI showing both will double-count.
 */
export const USDC_ERC20_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** Docs moved from arc.network to arc.io; the old host still appears in older repos. */
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  testnet: true,
  // 18 decimals is the native scale, confirmed on-chain. The ERC-20 interface
  // at USDC_ERC20_ADDRESS is 6 decimals; see src/units.ts.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
});

export const erc20Abi = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
