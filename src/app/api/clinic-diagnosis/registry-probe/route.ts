import { NextRequest, NextResponse } from 'next/server';

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

  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '5',
    returnType: 'json',
    'cond[BPLC_NM::LIKE]': seed,
  });

  const url = `${ENDPOINT}?${params.toString()}`;
  const started = Date.now();

  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const text = await res.text();
    return NextResponse.json({
      keyInfo,
      seed,
      // 키가 들어간 부분은 잘라내고 쿼리 모양만 보여준다
      queryShape: url.replace(encodeURIComponent(key), '<KEY>').slice(0, 300),
      status: res.status,
      contentType: res.headers.get('content-type'),
      elapsedMs: Date.now() - started,
      bodyLength: text.length,
      bodyHead: text.slice(0, 900),
    });
  } catch (error) {
    return NextResponse.json({
      keyInfo,
      seed,
      elapsedMs: Date.now() - started,
      fetchError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
