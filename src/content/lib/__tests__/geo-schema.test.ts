import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArticleSchema,
  buildFaqPageSchema,
  buildGeoSchemas,
  buildMedicalClinicSchema,
  buildMetaDescription,
  extractFaqItems,
  extractSummaryLines,
  serializeJsonLd,
  stripStructureBlocks,
  META_DESCRIPTION_MAX,
  type GeoHospitalProfile,
} from '../geo-schema.ts';

// ---------------------------------------------------------------------------
// 픽스처 — 실제 생성 본문 구조(플레인 텍스트 + 구조 마커)를 그대로 모사
// ---------------------------------------------------------------------------

const FULL_CONTENT = `허리 디스크 초기 증상은 아침에 더 묵직하게 느껴지는 경우가 많습니다.

[핵심 요약]
허리 디스크는 척추뼈 사이 쿠션이 밀려나 신경을 누르는 상태입니다
초기에는 허리보다 다리 저림으로 먼저 나타나는 경우가 많습니다
2주 이상 통증이 계속되면 전문의 진료를 받아보는 것이 좋습니다
[/핵심 요약]

허리 디스크, 왜 생기는 걸까요

[이미지 1: 진료실에서 허리 모형을 짚으며 설명하는 의료진 클로즈업]

디스크는 척추뼈 사이에서 충격을 흡수하는 쿠션입니다. 오래 앉아 있으면 부담이 커집니다.

▶ 오래 앉는 습관이 미치는 영향

앉은 자세는 서 있을 때보다 허리에 더 큰 압력을 줍니다.

[자주 묻는 질문]
Q1. 허리 디스크 초기에는 어떤 증상이 나타나나요?
A1. 허리 통증보다 다리 저림이 먼저 나타나는 경우가 많습니다. 아침에 증상이 심해지는 특징이 있습니다.

Q2. 허리 디스크는 수술 없이 나을 수 있나요?
A2. 초기에는 보존적 치료를 먼저 시도합니다. 전문의와 상담 후 결정하는 것이 안전합니다.
[/자주 묻는 질문]`;

const NO_FAQ_CONTENT = `무릎 통증은 활동량이 갑자기 늘어난 분들에게 흔합니다.

무릎이 아플 때 먼저 확인할 것

며칠 쉬어도 통증이 가시지 않으면 진료를 받아보는 것이 좋습니다.`;

const PROFILE: GeoHospitalProfile = {
  hospitalName: '애플정형외과의원',
  specialty: '정형외과',
  region: '대구 수성구',
  address: '대구광역시 수성구 청호로 1',
};

const EMPTY_PROFILE: GeoHospitalProfile = {
  hospitalName: null,
  specialty: null,
  region: null,
};

// ---------------------------------------------------------------------------
// FAQ 파생
// ---------------------------------------------------------------------------

test('FAQ 파생: 본문 Q/A 쌍을 정확히 추출한다', () => {
  const items = extractFaqItems(FULL_CONTENT);
  assert.equal(items.length, 2);
  assert.equal(items[0].question, '허리 디스크 초기에는 어떤 증상이 나타나나요?');
  assert.equal(
    items[0].answer,
    '허리 통증보다 다리 저림이 먼저 나타나는 경우가 많습니다. 아침에 증상이 심해지는 특징이 있습니다.',
  );
  assert.equal(items[1].question, '허리 디스크는 수술 없이 나을 수 있나요?');
  assert.match(items[1].answer, /보존적 치료를 먼저 시도합니다/);
});

test('FAQ 파생: FAQPage 스키마 텍스트는 전부 본문에서 온다 (수기 문구 없음)', () => {
  const items = extractFaqItems(FULL_CONTENT);
  const schema = buildFaqPageSchema(items);
  assert.ok(schema);
  assert.equal(schema['@type'], 'FAQPage');
  const mainEntity = schema.mainEntity as Array<{
    name: string;
    acceptedAnswer: { text: string };
  }>;
  assert.equal(mainEntity.length, 2);
  for (const entity of mainEntity) {
    assert.ok(FULL_CONTENT.includes(entity.name), `질문이 본문에 실재해야 함: ${entity.name}`);
    assert.ok(
      FULL_CONTENT.replace(/\s+/g, ' ').includes(entity.acceptedAnswer.text),
      `답변이 본문에 실재해야 함: ${entity.acceptedAnswer.text}`,
    );
  }
});

test('FAQ 파생: 번호가 어긋난 Q/A(Q1↔A2)는 쌍으로 인정하지 않는다', () => {
  const content = `[자주 묻는 질문]
Q1. 질문 하나?
A2. 번호가 어긋난 답변.
[/자주 묻는 질문]`;
  assert.deepEqual(extractFaqItems(content), []);
});

test('FAQPage 생략: 본문에 FAQ 블록이 없으면 스키마에 FAQPage 가 없다', () => {
  const schemas = buildGeoSchemas({ title: '무릎 통증', content: NO_FAQ_CONTENT }, PROFILE);
  const types = schemas.map((s) => s['@type']);
  assert.ok(!types.includes('FAQPage'));
  assert.ok(types.includes('Article'));
  assert.ok(types.includes('MedicalClinic'));
});

test('FAQPage 생략: 빈 FAQ 목록이면 null', () => {
  assert.equal(buildFaqPageSchema([]), null);
  assert.equal(buildFaqPageSchema([{ question: '  ', answer: '' }]), null);
});

// ---------------------------------------------------------------------------
// 요약·메타 설명 파생
// ---------------------------------------------------------------------------

test('핵심 요약: 블록의 3줄을 추출한다', () => {
  const lines = extractSummaryLines(FULL_CONTENT);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^허리 디스크는/);
});

test('메타 설명: 요약 블록이 있으면 요약에서 파생한다', () => {
  const description = buildMetaDescription(FULL_CONTENT);
  assert.ok(description.startsWith('허리 디스크는 척추뼈 사이 쿠션이'));
  assert.ok(description.length <= META_DESCRIPTION_MAX);
});

test('메타 설명: 요약이 없으면 첫 단락에서 파생하고 상한을 지킨다', () => {
  const description = buildMetaDescription(NO_FAQ_CONTENT);
  assert.equal(description, '무릎 통증은 활동량이 갑자기 늘어난 분들에게 흔합니다.');

  const long = `${'가'.repeat(300)}.\n\n다음 단락.`;
  const truncated = buildMetaDescription(long);
  assert.equal(truncated.length, META_DESCRIPTION_MAX);
  assert.ok(truncated.endsWith('…'));
});

test('블록 제거: 요약·FAQ·이미지 플레이스홀더가 본문에서 제거된다', () => {
  const stripped = stripStructureBlocks(FULL_CONTENT);
  assert.ok(!stripped.includes('[핵심 요약]'));
  assert.ok(!stripped.includes('[자주 묻는 질문]'));
  assert.ok(!stripped.includes('[이미지'));
  assert.ok(stripped.includes('허리 디스크, 왜 생기는 걸까요'));
});

// ---------------------------------------------------------------------------
// Article · MedicalClinic
// ---------------------------------------------------------------------------

test('Article: 제목·본문 파생 필드 + 병원명 author + 발행일', () => {
  const schema = buildArticleSchema(
    { title: '허리 디스크 초기 증상', content: FULL_CONTENT, publishedAt: '2026-07-01T00:00:00Z' },
    PROFILE,
  );
  assert.equal(schema['@type'], 'Article');
  assert.equal(schema.headline, '허리 디스크 초기 증상');
  assert.equal(schema.datePublished, '2026-07-01T00:00:00.000Z');
  assert.deepEqual(schema.author, { '@type': 'Organization', name: '애플정형외과의원' });
});

test('Article: 병원명 없으면 author 생략, 발행일 파싱 불가면 datePublished 생략', () => {
  const schema = buildArticleSchema(
    { title: '제목', content: NO_FAQ_CONTENT, publishedAt: 'not-a-date' },
    EMPTY_PROFILE,
  );
  assert.ok(!('author' in schema));
  assert.ok(!('datePublished' in schema));
});

test('MedicalClinic: 프로필 공개 사실정보만 파생한다', () => {
  const schema = buildMedicalClinicSchema(PROFILE);
  assert.ok(schema);
  assert.equal(schema['@type'], 'MedicalClinic');
  assert.equal(schema.name, '애플정형외과의원');
  assert.equal(schema.medicalSpecialty, '정형외과');
  const address = schema.address as Record<string, unknown>;
  assert.equal(address.addressLocality, '대구 수성구');
  assert.equal(address.addressCountry, 'KR');
});

test('MedicalClinic: 병원명이 없으면 스키마 자체를 생략한다', () => {
  assert.equal(buildMedicalClinicSchema(EMPTY_PROFILE), null);
  const schemas = buildGeoSchemas({ title: '제목', content: NO_FAQ_CONTENT }, EMPTY_PROFILE);
  assert.ok(!schemas.map((s) => s['@type']).includes('MedicalClinic'));
});

// ---------------------------------------------------------------------------
// 직렬화 (XSS 가드)
// ---------------------------------------------------------------------------

test('직렬화: "</script" 시퀀스가 이스케이프되고 JSON 으로 되돌릴 수 있다', () => {
  const malicious = '본문에 </script><script>alert(1)</script> 이 섞인 경우';
  const schemas = buildGeoSchemas(
    { title: `제목 </script>`, content: `${malicious}\n\n[자주 묻는 질문]\nQ1. 질문?\nA1. 답변 </script> 포함.\n[/자주 묻는 질문]` },
    PROFILE,
  );
  const serialized = serializeJsonLd(schemas);
  assert.ok(!serialized.includes('</script'), '직렬화 결과에 </script 시퀀스가 없어야 함');
  assert.ok(!serialized.includes('</'), '직렬화 결과에 </ 시퀀스가 없어야 함');
  // "<\/" 는 유효한 JSON 이스케이프 — 파싱하면 원문이 복원된다
  const parsed = JSON.parse(serialized) as Array<Record<string, unknown>>;
  assert.equal(parsed[0].headline, '제목 </script>');
});

test('직렬화: 스키마 1개면 객체, 여러 개면 배열', () => {
  const single = serializeJsonLd([{ '@type': 'Article' }]);
  assert.ok(single.trim().startsWith('{'));
  const multi = serializeJsonLd([{ '@type': 'Article' }, { '@type': 'FAQPage' }]);
  assert.ok(multi.trim().startsWith('['));
});
