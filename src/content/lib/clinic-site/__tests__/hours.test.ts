import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLINIC_HOURS_DAY_KEYS,
  CLINIC_HOURS_NOTE_MAX_LENGTH,
  EMPTY_CLINIC_HOURS,
  buildOpeningHoursSpecification,
  formatClinicHoursRows,
  isEmptyClinicHours,
  isValidTime,
  parseClinicHours,
  parseRange,
  validateClinicHoursInput,
} from '../hours.ts';
import { hasClinicAboutContent } from '../about.ts';

const SRC = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 시간 검증
// ---------------------------------------------------------------------------

test('isValidTime: HH:MM 24시간 표기만 통과한다', () => {
  for (const ok of ['00:00', '09:30', '23:59']) assert.equal(isValidTime(ok), true, ok);
  for (const bad of ['24:00', '9:30', '09:60', '오전 9시', '', null, 930]) {
    assert.equal(isValidTime(bad), false, String(bad));
  }
});

test('parseRange: 축약 입력(9:5)을 09:05 로 정규화한다', () => {
  assert.deepEqual(parseRange({ open: '9:5', close: '18:0' }), { open: '09:05', close: '18:00' });
});

test('parseRange: 시작이 종료보다 늦거나 같으면 무효', () => {
  assert.equal(parseRange({ open: '18:00', close: '09:00' }), null);
  assert.equal(parseRange({ open: '09:00', close: '09:00' }), null);
});

test('parseRange: 형태가 아니면 무효', () => {
  for (const bad of [null, undefined, '09:00', 3, [], { open: '09:00' }]) {
    assert.equal(parseRange(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// 저장 경로 검증 — 조용히 버리지 않는다
// ---------------------------------------------------------------------------

test('validateClinicHoursInput: 정상 입력을 정규화해 통과시킨다', () => {
  const result = validateClinicHoursInput({
    weekday: { open: '9:00', close: '18:00' },
    saturday: { open: '09:00', close: '13:00' },
    sunday: 'closed',
    holiday: 'closed',
    lunch: { open: '13:00', close: '14:00' },
    note: '  전화 예약 후 방문 부탁드립니다  ',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.hours, {
    weekday: { open: '09:00', close: '18:00' },
    saturday: { open: '09:00', close: '13:00' },
    sunday: 'closed',
    holiday: 'closed',
    lunch: { open: '13:00', close: '14:00' },
    note: '전화 예약 후 방문 부탁드립니다',
  });
});

test('validateClinicHoursInput: 잘못된 시각은 사유와 함께 거부한다(저장했는데 사라지는 일 방지)', () => {
  const result = validateClinicHoursInput({ weekday: { open: '18:00', close: '09:00' } });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /평일/);
});

test('validateClinicHoursInput: 점심시간 오류도 사유를 돌려준다', () => {
  const result = validateClinicHoursInput({ lunch: { open: '14:00', close: '13:00' } });
  assert.equal(result.ok, false);
});

test('validateClinicHoursInput: 비어 있으면 null(미설정으로 비우기)', () => {
  for (const empty of [null, undefined, {}, { weekday: null, note: '' }]) {
    const result = validateClinicHoursInput(empty);
    assert.equal(result.ok, true, String(empty));
    if (result.ok) assert.equal(result.hours, null);
  }
});

test('validateClinicHoursInput: 배열·문자열 같은 엉뚱한 형태는 거부한다', () => {
  for (const bad of [[], 'weekday', 42]) {
    assert.equal(validateClinicHoursInput(bad).ok, false, String(bad));
  }
});

test('validateClinicHoursInput: 안내 문구는 상한에서 잘린다', () => {
  const result = validateClinicHoursInput({ note: 'a'.repeat(500) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.hours?.note.length, CLINIC_HOURS_NOTE_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// 조회 경로 — 관대한 파싱 (이미 저장된 값 하나로 공개 페이지가 죽으면 안 된다)
// ---------------------------------------------------------------------------

test('parseClinicHours: 깨진 값은 버리고 나머지는 살린다', () => {
  const hours = parseClinicHours({
    weekday: { open: '09:00', close: '18:00' },
    saturday: { open: '13:00', close: '09:00' }, // 깨진 값
    note: '안내',
  });
  assert.deepEqual(hours?.weekday, { open: '09:00', close: '18:00' });
  assert.equal(hours?.saturday, null);
  assert.equal(hours?.note, '안내');
});

test('parseClinicHours: 문자열 JSON 도 읽는다(드라이버 차이 방어)', () => {
  const hours = parseClinicHours('{"weekday":{"open":"09:00","close":"18:00"}}');
  assert.deepEqual(hours?.weekday, { open: '09:00', close: '18:00' });
});

test('parseClinicHours: 읽을 내용이 없으면 null', () => {
  for (const empty of [null, undefined, '', '{}', 'not json', {}, []]) {
    assert.equal(parseClinicHours(empty), null, String(empty));
  }
});

test('isEmptyClinicHours: 빈 값 판정', () => {
  assert.equal(isEmptyClinicHours(null), true);
  assert.equal(isEmptyClinicHours(EMPTY_CLINIC_HOURS), true);
  assert.equal(isEmptyClinicHours({ ...EMPTY_CLINIC_HOURS, sunday: 'closed' }), false);
  assert.equal(isEmptyClinicHours({ ...EMPTY_CLINIC_HOURS, note: '안내' }), false);
});

// ---------------------------------------------------------------------------
// 표시
// ---------------------------------------------------------------------------

test('formatClinicHoursRows: 미설정 구간은 줄 자체가 없다', () => {
  const rows = formatClinicHoursRows({
    ...EMPTY_CLINIC_HOURS,
    weekday: { open: '09:00', close: '18:00' },
    sunday: 'closed',
  });
  assert.deepEqual(rows, [
    { label: '평일', value: '09:00 ~ 18:00' },
    { label: '일요일', value: '휴진' },
  ]);
});

test('formatClinicHoursRows: 점심시간은 요일 뒤에 붙는다', () => {
  const rows = formatClinicHoursRows({
    ...EMPTY_CLINIC_HOURS,
    weekday: { open: '09:00', close: '18:00' },
    lunch: { open: '13:00', close: '14:00' },
  });
  assert.equal(rows[rows.length - 1].label, '점심시간');
});

test('formatClinicHoursRows: 표시 순서는 평일 → 토 → 일 → 공휴일', () => {
  const filled = CLINIC_HOURS_DAY_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: 'closed' as const }),
    { ...EMPTY_CLINIC_HOURS },
  );
  const labels = formatClinicHoursRows(filled).map((row) => row.label);
  assert.deepEqual(labels, ['평일', '토요일', '일요일', '공휴일']);
});

test('formatClinicHoursRows: null 이면 빈 배열', () => {
  assert.deepEqual(formatClinicHoursRows(null), []);
});

// ---------------------------------------------------------------------------
// 구조화 데이터
// ---------------------------------------------------------------------------

test('buildOpeningHoursSpecification: 평일은 월~금 5일로 펼쳐진다', () => {
  const nodes = buildOpeningHoursSpecification({
    ...EMPTY_CLINIC_HOURS,
    weekday: { open: '09:00', close: '18:00' },
  });
  assert.deepEqual(nodes, [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '09:00',
      closes: '18:00',
    },
  ]);
});

test('buildOpeningHoursSpecification: 휴진은 항목을 만들지 않는다(0시~0시 오독 방지)', () => {
  const nodes = buildOpeningHoursSpecification({
    ...EMPTY_CLINIC_HOURS,
    sunday: 'closed',
    holiday: 'closed',
  });
  assert.deepEqual(nodes, []);
});

test('buildOpeningHoursSpecification: 공휴일은 PublicHolidays 로 나간다', () => {
  const nodes = buildOpeningHoursSpecification({
    ...EMPTY_CLINIC_HOURS,
    holiday: { open: '10:00', close: '13:00' },
  });
  assert.deepEqual(nodes[0].dayOfWeek, ['PublicHolidays']);
});

test('buildOpeningHoursSpecification: 진료시간이 없으면 빈 배열(스키마에서 생략)', () => {
  assert.deepEqual(buildOpeningHoursSpecification(null), []);
  assert.deepEqual(buildOpeningHoursSpecification(EMPTY_CLINIC_HOURS), []);
});

// ---------------------------------------------------------------------------
// 병원 소개 페이지 노출 판정
// ---------------------------------------------------------------------------

test('소개문·진료시간·사진 중 하나라도 있으면 소개 페이지를 연다', () => {
  assert.equal(hasClinicAboutContent({ description: '소개', hasHours: false }), true);
  assert.equal(hasClinicAboutContent({ hasHours: true }), true);
  assert.equal(hasClinicAboutContent({ hasHours: false, galleryCount: 2 }), true);
});

test('★주소·전화만 있으면 소개 페이지를 만들지 않는다(홈과 중복 콘텐츠)', () => {
  assert.equal(
    hasClinicAboutContent({
      hasHours: false,
      address: '서울시 강남구 테헤란로 1',
      phone: '02-123-4567',
      galleryCount: 0,
    }),
    false,
  );
});

test('아무 내용도 없으면 소개 페이지를 만들지 않는다(빈 페이지 색인 방지)', () => {
  assert.equal(hasClinicAboutContent({ hasHours: false }), false);
  assert.equal(hasClinicAboutContent({ description: '   ', hasHours: false }), false);
});

// ---------------------------------------------------------------------------
// 소스 계약 — 세 곳이 같은 기준을 쓰는지
// ---------------------------------------------------------------------------

test('★홈 링크·소개 페이지·sitemap 이 같은 판정 함수를 쓴다(사이트맵에만 있는 404 방지)', () => {
  const home = SRC('../../../../app/clinic-site/[slug]/page.tsx');
  const about = SRC('../../../../app/clinic-site/[slug]/about/page.tsx');
  const sitemap = SRC('../../../../app/clinic-site/[slug]/sitemap.xml/route.ts');
  for (const source of [home, about, sitemap]) {
    assert.match(source, /hasClinicAboutContent\(/);
  }
  // 소개 페이지는 내용이 없으면 404 를 낸다.
  assert.match(about, /if \(!data\) notFound\(\);/);
});

test('소개 페이지는 회원이 입력한 공개 사실정보만 렌더한다(새 광고 문구를 만들지 않는다)', () => {
  const about = SRC('../../../../app/clinic-site/[slug]/about/page.tsx');
  assert.match(about, /theme\.description/);
  assert.match(about, /formatClinicHoursRows/);
  assert.match(about, /ClinicInfoList/);
  // 본문 글(saved_posts)이나 임의 텍스트 생성이 없다.
  assert.ok(!/getPublishedPosts?\(/.test(about));
});

test('진료시간은 MedicalClinic 스키마의 openingHoursSpecification 으로 나간다', () => {
  const schema = SRC('../../geo-schema.ts');
  assert.match(schema, /openingHoursSpecification/);
  const about = SRC('../../../../app/clinic-site/[slug]/about/page.tsx');
  assert.match(about, /openingHours: buildOpeningHoursSpecification\(clinic\.hours\)/);
});

test('마이그 053: hospital_hours 컬럼이 정의돼 있다', () => {
  const migration = SRC('../../../../../supabase/migrations/20260726_053_clinic_site_hours.sql');
  assert.match(migration, /add column if not exists hospital_hours jsonb/);
});

test('폴백: 마이그 053 미적용이어도 공개 페이지·프로필 저장이 죽지 않는다', () => {
  const data = SRC('../data.ts');
  assert.match(data, /CLINIC_PROFILE_COLS_WITH_HOURS/);
  assert.match(data, /42703/);
  const profile = SRC('../../../../app/api/profile/route.ts');
  assert.match(profile, /\['hospital_hours'\]/);
});
