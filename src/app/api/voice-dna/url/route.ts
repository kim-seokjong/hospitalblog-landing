import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { parseNaverBlogId, fetchNaverBlogPosts } from '@/content/lib/naver-blog-fetch';
import {
  analyzeBlogSamples,
  parseVoiceDnaCard,
  type VoiceDnaCard,
} from '@/content/lib/voice-dna';

export const maxDuration = 60;

/** 자동 수집 글 수 상한. */
const COLLECT_LIMIT = 8;

/**
 * POST /api/voice-dna/url
 * body: { blogUrl: string }
 *
 * 본인 병원 네이버 블로그 주소로 최근 글 본문을 자동 수집해 문체를 분석하고
 * profiles.voice_dna 를 갱신한다(source:'pasted', sampleCount=수집편수).
 *
 * 에러: 400(주소 파싱 실패) · 422(본문 수집 0편) · 502(분석 실패, 기존 카드 유지) · 500.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const raw = (await req.json().catch(() => null)) as { blogUrl?: unknown } | null;
    const blogUrl = typeof raw?.blogUrl === 'string' ? raw.blogUrl : '';

    const blogId = parseNaverBlogId(blogUrl);
    if (!blogId) {
      return NextResponse.json(
        { error: '네이버 블로그 주소를 확인해주세요. 예: blog.naver.com/myclinic' },
        { status: 400 },
      );
    }

    const samples = await fetchNaverBlogPosts(blogId, COLLECT_LIMIT);
    if (samples.length === 0) {
      return NextResponse.json(
        {
          error:
            '블로그에서 글 본문을 가져오지 못했습니다. 공개 블로그인지, 발행된 글이 있는지 확인하거나 직접 붙여넣기를 이용해주세요.',
        },
        { status: 422 },
      );
    }

    const partial = await analyzeBlogSamples(samples);
    if (!partial) {
      // 분석 실패(graceful) — 기존 카드 유지
      return NextResponse.json({ status: 'analyze_failed' }, { status: 502 });
    }

    const card: VoiceDnaCard = {
      tone: partial.tone ?? '따뜻하고 신뢰감 있는',
      patientTerm: partial.patientTerm ?? '환자분',
      narrator: partial.narrator ?? '원장',
      sentenceStyle: partial.sentenceStyle ?? '짧고 명확',
      signatures: partial.signatures ?? [],
      description: partial.description ?? '',
      source: 'pasted',
      sampleCount: samples.length,
    };

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ voice_dna: card, voice_dna_updated_at: nowIso })
      .eq('id', user.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const saved = parseVoiceDnaCard(card) ?? card;
    return NextResponse.json({
      status: 'blog',
      card: saved,
      updatedAt: nowIso,
      collected: samples.length,
      blogId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
