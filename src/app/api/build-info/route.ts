import { NextResponse } from 'next/server';

/**
 * GET /api/build-info — 지금 프로덕션에 떠 있는 코드가 어느 커밋인지 알려준다.
 *
 * 왜 만들었나 (2026-08-10):
 * "푸시했는데 배포가 안 됐다"를 밖에서 확인할 방법이 없었다. 예전에 Vercel 이 cron 설정
 * 때문에 배포를 막고 있던 적이 있는데, 그때도 사이트는 200 을 돌려주고 있었다 —
 * **살아 있는 것과 최신인 것은 다르다.** 클라이언트 청크 해시로는 서버 코드만 바뀐 커밋을
 * 구분할 수 없고, 대시보드는 로그인이 필요해 자동 점검에 쓸 수 없다.
 * 이제 `curl .../api/build-info` 한 번이면 배포 반영 여부가 확정된다.
 *
 * 노출 범위: 커밋 SHA 앞 7자리·환경·인스턴스 기동 시각뿐이다. 소스도 토큰도 나가지 않는다.
 *
 * ⛔**브랜치명(VERCEL_GIT_COMMIT_REF)은 일부러 뺐다.** 배포 판정에는 commit 하나면 되고,
 *   브랜치명에는 고객명·티켓번호·장애명이 들어가기 쉽다. 지금은 main 하나뿐이라 위험이
 *   없지만, 브랜치 전략이 바뀔 때 이 엔드포인트를 다시 열어볼 사람은 없다.
 *   ★쓰이지 않는 정보는 공개하지 않는다 — 나중에 추가하고 싶어지면 그때 다시 판단할 것.
 *
 * ★반드시 캐시를 끈다 — 캐시된 옛 응답을 보고 "배포됐다"고 오판하면
 *   이 엔드포인트는 있으나 마나가 아니라 **적극적으로 해로워진다.**
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 모듈 평가 시각 = 이 서버 **인스턴스**가 뜬 시각.
 * ⚠️배포 시각이 아니다. 서버리스라 같은 배포에서도 콜드 스타트·리전마다 값이 달라진다.
 *   이 값의 변화를 새 배포로 해석하면 오탐이다 — 배포 판정은 반드시 commit 으로 한다.
 */
const INSTANCE_STARTED_AT = new Date().toISOString();

export async function GET() {
  const body = {
    // Vercel 이 빌드·런타임에 주입하는 시스템 환경변수. 로컬에서는 없으므로 'local'.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    // preview 배포를 프로덕션으로 오인하는 것을 막아준다 — 이건 판정에 실제로 쓰인다.
    env: process.env.VERCEL_ENV ?? 'development',
    // 이름에 instance 를 박아 둔다 — 'startedAt' 이면 소비자가 배포 시각으로 오해한다.
    instanceStartedAt: INSTANCE_STARTED_AT,
  };
  return NextResponse.json(body, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
