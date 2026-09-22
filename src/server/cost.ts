/**
 * Cost calculation from provider-reported usage and a tariff snapshot frozen
 * into the run manifest. Pure; no network. Rates verified 2026-09-20
 * (docs/05_decision_log.md).
 */

export type Tariff = {
  tariff_id: string;
  currency: "USD";
  captured_at: string;
  source_url: string;
  /** USD per 1 token. */
  jev: { input: number; output: number };
  deepseek: {
    peak: { cache_hit: number; cache_miss: number; output: number };
    off_peak: { cache_hit: number; cache_miss: number; output: number };
  };
};

const PER_MILLION = 1_000_000;

export const TARIFF_2026_09_20: Tariff = {
  tariff_id: "tariff-2026-09-20",
  currency: "USD",
  captured_at: "2026-09-20",
  source_url:
    "https://docs.typesafe.ai/models | https://api-docs.deepseek.com/quick_start/pricing/",
  // Jev: $0.042 per million input tokens; output is free.
  jev: { input: 0.042 / PER_MILLION, output: 0 },
  deepseek: {
    peak: {
      cache_hit: 0.006 / PER_MILLION,
      cache_miss: 0.3 / PER_MILLION,
      output: 1.2 / PER_MILLION,
    },
    off_peak: {
      cache_hit: 0.003 / PER_MILLION,
      cache_miss: 0.15 / PER_MILLION,
      output: 0.6 / PER_MILLION,
    },
  },
};

/**
 * DeepSeek peak window: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC,
 * excluding Chinese public holidays. Holidays are not encoded; a run crossing
 * one must record that in the manifest rather than silently mispricing.
 */
export function isPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function jevCost(
  usage: Record<string, number> | null,
  tariff: Tariff = TARIFF_2026_09_20,
): number {
  if (!usage) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return input * tariff.jev.input + output * tariff.jev.output;
}

export function deepseekCost(
  usage: Record<string, number> | null,
  at: Date,
  tariff: Tariff = TARIFF_2026_09_20,
): number {
  if (!usage) return 0;
  const rates = isPeak(at) ? tariff.deepseek.peak : tariff.deepseek.off_peak;
  const total = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? 0;
  const miss = Math.max(0, total - cached);
  const output = usage.output_tokens ?? 0;
  return cached * rates.cache_hit + miss * rates.cache_miss + output * rates.output;
}
