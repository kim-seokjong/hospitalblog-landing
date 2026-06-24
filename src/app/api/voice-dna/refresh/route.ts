import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import {
  buildSeedCard,
  analyzeEdits,
  isMeaningfulEdit,
  parseVoiceDnaCard,
  MIN_PAIRS_FOR_LEARNING,
  type EditPair,
  type VoiceDnaCard,
  type VoiceDnaProfile,
} from '@/content/lib/voice-dna';

export const maxDuration = 60;

/**
 * POST /api/voice-dna/refresh
 *
 * VOICE-DNA 문체 카드 갱신 트리거. 서버가 임계를 판단하므로 매번 호출해도 안전하다
 * (page.tsx 가 복사 저장 성공 후 fire-and-forget 으로 호출).
 *
 * 동작:
 *  1) 인증 → 사용자 published saved_posts 조회(original_content + content 쌍)
 *  2) isMeaningfulEdit 로 의미 있는 편집쌍만 추림
 *  3) 3개 이상이면 analyzeEdits 로 카드 학습 → profiles.voice_dna 갱신(learned)
 *  4) 미달이고 카드가 아직 없으면 buildSeedCard 로 시드만 생성(seed)
 *  5) 미달이고 카드가 이미 있으면 no-op
 *
 * 모든 단계는 graceful — 실패해도 500 보다 의미 있는 JSON 으로 응답하거나 기존 카드를 유지한다.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 현재 프로필 + 카드 로드
    const { data: profileRow, error: profileErr } = await supabase
      .from('profiles')
      .select('hospital_type, hospital_name, hospital_desc, hospital_keywords, voice_dna')
      .eq('id', user.id)
      .single();

    if (profileErr || !profileRow) {
      return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
    }

    const existingCard = parseVoiceDnaCard(profileRow.voice_dna);

    // 발행된 글 중 원본 스냅샷이 있는 것만(편집쌍 후보)
    const { data: posts, error: postsErr } = await supabase
      .from('saved_posts')
      .select('original_content, content')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('original_content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (postsErr) {
      return NextResponse.json({ error: postsErr.message }, { status: 500 });
    }

    const meaningfulPairs: EditPair[] = (posts ?? [])
      .map((p) => ({
        original: typeof p.original_content === 'string' ? p.original_content : '',
        edited: typeof p.content === 'string' ? p.content : '',
      }))
      .filter((pair) => pair.original !== '' && pair.edited !== '')
      .filter((pair) => isMeaningfulEdit(pair.original, pair.edited));

    // 임계 미달 — 카드 있으면 no-op, 없으면 시드 생성
    if (meaningfulPairs.length < MIN_PAIRS_FOR_LEARNING) {
      if (existingCard) {
        return NextResponse.json({
          status: 'noop',
          source: existingCard.source,
          meaningfulPairs: meaningfulPairs.length,
        });
      }

      const profile: VoiceDnaProfile = {
        hospital_type: profileRow.hospital_type ?? null,
        hospital_name: profileRow.hospital_name ?? null,
        hospital_desc: profileRow.hospital_desc ?? null,
        keywords: Array.isArray(profileRow.hospital_keywords) ? profileRow.hospital_keywords : null,
      };
      const seedCard = await buildSeedCard(profile);
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ voice_dna: seedCard, voice_dna_updated_at: nowIso })
        .eq('id', user.id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      return NextResponse.json({
        status: 'seeded',
        card: seedCard,
        meaningfulPairs: meaningfulPairs.length,
      });
    }

    // 임계 충족 — 학습 카드 생성
    const learnedPartial = await analyzeEdits(meaningfulPairs);
    if (!learnedPartial) {
      // 분석 실패(graceful): 기존 카드 유지, 시드도 없으면 시드 생성 시도
      if (existingCard) {
        return NextResponse.json({
          status: 'analyze_failed_kept',
          source: existingCard.source,
          meaningfulPairs: meaningfulPairs.length,
        });
      }
      return NextResponse.json({
        status: 'analyze_failed_no_card',
        meaningfulPairs: meaningfulPairs.length,
      });
    }

    const learnedCard: VoiceDnaCard = {
      tone: learnedPartial.tone ?? existingCard?.tone ?? '따뜻하고 신뢰감 있는',
      patientTerm: learnedPartial.patientTerm ?? existingCard?.patientTerm ?? '환자분',
      narrator: learnedPartial.narrator ?? existingCard?.narrator ?? '원장',
      sentenceStyle: learnedPartial.sentenceStyle ?? existingCard?.sentenceStyle ?? '짧고 명확',
      signatures: learnedPartial.signatures ?? existingCard?.signatures ?? [],
      description: learnedPartial.description ?? existingCard?.description ?? '',
      source: 'learned',
      sampleCount: meaningfulPairs.length,
    };

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ voice_dna: learnedCard, voice_dna_updated_at: nowIso })
      .eq('id', user.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      status: 'learned',
      card: learnedCard,
      meaningfulPairs: meaningfulPairs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
