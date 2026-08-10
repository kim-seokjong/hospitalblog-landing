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
 * 노출 범위: 커밋 SHA·브랜치·빌드 시각뿐이다. 소스도 토큰도 나가지 않는다.
 * 이 정보로 할 수 있는 일이 없어서 공개해도 무방하다고 판단했다.
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
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    env: process.env.VERCEL_ENV ?? 'development',
    // 이름에 instance 를 박아 둔다 — 'startedAt' 이면 소비자가 배포 시각으로 오해한다.
    instanceStartedAt: INSTANCE_STARTED_AT,
  };
  return NextResponse.json(body, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
