import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosisQueries, MAX_RECOMMEND_QUESTIONS } from '../ai-citation.ts';

/**
 * 진단 질의 회귀 테스트 (2026-08-05).
 *
 * 배경: 기존 질의 3개는 "○○구 안과 추천해줘"의 **표현만 바꾼 것**이라
 * 실제로는 한 가지("지역+진료과")만 묻고 있었다. 경쟁 서비스와 비교했을 때
 * 가장 큰 격차가 여기였다 — 환자는 시술·대기·보호자 관점으로 묻는다.
 * 상한에서 잘리므로 **서로 다른 축이 앞쪽에 오는지**가 핵심이다.
 */

test('상한 안에서 서로 다른 축이 들어간다 (기본·시술·조건)', () => {
  const q = buildDiagnosisQueries({ region: '대구 수성구', specialty: '안과', clinicName: '보라빛안과의원' });
  assert.equal(q.recommend.length, MAX_RECOMMEND_QUESTIONS);
  assert.ok(q.recommend[0].includes('안과 추천해줘'), '1번은 기본 노출 질문');
  assert.ok(q.recommend[1].includes('백내장 수술'), '2번은 시술 질문');
  assert.ok(q.recommend[2].includes('대기 짧은'), '3번은 조건 질문');
  // 같은 문장 반복이 아니어야 한다
  assert.equal(new Set(q.recommend).size, q.recommend.length);
});

test('진료과마다 그 과의 시술이 들어간다', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['치과', '임플란트'],
    ['정형외과', '무릎 관절'],
    ['피부과', '여드름 치료'],
    ['소아청소년과', '영유아 검진'],
  ];
  for (const [specialty, need] of cases) {
    const q = buildDiagnosisQueries({ region: '대구 중구', specialty, clinicName: '가나의원' });
    assert.ok(q.recommend.some((s) => s.includes(need)), `${specialty} → ${need} 누락`);
  }
});

test('목록에 없는 진료과는 시술을 지어내지 않는다', () => {
  // 하지도 않는 진료로 진단하면 원장이 첫 화면에서 신뢰를 잃는다
  const q = buildDiagnosisQueries({ region: '대구 남구', specialty: '영상의학과', clinicName: '가나의원' });
  assert.equal(q.recommend.length, MAX_RECOMMEND_QUESTIONS);
  assert.ok(q.recommend.every((s) => s.includes('영상의학과')));
  assert.ok(q.recommend.some((s) => s.includes('대기 짧은')), '공통 축은 남아야 한다');
});

test('지역이 없으면 진료과만으로 만든다', () => {
  const q = buildDiagnosisQueries({ region: '', specialty: '안과', clinicName: '보라빛안과의원' });
  assert.ok(q.recommend.length > 0);
  assert.ok(q.recommend.every((s) => !s.includes('undefined')));
  assert.equal(q.named, '보라빛안과의원 어떤 병원이야?');
});

test('진료과가 없으면 추천 질의를 만들지 않는다', () => {
  const q = buildDiagnosisQueries({ region: '대구 수성구', specialty: '', clinicName: '가나의원' });
  assert.equal(q.recommend.length, 0);
});

test('병원명이 없으면 이름 질의는 null', () => {
  const q = buildDiagnosisQueries({ region: '대구 수성구', specialty: '안과', clinicName: '' });
  assert.equal(q.named, null);
});

test('상한을 넘겨 만들어두되 잘라서 낸다 (상한 확대 시 보호자 축이 들어온다)', () => {
  const q = buildDiagnosisQueries({ region: '대구 수성구', specialty: '안과', clinicName: '보라빛안과의원' });
  assert.ok(q.recommend.length <= MAX_RECOMMEND_QUESTIONS);
});
