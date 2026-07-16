import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIALTY_LEXICONS,
  resolveSpecialtyKey,
  createSpecialtyFilter,
} from '../specialty-filter.ts';

// ── resolveSpecialtyKey ──
test('resolveSpecialtyKey: 정식 명칭·별칭 매핑', () => {
  assert.equal(resolveSpecialtyKey('피부과'), '피부과');
  assert.equal(resolveSpecialtyKey('  치과  '), '치과');
  assert.equal(resolveSpecialtyKey('비뇨의학과'), '비뇨기과');
  assert.equal(resolveSpecialtyKey('소아청소년과'), '소아과');
  assert.equal(resolveSpecialtyKey('한방병원'), '한의원');
  assert.equal(resolveSpecialtyKey('정신과'), '정신건강의학과');
});

test('resolveSpecialtyKey: 미설정·사전에 없는 진료과는 null (그레이스풀)', () => {
  assert.equal(resolveSpecialtyKey(''), null);
  assert.equal(resolveSpecialtyKey('   '), null);
  assert.equal(resolveSpecialtyKey(undefined), null);
  assert.equal(resolveSpecialtyKey('기타'), null);
  assert.equal(resolveSpecialtyKey('수의과'), null);
});

// ── createSpecialtyFilter ──
test('createSpecialtyFilter: specialty 없으면 null — 필터 건너뜀', () => {
  assert.equal(createSpecialtyFilter(undefined), null);
  assert.equal(createSpecialtyFilter(''), null);
  assert.equal(createSpecialtyFilter('기타'), null);
});

test('피부과: 타 진료과 명칭 토큰 제외', () => {
  const filter = createSpecialtyFilter('피부과');
  assert.ok(filter);
  assert.equal(filter('치과'), false);
  assert.equal(filter('어린이치과'), false);
  assert.equal(filter('강남치과추천'), false);
  assert.equal(filter('한의원다이어트'), false);
  assert.equal(filter('정형외과도수치료'), false);
});

test('피부과: 타 진료과 시그니처 시술어 제외', () => {
  const filter = createSpecialtyFilter('피부과');
  assert.ok(filter);
  assert.equal(filter('임플란트가격'), false);
  assert.equal(filter('치아교정비용'), false);
  assert.equal(filter('추나요법'), false);
  assert.equal(filter('라식수술'), false);
});

test('피부과: 공유 시술어(보톡스·필러·리프팅)는 통과 — recall 보존', () => {
  const filter = createSpecialtyFilter('피부과');
  assert.ok(filter);
  assert.equal(filter('보톡스'), true);
  assert.equal(filter('사각턱보톡스'), true);
  assert.equal(filter('필러가격'), true);
  assert.equal(filter('리프팅잘하는곳'), true);
  assert.equal(filter('여드름흉터'), true);
});

test('본인 진료과 토큰은 절대 필터하지 않음', () => {
  const dental = createSpecialtyFilter('치과');
  assert.ok(dental);
  assert.equal(dental('치과'), true);
  assert.equal(dental('어린이치과'), true);
  assert.equal(dental('임플란트가격'), true);
  // 치과 사용자에게 타 진료과는 여전히 제외
  assert.equal(dental('피부과보톡스'), false);
});

test('성형외과: 본인 토큰 안의 "외과"에 오차단되지 않음', () => {
  const filter = createSpecialtyFilter('성형외과');
  assert.ok(filter);
  assert.equal(filter('성형외과추천'), true);
  assert.equal(filter('강남성형외과'), true);
  // 다른 외과 계열은 제외
  assert.equal(filter('정형외과'), false);
  assert.equal(filter('신경외과'), false);
});

test('별칭 진료과도 본인 보호: 비뇨의학과 사용자', () => {
  const filter = createSpecialtyFilter('비뇨의학과');
  assert.ok(filter);
  assert.equal(filter('비뇨의학과추천'), true);
  assert.equal(filter('비뇨기과'), true);
  assert.equal(filter('치과임플란트'), false);
});

test('공백·대소문자 무시 정규화 후 매칭', () => {
  const filter = createSpecialtyFilter('피부과');
  assert.ok(filter);
  assert.equal(filter('어린이 치과'), false);
  assert.equal(filter('사각턱 보톡스'), true);
});

// ── 사전 무결성 ──
test('사전: 시그니처에 공유 시술어(보톡스·필러·리프팅·도수치료) 금지', () => {
  const shared = ['보톡스', '필러', '리프팅', '도수치료'];
  for (const [key, lexicon] of Object.entries(SPECIALTY_LEXICONS)) {
    for (const sig of lexicon.signatures) {
      assert.equal(shared.includes(sig), false, `${key} 시그니처에 공유 시술어 ${sig}`);
    }
  }
});

test('사전: CLAUDE.md 지원 진료과 15개 전부 커버', () => {
  const supported = [
    '내과', '외과', '피부과', '성형외과', '정형외과', '안과',
    '이비인후과', '치과', '한의원', '산부인과', '소아과',
    '신경과', '정신건강의학과', '재활의학과', '비뇨기과',
  ];
  for (const s of supported) {
    assert.notEqual(resolveSpecialtyKey(s), null, `${s} 사전 누락`);
  }
});
