import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';
import { logUsage } from '@/lib/usage-logger';
import type { GeneratedImage } from '@/types';

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
      content: `아래 한국어 이미지 설명을 Flux.1 Pro 이미지 생성에 최적화된 영어 프롬프트로 변환해주세요.

한국어 설명: "${koreanDesc}"

규칙:
- 영어로만 출력 (80~120단어)
- Flux.1 스타일: "RAW photo, professional DSLR, 8K UHD, photorealistic, sharp focus, cinematic lighting"
- 병원·의료 맥락 유지
- 등장인물은 한국인 외모로: "Korean people, East Asian appearance"
- 설명 없이 프롬프트 텍스트만 출력`,
    }],
  });

  const text = res.content.find(b => b.type === 'text');
  return text?.type === 'text' ? text.text.trim() : koreanDesc;
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

  if (!res.ok) throw new Error(`fal.ai 요청 실패: ${await res.text()}`);
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
    const { imageId, prompt, style = 'cardnews' } = await req.json();

    if (!prompt) return NextResponse.json({ error: '프롬프트를 입력해주세요.' }, { status: 400 });

    // 한국어 입력이면 영어 프롬프트로 자동 변환
    const isKorean = hasKorean(prompt);
    const englishPrompt = isKorean ? await translateToFluxPrompt(prompt) : prompt;

    let url: string;
    if (style === 'photo') {
      url = await generatePexels(prompt);
    } else {
      url = await generateWithFal(englishPrompt);
      logUsage({ feature: 'regenerate-image', api_provider: 'fal', image_count: 1 });
    }

    const image: GeneratedImage = {
      id: imageId || `img-${Date.now()}`,
      url,
      prompt,                          // 사용자가 입력한 원문(한국어) 저장
      revised_prompt: englishPrompt.slice(0, 120),  // 실제 사용된 영어 프롬프트
    };

    return NextResponse.json({ image, translatedPrompt: isKorean ? englishPrompt : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `이미지 재생성 실패: ${message}` }, { status: 500 });
  }
}
