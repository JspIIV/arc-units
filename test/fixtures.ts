/**
 * Real Arc testnet observations, captured by scripts/probe.mjs at block
 * 54723664. Both readings for each account were taken at that same block.
 *
 * These are regression anchors: if a future change breaks the relationship
 * between the two interfaces, these fail.
 */
export interface AccountObservation {
  readonly address: `0x${string}`;
  /** getBalance(), 18 decimals. */
  readonly native: bigint;
  /** balanceOf() on the 0x3600...0000 precompile, 6 decimals. */
  readonly erc20: bigint;
}

export const OBSERVED_BLOCK = 54_723_664n;

export const OBSERVED_ACCOUNTS: readonly AccountObservation[] = [
  {
    address: "0x3c3380cdfb94dfeeaa41cad9f58254ae380d752d",
    native: 35726935718376739834239453n,
    erc20: 35726935718376n,
  },
  {
    address: "0x8fcbc3d691ab60cf8b5418e0b84cd3d46e7bfb5e",
    native: 87019102609604306789n,
    erc20: 87019102n,
  },
  {
    address: "0xa426e08bd1fa8f15c49fc2cd0e2a9077bbd87b42",
    native: 91807692387507364772n,
    erc20: 91807692n,
  },
  {
    address: "0xc307cb325f1c46b6944b7454462a0164312e255f",
    native: 19590548115025126999n,
    erc20: 19590548n,
  },
  {
    address: "0xac21dc2acf0323c639a0561cbf43691586dd840a",
    native: 263563932233279053391n,
    erc20: 263563932n,
  },
  {
    address: "0x080dc2e5fff69004b27c9ce63b12f44ec28092b6",
    native: 44484228366655092676n,
    erc20: 44484228n,
  },
  {
    // Smallest sampled account: 0.0000061919... USDC. The ERC-20 view shows
    // 0.006191 of it, which is a different number by any reading.
    address: "0x32e44fce4c7fc9568b1a86b8a264b66ca02e6b9a",
    native: 6191914082770705n,
    erc20: 6191n,
  },
  {
    address: "0x9c669155b9d795a190b4153bd77e91fb688af4c4",
    native: 8002781573238655348n,
    erc20: 8002781n,
  },
];

/** Observed gas price on Arc testnet, in native units. */
export const OBSERVED_GAS_PRICE = 25_000_000_000n;
