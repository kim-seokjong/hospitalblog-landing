import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  analyzePastedSamples,
  parseVoiceDnaCard,
  type VoiceDnaCard,
} from '@/content/lib/voice-dna';

export const maxDuration = 60;

/** 붙여넣기 샘플 1편당 최소 길이(너무 짧은 글은 문체 추출 불가). */
const MIN_SAMPLE_CHARS = 100;
const MAX_SAMPLES = 3;

/**
 * POST /api/voice-dna/paste
 * body: { samples: string[] }
 *
 * 사용자가 붙여넣은 기존 블로그 글 1~3편에서 문체를 추출해 profiles.voice_dna 를 갱신한다(source:'pasted').
 * 분석 실패 시 기존 카드를 유지한다(graceful).
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

    const raw = (await req.json().catch(() => null)) as { samples?: unknown } | null;
    const rawSamples = Array.isArray(raw?.samples) ? raw?.samples : null;
    if (!rawSamples) {
      return NextResponse.json({ error: '분석할 글(samples)이 필요합니다.' }, { status: 400 });
    }

    const samples = rawSamples
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_SAMPLE_CHARS)
      .slice(0, MAX_SAMPLES);

    if (samples.length === 0) {
      return NextResponse.json(
        { error: `각 글은 최소 ${MIN_SAMPLE_CHARS}자 이상이어야 합니다. 1~3편을 붙여넣어 주세요.` },
        { status: 400 },
      );
    }

    const partial = await analyzePastedSamples(samples);
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

    // 저장된 카드를 정규화해 반환(클라이언트 표시용)
    const saved = parseVoiceDnaCard(card) ?? card;
    return NextResponse.json({
      status: 'pasted',
      card: saved,
      updatedAt: nowIso,
      sampleCount: samples.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
