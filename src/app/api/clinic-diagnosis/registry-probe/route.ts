import { NextRequest, NextResponse } from 'next/server';
import { lookupClinics, buildRegistrySeedsForProbe, REGISTRY_TIMEOUT_MS, MAX_REGISTRY_CALLS } from '@/content/lib/clinic-diagnosis/registry';

/**
 * ⚠️ 임시 진단 전용 라우트 — 원인 파악 후 삭제한다.
 *
 * 병원 조회가 프로덕션에서만 0건으로 오는 원인을 잡기 위한 것이다.
 * 로컬에서는 같은 요청이 정상(4건)인데 서버에서만 비어 돌아온다.
 * 밖에서 보면 결과만 보이므로, 서버 안에서 실제 HTTP 응답을 그대로 확인한다.
 *
 * 보안:
 *  - 키 값 자체는 절대 반환하지 않는다(길이·앞뒤 2글자·공백 포함 여부만).
 *  - CRON_SECRET 을 아는 사람만 호출할 수 있다.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ENDPOINT = 'https://apis.data.go.kr/1741000/clinics/info';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const raw = process.env.DATA_GO_SERVICE_KEY ?? '';
  const key = raw.trim();
  const seed = searchParams.get('name') || '브이성형';

  // 키 글자는 한 자도 내보내지 않는다 — 길이·공백·문자 종류만.
  const keyInfo = {
    present: raw.length > 0,
    rawLength: raw.length,
    trimmedLength: key.length,
    hadWhitespace: raw !== key,
    hasPercent: key.includes('%'),
    hasPlus: key.includes('+'),
    hasEquals: key.includes('='),
    allAsciiAlnum: /^[A-Za-z0-9]+$/.test(key),
  };

  // ★실제 lookup 과 동일 조건으로 재현한다. 다르게 부르면 원인을 못 잡는다.
  const rows = searchParams.get('rows') || '100';
  const region = searchParams.get('region') || '';

  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: rows,
    returnType: 'json',
    'cond[BPLC_NM::LIKE]': seed,
  });
  if (region) params.set('cond[ROAD_NM_ADDR::LIKE]', region);

  const url = `${ENDPOINT}?${params.toString()}`;
  const started = Date.now();

  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const text = await res.text();

    // 실제 파이프라인이 보는 값들을 그대로 뽑아 본다
    let shape: Record<string, unknown> = {};
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const resp = (j.response ?? j) as Record<string, unknown>;
      const header = (resp.header ?? {}) as Record<string, unknown>;
      const body = (resp.body ?? {}) as Record<string, unknown>;
      const rawItems = body.items as unknown;
      const itemArr = Array.isArray(rawItems)
        ? rawItems
        : rawItems && typeof rawItems === 'object'
          ? (rawItems as Record<string, unknown>).item
          : undefined;
      shape = {
        rootKeys: Object.keys(j),
        respKeys: Object.keys(resp),
        headerResultCode: header.resultCode,
        headerResultMsg: header.resultMsg,
        bodyKeys: Object.keys(body),
        totalCount: body.totalCount,
        itemsType: Array.isArray(rawItems) ? 'array' : typeof rawItems,
        itemCount: Array.isArray(itemArr) ? itemArr.length : itemArr ? 1 : 0,
        firstName: Array.isArray(itemArr) && itemArr[0] ? (itemArr[0] as Record<string, unknown>).BPLC_NM : null,
        firstStatus: Array.isArray(itemArr) && itemArr[0] ? (itemArr[0] as Record<string, unknown>).SALS_STTS_CD : null,
      };
    } catch (e) {
      shape = { parseError: e instanceof Error ? e.message : String(e) };
    }

    // ★실제 파이프라인 함수를 서버에서 그대로 돌려본다
    const lookupStarted = Date.now();
    let lookupOutcome: unknown;
    let lookupError: string | null = null;
    try {
      lookupOutcome = await lookupClinics(seed, region ? { region } : {});
    } catch (e) {
      lookupError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }

    return NextResponse.json({
      keyInfo,
      seed,
      rows,
      region,
      config: { timeoutMs: REGISTRY_TIMEOUT_MS, maxCalls: MAX_REGISTRY_CALLS },
      seeds: buildRegistrySeedsForProbe(seed),
      lookup: { outcome: lookupOutcome, error: lookupError, elapsedMs: Date.now() - lookupStarted },
      queryShape: url.replace(encodeURIComponent(key), '<KEY>').slice(0, 300),
      status: res.status,
      contentType: res.headers.get('content-type'),
      elapsedMs: Date.now() - started,
      bodyLength: text.length,
      shape,
      bodyHead: text.slice(0, 400),
    });
  } catch (error) {
    return NextResponse.json({
      keyInfo,
      seed,
      rows,
      elapsedMs: Date.now() - started,
      fetchError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
