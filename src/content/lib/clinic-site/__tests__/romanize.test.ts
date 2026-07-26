import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLUG_BASE_MIN_LENGTH,
  SLUG_BASE_MAX_LENGTH,
  romanizeKorean,
  stripCorporatePrefix,
  stripClinicSuffix,
  normalizeSlugChars,
  clampSlugLength,
  hospitalNameToSlugBase,
  buildSlugCandidates,
} from '../romanize.ts';
import { SLUG_MIN_LENGTH, SLUG_MAX_LENGTH, RESERVED_SLUGS, validateSlug } from '../slug.ts';

// ---------------------------------------------------------------------------
// 상수 동기화 — romanize 는 자립 모듈이라 길이 상수를 중복 정의한다.
// 두 값이 어긋나면 "생성은 됐는데 저장이 400" 이 나므로 여기서 고정한다.
// ---------------------------------------------------------------------------

test('길이 상수는 slug.ts 와 동일해야 한다', () => {
  assert.equal(SLUG_BASE_MIN_LENGTH, SLUG_MIN_LENGTH);
  assert.equal(SLUG_BASE_MAX_LENGTH, SLUG_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// romanizeKorean — 자모 단위 결정적 매핑
// ---------------------------------------------------------------------------

test('romanizeKorean: 한글 음절을 초성+중성+종성으로 옮긴다', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['강남', 'gangnam'],
    ['서울', 'seoul'],
    ['연세', 'yeonse'],
    ['의원', 'uiwon'],
    ['병원', 'byeongwon'],
    ['한의원', 'hanuiwon'],
    ['치과', 'chigwa'],
    ['피부과', 'pibugwa'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(romanizeKorean(input), expected, input);
  }
});

test('romanizeKorean: 영문은 소문자로, 숫자는 그대로 남는다', () => {
  assert.equal(romanizeKorean('ABC123'), 'abc123');
  assert.equal(romanizeKorean('365'), '365');
});

test('romanizeKorean: 한글·영문·숫자가 섞여도 순서를 유지한다', () => {
  assert.equal(romanizeKorean('365연세'), '365yeonse');
  assert.equal(romanizeKorean('S라인'), 'srain');
});

test('romanizeKorean: 그 밖의 문자는 구분자(-)가 된다', () => {
  assert.equal(romanizeKorean('연세 의원'), 'yeonse-uiwon');
  assert.equal(romanizeKorean('연세·의원'), 'yeonse-uiwon');
  assert.equal(romanizeKorean('%%%'), '---');
});

test('romanizeKorean: 같은 입력은 항상 같은 결과를 낸다(결정적)', () => {
  const name = '강남연세정형외과의원';
  assert.equal(romanizeKorean(name), romanizeKorean(name));
});

test('romanizeKorean: 빈 입력·null 성 입력에도 죽지 않는다', () => {
  assert.equal(romanizeKorean(''), '');
  assert.equal(romanizeKorean(undefined as unknown as string), '');
});

// ---------------------------------------------------------------------------
// 정규화 · 길이 보정
// ---------------------------------------------------------------------------

test('normalizeSlugChars: 연속·앞뒤 하이픈을 정리한다', () => {
  assert.equal(normalizeSlugChars('--a--b--'), 'a-b');
  assert.equal(normalizeSlugChars('Yeonse Uiwon'), 'yeonse-uiwon');
  assert.equal(normalizeSlugChars('---'), '');
});

test('clampSlugLength: 상한을 넘으면 30자 이하로 자른다', () => {
  const long = 'a'.repeat(60);
  const clamped = clampSlugLength(long);
  assert.equal(clamped.length, SLUG_BASE_MAX_LENGTH);
});

test('clampSlugLength: 하한 미만이면 보충해서 3자 이상을 만든다', () => {
  const clamped = clampSlugLength('on');
  assert.ok(clamped.length >= SLUG_BASE_MIN_LENGTH, clamped);
  assert.equal(validateSlug(clamped).ok, true);
});

test('clampSlugLength: 자른 뒤 하이픈으로 끝나지 않는다', () => {
  const value = clampSlugLength(`${'ab-'.repeat(12)}`);
  assert.ok(!value.endsWith('-'), value);
  assert.equal(validateSlug(value).ok, true);
});

// ---------------------------------------------------------------------------
// 병원명 전처리 — 법인격 접두어 · 종별 접미어
// ---------------------------------------------------------------------------

test('stripCorporatePrefix: 법인격 표기는 브랜드가 아니므로 항상 제거한다', () => {
  assert.equal(stripCorporatePrefix('의료법인 성모병원'), '성모병원');
  assert.equal(stripCorporatePrefix('사회복지법인 사랑의원'), '사랑의원');
  assert.equal(stripCorporatePrefix('연세의원'), '연세의원');
});

test('stripClinicSuffix: 긴 접미어를 먼저 떼어낸다', () => {
  assert.equal(stripClinicSuffix('서울치과의원'), '서울');
  assert.equal(stripClinicSuffix('서울한의원'), '서울');
  assert.equal(stripClinicSuffix('서울의원'), '서울');
});

test('stripClinicSuffix: 떼면 빈 문자열이 되는 경우 원본을 유지한다', () => {
  assert.equal(stripClinicSuffix('의원'), '의원');
  assert.equal(stripClinicSuffix('병원'), '병원');
});

test('병원 접미사는 기본적으로 슬러그에 남는다(업종이 다르면 주소도 달라야 한다)', () => {
  assert.equal(hospitalNameToSlugBase('연세의원'), 'yeonseuiwon');
  assert.equal(hospitalNameToSlugBase('연세한의원'), 'yeonsehanuiwon');
  assert.equal(hospitalNameToSlugBase('연세치과'), 'yeonsechigwa');
  // 세 곳이 서로 다른 주소를 받는다 = 불필요한 중복 충돌이 생기지 않는다.
  const slugs = new Set([
    hospitalNameToSlugBase('연세의원'),
    hospitalNameToSlugBase('연세한의원'),
    hospitalNameToSlugBase('연세치과'),
  ]);
  assert.equal(slugs.size, 3);
});

test('길이를 넘을 때만 접미사를 떼어 30자 안에 넣는다', () => {
  const slug = hospitalNameToSlugBase('강남연세정형외과의원');
  assert.ok(slug !== null);
  assert.ok((slug as string).length <= SLUG_BASE_MAX_LENGTH, slug as string);
  // '의원'(uiwon)이 떨어져 나간 형태여야 한다.
  assert.equal(slug, 'gangnamyeonsejeonghyeongoegwa');
});

// ---------------------------------------------------------------------------
// hospitalNameToSlugBase — 입력 유형별
// ---------------------------------------------------------------------------

test('hospitalNameToSlugBase: 대표 변환 예시', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['연세의원', 'yeonseuiwon'],
    ['서울아이한의원', 'seoulaihanuiwon'],
    ['미소드림치과', 'misodeurimchigwa'],
    ['365밝은안과의원', '365bakeunangwauiwon'],
    ['의료법인 성모병원', 'seongmobyeongwon'],
    ['Smile Dental Clinic', 'smile-dental-clinic'],
    ['하나이비인후과', 'hanaibiinhugwa'],
    ['수성한방병원', 'suseonghanbangbyeongwon'],
    ['서울 연세 의원', 'seoul-yeonse-uiwon'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(hospitalNameToSlugBase(name), expected, name);
  }
});

test('hospitalNameToSlugBase: 특수문자만 있으면 null (죽은 주소를 만들지 않는다)', () => {
  assert.equal(hospitalNameToSlugBase('###'), null);
  assert.equal(hospitalNameToSlugBase('   '), null);
  assert.equal(hospitalNameToSlugBase(''), null);
});

test('hospitalNameToSlugBase: 아주 짧은 이름도 형식을 만족하게 보충한다', () => {
  const slug = hospitalNameToSlugBase('온');
  assert.ok(slug !== null);
  assert.equal(validateSlug(slug as string).ok, true);
  assert.ok((slug as string).length >= SLUG_BASE_MIN_LENGTH);
});

test('hospitalNameToSlugBase: 아주 긴 이름도 항상 형식을 만족한다', () => {
  const slug = hospitalNameToSlugBase('대한민국최고의척추관절전문정형외과병원');
  assert.ok(slug !== null);
  assert.equal(validateSlug(slug as string).ok, true);
});

test('hospitalNameToSlugBase: 특수문자가 섞여도 형식을 만족한다', () => {
  const slug = hospitalNameToSlugBase('연세 & 미소(강남점) 의원!');
  assert.ok(slug !== null);
  assert.equal(validateSlug(slug as string).ok, true);
  assert.ok(!(slug as string).includes('--'), slug as string);
});

// ---------------------------------------------------------------------------
// buildSlugCandidates — 중복 재시도 · 예약어 회피
// ---------------------------------------------------------------------------

test('buildSlugCandidates: 첫 후보는 병원명 그대로, 이후는 -2, -3 …', () => {
  const candidates = buildSlugCandidates('연세의원', { attempts: 4, randomAttempts: 0 });
  assert.deepEqual(candidates, [
    'yeonseuiwon',
    'yeonseuiwon-2',
    'yeonseuiwon-3',
    'yeonseuiwon-4',
  ]);
});

test('buildSlugCandidates: 모든 후보가 슬러그 형식 검증을 통과한다', () => {
  const names = ['연세의원', '온', '대한민국최고의척추관절전문정형외과병원', 'Smile Dental Clinic'];
  for (const name of names) {
    for (const candidate of buildSlugCandidates(name, { attempts: 12, randomAttempts: 0 })) {
      assert.equal(validateSlug(candidate).ok, true, `${name} → ${candidate}`);
    }
  }
});

test('buildSlugCandidates: 숫자 접미어를 붙여도 30자를 넘지 않는다', () => {
  const candidates = buildSlugCandidates('대한민국최고의척추관절전문정형외과병원', {
    attempts: 10,
    randomAttempts: 0,
  });
  for (const candidate of candidates) {
    assert.ok(candidate.length <= SLUG_BASE_MAX_LENGTH, candidate);
  }
});

test('buildSlugCandidates: 예약어는 후보에서 제외된다', () => {
  const candidates = buildSlugCandidates('Store', {
    isReserved: (slug) => RESERVED_SLUGS.has(slug),
    attempts: 3,
    randomAttempts: 0,
  });
  assert.ok(!candidates.includes('store'), candidates.join(','));
  assert.equal(candidates[0], 'store-2');
  for (const candidate of candidates) {
    assert.equal(RESERVED_SLUGS.has(candidate), false, candidate);
  }
});

test('buildSlugCandidates: 예약어 판정을 주지 않으면 기본은 "예약어 없음"', () => {
  const candidates = buildSlugCandidates('Store', { attempts: 2, randomAttempts: 0 });
  assert.equal(candidates[0], 'store');
});

test('buildSlugCandidates: 숫자 접미어를 모두 소진하면 무작위 꼬리로 마지막 시도를 한다', () => {
  const candidates = buildSlugCandidates('연세의원', {
    attempts: 2,
    randomAttempts: 1,
    randomSuffix: () => 'zq7k',
  });
  assert.deepEqual(candidates, ['yeonseuiwon', 'yeonseuiwon-2', 'yeonseuiwon-zq7k']);
});

test('buildSlugCandidates: 중복 후보는 한 번만 담긴다', () => {
  const candidates = buildSlugCandidates('연세의원', {
    attempts: 3,
    randomAttempts: 2,
    randomSuffix: () => '2', // -2 와 충돌하는 꼬리
  });
  assert.equal(new Set(candidates).size, candidates.length);
});

test('buildSlugCandidates: 슬러그를 만들 수 없으면 빈 배열(호출부가 개설을 포기한다)', () => {
  assert.deepEqual(buildSlugCandidates('###'), []);
  assert.deepEqual(buildSlugCandidates(''), []);
});
