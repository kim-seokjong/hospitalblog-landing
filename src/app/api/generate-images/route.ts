import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';
import { OPENAI_IMAGE_MODEL } from '@/lib/openai';
import { logUsage } from '@/lib/usage-logger';
import type { GeneratedImage } from '@/types';

export const maxDuration = 120;

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
    throw new Error(`fal.ai 요청 실패: ${err}`);
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
  count: number
): Promise<string[]> {
  const anthropic = getAnthropicClient();
  const targets = [...descriptions];
  while (targets.length < count) targets.push(`${keyword} 관련 의료 장면 ${targets.length + 1}`);

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

이미지 설명:
${targets.slice(0, count).map((d, i) => `${i + 1}. ${d}`).join('\n')}

프롬프트 구조 (각 이미지마다 아래 순서로 작성):
1. 장면: 촬영 방식 + 인물/상황 설명 (ultra-realistic photo / close-up portrait / medium shot 중 구도 순환)
2. 인물: Korean people, East Asian appearance, Korean patient/doctor/medical staff
3. 조명: natural indoor lighting, soft diffused daylight, true-to-life colors, accurate white balance (cinematic light, studio light 절대 금지)
4. 피부 실사 섹션 반드시 포함: "Skin realism focus: visible pores, fine micro-texture, organic acne marks (non-repeating), uneven pigmentation, subtle redness, natural oil sheen only on high points, visible peach fuzz and very fine vellus hair. No symmetry correction."
5. 카메라: phone camera realism, subtle sensor grain, slight edge softness
6. 금지: "No retouching, no smoothing, no beauty filters, no AI glow, no plastic skin, no studio light, no cinematic lighting, no illustration, no cartoon, no 3D render, no text, no logo"

- 영어로만 출력, 각 프롬프트 80~120단어
- 의료 현장의 실제 모습 (병원 인테리어, 의료진, 장비, 환자 치료)`,
    }],
  });

  logUsage({
    feature: 'generate-images',
    api_provider: 'anthropic',
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  });

  const toolUse = res.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return targets.slice(0, count).map(d =>
      `ultra-realistic, ${d}, Korean medical staff and patients, East Asian appearance, phone camera realism, slight sensor grain, natural indoor lighting, soft diffused daylight, visible pores, subsurface scattering skin, no AI glow, no plastic skin, no studio light, no illustration, no cartoon`
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

  if (!res.ok) throw new Error(`OpenAI 이미지 생성 실패: ${await res.text()}`);
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
  imageCount: number
): Promise<{ images: GeneratedImage[]; errors: string[] }> {
  const descriptions = extractImageDescriptions(body);
  const prompts = await buildFluxPrompts(descriptions, keyword, title, imageCount);

  const images: GeneratedImage[] = [];
  const errors: string[] = [];

  await Promise.allSettled(
    prompts.map(async (prompt, index) => {
      try {
        const url = await generateOneOpenAIImage(prompt);
        images.push({
          id: `img-${index + 1}`,
          url,
          prompt,
          revised_prompt: (descriptions[index] || prompt).slice(0, 80),
        });
      } catch (err) {
        errors.push(`img-${index + 1}: ${err instanceof Error ? err.message : '실패'}`);
      }
    })
  );

  if (images.length > 0) {
    logUsage({ feature: 'generate-images', api_provider: 'openai', image_count: images.length });
  }

  return { images, errors };
}

async function generateCardnewsImages(
  keyword: string,
  title: string,
  body: string,
  imageCount: number
): Promise<{ images: GeneratedImage[]; errors: string[] }> {
  const descriptions = extractImageDescriptions(body);
  const prompts = await buildFluxPrompts(descriptions, keyword, title, imageCount);

  const images: GeneratedImage[] = [];
  const errors: string[] = [];

  await Promise.allSettled(
    prompts.map(async (prompt, index) => {
      try {
        const url = await generateWithFal(prompt);
        images.push({
          id: `img-${index + 1}`,
          url,
          prompt,
          revised_prompt: (descriptions[index] || prompt).slice(0, 80),
        });
      } catch (err) {
        errors.push(`img-${index + 1}: ${err instanceof Error ? err.message : '실패'}`);
      }
    })
  );

  if (images.length > 0) {
    logUsage({
      feature: 'generate-images',
      api_provider: 'fal',
      image_count: images.length,
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
    const { keyword, title, body = '', count = 4, style = 'cardnews' } = await req.json();

    if (!keyword || !title) {
      return NextResponse.json({ error: '키워드와 제목을 입력해주세요.' }, { status: 400 });
    }

    const imageCount = Math.min(Math.max(1, count), 8);

    const { images, errors } = style === 'cardnews'
      ? await generateCardnewsImages(keyword, title, body, imageCount)
      : await generateWithOpenAIImages(keyword, title, body, imageCount);

    if (images.length === 0) {
      return NextResponse.json({ error: '이미지 생성에 실패했습니다.', details: errors }, { status: 500 });
    }

    images.sort((a, b) => {
      const numA = parseInt(a.id.replace('img-', ''), 10);
      const numB = parseInt(b.id.replace('img-', ''), 10);
      return numA - numB;
    });
    return NextResponse.json({ images, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error('이미지 생성 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `이미지 생성 실패: ${message}` }, { status: 500 });
  }
}
