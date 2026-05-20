import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { OPENAI_IMAGE_MODEL } from '@/content/lib/openai';
import { logUsage } from '@/dev/lib/usage-logger';
import { requirePaidPlan } from '@/payment/lib/usage-guard';
import type { GeneratedImage } from '@/types';

export const maxDuration = 60;

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
    return '이미지 콘텐츠 정책으로 생성이 거부되었습니다. 프롬프트를 조정해 다시 시도해주세요.';
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
  return '이미지 재생성에 실패했습니다. 잠시 후 다시 시도해주세요.';
}

function hasKorean(text: string): boolean {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

async function translateToFluxPrompt(koreanDesc: string): Promise<string> {
  const anthropic = getAnthropicClient();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `아래 한국어 이미지 설명을 gpt-image-2에 최적화된 영어 프롬프트로 변환해주세요.

한국어 설명: "${koreanDesc}"

프롬프트 구조 (순서대로):
1. 장면: ultra-realistic photo + 상황 설명
2. 인물: Korean people, East Asian appearance
3. 조명: natural indoor lighting, soft diffused daylight, true-to-life colors (cinematic light, studio light 금지)
4. 피부 실사 섹션: "Skin realism focus: visible pores, fine micro-texture, organic acne marks (non-repeating), uneven pigmentation, subtle redness, natural oil sheen only on high points, visible peach fuzz and very fine vellus hair. No symmetry correction."
5. 카메라: phone camera realism, subtle sensor grain, slight edge softness
6. 금지: "No retouching, no smoothing, no beauty filters, no AI glow, no plastic skin, no studio light, no cinematic lighting, no illustration, no cartoon, no 3D render, no text, no logo"

- 영어로만 출력 (80~120단어)
- 병원·의료 맥락 유지
- 설명 없이 프롬프트 텍스트만 출력`,
    }],
  });

  const text = res.content.find(b => b.type === 'text');
  return text?.type === 'text' ? text.text.trim() : koreanDesc;
}

async function generateWithOpenAI(prompt: string): Promise<string> {
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
    console.error('[openai] regenerate failed:', res.status, raw);
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
  throw new Error('OpenAI 이미지 데이터 없음');
}

async function generateWithFal(prompt: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY가 설정되지 않았습니다.');

  const res = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
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
    const raw = await res.text();
    console.error('[fal.ai] regenerate failed:', res.status, raw);
    throw new Error(`fal.ai status=${res.status}`);
  }
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error('fal.ai 응답에 이미지 URL이 없습니다.');
  return url as string;
}

async function generatePexels(query: string): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY가 설정되지 않았습니다.');

  // Pexels도 한국어면 번역, 실패 시 원문 사용
  let searchQuery = query;
  if (hasKorean(query)) {
    try {
      searchQuery = await translateToFluxPrompt(query);
    } catch {
      searchQuery = query;
    }
  }

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=15&orientation=landscape`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) throw new Error('Pexels 요청 실패');
  const data = await res.json();
  const photos = Array.isArray(data.photos) ? data.photos as Array<{ src: { large2x: string } }> : [];
  if (!photos.length) throw new Error('검색 결과가 없습니다.');
  const photo = photos[Math.floor(Math.random() * photos.length)];
  return photo.src.large2x;
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requirePaidPlan();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
    }

    const { imageId, prompt, style = 'cardnews', provider = 'openai' } = await req.json();

    if (!prompt) return NextResponse.json({ error: '프롬프트를 입력해주세요.' }, { status: 400 });

    // 한국어 입력이면 영어 프롬프트로 자동 변환
    const isKorean = hasKorean(prompt);
    const englishPrompt = isKorean ? await translateToFluxPrompt(prompt) : prompt;

    let url: string;
    if (style === 'cardnews' || provider === 'fal') {
      url = await generateWithFal(englishPrompt);
      logUsage({ feature: 'regenerate-image', api_provider: 'fal', image_count: 1 });
    } else {
      // 같은 프롬프트 반복 시 다른 장면이 나오도록 변형 지시 추가
      const sceneVariants = [
        'Show a completely different scene with different subjects and setting.',
        'Different moment, different angle, different background.',
        'Alternative view: change the composition and subjects entirely.',
        'New scene with different activity and environment.',
      ];
      const variant = sceneVariants[Math.floor(Math.random() * sceneVariants.length)];
      url = await generateWithOpenAI(`${englishPrompt} ${variant}`);
      logUsage({ feature: 'regenerate-image', api_provider: 'openai', image_count: 1 });
    }

    const image: GeneratedImage = {
      id: imageId || `img-${Date.now()}`,
      url,
      prompt,                          // 사용자가 입력한 원문(한국어) 저장
      revised_prompt: englishPrompt.slice(0, 120),  // 실제 사용된 영어 프롬프트
    };

    return NextResponse.json({ image, translatedPrompt: isKorean ? englishPrompt : undefined });
  } catch (error) {
    console.error('이미지 재생성 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: safeImageErrorMessage(message) }, { status: 500 });
  }
}
