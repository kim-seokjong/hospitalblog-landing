import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitKeywords,
  primaryKeyword,
  normalizeKeywordInput,
  MAX_TRACKED_KEYWORDS,
} from '../keyword-list.ts';

// ── 핵심 회귀: 콤마 다중 키워드 분리 ──
// 이 분리가 없어서 "조원동치과, , 사랑니" 가 통째로 네이버 질의로 나갔고,
// 두 달간 post_rankings 전 행이 NULL 이었다.
test('운영 실데이터: "조원동치과, , 사랑니" → 빈 토큰 제거 후 2개', () => {
  assert.deepEqual(splitKeywords('조원동치과, , 사랑니'), ['조원동치과', '사랑니']);
});

test('운영 실데이터: 3개 키워드', () => {
  assert.deepEqual(splitKeywords('봉천 치과, 턱관절장애, 턱에서 딱딱 소리'), [
    '봉천 치과',
    '턱관절장애',
    '턱에서 딱딱 소리',
  ]);
});

test('키워드 안의 공백은 유지된다 (구분자는 콤마뿐)', () => {
  assert.deepEqual(splitKeywords('신대방역 치과, 잇몸 치료'), ['신대방역 치과', '잇몸 치료']);
});

test('단일 키워드', () => {
  assert.deepEqual(splitKeywords('보톡스'), ['보톡스']);
});

test('연속 콤마·앞뒤 콤마 모두 정리', () => {
  assert.deepEqual(splitKeywords(',,a,,,b,,'), ['a', 'b']);
});

test('내부 연속 공백은 1칸으로 축약', () => {
  assert.deepEqual(splitKeywords('구로동   치과'), ['구로동 치과']);
});

test('대소문자 무시 중복 제거 — 첫 표기 유지', () => {
  assert.deepEqual(splitKeywords('Botox, botox, BOTOX'), ['Botox']);
});

test('전각 콤마·가운뎃점도 구분자', () => {
  assert.deepEqual(splitKeywords('임플란트，교정·미백'), ['임플란트', '교정', '미백']);
});

test('빈값·공백만·비문자열은 빈 배열', () => {
  assert.deepEqual(splitKeywords(''), []);
  assert.deepEqual(splitKeywords('   '), []);
  assert.deepEqual(splitKeywords(', , ,'), []);
  assert.deepEqual(splitKeywords(null), []);
  assert.deepEqual(splitKeywords(undefined), []);
  assert.deepEqual(splitKeywords(123), []);
});

test('개수 상한 적용 (기본 MAX_TRACKED_KEYWORDS)', () => {
  const many = Array.from({ length: 12 }, (_, i) => `키워드${i}`).join(', ');
  assert.equal(splitKeywords(many).length, MAX_TRACKED_KEYWORDS);
  assert.equal(splitKeywords(many, 2).length, 2);
});

test('과도하게 긴 토큰은 제외 (질의로 의미 없음)', () => {
  const long = 'ㄱ'.repeat(200);
  assert.deepEqual(splitKeywords(`정상키워드, ${long}`), ['정상키워드']);
});

// ── primaryKeyword ──
test('primaryKeyword: 첫 유효 키워드', () => {
  assert.equal(primaryKeyword('조원동치과, , 사랑니'), '조원동치과');
  assert.equal(primaryKeyword(', , 사랑니'), '사랑니');
  assert.equal(primaryKeyword('  '), null);
});

// ── normalizeKeywordInput (저장 경계) ──
test('normalizeKeywordInput: 저장 전 정리', () => {
  assert.equal(normalizeKeywordInput('조원동치과, , 사랑니'), '조원동치과, 사랑니');
  assert.equal(normalizeKeywordInput('a,,b'), 'a, b');
  assert.equal(normalizeKeywordInput('   '), '');
});

test('normalizeKeywordInput 은 멱등이다 (재저장해도 안 변한다)', () => {
  const once = normalizeKeywordInput('조원동치과, , 사랑니');
  assert.equal(normalizeKeywordInput(once), once);
});
