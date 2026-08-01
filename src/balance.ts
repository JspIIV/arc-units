/** Reading Arc balances through both interfaces without getting a torn result. */
import type { Address, PublicClient } from "viem";
import { USDC_ERC20_ADDRESS, erc20Abi } from "./chain.ts";
import {
  type Erc20,
  type Native,
  SCALE,
  erc20 as tagErc20,
  formatErc20,
  formatNative,
  native as tagNative,
  toErc20,
} from "./units.ts";

export interface UsdcBalance {
  /** The authoritative balance, 18 decimals. */
  readonly native: Native;
  /** What `balanceOf` reports at the same block, 6 decimals. */
  readonly erc20: Erc20;
  /** Native remainder the ERC-20 view truncates away. */
  readonly dust: Native;
  /** Block both reads were pinned to. */
  readonly blockNumber: bigint;
  /** False if the two interfaces disagreed — see {@link readUsdcBalance}. */
  readonly consistent: boolean;
}

/**
 * Read an account's USDC through both interfaces, pinned to a single block.
 *
 * Pinning is the point. Arc produces a block roughly every 500ms, so reading
 * `getBalance` and `balanceOf` at `latest` in sequence can straddle a block and
 * report two different balances for an active account — which looks exactly
 * like the invariant being broken. Both reads here use the same block number.
 *
 * `consistent` is false only if the chain genuinely disagreed with
 * `erc20 === native / 1e12`; treat it as a signal that Arc changed its
 * precompile behaviour, not as a routine condition.
 */
export async function readUsdcBalance(
  client: PublicClient,
  address: Address,
  options: { blockNumber?: bigint } = {},
): Promise<UsdcBalance> {
  const blockNumber = options.blockNumber ?? (await client.getBlockNumber());

  const rawNative = await client.getBalance({ address, blockNumber });
  const rawErc20 = (await client.readContract({
    address: USDC_ERC20_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    blockNumber,
  })) as bigint;

  const balance = tagNative(rawNative);
  const projected = toErc20(balance);

  return {
    native: balance,
    erc20: tagErc20(rawErc20),
    dust: projected.dust,
    blockNumber,
    consistent: rawErc20 === (projected.value as bigint),
  };
}

/** One-line summary of a balance, showing what each interface reports. */
export function describeBalance(balance: UsdcBalance): string {
  const dust = balance.dust === 0n ? "no dust" : `${formatNative(balance.dust)} USDC hidden from ERC-20`;
  return (
    `${formatNative(balance.native)} USDC native / ` +
    `${formatErc20(balance.erc20)} USDC via ERC-20 ` +
    `@ block ${balance.blockNumber} (${dust})` +
    (balance.consistent ? "" : " [INCONSISTENT]")
  );
}

/**
 * Largest native amount at or below `amount` that the ERC-20 interface can
 * carry without truncation. Use it to size a `transfer` so the recipient sees
 * exactly what you intended.
 */
export function largestTransferable(amount: Native): Native {
  return ((amount / SCALE) * SCALE) as Native;
}
