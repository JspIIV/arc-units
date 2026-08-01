# arc-units

Correct USDC amount handling on [Arc](https://www.arc.io/), Circle's stablecoin-native L1.

Arc exposes **one** USDC balance through **two** interfaces at different scales. Mixing them up is a factor-of-a-trillion error, and the sources that should settle it disagree — some say the native gas token is 6 decimals, others 18. This package measures the answer on-chain, encodes it, and makes the mix-up a compile error.

## The problem

| | reads via | decimals | notes |
|---|---|---|---|
| native | `getBalance()` | **18** | the authoritative balance; gas is priced here |
| ERC-20 | `balanceOf()` at `0x3600…0000` | **6** | a **truncating** projection of the same value |

They are not two tokens. A precompile forwards ERC-20 calls to the account's native balance, so showing both in a UI double-counts the same money.

The relationship, measured across 8 live testnet accounts at a single pinned block:

```
erc20 === native / 1e12        (floor division)
```

Every account sampled held a remainder below `1e-6` USDC that the ERC-20 interface simply cannot express. Two consequences that bite in practice:

- **A gas price read as a 6-decimal amount is zero.** Gas runs around `0.000000025` USDC per unit — three orders of magnitude below what the ERC-20 interface can represent.
- **"Send my whole balance" over ERC-20 always strands dust.** You can only move `floor(native / 1e12) * 1e12`.

Run `npm run probe` to reproduce the measurement against live testnet yourself.

## Install

```bash
npm install arc-units viem
```

## Use

Amounts carry their interface in the type, so the two can never be added, compared, or passed to the wrong function:

```ts
import { native, erc20, toErc20, toNative, formatNative } from "arc-units";

const balance = native(1_234_567_890_123_456_789n);   // from getBalance()
const payment = erc20(1_000_000n);                     // from balanceOf()

balance + payment;        // compile error — different interfaces
toNative(payment);        // 1000000000000000000n — always exact
formatNative(balance);    // "1.234567890123456789"
```

Truncation is never silent. `toErc20` hands back the dust so you have to decide what happens to it:

```ts
const { value, dust } = toErc20(balance);
// value: 1234567n            what the recipient would see
// dust:  890123456789n       stays behind
```

When losing any of it is unacceptable, let it throw instead:

```ts
import { toErc20Exact } from "arc-units";

toErc20Exact(balance);              // throws ArcUnitsError, naming the lost amount
toErc20Exact(native(7n * 10n**12n)); // 7n
```

### Reading a balance

Arc produces a block roughly every 500ms, so reading `getBalance()` and `balanceOf()` back-to-back at `latest` can straddle a block and report two different balances for an active account — which looks exactly like the invariant being broken. `readUsdcBalance` pins both reads to one block:

```ts
import { createPublicClient } from "viem";
import { arcTestnet, throttledHttp, readUsdcBalance, describeBalance } from "arc-units";

const client = createPublicClient({ chain: arcTestnet, transport: throttledHttp() });

const balance = await readUsdcBalance(client, "0x…");
console.log(describeBalance(balance));
// 88.567479576773353909 USDC native / 88.567479 USDC via ERC-20
//   @ block 54727035 (0.000000576773353909 USDC hidden from ERC-20)
```

`balance.consistent` is `false` only if the chain genuinely disagreed with the `1e12` relationship — treat it as a signal that Arc changed its precompile, not as a routine condition.

### Rate limiting

Arc's public RPC returns `request limit reached` under light parallel load — eight concurrent `eth_call`s is enough. viem's built-in retry does not cover it, because the node answers with a JSON-RPC error rather than a 429. `throttledHttp` serialises requests, spaces them, and backs off on that specific error:

```ts
throttledHttp(undefined, {
  minIntervalMs: 250,
  onRateLimit: ({ method, waitMs }) => console.log(`${method} backing off ${waitMs}ms`),
});
```

It trades throughput for not hand-tuning concurrency at every call site. Pass a paid endpoint URL if you need parallelism.

## API

**Units** — `native`, `erc20`, `toErc20`, `toErc20Exact`, `toNative`, `isErc20Representable`, `formatNative`, `formatErc20`, `parseNative`, `parseErc20`, `gasCost`, `addNative`, `addErc20`, `SCALE`, `NATIVE_DECIMALS`, `ERC20_DECIMALS`, `ArcUnitsError`

**Chain** — `arcTestnet`, `USDC_ERC20_ADDRESS`, `ARC_TESTNET_RPC`, `erc20Abi`

**Balance** — `readUsdcBalance`, `describeBalance`, `largestTransferable`

**Transport** — `throttledHttp`

## Arc testnet reference

Verified on-chain, not copied from docs:

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://testnet.arcscan.app` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |
| Faucet | `https://faucet.circle.com` |
| Block time | ~500ms measured |

Note that Arc's docs moved from `arc.network` to `arc.io`; older repositories still point at the retired host.

## Development

```bash
npm test          # 31 unit tests, including real on-chain fixtures
npm run typecheck
npm run build
npm run probe     # re-measure the decimal relationship against live testnet
node scripts/demo.mjs   # end-to-end run of the built package
```

## License

MIT

## On-chain: DustLens

The library proves the 18/6 relationship off-chain. `DustLens` proves it from inside the EVM.

| | |
|---|---|
| Address | [`0x3813b1dbc6285b9938f01f9055eee81b6495c489`](https://testnet.arcscan.app/address/0x3813b1dbc6285b9938f01f9055eee81b6495c489) |
| Network | Arc Testnet (5042002) |
| Source | [`contracts/DustLens.sol`](contracts/DustLens.sol) |

`inspect(address)` returns the native balance, the ERC-20 balance, the dust between them, and whether the two agree — all in a single call, which also removes the torn-read window that separate `eth_call`s have across Arc's ~500ms blocks.

Verified live against the deployer account:

```
contract native : 4985632220860000000  (4.98563222086 USDC)
rpc      native : 4985632220860000000
contract erc20  : 4985632              (4.985632 USDC)
contract dust   : 220860000000         (0.00000022086 USDC)
consistent      : true
```

`splitEvenly(address[])` shows the practical consequence: it distributes native value exactly and gives the remainder to the first recipient, so the contract keeps nothing. A split done through the ERC-20 interface would strand whatever fell below `1e-6` USDC.

```
splitting 1000000000001 between 2
  0x…0a11 received 500000000001
  0x…0b22 received 500000000000
  contract kept 0
```

Reproduce with `npm run compile` and `node scripts/exercise-split.mjs`.
