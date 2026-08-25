import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { resolveClinicForDiagnosis } from '@/content/lib/clinic-diagnosis/lookup-service';
import { runClinicDiagnosis } from '@/content/lib/clinic-diagnosis/run';
import { parseBlogCheckInput } from '@/content/lib/blog-check-input';
import { normalizeSiteUrl } from '@/content/lib/clinic-diagnosis/site-audit';
import {
  consumeDiagnosisQuota,
  diagnosisCacheKey,
  DIAGNOSIS_CACHE_TTL_MS,
  extractClientIp,
  getDiagnosisInflight,
  getShareInflight,
  isCacheable,
  joinOrStartSingleFlight,
  limitMessage,
  shareOnce,
} from '@/content/lib/clinic-diagnosis/limits';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';
import { hashClientIp } from '@/content/lib/clinic-diagnosis/email-lead';
import { ANON_ID_COOKIE, isValidAnonId } from '@/content/lib/funnel-events';
import { isBotUserAgent } from '@/content/lib/bot-user-agent';
import { INTERNAL_COOKIE, INTERNAL_COOKIE_VALUE } from '@/content/lib/internal-traffic';
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
 *   mngNo: string,            // /lookup 에서 고른 병원 식별자 (행안부 MNG_NO 또는 'hira:…' 폴백)
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
 * ⚠️ mngNo 는 클라이언트가 보내는 값이므로 **서버에서 원천에 재확인**한 뒤
 *    그 결과로만 진단한다. 클라이언트가 조작한 병원 정보로 리포트가 만들어지지 않는다.
 *    (행안부 관리번호 → 행안부 / 'hira:…' → 폴백 명부. 접두사로 키 공간이 갈린다.)
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
        // ★리드는 캐시 여부와 무관하게 남긴다 (2026-08-10, Codex 지적).
        //   예전에는 캐시 미스의 리더만 saveLead 를 탔다. 그러면 우리가 테스트로 한 번
        //   조회한 병원을 TTL(7일) 안에 **진짜 외부 병원이 조회해도 기록이 통째로 사라진다.**
        //   진단은 영업 리드 확보가 목적이므로, 캐시는 조회 비용을 아끼는 장치일 뿐
        //   "누가 진단했는가"를 버리는 근거가 될 수 없다.
        await saveLead(cached.clinic, cached, readRequester(req));
        const shared = share ? await getOrCreateShare(cacheKey, cached, cacheable) : null;
        return NextResponse.json({
          report: cached,
          cached: true,
          shareUrl: shared?.url ?? null,
          shareToken: shared?.token ?? null,
        });
      }
    }

    // 2) single-flight + 캡 (in-flight 확인이 캡보다 먼저 — 팔로워는 무과금으로 조인)
    const join = joinOrStartSingleFlight<DiagnosisReport | null>(
      getDiagnosisInflight<DiagnosisReport | null>(),
      cacheKey,
      () => consumeDiagnosisQuota(extractClientIp(req.headers)),
      async () => {
        // 서버에서 병원을 재확인한다 — 클라이언트가 준 mngNo 를 그대로 믿지 않는다.
        // 식별자 접두사('hira:')로 원천을 갈라 행안부 또는 폴백 명부에서 다시 읽는다.
        const clinic = await resolveClinicForDiagnosis(mngNo, name, region);
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

    // 3) 캐시 저장은 리더만. **공유 링크와 리드 적재는 모든 경로**에서 한다.
    //
    // ★ 공유 링크 — 예전에는 리더만 받아서, 캐시 히트·팔로워로 들어온 사용자는
    //   shareUrl 이 null 이었다. 결과를 메일로 보내는 동선(1순위)은 이 토큰으로
    //   서버가 리포트를 다시 읽는 구조라, 토큰이 없으면 그 사용자는 메일을 요청할 수
    //   없다 — 이메일 확보가 캐시 여부에 따라 갈리면 안 된다.
    //   캐시된 토큰을 재사용하므로 리포트 행이 요청마다 늘어나지도 않는다.
    //
    // ★ 리드 — 같은 이유로 팔로워도 남긴다(2026-08-10). 팔로워는 리더와 **다른 사람**이고,
    //   진단의 목적이 영업 리드 확보이므로 동시에 들어왔다는 이유로 한 명을 버릴 수 없다.
    if (join.isLeader && cacheable) cacheSet(cacheKey, report, DIAGNOSIS_CACHE_TTL_MS);
    await saveLead(report.clinic, report, readRequester(req));
    const shared = share ? await getOrCreateShare(cacheKey, report, cacheable) : null;

    return NextResponse.json({
      report,
      cached: false,
      shareUrl: shared?.url ?? null,
      shareToken: shared?.token ?? null,
    });
  } catch (err) {
    console.error('[clinic-diagnosis]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '진단 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

/**
 * 요청자 귀속 정보 — 원본 IP·UA 는 저장하지 않는다.
 *
 * 필요한 이유(2026-08-05): 7/28 10분 사이에 19곳이 연속 진단된 기록이 남았는데
 * 그게 우리 검증인지 외부의 대량 조회인지 사후에 가릴 수가 없었다. 진단은 핵심
 * 리드 경로라 "누가 얼마나 쓰는가"를 모르면 지표도 대응도 성립하지 않는다.
 */
function readRequester(req: NextRequest): Requester {
  const ua = req.headers.get('user-agent') ?? '';
  const anon = req.cookies.get(ANON_ID_COOKIE)?.value ?? '';
  const ip = extractClientIp(req.headers);
  const salt = process.env.DIAGNOSIS_EMAIL_IP_SALT ?? '';
  return {
    // 쿠키가 없으면 null — 이 라우트는 쿠키를 발급하지 않는다(응답 경로가 여러 개라
    // 일관되게 붙이기 어렵다). 랜딩을 거쳐 온 사용자만 방문 흐름과 이어진다.
    anonId: isValidAnonId(anon) ? anon : null,
    // ★솔트가 없으면 저장하지 않는다. 솔트 없는 IP 해시는 IPv4 전 대역을 미리
    //   계산해 되돌릴 수 있어 익명화가 아니다(Codex 지적).
    // ★IP 를 못 읽은 요청도 저장하지 않는다 — 전부 같은 해시가 되어 한 사람이
    //   반복 조회한 것처럼 보인다.
    ipHash: salt && ip && ip !== 'unknown' ? hashClientIp(ip, salt) : null,
    isBot: isBotUserAgent(ua),
    // ★내부 트래픽(우리·대표 본인) 표시 (2026-08-06).
    //   funnel_events 는 이 쿠키로 내부를 걸러내는데 진단 리드는 안 걸러서,
    //   같은 날 진단이 7건으로 잡히고 그중 6건이 우리였다(대표 2·나 4).
    //   건수만 부풀리는 게 아니라 harvest_diagnosed 가 그 병원을 신규 리드로
    //   영업DB에 올려버린다 — 우리가 테스트로 조회한 병원에 영업 메일이 나간다.
    isInternal: req.cookies.get(INTERNAL_COOKIE)?.value === INTERNAL_COOKIE_VALUE,
    utmSource: readUtmSource(req),
  };
}

/**
 * 어느 캠페인을 타고 왔는가 (2026-08-25 신설).
 *
 * 콜드메일은 진단 링크에 `?utm_source=mail0825s2&utm_medium=outbound` 를 이미 붙여
 * 보내고 있었다. 그런데 이 라우트가 그걸 한 번도 읽지 않아서 리드의 `source` 가
 * 전부 `clinic-check` 하나였다 — **하루 50통을 보내면서 그게 진단으로 이어지는지
 * 잴 수단이 없었다.**
 *
 * ★진단 요청은 같은 페이지에서 나가는 POST 라 **`referer` 에 원래 쿼리가 그대로
 *   남는다.** 클라이언트를 고치지 않고 서버에서만 읽을 수 있는 이유다.
 * ⚠️값은 그대로 믿지 않는다 — 길이를 자르고 안전한 문자만 남긴다(리드 테이블에
 *   외부 입력이 그대로 들어가는 자리다).
 */
function readUtmSource(req: NextRequest): string | null {
  const raw =
    req.nextUrl.searchParams.get('utm_source') ??
    (() => {
      const ref = req.headers.get('referer') ?? '';
      if (!ref) return null;
      try {
        return new URL(ref).searchParams.get('utm_source');
      } catch {
        return null;
      }
    })();
  const cleaned = (raw ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  return cleaned || null;
}

interface Requester {
  readonly anonId: string | null;
  readonly ipHash: string | null;
  readonly isBot: boolean;
  readonly utmSource: string | null;
  readonly isInternal: boolean;
}

/**
 * 061 의 새 컬럼이 아직 없어서 거부된 것인가.
 * 아무 42703 이나 삼키면 트리거·뷰가 다른 컬럼을 잘못 참조하는 진짜 결함까지
 * "마이그레이션 미적용"으로 오인해 조용히 넘어간다 — 세 컬럼 이름이 실제로
 * 언급된 경우로만 좁힌다(Codex 지적).
 */
// 061(anon_id·ip_hash·is_bot) + 063(is_internal). 새 컬럼을 추가할 때마다 여기에 넣는다 —
// 빠뜨리면 그 컬럼이 없는 DB 에서 insert 가 통째로 실패하고 폴백도 안 타 리드가 영구 유실된다.
const NEW_COLUMNS = ['anon_id', 'ip_hash', 'is_bot', 'is_internal'];

function isUnknownColumn(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? '';
  if (code !== 'PGRST204' && code !== '42703') return false;
  const m = (error.message ?? '').toLowerCase();
  return NEW_COLUMNS.some((c) => m.includes(c));
}

/** 영업 리드 적재 — 실패해도 진단 응답을 막지 않는다(테이블 미적용 포함). */
async function saveLead(
  clinic: ClinicCandidate,
  report: DiagnosisReport,
  requester: Requester,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const base = {
      mng_no: clinic.mngNo,
      clinic_name: clinic.name.slice(0, 120),
      region: `${clinic.province} ${clinic.region}`.trim().slice(0, 60),
      specialty: clinic.specialty.slice(0, 40),
      phone: clinic.phone.slice(0, 30),
      blog_id: report.blog.blogId,
      site_url: report.site.url,
      // ★기존 값을 유지한 채 뒤에만 붙인다(`clinic-check:mail0825s2`).
      //   `clinic-check` 로 시작하는 건 그대로라 지금까지의 집계가 안 깨진다.
      source: requester.utmSource
        ? `clinic-check:${requester.utmSource}`.slice(0, 60)
        : 'clinic-check',
    };
    const { error } = await admin.from('clinic_diagnosis_leads').insert({
      ...base,
      anon_id: requester.anonId,
      ip_hash: requester.ipHash,
      is_bot: requester.isBot,
      is_internal: requester.isInternal,
    });
    // 마이그레이션 061 적용 전에 배포되면 새 컬럼이 없어 insert 가 통째로 거부된다.
    // 그 사이 리드를 잃지 않도록 기존 컬럼만으로 한 번 더 넣는다.
    if (error && isUnknownColumn(error)) {
      const retry = await admin.from('clinic_diagnosis_leads').insert(base);
      if (retry.error) {
        console.error('[clinic-diagnosis] 리드 적재 실패(무시):', retry.error.message);
      } else {
        console.warn('[clinic-diagnosis] 061 미적용 — 귀속 정보 없이 적재했다');
      }
    } else if (error) {
      console.error('[clinic-diagnosis] 리드 적재 실패(무시):', error.message);
    }
  } catch (e) {
    console.error('[clinic-diagnosis] 리드 적재 예외(무시):', e instanceof Error ? e.message : e);
  }
}

interface ShareLink {
  readonly token: string;
  readonly url: string;
}

/** 공유 토큰 캐시 키 — 리포트 캐시와 같은 수명으로 붙여 둔다. */
function shareCacheKey(cacheKey: string): string {
  return `${cacheKey}|share`;
}

/**
 * 이 진단에 대한 공유 링크를 가져온다(없으면 발급).
 *
 * 같은 캐시 키에는 같은 토큰을 재사용한다 — 캐시 히트로 들어온 요청마다 리포트
 * 행을 새로 쌓지 않기 위해서다. 캐시하지 않는 진단(본문 붙여넣기)만 매번 발급한다.
 *
 * ★ 발급을 **캐시 키 단위 single-flight 안에서** 돌린다.
 *   같은 병원을 두 명이 동시에 진단하면 둘 다 캐시 미스 상태로 여기 들어와
 *   `clinic_diagnosis_reports` 에 행이 2개 생겼다(캐시 재사용은 순차 요청에서만 참).
 *   ⚠️ 캐시하지 않는 진단(본문 붙여넣기)은 요청마다 리포트 내용이 다르므로 묶지 않는다 —
 *      묶으면 남의 본문으로 만든 리포트 링크를 받게 된다.
 */
async function getOrCreateShare(
  cacheKey: string,
  report: DiagnosisReport,
  cacheable: boolean,
): Promise<ShareLink | null> {
  if (!cacheable) return createShareLink(report);

  const key = shareCacheKey(cacheKey);
  const cached = cacheGet<ShareLink>(key);
  if (cached && typeof cached.token === 'string' && typeof cached.url === 'string') return cached;

  return shareOnce(getShareInflight<ShareLink | null>(), key, async () => {
    // 리더를 기다리는 사이 캐시가 채워졌을 수 있다 — 한 번 더 본다.
    const fresh = cacheGet<ShareLink>(key);
    if (fresh && typeof fresh.token === 'string' && typeof fresh.url === 'string') return fresh;
    const created = await createShareLink(report);
    if (created) cacheSet(key, created, DIAGNOSIS_CACHE_TTL_MS);
    return created;
  });
}

/**
 * 공유 링크 발급 — 대표가 전화·메일 후속에 그대로 보낼 수 있는 읽기 전용 주소이자,
 * 결과를 메일로 보내는 동선에서 서버가 리포트를 다시 읽는 열쇠다.
 * 토큰은 추측 불가능한 난수(UUID 2개 결합, 하이픈 제거 = 64자)로만 만든다.
 */
async function createShareLink(report: DiagnosisReport): Promise<ShareLink | null> {
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
    return { token, url: `/clinic-check/r/${token}` };
  } catch (e) {
    console.error('[clinic-diagnosis] 공유 링크 예외(무시):', e instanceof Error ? e.message : e);
    return null;
  }
}
