// Model cost per claim and per user, from each response's token usage. Needed to price the product.
import { FieldValue } from "firebase-admin/firestore";
import { claims, users } from "./store";

// USD per million tokens. Cache writes cost 1.25x input and cache reads 0.1x input.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const FALLBACK_PRICE = PRICES["claude-opus-5-5"];

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costOf(model: string, usage: Usage): number {
  const price = Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1] ?? FALLBACK_PRICE;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const dollars =
    usage.input_tokens * price.input +
    cacheWrite * price.input * 1.25 +
    cacheRead * price.input * 0.1 +
    usage.output_tokens * price.output;
  return dollars / 1_000_000;
}

/** Adds a response's cost to the user's (and, when known, the claim's) running total. */
export async function recordUsage(opts: { userId: string; claimId?: string | null; model: string; usage: Usage }) {
  const cost = costOf(opts.model, opts.usage);
  const tokens = opts.usage.input_tokens + (opts.usage.cache_creation_input_tokens ?? 0) + (opts.usage.cache_read_input_tokens ?? 0);
  const writes: Promise<unknown>[] = [users.doc(opts.userId).set({ cost_usd: FieldValue.increment(cost) }, { merge: true })];
  if (opts.claimId) {
    writes.push(
      claims.doc(opts.claimId).set(
        {
          cost_usd: FieldValue.increment(cost),
          tokens_in: FieldValue.increment(tokens),
          tokens_out: FieldValue.increment(opts.usage.output_tokens),
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes).catch((err) => console.error("recording usage failed", err));
}
