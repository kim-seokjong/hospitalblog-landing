import { NextRequest, NextResponse } from 'next/server';
import { logUsage } from '@/lib/usage-logger';
import type { GeneratedImage } from '@/types';

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

  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
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

    let url: string;
    if (style === 'photo') {
      url = await generatePexels(prompt);
    } else {
      url = await generateWithFal(prompt);
      logUsage({ feature: 'regenerate-image', api_provider: 'fal', image_count: 1 });
    }

    const image: GeneratedImage = {
      id: imageId || `img-${Date.now()}`,
      url,
      prompt,
      revised_prompt: prompt.slice(0, 80),
    };

    return NextResponse.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `이미지 재생성 실패: ${message}` }, { status: 500 });
  }
}
