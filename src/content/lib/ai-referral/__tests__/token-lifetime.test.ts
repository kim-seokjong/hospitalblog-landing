import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildBeaconSigningInput,
  isBeaconExpValid,
  BEACON_TOKEN_TTL_MS,
  BEACON_CLOCK_SKEW_MS,
} from '../request.ts';

/**
 * ★ 토큰 수명 ↔ 페이지 캐시 회귀 테스트 (2차 리뷰 차단 사항).
 *
 * 차단된 버그: 토큰을 서버 렌더 시 HTML 에 박았는데 병원 블로그 페이지는
 * `revalidate = 3600` 을 선언한다. 페이지가 한 번이라도 캐시되면 캐시 생성 후
 * ~12분(TTL 10분 + 시계오차 2분)까지만 토큰이 유효하고, 그 뒤 다음 갱신까지
 * 최대 48분 동안 **정상 AI 유입이 전부 거부**된다. 단위 테스트가 캐시 동작을
 * 모델링하지 않아 전부 통과하면서 기능은 대부분 죽어 있는 상태였다.
 *
 * 해결: 토큰을 방문 시점에 별도 동적 경로에서 발급한다.
 * 아래 테스트는 (a) 그 실패 시나리오를 수치로 고정하고,
 * (b) 페이지가 다시 토큰을 HTML 에 박지 못하도록 소스 수준에서 막는다.
 */

const PAGE_CACHE_TTL_MS = 3600 * 1000; // 페이지의 revalidate = 3600
const REPO = process.cwd();

test('★ 캐시된 HTML 에 토큰을 박으면 갱신 주기 대부분에서 거부된다 (버그 재현)', () => {
  const cachedAt = Date.UTC(2026, 6, 26, 0, 0, 0);
  // 캐시 생성 시점에 발급된 토큰이 HTML 에 굳는다
  const bakedExp = cachedAt + BEACON_TOKEN_TTL_MS;

  // 캐시 직후 방문: 통과
  assert.equal(isBeaconExpValid(bakedExp, cachedAt + 1_000), true);
  // 만료 창(TTL + 시계오차) 안: 통과
  assert.equal(isBeaconExpValid(bakedExp, cachedAt + BEACON_TOKEN_TTL_MS + BEACON_CLOCK_SKEW_MS - 1_000), true);
  // 그 직후부터 캐시 갱신 전까지: 전부 거부 ← 이것이 차단된 버그
  assert.equal(isBeaconExpValid(bakedExp, cachedAt + BEACON_TOKEN_TTL_MS + BEACON_CLOCK_SKEW_MS + 1_000), false);
  assert.equal(isBeaconExpValid(bakedExp, cachedAt + 30 * 60 * 1000), false);
  assert.equal(isBeaconExpValid(bakedExp, cachedAt + PAGE_CACHE_TTL_MS - 1_000), false);

  // 캐시 주기의 3/4 이상이 "조용히 거부되는" 구간이었다는 사실을 수치로 고정한다
  const validWindow = BEACON_TOKEN_TTL_MS + BEACON_CLOCK_SKEW_MS; // 12분
  const rejectedRatio = 1 - validWindow / PAGE_CACHE_TTL_MS;
  assert.ok(rejectedRatio >= 0.75, `거부 구간 비율 ${rejectedRatio}`);
});

test('★ 방문 시점 발급이면 캐시 주기 어디에서 방문해도 통과한다 (해결 확인)', () => {
  const cachedAt = Date.UTC(2026, 6, 26, 0, 0, 0);
  // 토큰은 페이지가 아니라 방문 시점에 발급되므로 exp 는 항상 "지금 + TTL"
  for (const offset of [0, 12 * 60 * 1000, 30 * 60 * 1000, PAGE_CACHE_TTL_MS - 1_000, PAGE_CACHE_TTL_MS * 5]) {
    const visitAt = cachedAt + offset;
    const freshExp = visitAt + BEACON_TOKEN_TTL_MS;
    assert.equal(
      isBeaconExpValid(freshExp, visitAt),
      true,
      `캐시 생성 후 ${offset / 60000}분 시점 방문이 거부됐다`,
    );
  }
});

test('★ TTL 을 캐시 주기에 맞춰 늘리는 해법을 쓰지 않았다', () => {
  // TTL 을 1시간으로 늘리면 재사용 창이 그만큼 넓어진다 — 금지된 해법.
  assert.ok(
    BEACON_TOKEN_TTL_MS < PAGE_CACHE_TTL_MS / 2,
    'TTL 이 페이지 캐시 주기에 근접했다 — 재사용 창이 넓어진다',
  );
});

test('★ 병원 블로그 페이지가 토큰을 HTML 에 박지 않는다 (구조 고정)', () => {
  // 캐시되는 서버 컴포넌트에서 토큰을 발급하면 위 버그가 그대로 재발한다.
  const pages = [
    path.join(REPO, 'src', 'app', 'clinic-site', '[slug]', 'page.tsx'),
    path.join(REPO, 'src', 'app', 'clinic-site', '[slug]', 'posts', '[postId]', 'page.tsx'),
  ];
  for (const page of pages) {
    const source = readFileSync(page, 'utf8');
    assert.equal(
      source.includes('issueBeaconToken'),
      false,
      `${path.basename(page)} 가 토큰을 서버 렌더 시 발급하고 있다`,
    );
    assert.equal(
      /<AiReferralBeacon[^>]*\btoken=/.test(source),
      false,
      `${path.basename(page)} 가 토큰을 props 로 내려보내고 있다`,
    );
  }
});

test('★ 토큰 발급 경로는 동적이며 캐시를 금지한다', () => {
  const route = readFileSync(
    path.join(REPO, 'src', 'app', 'api', 'clinic-site', 'ai-referral', 'token', 'route.ts'),
    'utf8',
  );
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /'Cache-Control': 'no-store/);
});

// ---------------------------------------------------------------------------
// 서명 범위 = 적재 범위
// ---------------------------------------------------------------------------

test('서명 대상에 적재되는 값(병원·출처·글)이 모두 들어간다', () => {
  const post = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.equal(
    buildBeaconSigningInput('my-clinic', 'chatgpt', post, 1700),
    `v2|my-clinic|chatgpt|${post}|1700`,
  );
  // 어느 한 필드만 달라져도 서명 대상이 달라진다
  const variants = new Set([
    buildBeaconSigningInput('a-clinic', 'chatgpt', null, 1700),
    buildBeaconSigningInput('b-clinic', 'chatgpt', null, 1700),
    buildBeaconSigningInput('a-clinic', 'perplexity', null, 1700),
    buildBeaconSigningInput('a-clinic', 'chatgpt', post, 1700),
    buildBeaconSigningInput('a-clinic', 'chatgpt', null, 1800),
  ]);
  assert.equal(variants.size, 5);
});
