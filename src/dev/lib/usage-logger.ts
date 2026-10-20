import { createAdminClient } from '@/dev/lib/supabase/server';

export type FeatureType =
  | 'generate-titles'
  | 'generate-content'
  | 'generate-tags'
  | 'generate-images'
  | 'generate-cardnews-slides'
  | 'check-originality'
  | 'regenerate-image'
  | 'generate-style'
  | 'thumbnail-copy'
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

/**
 * API 응답 속도에 영향 없도록 비동기로 저장 — 대부분은 기다리지 않고 부른다(fire-and-forget).
 * ★판정에 쓰이는 로그(무료 본문 = 부속 기능 허용 근거, 10/13)는 호출한 쪽이 await 한다 — 서버리스는 응답 뒤 작업을 잃을 수 있다.
 *   실패해도 reject 하지 않는다.
 */
export function logUsage(entry: UsageEntry): Promise<void> {
  const cost_usd = calcCost(entry);

  return (async () => {
    try {
      const supabase = createAdminClient();
      const { error } = await supabase.from('usage_logs').insert({
        feature: entry.feature,
        api_provider: entry.api_provider,
        input_tokens: entry.input_tokens ?? 0,
        output_tokens: entry.output_tokens ?? 0,
        image_count: entry.image_count ?? 0,
        cost_usd,
        user_id: entry.user_id ?? null,
        user_agent: entry.user_agent ?? null,
      });
      if (error) console.error('[usage-logger] 저장 실패:', error.message);
    } catch (err) {
      console.error('[usage-logger] 저장 실패:', err);
    }
  })();
}
