import test from 'node:test';
import assert from 'node:assert/strict';
import { refineSpecialties, type SpecialtyLookup } from '../specialty-refine.ts';
import type { ClinicCandidate } from '../types.ts';

/**
 * 진료과 보정 회귀 테스트.
 *
 * 케이스는 전부 2026-08-05에 **실제로 틀리게 나갔던 병원들**이다.
 * 행안부 진료과목은 개설 신고 순서라 첫 값이 대표 과목이 아니었고,
 * 원장이 자기 병원을 진단해 보면 첫 화면부터 틀린 과가 찍혀 있었다.
 */

function clinic(over: Partial<ClinicCandidate> = {}): ClinicCandidate {
  return {
    mngNo: 'PHMA1',
    name: '신암카톨릭비뇨기과의원',
    roadAddress: '대구광역시 동구 아양로 1',
    province: '대구광역시',
    region: '동구',
    specialty: '피부과',
    institutionType: '의원',
    phone: '053-000-0000',
    active: true,
    statusLabel: '영업/정상',
    openedOn: '2010-01-01',
    closedOn: '',
    ...over,
  } as ClinicCandidate;
}

type Row = { name_norm: string; province: string; specialty: string; institution_type?: string };

const lookupOf =
  (rows: Row[]): SpecialtyLookup =>
  async () =>
    rows.map((r) => ({ institution_type: '의원', ...r }));

test('행안부가 고른 엉뚱한 과를 심평원 표시과목으로 바꾼다', async () => {
  const [out] = await refineSpecialties(
    [clinic()],
    lookupOf([{ name_norm: '신암카톨릭비뇨기과의원', province: '대구광역시', specialty: '비뇨의학과' }]),
  );
  assert.equal(out.specialty, '비뇨의학과');
});

test('실제로 틀렸던 5곳을 모두 바로잡는다', async () => {
  // name_norm 은 임포터가 넣은 값 그대로 쓴다 — 공백 제거 + **소문자화**.
  // 영문이 섞인 상호("칠곡제이(J)…")를 원본 대소문자로 맞추려 하면 영영 매칭되지 않는다.
  const cases: ReadonlyArray<readonly [string, string, string, string]> = [
    ['칠곡제이(J)성형외과의원', '칠곡제이(j)성형외과의원', '신경외과', '성형외과'],
    ['올포스킨피부과의원', '올포스킨피부과의원', '내과', '피부과'],
    ['시티여성의원', '시티여성의원', '성형외과', '산부인과'],
    ['9988정형외과의원', '9988정형외과의원', '내과', '정형외과'],
    ['필연합의원', '필연합의원', '피부과', '비뇨의학과'],
  ];
  for (const [name, norm, wrong, right] of cases) {
    const [out] = await refineSpecialties(
      [clinic({ name, specialty: wrong })],
      lookupOf([{ name_norm: norm, province: '대구광역시', specialty: right }]),
    );
    assert.equal(out.specialty, right, `${name} 보정 실패`);
  }
});

test('시·도가 다르면 바꾸지 않는다 — 동명 병원 오염 방지', async () => {
  const [out] = await refineSpecialties(
    [clinic({ province: '서울특별시' })],
    lookupOf([{ name_norm: '신암카톨릭비뇨기과의원', province: '대구광역시', specialty: '비뇨의학과' }]),
  );
  assert.equal(out.specialty, '피부과');
});

test('같은 시·도에 같은 이름이 여러 과로 있으면 손대지 않는다', async () => {
  const [out] = await refineSpecialties(
    [clinic({ name: '연합의원', specialty: '내과' })],
    lookupOf([
      { name_norm: '연합의원', province: '대구광역시', specialty: '피부과' },
      { name_norm: '연합의원', province: '대구광역시', specialty: '성형외과' },
    ]),
  );
  assert.equal(out.specialty, '내과');
});

test('★동명 병원이 여러 곳이면 과가 같아도 덮어쓰지 않는다', async () => {
  // 두 행의 과가 우연히 같아도, 지금 보는 병원이 그중 어느 곳인지 알 수 없다.
  // 행안부 후보가 사실 제3의 병원이면 엉뚱한 과를 씌우게 된다.
  const [out] = await refineSpecialties(
    [clinic({ name: '새봄의원', specialty: '피부과' })],
    lookupOf([
      { name_norm: '새봄의원', province: '서울특별시', specialty: '내과' },
      { name_norm: '새봄의원', province: '서울특별시', specialty: '내과' },
    ]),
  );
  assert.equal(out.specialty, '피부과');
});

test('★기관 종별이 다르면 덮어쓰지 않는다 — 동명 치과기관 오염 방지', async () => {
  const [out] = await refineSpecialties(
    [clinic({ name: '가온의원', institutionType: '의원', specialty: '내과' })],
    lookupOf([
      { name_norm: '가온의원', province: '대구광역시', specialty: '치과', institution_type: '치과의원' },
    ]),
  );
  assert.equal(out.specialty, '내과');
});

test('시·도 표기가 달라도 같은 곳이면 보정한다 (강원도 ↔ 강원특별자치도)', async () => {
  const [out] = await refineSpecialties(
    [clinic({ name: '고성의원', province: '강원도', specialty: '내과' })],
    lookupOf([{ name_norm: '고성의원', province: '강원특별자치도', specialty: '정형외과' }]),
  );
  assert.equal(out.specialty, '정형외과');
});

test('시·도 축약형도 같은 곳으로 본다 (서울 ↔ 서울특별시)', async () => {
  const [out] = await refineSpecialties(
    [clinic({ name: '한빛의원', province: '서울', specialty: '내과' })],
    lookupOf([{ name_norm: '한빛의원', province: '서울특별시', specialty: '안과' }]),
  );
  assert.equal(out.specialty, '안과');
});

test('치과의원·한의원은 종별로 확정되므로 건드리지 않는다', async () => {
  const [dental] = await refineSpecialties(
    [clinic({ name: '미소치과의원', institutionType: '치과의원', specialty: '치과' })],
    lookupOf([{ name_norm: '미소치과의원', province: '대구광역시', specialty: '내과' }]),
  );
  assert.equal(dental.specialty, '치과');
  const [korean] = await refineSpecialties(
    [clinic({ name: '탕정365한의원', institutionType: '한의원', specialty: '한의원' })],
    lookupOf([{ name_norm: '탕정365한의원', province: '대구광역시', specialty: '내과' }]),
  );
  assert.equal(korean.specialty, '한의원');
});

test('명부가 비었거나 조회기가 없으면 원본을 그대로 쓴다', async () => {
  const [none] = await refineSpecialties([clinic()], null);
  assert.equal(none.specialty, '피부과');
  const [empty] = await refineSpecialties([clinic()], lookupOf([]));
  assert.equal(empty.specialty, '피부과');
});

test('조회가 던져도 진단을 막지 않는다', async () => {
  const boom: SpecialtyLookup = async () => {
    throw new Error('timeout');
  };
  const [out] = await refineSpecialties([clinic()], boom);
  assert.equal(out.specialty, '피부과');
});

test('빈 진료과 행으로는 덮어쓰지 않는다', async () => {
  const [out] = await refineSpecialties(
    [clinic()],
    lookupOf([{ name_norm: '신암카톨릭비뇨기과의원', province: '대구광역시', specialty: '  ' }]),
  );
  assert.equal(out.specialty, '피부과');
});

test('원본 배열·객체를 변형하지 않는다', async () => {
  const input = [clinic()];
  const snapshot = input[0].specialty;
  await refineSpecialties(
    input,
    lookupOf([{ name_norm: '신암카톨릭비뇨기과의원', province: '대구광역시', specialty: '비뇨의학과' }]),
  );
  assert.equal(input[0].specialty, snapshot);
});
