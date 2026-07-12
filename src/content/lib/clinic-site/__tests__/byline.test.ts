import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorNode,
  buildPhysicianSchema,
  CLINICAL_ROLES,
  formatBylineText,
  isClinicalRole,
  resolveAuthorAttribution,
} from '../byline.ts';

// ---------------------------------------------------------------------------
// isClinicalRole — 임상 역할 분기
// ---------------------------------------------------------------------------

test('isClinicalRole: 원장·부원장만 임상 역할', () => {
  assert.equal(isClinicalRole('원장'), true);
  assert.equal(isClinicalRole('부원장'), true);
  assert.equal(isClinicalRole(' 원장 '), true); // 트림
  for (const p of ['간호사', '원무', '마케터', '기타', '', null, undefined]) {
    assert.equal(isClinicalRole(p), false, `${String(p)} 는 임상 역할이 아님`);
  }
});

test('CLINICAL_ROLES 는 원장·부원장 두 개뿐', () => {
  assert.deepEqual([...CLINICAL_ROLES], ['원장', '부원장']);
});

// ---------------------------------------------------------------------------
// resolveAuthorAttribution — 인물 vs 병원 vs null
// ---------------------------------------------------------------------------

test('임상 역할 + 이름 → 개인(person) 저자', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.equal(attr?.type, 'person');
  assert.equal(attr && attr.type === 'person' && attr.personName, '김석종');
  assert.equal(attr && attr.type === 'person' && attr.roleLabel, '원장');
});

test('부원장 + 이름 → 개인(person) 저자', () => {
  const attr = resolveAuthorAttribution({
    fullName: '이하나',
    position: '부원장',
    hospitalName: '청호의원',
    specialty: '치과',
  });
  assert.equal(attr?.type, 'person');
});

test('비임상 직책(마케터·원무·간호사·기타) → 병원(organization) 저자 (의사인 척 금지)', () => {
  for (const position of ['마케터', '원무', '간호사', '기타']) {
    const attr = resolveAuthorAttribution({
      fullName: '홍길동',
      position,
      hospitalName: '청호의원',
      specialty: '피부과',
    });
    assert.equal(attr?.type, 'organization', `${position} → 조직 저자여야 함`);
    assert.equal(attr && attr.type === 'organization' && attr.orgName, '청호의원');
  }
});

test('임상 역할이어도 이름이 없으면 → 병원(organization) 저자', () => {
  const attr = resolveAuthorAttribution({
    fullName: '',
    position: '원장',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.equal(attr?.type, 'organization');
});

test('이름·병원명 모두 없으면 → null (저자 표기 생략)', () => {
  const attr = resolveAuthorAttribution({
    fullName: null,
    position: '마케터',
    hospitalName: null,
    specialty: null,
  });
  assert.equal(attr, null);
});

// ---------------------------------------------------------------------------
// formatBylineText — 화면 바이라인 문구
// ---------------------------------------------------------------------------

test('formatBylineText: 인물 → "작성: 이름 직책"', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.equal(formatBylineText(attr), '작성: 김석종 원장');
});

test('formatBylineText: 조직 → "작성: 병원명"', () => {
  const attr = resolveAuthorAttribution({
    fullName: '홍길동',
    position: '마케터',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.equal(formatBylineText(attr), '작성: 청호의원');
});

test('formatBylineText: null → null', () => {
  assert.equal(formatBylineText(null), null);
});

// ---------------------------------------------------------------------------
// buildAuthorNode — Article.author JSON-LD
// ---------------------------------------------------------------------------

test('buildAuthorNode: 인물 → Person(name·jobTitle), 검증불가 자격 없음', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  const node = buildAuthorNode(attr);
  assert.deepEqual(node, { '@type': 'Person', name: '김석종', jobTitle: '원장' });
  // '전문의'·board certified 등 자격 문구가 새지 않는다
  assert.equal(JSON.stringify(node).includes('전문의'), false);
});

test('buildAuthorNode: 조직 → Organization(name=병원명)', () => {
  const attr = resolveAuthorAttribution({
    fullName: '홍길동',
    position: '원무',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.deepEqual(buildAuthorNode(attr), { '@type': 'Organization', name: '청호의원' });
});

test('buildAuthorNode: null → null', () => {
  assert.equal(buildAuthorNode(null), null);
});

// ---------------------------------------------------------------------------
// buildPhysicianSchema — 임상 역할일 때만
// ---------------------------------------------------------------------------

test('buildPhysicianSchema: 임상 역할 → Physician(affiliation·medicalSpecialty), 자격 단정 없음', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  const schema = buildPhysicianSchema(attr);
  assert.equal(schema?.['@type'], 'Physician');
  assert.equal(schema?.name, '김석종');
  assert.equal(schema?.jobTitle, '원장');
  assert.deepEqual(schema?.affiliation, { '@type': 'MedicalClinic', name: '청호의원' });
  assert.equal(schema?.medicalSpecialty, '피부과');
  // 인물 자격(전문의/board certified)을 단정하는 필드가 없어야 한다
  const serialized = JSON.stringify(schema);
  assert.equal(serialized.includes('전문의'), false);
  assert.equal(serialized.toLowerCase().includes('board'), false);
  assert.equal(serialized.includes('medicalLicense'), false);
});

test('buildPhysicianSchema: 병원명 없으면 affiliation 생략', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '',
    specialty: '피부과',
  });
  // 병원명이 없으면 attribution 자체는 person 유지(이름+임상역할)
  const schema = buildPhysicianSchema(attr);
  assert.equal(schema?.['@type'], 'Physician');
  assert.equal('affiliation' in (schema ?? {}), false);
});

test('buildPhysicianSchema: 진료과 없으면 medicalSpecialty 생략', () => {
  const attr = resolveAuthorAttribution({
    fullName: '김석종',
    position: '원장',
    hospitalName: '청호의원',
    specialty: null,
  });
  const schema = buildPhysicianSchema(attr);
  assert.equal('medicalSpecialty' in (schema ?? {}), false);
});

test('buildPhysicianSchema: 비임상 직책(조직 저자) → null (Physician 생략)', () => {
  const attr = resolveAuthorAttribution({
    fullName: '홍길동',
    position: '마케터',
    hospitalName: '청호의원',
    specialty: '피부과',
  });
  assert.equal(buildPhysicianSchema(attr), null);
});

test('buildPhysicianSchema: null → null', () => {
  assert.equal(buildPhysicianSchema(null), null);
});
