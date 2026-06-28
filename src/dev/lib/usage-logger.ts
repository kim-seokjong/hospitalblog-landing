import { createAdminClient } from '@/dev/lib/supabase/server';

export type FeatureType =
  | 'generate-titles'
  | 'generate-content'
  | 'generate-tags'
  | 'generate-images'
  | 'generate-cardnews-slides'
  | 'check-originality'
  | 'regenerate-image'
  | 'free-sample';

export type ApiProvider = 'anthropic' | 'fal' | 'pexels' | 'openai';

// Claude Sonnet 4.6 pricing (USD per token)
const CLAUDE_INPUT_COST_PER_TOKEN = 3 / 1_000_000;   // $3 / MTok
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000; // $15 / MTok
const FAL_COST_PER_IMAGE = 0.04;                      // $0.04 / image

export interface UsageEntry {
  feature: FeatureType;
  api_provider: ApiProvider;
  input_tokens?: number;
  output_tokens?: number;
  image_count?: number;
  user_id?: string | null;
  user_agent?: string | null;
}

export function calcCost(entry: UsageEntry): number {
  if (entry.api_provider === 'anthropic') {
    return (
      (entry.input_tokens ?? 0) * CLAUDE_INPUT_COST_PER_TOKEN +
      (entry.output_tokens ?? 0) * CLAUDE_OUTPUT_COST_PER_TOKEN
    );
  }
  if (entry.api_provider === 'fal') {
    return (entry.image_count ?? 0) * FAL_COST_PER_IMAGE;
  }
  return 0;
}

/** API 응답 속도에 영향 없도록 비동기로 저장 */
export function logUsage(entry: UsageEntry): void {
  const cost_usd = calcCost(entry);

  // fire-and-forget
  (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from('usage_logs').insert({
        feature: entry.feature,
        api_provider: entry.api_provider,
        input_tokens: entry.input_tokens ?? 0,
        output_tokens: entry.output_tokens ?? 0,
        image_count: entry.image_count ?? 0,
        cost_usd,
        user_id: entry.user_id ?? null,
        user_agent: entry.user_agent ?? null,
      });
    } catch (err) {
      console.error('[usage-logger] 저장 실패:', err);
    }
  })();
}
