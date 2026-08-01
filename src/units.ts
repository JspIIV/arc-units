/**
 * Arc represents one USDC balance through two interfaces with different scales:
 *
 *   native   getBalance()  18 decimals  the real balance, gas is priced here
 *   erc20    balanceOf()    6 decimals  a truncating projection of the same value
 *
 * Measured on Arc testnet across 8 accounts: `erc20 === native / 1e12` (floor),
 * and every account held a remainder too small for the ERC-20 view to express.
 *
 * Both interfaces are plain `bigint`, so nothing stops you from adding a gas
 * price to a token amount and being wrong by a factor of a trillion. The branded
 * types below make that a compile error.
 */

export const NATIVE_DECIMALS = 18;
export const ERC20_DECIMALS = 6;

/** Scale between the two interfaces: 10 ** (18 - 6). */
export const SCALE = 10n ** BigInt(NATIVE_DECIMALS - ERC20_DECIMALS);

declare const brand: unique symbol;

/** An amount in native units (18 decimals) — what `getBalance` and gas use. */
export type Native = bigint & { readonly [brand]: "native" };

/** An amount in ERC-20 units (6 decimals) — what `balanceOf` returns. */
export type Erc20 = bigint & { readonly [brand]: "erc20" };

export class ArcUnitsError extends Error {
  override name = "ArcUnitsError";
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) throw new ArcUnitsError(`${label} cannot be negative, got ${value}`);
}

/** Tag a raw bigint from `getBalance`, `gasPrice`, or a tx `value` as native. */
export function native(value: bigint): Native {
  assertNonNegative(value, "native amount");
  return value as Native;
}

/** Tag a raw bigint from `balanceOf` or an ERC-20 `transfer` as erc20. */
export function erc20(value: bigint): Erc20 {
  assertNonNegative(value, "erc20 amount");
  return value as Erc20;
}

/**
 * The part of a native amount the ERC-20 interface can represent, plus the
 * remainder it cannot.
 */
export interface Projection {
  /** The value `balanceOf` would report. */
  readonly value: Erc20;
  /** Native remainder below 1e-6 USDC. Real balance, invisible over ERC-20. */
  readonly dust: Native;
}

/**
 * Project a native amount onto the ERC-20 interface.
 *
 * Returns the dust alongside the value rather than discarding it, so callers
 * have to decide what happens to it. Use {@link toErc20Exact} when losing any
 * is unacceptable.
 */
export function toErc20(amount: Native): Projection {
  return {
    value: (amount / SCALE) as Erc20,
    dust: (amount % SCALE) as Native,
  };
}

/**
 * Project a native amount onto the ERC-20 interface, refusing to lose dust.
 *
 * @throws {ArcUnitsError} if the amount is not an exact multiple of {@link SCALE}.
 */
export function toErc20Exact(amount: Native): Erc20 {
  const { value, dust } = toErc20(amount);
  if (dust !== 0n) {
    throw new ArcUnitsError(
      `native amount ${amount} does not fit the 6-decimal ERC-20 interface: ` +
        `${dust} would be truncated (use toErc20() to handle the dust)`,
    );
  }
  return value;
}

/** Widen an ERC-20 amount to native units. Always exact — no value is lost. */
export function toNative(amount: Erc20): Native {
  return (amount * SCALE) as Native;
}

/** True if the amount survives a round trip through the ERC-20 interface. */
export function isErc20Representable(amount: Native): boolean {
  return amount % SCALE === 0n;
}

function decimalsOf(kind: "native" | "erc20"): number {
  return kind === "native" ? NATIVE_DECIMALS : ERC20_DECIMALS;
}

function format(value: bigint, decimals: number, trim: boolean): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0");
  const shown = trim ? fraction.replace(/0+$/, "") : fraction;
  return shown === "" ? `${whole}` : `${whole}.${shown}`;
}

/** Render a native amount as a decimal USDC string (18 decimal places). */
export function formatNative(amount: Native, options: { trim?: boolean } = {}): string {
  return format(amount, NATIVE_DECIMALS, options.trim ?? true);
}

/** Render an ERC-20 amount as a decimal USDC string (6 decimal places). */
export function formatErc20(amount: Erc20, options: { trim?: boolean } = {}): string {
  return format(amount, ERC20_DECIMALS, options.trim ?? true);
}

function parse(input: string, decimals: number, kind: string): bigint {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new ArcUnitsError(`${kind} amount must be a non-negative decimal string, got "${input}"`);
  }
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new ArcUnitsError(
      `"${input}" has ${fraction.length} decimal places but ${kind} units allow ${decimals}`,
    );
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Parse a USDC string into native units. Accepts up to 18 decimal places. */
export function parseNative(input: string): Native {
  return parse(input, NATIVE_DECIMALS, "native") as Native;
}

/** Parse a USDC string into ERC-20 units. Rejects more than 6 decimal places. */
export function parseErc20(input: string): Erc20 {
  return parse(input, ERC20_DECIMALS, "erc20") as Erc20;
}

/**
 * Cost of a transaction in native units.
 *
 * Gas on Arc is priced in USDC, not ETH, so this is a dollar amount — but it is
 * a *native* amount, and routinely smaller than 1e-6 USDC per gas unit. Feeding
 * a gas price through the ERC-20 interface rounds it to zero.
 */
export function gasCost(gasPrice: Native, gasUnits: bigint): Native {
  assertNonNegative(gasUnits, "gas units");
  return (gasPrice * gasUnits) as Native;
}

/** Sum native amounts without leaving the branded type. */
export function addNative(...amounts: Native[]): Native {
  return amounts.reduce((sum, a) => sum + a, 0n) as Native;
}

/** Sum ERC-20 amounts without leaving the branded type. */
export function addErc20(...amounts: Erc20[]): Erc20 {
  return amounts.reduce((sum, a) => sum + a, 0n) as Erc20;
}
