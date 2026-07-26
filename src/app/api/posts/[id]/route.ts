import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { buildServerComplianceReport } from '@/content/lib/compliance-report-server';
import { sanitizeImageUrls, sanitizeTags, sanitizeSeoScore } from '@/content/lib/saved-post-fields';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * "의도적으로 비우기"인지 판정한다 — null 또는 빈 배열.
 * 타입이 어긋난 입력(객체·문자열 등)과 구분해, 잘못된 페이로드가 기존 산출물을
 * 조용히 파괴하는 것을 막는다.
 */
function isExplicitClear(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('saved_posts')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: '글을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ post: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    // image_urls 추가(2026-W30) — 누락돼 있어 재복사·재저장으로는 이미지를 영구히 채울 수 없었다.
    const allowedFields = ['title', 'content', 'tags', 'status', 'keyword', 'seo_score', 'image_urls', 'target_site', 'published_url'];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // compliance_report(검사 증빙 스냅샷) — 재복사(PATCH)로 최신 검사 결과가 오면 갱신.
    // 서버 검증 실패(형태 불일치)나 미전송 시 건드리지 않는다(글 수정 자체는 막지 않는 방침,
    // 마이그 034 미적용 환경은 아래 42703 폴백이 보호).
    //
    // POST 와 동일하게 A층·등급·검수 권고를 서버가 본문으로 재산정한다. 본문이 함께
    // 오지 않으면 재검사할 대상이 없으므로 리포트 갱신을 건너뛴다 — 검증만 통과한
    // 클라이언트 등급을 그대로 저장하면 발행 게이트를 우회할 수 있다.
    const incomingReport = 'compliance_report' in body
      ? buildServerComplianceReport(body.compliance_report, body.content)
      : null;
    if (incomingReport) {
      updates.compliance_report = incomingReport;
    } else if (typeof body.content === 'string' && body.content.trim() !== '') {
      // 본문이 바뀌었는데 새 검사 결과가 없으면 기존 스냅샷을 **무효화**한다.
      //
      // 무효화하지 않으면 PASS 로 저장된 글의 본문만 금지 표현으로 바꿔(PostEditor 는
      // { title, content, tags } 만 보낸다) 옛 PASS 스냅샷을 그대로 남길 수 있다.
      // site-publish·auto-publish·GEO export 는 본문을 재검사하지 않고 이 값을 읽으므로
      // 그대로면 발행 게이트가 뚫린다.
      // 리포트 없음 = 발행 차단(publish-gate 의 fail-closed 규칙)이고,
      // compliance-recheck 가 A층+B층으로 다시 검사해 복구할 수 있다.
      updates.compliance_report = null;
    }

    // original_content(VOICE-DNA 원본 스냅샷)는 불변 — 최초 1회만 채운다.
    // 재복사(PATCH)로 들어와도 이미 값이 있으면 절대 덮지 않는다. 미전송 시 건드리지 않음(하위 호환).
    const incomingOriginal =
      typeof body.original_content === 'string' && body.original_content.trim() !== ''
        ? body.original_content.trim()
        : null;
    if (incomingOriginal) {
      // 현재 값 확인 — 비어 있을 때만 채운다. 조회 실패(컬럼 미존재 등) 시 graceful 하게 건너뜀.
      const { data: current } = await supabase
        .from('saved_posts')
        .select('original_content')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();
      const hasOriginal =
        current && typeof (current as { original_content?: unknown }).original_content === 'string'
          && (current as { original_content: string }).original_content.trim() !== '';
      if (current && !hasOriginal) {
        updates.original_content = incomingOriginal;
      }
    }

    for (const field of allowedFields) {
      if (field in body) {
        if (field === 'title') {
          const val = body[field];
          if (typeof val !== 'string' || val.trim() === '') {
            return NextResponse.json({ error: '제목은 비워둘 수 없습니다.' }, { status: 400 });
          }
          updates[field] = val.trim();
        } else if (field === 'content') {
          const val = body[field];
          if (typeof val !== 'string' || val.trim() === '') {
            return NextResponse.json({ error: '본문은 비워둘 수 없습니다.' }, { status: 400 });
          }
          updates[field] = val.trim();
        } else if (field === 'tags') {
          // 빈 배열·null = 사용자가 의도적으로 비운 것 → 비운다.
          // 그 외 형태 불일치(객체·문자열 등)는 기존 값을 파괴하지 않고 보존한다.
          const normalized = sanitizeTags(body[field]);
          if (normalized) updates[field] = normalized;
          else if (isExplicitClear(body[field])) updates[field] = null;
        } else if (field === 'image_urls') {
          // Storage(clinic-assets) public URL 만 통과. 빈 배열·null 은 명시적 비우기.
          const normalized = sanitizeImageUrls(body[field], process.env.NEXT_PUBLIC_SUPABASE_URL);
          if (normalized) updates[field] = normalized;
          else if (isExplicitClear(body[field])) updates[field] = null;
        } else if (field === 'seo_score') {
          // 타입 미검증으로 문자열이 넘어가면 Postgres 22P02 로 저장 전체가 실패했다.
          const normalized = sanitizeSeoScore(body[field]);
          if (normalized !== null) updates[field] = normalized;
          else if (body[field] === null) updates[field] = null;
        } else if (field === 'status') {
          const validStatuses = ['draft', 'scheduled', 'published'];
          if (!validStatuses.includes(body[field])) {
            return NextResponse.json({ error: '유효하지 않은 상태값입니다.' }, { status: 400 });
          }
          updates[field] = body[field];
        } else if (field === 'target_site') {
          const val = body[field];
          // null은 네이버 간주로 되돌리는 정당한 경우 → 허용
          if (val === null) {
            updates[field] = null;
          } else if (val === 'naver' || val === 'google') {
            updates[field] = val;
          } else {
            return NextResponse.json({ error: 'target_site는 naver 또는 google이어야 합니다.' }, { status: 400 });
          }
        } else if (field === 'published_url') {
          const val = body[field];
          if (val === null) {
            updates[field] = null;
          } else if (typeof val === 'string' && /^https?:\/\//i.test(val.trim())) {
            updates[field] = val.trim();
          } else {
            return NextResponse.json({ error: 'published_url은 http(s) URL이어야 합니다.' }, { status: 400 });
          }
        } else {
          updates[field] = body[field];
        }
      }
    }

    let { data, error } = await supabase
      .from('saved_posts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    // 마이그 034(compliance_report) 미적용 환경 폴백 — 컬럼 없음(42703)이면
    // 리포트만 제외하고 재시도한다(글 수정 자체를 막지 않는다).
    //
    // 조건은 `incomingReport` 가 아니라 **updates 에 컬럼이 들어갔는지**로 판정한다.
    // 무효화 경로(compliance_report = null)는 incomingReport 가 null 이라
    // 예전 조건으로는 폴백을 타지 못해, 컬럼 미존재 환경에서 PostEditor 의
    // 본문 저장이 500 으로 실패했다.
    if (error && 'compliance_report' in updates && error.code === '42703') {
      const { compliance_report: _omitted, ...withoutReport } = updates;
      ({ data, error } = await supabase
        .from('saved_posts')
        .update(withoutReport)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single());
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: '글을 찾을 수 없거나 권한이 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ post: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { error } = await supabase
      .from('saved_posts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
