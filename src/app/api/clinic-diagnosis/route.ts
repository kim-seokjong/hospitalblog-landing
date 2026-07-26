import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { findClinicByMngNo } from '@/content/lib/clinic-diagnosis/registry';
import { runClinicDiagnosis } from '@/content/lib/clinic-diagnosis/run';
import { parseBlogCheckInput } from '@/content/lib/blog-check-input';
import { normalizeSiteUrl } from '@/content/lib/clinic-diagnosis/site-audit';
import {
  consumeDiagnosisQuota,
  diagnosisCacheKey,
  DIAGNOSIS_CACHE_TTL_MS,
  extractClientIp,
  getDiagnosisInflight,
  isCacheable,
  joinOrStartSingleFlight,
  limitMessage,
} from '@/content/lib/clinic-diagnosis/limits';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';
import type { ClinicCandidate, DiagnosisReport } from '@/content/lib/clinic-diagnosis/types';

export const dynamic = 'force-dynamic';
/** 블로그(RSS+본문+키워드) · 홈페이지(3 GET) · AI(3질의) 병렬 — 여유치. */
export const maxDuration = 60;

/** 붙여넣기 본문 상한(자). */
const MAX_PASTED_BODY = 20_000;

/**
 * POST /api/clinic-diagnosis — 확정된 병원 1곳의 네 축 진단 (비회원 공개).
 *
 * body: {
 *   mngNo: string,            // /lookup 에서 고른 행안부 관리번호
 *   name: string,             // 같은 후보를 다시 찾기 위한 이름
 *   region?: string,
 *   blogId?: string,          // 상세 진단 — 자동 탐색 대신 직접 지정
 *   siteUrl?: string,         // 상세 진단 — 자동 탐색 대신 직접 지정
 *   body?: string,            // 상세 진단 — 본문 전문 붙여넣기(의료광고법 정밀 점검)
 *   share?: boolean           // 공유 링크 발급 여부
 * }
 *
 * 남용·비용 방어:
 * - 캐시: 병원(+직접 지정값) 단위 7일. 캐시 히트는 캡을 소비하지 않는다.
 * - 캡: IP당 일 3회 + 전체 일 100회
 * - single-flight: 같은 병원 동시 요청은 리더 1회만 실행(팔로워 무과금)
 * - 붙여넣은 본문이 있으면 캐시하지 않는다(매번 다른 입력)
 *
 * ⚠️ mngNo 는 클라이언트가 보내는 값이므로 **서버에서 행안부로 재확인**한 뒤
 *    그 결과로만 진단한다. 클라이언트가 조작한 병원 정보로 리포트가 만들어지지 않는다.
 */
export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const mngNo = typeof raw?.mngNo === 'string' ? raw.mngNo.trim() : '';
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    const region = typeof raw?.region === 'string' ? raw.region.trim() : '';
    const share = raw?.share === true;

    if (!mngNo || mngNo.length > 60 || name.length < 2 || name.length > 60) {
      return NextResponse.json({ error: '병원을 먼저 선택해 주세요.' }, { status: 400 });
    }

    // 직접 지정값 검증 — 실패하면 조용히 무시하지 않고 알린다(사용자가 오타를 고칠 수 있게).
    const blogId = raw?.blogId === undefined || raw?.blogId === null ? null : parseBlogCheckInput(raw.blogId);
    if (raw?.blogId && !blogId) {
      return NextResponse.json(
        { error: '블로그 주소를 확인해 주세요. 예: blog.naver.com/myclinic' },
        { status: 400 },
      );
    }
    const rawSite = typeof raw?.siteUrl === 'string' ? raw.siteUrl.trim() : '';
    const siteUrl = rawSite ? (normalizeSiteUrl(rawSite)?.httpsUrl ?? null) : null;
    if (rawSite && !siteUrl) {
      return NextResponse.json({ error: '홈페이지 주소를 확인해 주세요. 예: www.myclinic.co.kr' }, { status: 400 });
    }
    const pastedBody =
      typeof raw?.body === 'string' && raw.body.trim().length >= 50 ? raw.body.trim().slice(0, MAX_PASTED_BODY) : null;

    const cacheKey = diagnosisCacheKey({ mngNo, blogId, siteUrl, hasPastedBody: Boolean(pastedBody) });
    const cacheable = isCacheable({ hasPastedBody: Boolean(pastedBody) });

    // 1) 캐시 히트 — 캡 미소비
    if (cacheable) {
      const cached = cacheGet<DiagnosisReport>(cacheKey);
      if (cached) {
        return NextResponse.json({ report: cached, cached: true, shareUrl: null });
      }
    }

    // 2) single-flight + 캡 (in-flight 확인이 캡보다 먼저 — 팔로워는 무과금으로 조인)
    const join = joinOrStartSingleFlight<DiagnosisReport | null>(
      getDiagnosisInflight<DiagnosisReport | null>(),
      cacheKey,
      () => consumeDiagnosisQuota(extractClientIp(req.headers)),
      async () => {
        // 서버에서 병원을 재확인한다 — 클라이언트가 준 mngNo 를 그대로 믿지 않는다.
        const clinic = await findClinicByMngNo(mngNo, name, { region });
        if (!clinic) return null;
        return runClinicDiagnosis(clinic, { manualBlogId: blogId, manualSiteUrl: siteUrl, pastedBody });
      },
    );
    if (!join.ok) {
      return NextResponse.json({ error: limitMessage(join.reason) }, { status: 429 });
    }

    const report = await join.promise;
    if (!report) {
      return NextResponse.json(
        { error: '선택한 병원을 다시 확인하지 못했어요. 병원을 다시 선택해 주세요.' },
        { status: 422 },
      );
    }

    // 3) 리더만 캐시 저장 + 리드 적재 + 공유 링크 발급 (전부 그레이스풀)
    let shareUrl: string | null = null;
    if (join.isLeader) {
      if (cacheable) cacheSet(cacheKey, report, DIAGNOSIS_CACHE_TTL_MS);
      await saveLead(report.clinic, report);
      if (share) shareUrl = await createShareLink(report);
    }

    return NextResponse.json({ report, cached: false, shareUrl });
  } catch (err) {
    console.error('[clinic-diagnosis]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '진단 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

/** 영업 리드 적재 — 실패해도 진단 응답을 막지 않는다(테이블 미적용 포함). */
async function saveLead(clinic: ClinicCandidate, report: DiagnosisReport): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('clinic_diagnosis_leads').insert({
      mng_no: clinic.mngNo,
      clinic_name: clinic.name.slice(0, 120),
      region: `${clinic.province} ${clinic.region}`.trim().slice(0, 60),
      specialty: clinic.specialty.slice(0, 40),
      phone: clinic.phone.slice(0, 30),
      blog_id: report.blog.blogId,
      site_url: report.site.url,
      source: 'clinic-check',
    });
    if (error) console.error('[clinic-diagnosis] 리드 적재 실패(무시):', error.message);
  } catch (e) {
    console.error('[clinic-diagnosis] 리드 적재 예외(무시):', e instanceof Error ? e.message : e);
  }
}

/**
 * 공유 링크 발급 — 대표가 전화·메일 후속에 그대로 보낼 수 있는 읽기 전용 주소.
 * 토큰은 추측 불가능한 난수(UUID 2개 결합, 하이픈 제거 = 64자)로만 만든다.
 */
async function createShareLink(report: DiagnosisReport): Promise<string | null> {
  try {
    const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
    const admin = createAdminClient();
    const { error } = await admin.from('clinic_diagnosis_reports').insert({
      mng_no: report.clinic.mngNo,
      clinic_name: report.clinic.name.slice(0, 120),
      share_token: token,
      results: report,
    });
    if (error) {
      console.error('[clinic-diagnosis] 공유 링크 발급 실패(무시):', error.message);
      return null;
    }
    return `/clinic-check/r/${token}`;
  } catch (e) {
    console.error('[clinic-diagnosis] 공유 링크 예외(무시):', e instanceof Error ? e.message : e);
    return null;
  }
}
