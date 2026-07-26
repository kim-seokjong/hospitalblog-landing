import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideAutoPublishOnSave, publishBlockReason } from '../publish-gate.ts';

/**
 * 유료 결제 → 블로그 자동 개설 → 저장 즉시 자동 발행 파이프라인의 계약을 고정한다.
 *
 * 세 층으로 검증한다(auto-publish-atomicity.test.ts 와 같은 패턴):
 *  ① 순수 판정 — decideAutoPublishOnSave (검수 차단·구독 만료·주소 미설정)
 *  ② 소스 계약 — 결제 훅 위치, 소급 발행 차단, 게이트 재사용, 마이그 미적용 폴백
 *  ③ 마이그레이션 소스 — 컬럼·백필이 실제로 들어 있는지
 */

const SRC = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const provisionSource = SRC('../provision.ts');
const onSaveSource = SRC('../auto-publish-on-save.ts');
const postsRouteSource = SRC('../../../../app/api/posts/route.ts');
const cronRouteSource = SRC('../../../../app/api/cron/site-auto-publish/route.ts');
const paymentRepoSource = SRC('../../../../payment/lib/repository.ts');
const profileRouteSource = SRC('../../../../app/api/profile/route.ts');
const serverGateSource = SRC('../server-publish-gate.ts');
const dataSource = SRC('../data.ts');
const migrationSource = SRC(
  '../../../../../supabase/migrations/20260726_052_clinic_site_auto_provision.sql',
);

// ---------------------------------------------------------------------------
// ① 저장 즉시 자동 발행 판정 (순수)
// ---------------------------------------------------------------------------

const PASSING = {
  cadence: 'auto',
  siteSlug: 'myclinic',
  subscriptionActive: true,
  blockReason: null,
  content: '본문입니다.',
} as const;

test('조건이 모두 맞으면 저장 즉시 발행한다', () => {
  assert.deepEqual(decideAutoPublishOnSave({ ...PASSING }), { publish: true });
});

test('★검수에 걸린 글은 저장 즉시 발행되지 않는다', () => {
  // 실제 게이트(publishBlockReason)가 내는 사유를 그대로 넣는다 — 게이트가 두 벌이 되지 않게.
  const blocked = [
    publishBlockReason(null), // 검사 기록 없음
    publishBlockReason({ grade: 'HIGH', needsManualReview: false }),
    publishBlockReason({ grade: 'CRITICAL', needsManualReview: false }),
    publishBlockReason({ grade: 'LOW', needsManualReview: true }),
  ];
  for (const blockReason of blocked) {
    assert.notEqual(blockReason, null);
    assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, blockReason }), {
      publish: false,
      reason: 'review_blocked',
    });
  }
});

test('검수를 통과한 등급(LOW/MEDIUM)만 발행 대상이 된다', () => {
  for (const grade of ['LOW', 'MEDIUM']) {
    const blockReason = publishBlockReason({ grade, needsManualReview: false });
    assert.equal(blockReason, null, grade);
    assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, blockReason }), { publish: true });
  }
});

test('자동발행 주기가 auto 가 아니면 발행하지 않는다', () => {
  for (const cadence of ['off', 'weekly', 'biweekly', null, undefined, '']) {
    assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, cadence }), {
      publish: false,
      reason: 'cadence_not_auto',
    });
  }
});

test('블로그 주소가 없으면 발행하지 않는다', () => {
  for (const siteSlug of [null, undefined, '', '   ']) {
    assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, siteSlug }), {
      publish: false,
      reason: 'no_slug',
    });
  }
});

test('★구독 해지·만료 회원은 새 글 자동 발행이 멈춘다(기존 글은 건드리지 않는다)', () => {
  assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, subscriptionActive: false }), {
    publish: false,
    reason: 'subscription_inactive',
  });
  // 판정 함수는 "발행 안 함"만 말한다 — 어디에도 발행 취소(false 로 되돌리기)가 없다.
  assert.ok(!/published_to_site:\s*false/.test(onSaveSource));
});

test('본문이 비면 발행하지 않는다', () => {
  assert.deepEqual(decideAutoPublishOnSave({ ...PASSING, content: '   ' }), {
    publish: false,
    reason: 'empty_content',
  });
});

test('차단 판정은 사용자 플로우를 막지 않는다(예외를 던지지 않는다)', () => {
  assert.doesNotThrow(() =>
    decideAutoPublishOnSave({
      cadence: null,
      siteSlug: null,
      subscriptionActive: false,
      blockReason: '차단',
      content: '',
    }),
  );
});

// ---------------------------------------------------------------------------
// ② 소스 계약 — 결제 훅 · 게이트 재사용 · 소급 방지
// ---------------------------------------------------------------------------

test('결제 훅: 플랜 활성화(activateUserPlan) 지점에서 블로그를 개설한다', () => {
  assert.match(paymentRepoSource, /import \{ provisionClinicSite \}/);
  const activateBody = paymentRepoSource.slice(
    paymentRepoSource.indexOf('export async function activateUserPlan'),
  );
  assert.match(activateBody.slice(0, 2000), /provisionClinicSite\(admin, params\.userId\)/);
});

test('결제 훅: service role 클라이언트로 실행된다(남의 슬러그 중복 확인 필요)', () => {
  assert.match(paymentRepoSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(paymentRepoSource, /const admin = getAdmin\(\)/);
});

test('개설은 회원당 1회 — 마커(site_provisioned_at)로 멱등을 강제한다', () => {
  assert.match(provisionSource, /site_provisioned_at/);
  assert.match(provisionSource, /already_provisioned/);
});

test('이미 있는 슬러그는 덮어쓰지 않는다', () => {
  // 슬러그 생성 update 는 "아직 비어 있을 때만"(is null) 이라는 조건을 단다.
  assert.match(provisionSource, /\.is\(slugGuard\.column, null\)/);
  assert.match(provisionSource, /expected: null/);
});

test('병원명이 비면 슬러그를 만들지 않고 로그를 남긴다(죽은 주소 방지)', () => {
  assert.match(provisionSource, /no_hospital_name/);
  assert.match(provisionSource, /console\.error\([^)]*병원명이 비어/);
});

test('중복 시 다음 후보로 재시도한다(23505)', () => {
  assert.match(provisionSource, /isUniqueViolation/);
  assert.match(provisionSource, /if \(isUniqueViolation\(applied\.error\)\) continue/);
});

test('개설 시 자동발행을 auto 로 켠다(기본값)', () => {
  assert.match(provisionSource, /return 'auto'/);
  assert.match(provisionSource, /site_publish_cadence = cadence|patch\.site_publish_cadence = cadence/);
});

test('저장 즉시 발행은 수동 발행과 같은 검수 게이트를 쓴다', () => {
  assert.match(onSaveSource, /serverPublishBlockReason\(\s*validateComplianceReport\(/);
  // 게이트 판정을 자체 구현하지 않는다(HIGH/CRITICAL 문자열 비교가 재등장하면 안 된다).
  assert.ok(!/CRITICAL/.test(onSaveSource));
  // 서버 게이트는 수동 발행 게이트를 그대로 감싸기만 한다(기준이 두 벌이 되지 않게).
  assert.match(serverGateSource, /const snapshotReason = publishBlockReason\(report\)/);
  assert.match(serverGateSource, /if \(snapshotReason !== null\) return snapshotReason/);
});

test('★무인 발행 경로는 저장된 스냅샷만 믿지 않고 서버가 본문을 재검사한다', () => {
  // 스냅샷(compliance_report)은 클라이언트가 보낸 값이라 위조 가능하다.
  assert.match(serverGateSource, /import \{ checkCompliance \}/);
  assert.match(serverGateSource, /BLOCKING_SEVERITIES\.has\(v\.severity\)/);
  // 차단선은 스냅샷 게이트와 같다 — HIGH/CRITICAL 만.
  assert.match(serverGateSource, /new Set\(\['HIGH', 'CRITICAL'\]\)/);
  // 저장 훅과 cron 모두 이 게이트를 쓴다(한쪽만 고쳐지는 드리프트 방지).
  assert.match(onSaveSource, /serverPublishBlockReason/);
  assert.match(cronRouteSource, /serverPublishBlockReason\(/);
  assert.ok(!/[^r]publishBlockReason\(validateComplianceReport/.test(cronRouteSource));
});

test('재검사 자체가 실패하면 공개하지 않는다(fail-closed)', () => {
  assert.match(serverGateSource, /catch \(err\)/);
  assert.match(serverGateSource, /return SERVER_RECHECK_BLOCK_MESSAGE/);
});

test('저장 즉시 발행도 일일 상한을 cron 과 같은 원자 경로로 강제한다', () => {
  assert.match(onSaveSource, /claimPostsForPublish/);
  assert.match(onSaveSource, /cadence: 'auto'/);
});

test('★저장 훅은 방금 저장된 글 1편만 대상으로 한다(과거 글 소급 발행 없음)', () => {
  // 후보를 조회하는 select 가 없어야 한다 — 넘겨받은 postId 하나만 다룬다.
  assert.match(onSaveSource, /candidateIds: \[input\.postId\]/);
  assert.match(onSaveSource, /limit: 1/);
  assert.ok(!/from\('saved_posts'\)/.test(onSaveSource));
});

test('저장 훅 실패는 글 저장을 되돌리지 않는다', () => {
  assert.match(onSaveSource, /절대 throw 하지 않는다/);
  assert.match(onSaveSource, /catch \(err\)/);
  // 라우트는 insert 성공 이후에만 호출하고, 결과를 응답 상태에 반영하지 않는다.
  const hookIndex = postsRouteSource.indexOf('autoPublishSavedPost(');
  const insertIndex = postsRouteSource.indexOf(".from('saved_posts')");
  assert.ok(insertIndex >= 0 && hookIndex > insertIndex);
  assert.ok(!/status:\s*5\d\d[^}]*autoPublish/.test(postsRouteSource));
});

test('저장 훅은 응답을 오래 붙잡지 않는다(수동 발행과 같은 1.5초 상한)', () => {
  assert.match(onSaveSource, /INDEXNOW_INTERACTIVE_TIMEOUT_MS/);
});

// ---------------------------------------------------------------------------
// ② -2 cron 소급 발행 차단 · 구독 게이트
// ---------------------------------------------------------------------------

test('★cron: auto 는 자동발행을 켠 시점 이후에 만들어진 글만 후보로 잡는다', () => {
  assert.match(cronRouteSource, /resolveAutoPublishSince/);
  assert.match(cronRouteSource, /candidateQuery\.gte\('created_at', autoSince\)/);
});

test('★cron: 기준 시각이 없던 auto 회원은 "지금"으로 확정한다(과거 글 영구 제외)', () => {
  assert.match(cronRouteSource, /site_auto_publish_since: stamped/);
  assert.match(cronRouteSource, /\.is\('site_auto_publish_since', null\)/);
});

test('cron: weekly/biweekly 는 기존 동작을 그대로 둔다(소급 필터 없음)', () => {
  assert.match(cronRouteSource, /if \(cadence !== 'auto' \|\| !sinceAvailable\) return null/);
});

test('★cron: 구독이 끝난 회원은 건너뛰되 기존 발행 글은 내리지 않는다', () => {
  assert.match(cronRouteSource, /isActivePlan\(profile\.plan, profile\.plan_expires_at\)/);
  assert.match(cronRouteSource, /inactiveSkipped\+\+/);
  // cron 어디에도 발행 취소(published_to_site=false)나 슬러그 회수가 없다.
  assert.ok(!/published_to_site:\s*false/.test(cronRouteSource));
  assert.ok(!/site_slug:\s*null/.test(cronRouteSource));
});

test('cadence 를 auto 로 켜는 순간(/api/profile)에도 기준 시각을 남긴다', () => {
  assert.match(profileRouteSource, /site_publish_cadence === 'auto'/);
  assert.match(profileRouteSource, /site_auto_publish_since: new Date\(\)\.toISOString\(\)/);
});

test('★기준 시각은 "현재 auto 가 아닐 때만" 찍는다(껐다 켠 회원의 낡은 기준 재사용 방지)', () => {
  // .is(...,null) 조건이면 껐다 켠 회원의 오래된 기준이 그대로 남아
  // 껐던 기간에 쌓인 글이 전부 자동발행 대상이 된다.
  assert.ok(!/\.is\('site_auto_publish_since', null\)/.test(profileRouteSource));
  assert.match(profileRouteSource, /\.neq\('site_publish_cadence', 'auto'\)/);
  // 조건이 성립하려면 cadence 를 바꾸기 "전에" 실행돼야 한다.
  const stampIndex = profileRouteSource.indexOf("site_auto_publish_since: new Date()");
  const peelIndex = profileRouteSource.indexOf('PEEL_GROUPS_NEWEST_FIRST');
  assert.ok(stampIndex >= 0 && peelIndex > stampIndex);
});

test('★개설 훅도 기준 시각을 항상 새로 찍는다(조건부 기록 금지)', () => {
  assert.ok(!/if \(!row\.site_auto_publish_since\)/.test(provisionSource));
  assert.match(provisionSource, /patch\.site_auto_publish_since = nowIso/);
});

test('★가드 컬럼(마이그 052)이 없으면 자동발행을 켜지 않는다', () => {
  // 052 미적용이면 cron 의 소급 차단 필터가 통째로 꺼진다 —
  // 그 상태에서 결제가 cadence 를 auto 로 켜면 과거 글이 순차 공개된다.
  assert.match(provisionSource, /function resolveCadence\(current: string \| null, guardAvailable: boolean\)/);
  assert.match(provisionSource, /if \(!guardAvailable\) return null/);
  assert.match(provisionSource, /resolveCadence\(row\.site_publish_cadence, markerAvailable\)/);
  // /api/profile 도 같은 이유로 켜지 못하게 막는다(503).
  assert.match(profileRouteSource, /isMissingColumnError\(sinceError\)/);
  assert.match(profileRouteSource, /status: 503/);
});

test('★블로그 개설이 결제 응답을 무한정 붙잡지 못한다(시간 예산)', () => {
  assert.match(paymentRepoSource, /PROVISION_BUDGET_MS/);
  assert.match(paymentRepoSource, /withProvisionBudget\(provisionClinicSite\(/);
  // 예산 초과는 실패로 처리될 뿐 결제를 되돌리지 않는다(throw 없음).
  assert.ok(!/throw[^\n]*provisionClinicSite/.test(paymentRepoSource));
});

// ---------------------------------------------------------------------------
// ② -3 마이그레이션 미적용 폴백
// ---------------------------------------------------------------------------

test('폴백: 개설 로직은 마커 컬럼이 없어도(42703) 동작한다', () => {
  assert.match(provisionSource, /isMissingColumn/);
  assert.match(provisionSource, /PROFILE_COLS_LEGACY/);
  assert.match(provisionSource, /markerAvailable/);
});

test('폴백: cadence "auto" 를 아직 못 쓰는 DB(23514)에서도 개설이 끝까지 간다', () => {
  assert.match(provisionSource, /isCheckViolation/);
  assert.match(provisionSource, /delete next\.site_publish_cadence/);
});

test('폴백: cron 은 소급 방지 컬럼 유무를 먼저 확인하고 없으면 기존 동작을 유지한다', () => {
  assert.match(cronRouteSource, /sinceProbe/);
  assert.match(cronRouteSource, /sinceAvailable = sinceProbe\.error\?\.code !== '42703'/);
  assert.match(cronRouteSource, /SCHEDULE_COLS_BASE/);
});

test('폴백: 공개 페이지는 hospital_phone 컬럼이 없어도 렌더된다', () => {
  assert.match(dataSource, /42703/);
  assert.match(dataSource, /CLINIC_PROFILE_COLS_BASE/);
  assert.match(dataSource, /hospital_phone \?\? null/);
});

test('폴백: /api/profile 은 hospital_phone 컬럼이 없으면 제거하고 재시도한다', () => {
  assert.match(profileRouteSource, /\['hospital_phone'\]/);
  assert.match(profileRouteSource, /PROFILE_COLS_WITH_PHONE/);
});

// ---------------------------------------------------------------------------
// ③ 마이그레이션 소스
// ---------------------------------------------------------------------------

test('마이그 052: 필요한 컬럼 3종이 모두 들어 있다', () => {
  assert.match(migrationSource, /add column if not exists hospital_phone text/);
  assert.match(migrationSource, /add column if not exists site_provisioned_at timestamptz/);
  assert.match(migrationSource, /add column if not exists site_auto_publish_since timestamptz/);
});

test('★마이그 052: 기존 auto 회원의 기준 시각을 지금으로 백필한다(과거 글 대량 공개 방지)', () => {
  assert.match(migrationSource, /update public\.profiles/);
  assert.match(migrationSource, /set site_auto_publish_since = now\(\)/);
  assert.match(migrationSource, /where site_publish_cadence = 'auto'/);
});

test('마이그 052: 담당자 개인 연락처(phone)를 공개용으로 재사용하지 않는다', () => {
  assert.match(migrationSource, /profiles\.phone[^\n]*비공개|phone\(담당자/);
});
