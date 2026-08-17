import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { OPENAI_IMAGE_MODEL } from '@/content/lib/openai';
import { logUsage } from '@/dev/lib/usage-logger';
import { findProcedureCues } from '@/content/lib/procedure-visual-cues';
import { requirePaidPlan } from '@/payment/lib/usage-guard';
import { persistPostImages } from '@/content/lib/post-image-storage';
import type { GeneratedImage } from '@/types';

export const maxDuration = 300;

const IMAGE_CONCURRENCY = 3;
const IMAGE_MAX_RETRIES = 2;
const IMAGE_BACKFILL_PASSES = 1;

/** 콘텐츠 정책 위반·인증·요청 오류 등 재시도해도 의미 없는 오류 패턴 */
function isPermanentImageError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('content_policy') ||
    lower.includes('content policy') ||
    lower.includes('safety') ||
    lower.includes('moderation_blocked') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid_api_key') ||
    lower.includes('invalid_request_error') ||
    lower.includes('billing_hard_limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('payment required') ||
    lower.includes('verify_organization') ||
    lower.includes('must be verified') ||
    lower.includes('model_not_found') ||
    // 4xx HTTP 상태 (rate-limit 429 제외 — 일시적이므로 재시도)
    /status=4(?!29)\d{2}/.test(lower)
  );
}

/**
 * 외부 이미지 API 에러 메시지를 사용자에게 안전한 문구로 변환.
 * 원본 메시지는 서버 로그에만 남기고, 응답에는 카테고리 라벨만 노출.
 */
function safeImageErrorMessage(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes('billing') ||
    lower.includes('insufficient_quota') ||
    lower.includes('hard_limit') ||
    lower.includes('payment required') ||
    lower.includes('402')
  ) {
    return '이미지 생성 한도에 도달했습니다. OpenAI 결제·잔액을 확인해주세요.';
  }
  if (lower.includes('content_policy') || lower.includes('content policy') || lower.includes('safety') || lower.includes('moderation_blocked')) {
    return '이미지 콘텐츠 정책으로 생성이 거부되었습니다. 키워드를 조정해 다시 시도해주세요.';
  }
  if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('429')) {
    return '이미지 생성 요청이 일시적으로 많아 실패했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (lower.includes('verify_organization') || lower.includes('must be verified') || lower.includes('status=403')) {
    return '이미지 모델 접근 권한이 없습니다. OpenAI 조직 인증(verify_organization) 상태를 확인해주세요.';
  }
  if (lower.includes('model_not_found') || lower.includes('status=404')) {
    return '이미지 모델을 찾을 수 없습니다. 서버 OPENAI_IMAGE_MODEL 설정을 확인해주세요.';
  }
  if (lower.includes('invalid_api_key') || lower.includes('unauthorized') || lower.includes('status=401')) {
    return '이미지 생성용 API 키가 잘못되었거나 만료되었습니다. 서버 환경변수(OPENAI_API_KEY)를 확인해주세요.';
  }
  if (lower.includes('invalid_request_error') || lower.includes('status=400')) {
    return '이미지 요청 파라미터가 올바르지 않습니다. (서버 로그 확인 필요)';
  }
  return '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.';
}

/** 일시적 오류(429/5xx/네트워크)에 대한 지수 백오프 재시도 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = IMAGE_MAX_RETRIES,
  baseDelayMs: number = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isPermanentImageError(msg)) throw err;
      if (attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error('재시도 실패');
}

/** 작업을 동시성 제한 안에서 실행 — 결과는 입력 순서대로 반환 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = { status: 'fulfilled', value: await worker(items[idx], idx) };
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// Flux.1 Pro (fal.ai) 로 이미지 1장 생성
async function generateWithFal(prompt: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY가 설정되지 않았습니다.');

  const res = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: 'square_hd',
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      safety_tolerance: '2',
      output_format: 'jpeg',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[fal.ai] image generation failed:', res.status, err);
    throw new Error(`fal.ai status=${res.status}`);
  }

  const data = await res.json();
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error('fal.ai 응답에 이미지 URL이 없습니다.');
  return imageUrl as string;
}

// 본문에서 [이미지 N: 설명] 추출
function extractImageDescriptions(body: string): string[] {
  const matches = body.match(/\[이미지\s*\d+:\s*([^\]]+)\]/g) || [];
  return matches.map(m => m.replace(/\[이미지\s*\d+:\s*/, '').replace(']', '').trim());
}

// Claude로 Flux.1 용 고품질 프롬프트 생성
async function buildFluxPrompts(
  descriptions: string[],
  keyword: string,
  title: string,
  count: number,
  userId?: string | null,
  userAgent?: string | null,
): Promise<string[]> {
  const anthropic = getAnthropicClient();
  const targets = [...descriptions];
  while (targets.length < count) targets.push(`${keyword} 관련 의료 장면 ${targets.length + 1}`);

  const cues = findProcedureCues(keyword);
  const cuesSection = cues.length > 0
    ? `\n【시술 시각 단서 — 반드시 활용 (Procedure Visual Reference)】\n${cues.map((c, i) => `(${i + 1}) ${c}`).join('\n')}\n위 단서들은 "${keyword}" 시술/주제를 시각적으로 즉시 식별 가능하게 만드는 핵심 요소입니다. 각 이미지 프롬프트마다 이 단서 중 적절한 것을 자연스럽게 녹여 시술 자체가 화면의 주인공이 되게 작성하세요.\n`
    : `\n【시술 시각 단서】\n사전 매칭되지 않은 키워드입니다. 키워드 "${keyword}"의 의미를 정확히 파악하여, 보는 사람이 1초 안에 "이거 ${keyword}구나" 알 수 있는 도구·부위·동작·설정을 명확히 묘사하세요.\n`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [{
      name: 'build_flux_prompts',
      description: 'Flux.1 Pro 이미지 생성용 영문 프롬프트 목록',
      input_schema: {
        type: 'object' as const,
        properties: {
          prompts: { type: 'array', items: { type: 'string' } },
        },
        required: ['prompts'],
      },
    }],
    tool_choice: { type: 'tool', name: 'build_flux_prompts' },
    messages: [{
      role: 'user',
      content: `병원 블로그용 gpt-image-2 이미지 프롬프트 ${count}개를 만들어주세요.

제목: ${title}
키워드: ${keyword}
${cuesSection}
이미지 설명:
${targets.slice(0, count).map((d, i) => `${i + 1}. ${d}`).join('\n')}

【최우선 규칙 — 키워드 식별성】
- 각 이미지는 키워드 "${keyword}"를 보는 사람이 1초 안에 알아볼 수 있어야 함
- "병원 분위기" 이미지 금지 — "${keyword}" 시술/주제 자체가 주인공인 구도
- ${count}장 모두 다른 구도/단계로 분산: close-up procedure detail / medium shot of staff with patient / tools-and-equipment focus / patient consultation / post-procedure recovery / clinical environment overview 등에서 골고루 선택

【🚨 의료광고법(의료법 제56조) — 절대 금지 (Compliance Hard Rules)】
- before-after / before/after / split frame / side-by-side comparison / before vs after / "fading X" 표현 절대 금지
- 시술 효과를 보장·과장하는 표현 금지: "miraculous", "dramatic transformation", "perfect result", "completely smooth", "flawless", "guaranteed" 등
- 수치 결과 암시 금지: "70% improvement", "5x better", "instant results" 등
- 실제 환자 후기·간증처럼 보이는 구도 금지
- 위 표현이 영문 프롬프트에 들어가면 의료법 위반 — 전부 제거하고 시술 진행 장면(도구·부위·의료진 동작·임상 환경)으로만 작성

프롬프트 구조 (각 이미지마다 아래 순서로 작성):
1. 장면 도입: ultra-realistic photograph / clinical close-up / medium shot / equipment-focused shot 중 하나 명시
2. 시술 식별 단서: 위 Procedure Visual Reference의 핵심 요소(도구, 부위, 시술 단계, 의료진 동작 등)를 자연스럽게 녹여 작성. before-after 비교 형식은 사용 금지
3. 인물: Korean people, East Asian appearance, Korean patient / doctor / medical staff (동양적 얼굴 비율 명시)
4. 조명: natural indoor lighting, soft diffused daylight, true-to-life colors, accurate white balance (cinematic light, studio light 절대 금지)
5. 피부 실사 섹션 반드시 포함: "Skin realism focus: visible pores, fine micro-texture, organic acne marks (non-repeating), uneven pigmentation, subtle redness, natural oil sheen only on high points, visible peach fuzz and very fine vellus hair. No symmetry correction."
6. 카메라: modern flagship smartphone in 2026, main 24mm lens, computational HDR, crisp micro contrast, sharp focus edge to edge, clean and noise free, level horizon, steady framing
   ※ "sensor grain"(노이즈)·"edge softness"(선명도 저하)·"candid composition"(흐트러진 구도)은 쓰지 마라.
     리얼함을 그렇게 만들면 요즘 폰이 아니라 옛날 폰 사진이 되고, 화면이 탁해진다.
     리얼함은 피부 질감(5번)으로 만들고, 화질은 최신 폰 기준으로 깨끗하게 간다.
7. ★배경 생활감(2026-08-17 신설): 실제로 쓰이고 있는 공간처럼 채운다. 텅 빈 방은 모델하우스로 읽히고,
   그러면 스톡 사진처럼 보여 글까지 만들어낸 티가 난다.
   넣을 것 예시 — 의자 등받이에 걸친 가운이나 카디건, 꺼진 모니터와 키보드, 서류 트레이,
   손소독제 펌프, 화분, 스테인리스 트레이, 페달 휴지통, 접어 둔 천, 굴러다니는 볼펜, 스툴.
   ⛔**단 화면에 글자가 읽히는 물건은 넣지 마라** — AI는 글자를 못 그려서 깨진 글자가 그대로 남는다.
   피할 것: 라벨 붙은 약병, 인쇄면이 보이는 서류, 포스트잇, 명찰, 켜져 있는 모니터 화면, 벽 안내문.
   종이는 빈 것으로, 모니터는 꺼진 화면으로 지정한다.
8. 금지(영문 negative 포함): "No before-after comparison, no split frame, no side-by-side comparison, no dramatic transformation, no retouching, no smoothing, no beauty filters, no AI glow, no plastic skin, no studio light, no cinematic lighting, no illustration, no cartoon, no 3D render, no text, no logo, no labelled bottles, no printed documents, no sticky notes, no name badge"

- 영어로만 출력, 각 프롬프트 100~150단어 (시술 단서 포함으로 약간 길게)
- 의료 현장의 실제 모습 (병원 인테리어, 의료진, 장비, 환자 치료, 시술 도구)
- "before", "after", "comparison", "split frame", "vs" 같은 단어가 프롬프트에 절대 들어가서는 안 됨`,
    }],
  });

  logUsage({
    feature: 'generate-images',
    api_provider: 'anthropic',
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    user_id: userId ?? null,
    user_agent: userAgent ?? null,
  });

  const toolUse = res.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return targets.slice(0, count).map(d =>
      `ultra-realistic, ${d}, Korean medical staff and patients, East Asian appearance, photographed on a modern flagship smartphone in 2026, main 24mm lens, computational HDR, crisp micro contrast, sharp focus edge to edge, clean and noise free, level horizon, natural indoor lighting, soft diffused daylight, visible pores, subsurface scattering skin, no AI glow, no plastic skin, no studio light, no illustration, no cartoon`
    );
  }
  const input = toolUse.input as { prompts: string[] };
  return (input.prompts || []).slice(0, count);
}

// Pexels — Claude로 검색 쿼리 생성 (실사 전용)
async function buildPexelsQueries(descriptions: string[], keyword: string, count: number): Promise<string[]> {
  const anthropic = getAnthropicClient();
  const targets = [...descriptions];
  while (targets.length < count) targets.push(`${keyword} medical treatment`);

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [{
      name: 'build_search_queries',
      description: 'Pexels 이미지 검색용 영문 쿼리 생성',
      input_schema: {
        type: 'object' as const,
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: '2~4 단어 영문 Pexels 검색어' },
        },
        required: ['queries'],
      },
    }],
    tool_choice: { type: 'tool', name: 'build_search_queries' },
    messages: [{
      role: 'user',
      content: `각 이미지 설명에 맞는 Pexels 사진 검색 쿼리를 만들어주세요. 2~4단어 영문으로.

${targets.slice(0, count).map((d, i) => `${i + 1}. ${d}`).join('\n')}`,
    }],
  });

  const toolUse = res.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return targets.slice(0, count).map(d => `${keyword} medical`);
  const input = toolUse.input as { queries: string[] };
  return (input.queries || []).slice(0, count);
}

async function generateOneOpenAIImage(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'medium',
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error('[openai] image generation failed:', res.status, raw);
    const lower = raw.toLowerCase();
    if (lower.includes('billing_hard_limit') || lower.includes('insufficient_quota')) {
      throw new Error('openai billing_hard_limit');
    }
    if (lower.includes('content_policy') || lower.includes('safety') || lower.includes('moderation_blocked')) {
      throw new Error('openai content_policy');
    }
    if (lower.includes('verify_organization') || lower.includes('must be verified')) {
      throw new Error('openai verify_organization');
    }
    if (lower.includes('model_not_found') || lower.includes('does not exist')) {
      throw new Error('openai model_not_found');
    }
    if (lower.includes('invalid_api_key') || lower.includes('incorrect api key')) {
      throw new Error('openai invalid_api_key');
    }
    if (lower.includes('invalid_request_error')) {
      throw new Error(`openai invalid_request_error status=${res.status}`);
    }
    throw new Error(`openai status=${res.status}`);
  }
  const data = await res.json();
  const item = data.data?.[0];
  if (!item) throw new Error('OpenAI 응답이 없습니다.');

  if (item.url) return item.url as string;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  throw new Error('OpenAI 응답에 이미지 데이터가 없습니다.');
}

async function generateWithOpenAIImages(
  keyword: string,
  title: string,
  body: string,
  imageCount: number,
  userId?: string | null,
  userAgent?: string | null,
): Promise<{ images: GeneratedImage[]; errors: string[] }> {
  const descriptions = extractImageDescriptions(body);
  const prompts = await buildFluxPrompts(descriptions, keyword, title, imageCount, userId, userAgent);

  const images: GeneratedImage[] = [];
  const errors: string[] = [];
  const filled = new Set<number>();

  const pushImage = (index: number, url: string) => {
    images.push({
      id: `img-${index + 1}`,
      url,
      prompt: prompts[index],
      revised_prompt: (descriptions[index] || prompts[index]).slice(0, 80),
    });
    filled.add(index);
  };

  const settled = await runWithConcurrency(prompts, IMAGE_CONCURRENCY, (prompt) =>
    withRetry(() => generateOneOpenAIImage(prompt))
  );

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pushImage(index, result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : '실패';
      errors.push(`img-${index + 1}: ${reason}`);
    }
  });

  // 실패 슬롯 자동 backfill — 동시성 1 + 긴 backoff 로 6장 강제 채움
  for (let pass = 0; pass < IMAGE_BACKFILL_PASSES && filled.size < imageCount; pass++) {
    const missing: number[] = [];
    for (let i = 0; i < imageCount; i++) if (!filled.has(i)) missing.push(i);
    if (missing.length === 0) break;

    const backfill = await runWithConcurrency(missing, 1, (index) =>
      withRetry(() => generateOneOpenAIImage(prompts[index]), IMAGE_MAX_RETRIES, 3000)
    );

    backfill.forEach((result, k) => {
      const index = missing[k];
      if (result.status === 'fulfilled') pushImage(index, result.value);
    });
  }

  if (images.length > 0) {
    logUsage({ feature: 'generate-images', api_provider: 'openai', image_count: images.length, user_id: userId ?? null, user_agent: userAgent ?? null });
  }

  return { images, errors };
}

async function generateCardnewsImages(
  keyword: string,
  title: string,
  body: string,
  imageCount: number,
  userId?: string | null,
  userAgent?: string | null,
): Promise<{ images: GeneratedImage[]; errors: string[] }> {
  const descriptions = extractImageDescriptions(body);
  const prompts = await buildFluxPrompts(descriptions, keyword, title, imageCount, userId, userAgent);

  const images: GeneratedImage[] = [];
  const errors: string[] = [];
  const filled = new Set<number>();

  const pushImage = (index: number, url: string) => {
    images.push({
      id: `img-${index + 1}`,
      url,
      prompt: prompts[index],
      revised_prompt: (descriptions[index] || prompts[index]).slice(0, 80),
    });
    filled.add(index);
  };

  const settled = await runWithConcurrency(prompts, IMAGE_CONCURRENCY, (prompt) =>
    withRetry(() => generateWithFal(prompt))
  );

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pushImage(index, result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : '실패';
      errors.push(`img-${index + 1}: ${reason}`);
    }
  });

  // 실패 슬롯 자동 backfill — 동시성 1 + 긴 backoff 로 6장 강제 채움
  for (let pass = 0; pass < IMAGE_BACKFILL_PASSES && filled.size < imageCount; pass++) {
    const missing: number[] = [];
    for (let i = 0; i < imageCount; i++) if (!filled.has(i)) missing.push(i);
    if (missing.length === 0) break;

    const backfill = await runWithConcurrency(missing, 1, (index) =>
      withRetry(() => generateWithFal(prompts[index]), IMAGE_MAX_RETRIES, 3000)
    );

    backfill.forEach((result, k) => {
      const index = missing[k];
      if (result.status === 'fulfilled') pushImage(index, result.value);
    });
  }

  if (images.length > 0) {
    logUsage({
      feature: 'generate-images',
      api_provider: 'fal',
      image_count: images.length,
      user_id: userId ?? null,
      user_agent: userAgent ?? null,
    });
  }

  return { images, errors };
}

async function generatePhotoImages(
  keyword: string,
  body: string,
  imageCount: number
): Promise<{ images: GeneratedImage[]; errors: string[] }> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY가 설정되지 않았습니다.');

  const descriptions = extractImageDescriptions(body);
  const queries = await buildPexelsQueries(descriptions, keyword, imageCount);

  const images: GeneratedImage[] = [];
  const errors: string[] = [];

  await Promise.allSettled(
    queries.map(async (query, index) => {
      try {
        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
          { headers: { Authorization: apiKey } }
        );
        if (!res.ok) { errors.push(`img-${index + 1}: Pexels 요청 실패`); return; }

        const data = await res.json();
        const photos = Array.isArray(data.photos)
          ? data.photos as Array<{ id: number; src: { large2x: string; landscape: string }; alt: string; photographer: string }>
          : [];
        if (photos.length > 0) {
          const photo = photos[Math.floor(Math.random() * photos.length)];
          images.push({
            id: `img-${index + 1}`,
            url: photo.src.large2x || photo.src.landscape,
            prompt: query,
            revised_prompt: `${photo.alt} (Photo by ${photo.photographer} on Pexels)`,
          });
        } else {
          errors.push(`img-${index + 1}: 검색 결과 없음 (${query})`);
        }
      } catch (err) {
        errors.push(`img-${index + 1}: ${err instanceof Error ? err.message : '실패'}`);
      }
    })
  );

  return { images, errors };
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requirePaidPlan();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
    }

    const userId = gate.ok ? gate.userId : null;
    const userAgent = req.headers.get('user-agent') ?? null;

    const { keyword, title, body = '', count = 4, style = 'cardnews' } = await req.json();

    if (!keyword || !title) {
      return NextResponse.json({ error: '키워드와 제목을 입력해주세요.' }, { status: 400 });
    }

    const imageCount = Math.min(Math.max(1, count), 8);

    const { images, errors } = style === 'cardnews'
      ? await generateCardnewsImages(keyword, title, body, imageCount, userId, userAgent)
      : await generateWithOpenAIImages(keyword, title, body, imageCount, userId, userAgent);

    if (images.length === 0) {
      const sample = errors[0] ?? '';
      return NextResponse.json({ error: safeImageErrorMessage(sample) }, { status: 500 });
    }

    images.sort((a, b) => {
      const numA = parseInt(a.id.replace('img-', ''), 10);
      const numB = parseInt(b.id.replace('img-', ''), 10);
      return numA - numB;
    });

    // 영속화 — base64 data URL·만료성 CDN URL 을 clinic-assets 로 옮겨 영구 public URL 로 바꾼다.
    // 이 단계를 거쳐야 saved_posts.image_urls 에 저장되고 서브도메인 블로그에도 실린다.
    // 실패 시 원본 URL 유지(화면 표시는 정상, 저장만 스킵) — 생성 응답을 막지 않는다.
    const persistedUrls = await persistPostImages(userId, images.map((img) => img.url));
    const persistedImages = images.map((img, i) => ({ ...img, url: persistedUrls[i] ?? img.url }));

    return NextResponse.json({ images: persistedImages });
  } catch (error) {
    console.error('이미지 생성 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: safeImageErrorMessage(message) }, { status: 500 });
  }
}
