import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArcUnitsError,
  ERC20_DECIMALS,
  NATIVE_DECIMALS,
  SCALE,
  addNative,
  erc20,
  formatErc20,
  formatNative,
  gasCost,
  isErc20Representable,
  native,
  parseErc20,
  parseNative,
  toErc20,
  toErc20Exact,
  toNative,
} from "../src/units.ts";
import { OBSERVED_ACCOUNTS, OBSERVED_GAS_PRICE } from "./fixtures.ts";

describe("scale", () => {
  it("is 1e12, the gap between the two interfaces", () => {
    assert.equal(SCALE, 1_000_000_000_000n);
    assert.equal(SCALE, 10n ** BigInt(NATIVE_DECIMALS - ERC20_DECIMALS));
  });
});

describe("real Arc testnet accounts", () => {
  for (const account of OBSERVED_ACCOUNTS) {
    it(`${account.address} projects to the balance the chain reported`, () => {
      const { value, dust } = toErc20(native(account.native));
      assert.equal(value, account.erc20, "projection must match balanceOf()");
      assert.equal(dust, account.native % SCALE);
      // Reconstructing from the ERC-20 view alone loses exactly the dust.
      assert.equal(toNative(value) + dust, account.native);
    });
  }

  it("every sampled account held dust invisible over ERC-20", () => {
    const withDust = OBSERVED_ACCOUNTS.filter((a) => a.native % SCALE !== 0n);
    assert.equal(withDust.length, OBSERVED_ACCOUNTS.length);
  });
});

describe("toErc20", () => {
  it("splits value from dust instead of silently truncating", () => {
    const { value, dust } = toErc20(native(1_500_000_123_456_789_012n));
    assert.equal(value, 1_500_000n);
    assert.equal(dust, 123_456_789_012n);
  });

  it("reports no dust for an exactly representable amount", () => {
    assert.deepEqual(toErc20(native(2_000_000n * SCALE)), { value: 2_000_000n, dust: 0n });
  });
});

describe("toErc20Exact", () => {
  it("passes through amounts that fit", () => {
    assert.equal(toErc20Exact(native(7n * SCALE)), 7n);
  });

  it("refuses to lose dust", () => {
    assert.throws(() => toErc20Exact(native(SCALE + 1n)), ArcUnitsError);
  });

  it("names the amount that would be lost", () => {
    assert.throws(() => toErc20Exact(native(SCALE + 42n)), /42 would be truncated/);
  });
});

describe("toNative", () => {
  it("widens without loss and round-trips", () => {
    const amount = erc20(123_456_789n);
    assert.equal(toNative(amount), 123_456_789n * SCALE);
    assert.equal(toErc20Exact(toNative(amount)).valueOf(), amount.valueOf());
  });
});

describe("isErc20Representable", () => {
  it("distinguishes exact amounts from dusty ones", () => {
    assert.equal(isErc20Representable(native(SCALE)), true);
    assert.equal(isErc20Representable(native(SCALE - 1n)), false);
    assert.equal(isErc20Representable(native(0n)), true);
  });
});

describe("gas", () => {
  it("prices a plain transfer at the observed gas price", () => {
    const cost = gasCost(native(OBSERVED_GAS_PRICE), 21_000n);
    assert.equal(cost, 525_000_000_000_000n);
    assert.equal(formatNative(cost), "0.000525");
  });

  it("rounds a gas price to nothing if read through the ERC-20 interface", () => {
    // The trap this library exists for: gas is far below 1e-6 USDC per unit,
    // so anyone treating gasPrice as a 6-decimal amount sees zero.
    assert.equal(toErc20(native(OBSERVED_GAS_PRICE)).value, 0n);
    assert.equal(toErc20(native(OBSERVED_GAS_PRICE)).dust, OBSERVED_GAS_PRICE);
  });

  it("rejects negative gas units", () => {
    assert.throws(() => gasCost(native(1n), -1n), ArcUnitsError);
  });
});

describe("formatting", () => {
  it("renders each interface at its own scale", () => {
    assert.equal(formatNative(native(1_500_000_000_000_000_000n)), "1.5");
    assert.equal(formatErc20(erc20(1_500_000n)), "1.5");
  });

  it("keeps trailing zeros when asked", () => {
    assert.equal(formatErc20(erc20(1_500_000n), { trim: false }), "1.500000");
  });

  it("shows a whole number without a decimal point", () => {
    assert.equal(formatNative(native(3n * SCALE * 1_000_000n)), "3");
  });

  it("pads a fraction smaller than the leading digit", () => {
    assert.equal(formatErc20(erc20(1n)), "0.000001");
    assert.equal(formatNative(native(1n)), "0.000000000000000001");
  });
});

describe("parsing", () => {
  it("reads decimal strings at the right scale", () => {
    assert.equal(parseNative("1.5"), 1_500_000_000_000_000_000n);
    assert.equal(parseErc20("1.5"), 1_500_000n);
  });

  it("round-trips through formatting", () => {
    assert.equal(formatNative(parseNative("0.000000000000000001")), "0.000000000000000001");
  });

  it("rejects precision the ERC-20 interface cannot hold", () => {
    assert.throws(() => parseErc20("1.1234567"), /allow 6/);
  });

  it("accepts 18 places as native", () => {
    assert.equal(parseNative("1.123456789012345678"), 1_123_456_789_012_345_678n);
  });

  it("rejects junk", () => {
    for (const bad of ["", "abc", "-1", "1.2.3", "1e18", " "]) {
      assert.throws(() => parseNative(bad), ArcUnitsError, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe("guards", () => {
  it("rejects negative balances at the boundary", () => {
    assert.throws(() => native(-1n), ArcUnitsError);
    assert.throws(() => erc20(-1n), ArcUnitsError);
  });

  it("adds without leaving the branded type", () => {
    assert.equal(addNative(native(1n), native(2n), native(3n)), 6n);
    assert.equal(addNative(), 0n);
  });
});
