import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  parseVoiceDnaCard,
  sanitizeSignatures,
  type VoiceDnaCard,
  type VoiceDnaSource,
} from '@/content/lib/voice-dna';

export const dynamic = 'force-dynamic';

/**
 * GET /api/voice-dna
 * 인증 후 본인 voice_dna 카드 + voice_dna_updated_at 을 반환한다.
 * 카드가 없으면 card:null 로 응답(콜드스타트).
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('voice_dna, voice_dna_updated_at')
      .eq('id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
    }

    const card = parseVoiceDnaCard(data.voice_dna);
    return NextResponse.json({
      card,
      updatedAt: typeof data.voice_dna_updated_at === 'string' ? data.voice_dna_updated_at : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 문자열 필드를 검증·trim 한다. 미전송이면 fallback 유지. */
function pickStr(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  if (t === '') return fallback;
  return t.slice(0, maxLen);
}

/**
 * PATCH /api/voice-dna
 * body: { tone?, patientTerm?, narrator?, sentenceStyle?, signatures?, description? }
 *
 * 사용자가 마이페이지에서 수동 편집한 카드 필드를 검증·sanitize 후 profiles.voice_dna 에 저장한다.
 * source 는 'pasted'(사용자가 직접 손댄 표시)로 기록하고 voice_dna_updated_at 을 갱신한다.
 * sampleCount 등 메타는 기존 카드 값을 보존한다.
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    // 기존 카드 로드 — 미전송 필드·메타(sampleCount) 보존용
    const { data: profileRow, error: loadErr } = await supabase
      .from('profiles')
      .select('voice_dna')
      .eq('id', user.id)
      .single();

    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 });
    }

    const existing = parseVoiceDnaCard(profileRow?.voice_dna);

    // 사용자가 손댄 카드는 'pasted'(사용자 정의) 출처로 표시
    const source: VoiceDnaSource = 'pasted';
    const next: VoiceDnaCard = {
      tone: pickStr(body.tone, existing?.tone ?? '따뜻하고 신뢰감 있는', 60),
      patientTerm: pickStr(body.patientTerm, existing?.patientTerm ?? '환자분', 20),
      narrator: pickStr(body.narrator, existing?.narrator ?? '원장', 20),
      sentenceStyle: pickStr(body.sentenceStyle, existing?.sentenceStyle ?? '짧고 명확', 40),
      signatures:
        'signatures' in body ? sanitizeSignatures(body.signatures) : existing?.signatures ?? [],
      description: pickStr(body.description, existing?.description ?? '', 300),
      source,
      sampleCount: existing?.sampleCount ?? 0,
    };

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ voice_dna: next, voice_dna_updated_at: nowIso })
      .eq('id', user.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ card: next, updatedAt: nowIso });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
