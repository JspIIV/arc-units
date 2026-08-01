/**
 * The public Arc RPC answers `request limit reached` under light parallel load
 * — eight concurrent `eth_call`s is enough. viem's built-in retry does not
 * cover it, because the node returns a JSON-RPC error rather than a 429.
 *
 * This transport serialises requests, spaces them out, and backs off on that
 * specific error.
 */
import { http, type HttpTransportConfig, type Transport } from "viem";

export interface ThrottledHttpConfig extends HttpTransportConfig {
  /** Minimum gap between requests. Default 250ms, which held up in testing. */
  minIntervalMs?: number;
  /** Attempts before giving up. Default 6. */
  maxAttempts?: number;
  /** Called before each backoff, for progress reporting. */
  onRateLimit?: (info: { method: string; attempt: number; waitMs: number }) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(error: unknown): boolean {
  const details = (error as { details?: unknown })?.details;
  const message = (error as { message?: unknown })?.message;
  return `${String(details ?? "")} ${String(message ?? "")}`.includes("request limit");
}

/**
 * An HTTP transport that will not trip Arc's public rate limit.
 *
 * Requests run one at a time, so this trades throughput for not having to
 * hand-tune concurrency at every call site. Point it at a paid endpoint via
 * `url` if you need parallelism.
 */
export function throttledHttp(url?: string, config: ThrottledHttpConfig = {}): Transport {
  const { minIntervalMs = 250, maxAttempts = 6, onRateLimit, ...httpConfig } = config;
  const inner = http(url, httpConfig);

  return (opts) => {
    const transport = inner(opts);
    const original = transport.request;
    let queue: Promise<unknown> = Promise.resolve();

    // Cast rather than annotate: viem's request signature is generic over the
    // return type per call, which a single wrapper cannot express.
    const request = ((args: Parameters<typeof original>[0], reqOpts: Parameters<typeof original>[1]) => {
      const run = queue.then(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            const result = await original(args, reqOpts);
            await sleep(minIntervalMs);
            return result;
          } catch (error) {
            if (!isRateLimit(error) || attempt >= maxAttempts) throw error;
            const waitMs = minIntervalMs * 2 ** attempt;
            onRateLimit?.({ method: String(args.method), attempt, waitMs });
            await sleep(waitMs);
          }
        }
      });
      // Keep the chain alive even when a call fails, or one error would
      // permanently wedge every later request behind a rejected promise.
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }) as typeof original;

    return { ...transport, request };
  };
}
