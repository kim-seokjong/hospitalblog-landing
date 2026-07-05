import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLINICFLIX_CHARACTER_PRESETS,
  isCharacterPresetId,
  getCharacterPreset,
  parseCharacterSelection,
  parseCharacterFaceUrl,
  buildSeriesContext,
  extractPlanTopic,
} from '../clinicflix-characters.ts';

// ── 프리셋 구성 (파이프라인 characters.py 와 동기화 계약) ──
test('프리셋: 정확히 6종, id 중복 없음', () => {
  assert.equal(CLINICFLIX_CHARACTER_PRESETS.length, 6);
  const ids = new Set(CLINICFLIX_CHARACTER_PRESETS.map((p) => p.id));
  assert.equal(ids.size, 6);
});

test('프리셋: 남/여 목소리 커버리지', () => {
  const genders = new Set(CLINICFLIX_CHARACTER_PRESETS.map((p) => p.voiceGender));
  assert.deepEqual([...genders].sort(), ['female', 'male']);
});

test('프리셋: 캐치프레이즈에 의료광고법 위험 표현 없음 (효과 단정·최상급 금지)', () => {
  const banned = ['100%', '완치', '부작용 없', '보장', '최고', '1위', '유일', '완벽'];
  for (const p of CLINICFLIX_CHARACTER_PRESETS) {
    for (const word of banned) {
      assert.ok(
        !p.catchphrase.includes(word),
        `${p.id} 캐치프레이즈에 금지어 "${word}" 포함: ${p.catchphrase}`,
      );
    }
  }
});

// ── isCharacterPresetId / getCharacterPreset ──
test('isCharacterPresetId: 화이트리스트만 통과', () => {
  assert.equal(isCharacterPresetId('calm_male_doctor'), true);
  assert.equal(isCharacterPresetId('없는_아이디'), false);
  assert.equal(isCharacterPresetId(''), false);
  assert.equal(isCharacterPresetId(null), false);
  assert.equal(isCharacterPresetId(123), false);
});

test('getCharacterPreset: id 조회 (없으면 null)', () => {
  assert.equal(getCharacterPreset('witty_presenter')?.name, '엉뚱한 봉 피디');
  assert.equal(getCharacterPreset('nope'), null);
});

// ── parseCharacterSelection (profiles.clinicflix_character jsonb) ──
test('parseCharacterSelection: 정상 형태 → preset_id', () => {
  assert.equal(
    parseCharacterSelection({ preset_id: 'coordinator_female', selected_at: '2026-07-05' }),
    'coordinator_female',
  );
});

test('parseCharacterSelection: null/형태 불일치/모르는 id → null (변환 차단 없음)', () => {
  assert.equal(parseCharacterSelection(null), null);
  assert.equal(parseCharacterSelection(undefined), null);
  assert.equal(parseCharacterSelection('calm_male_doctor'), null); // 문자열 직접 저장은 비허용
  assert.equal(parseCharacterSelection({ preset_id: '삭제된_프리셋' }), null);
  assert.equal(parseCharacterSelection({ other: 1 }), null);
  assert.equal(parseCharacterSelection([]), null);
});

// ── buildSeriesContext ──
test('buildSeriesContext: 공백 정리·빈값 제거·중복 제거·최대 3건', () => {
  assert.deepEqual(
    buildSeriesContext([' 임플란트 통증 ', '', null, '임플란트 통증', '스케일링', undefined, '충치', '네번째']),
    ['임플란트 통증', '스케일링', '충치'],
  );
});

test('buildSeriesContext: 전부 무효면 빈 배열', () => {
  assert.deepEqual(buildSeriesContext([null, undefined, '  ']), []);
});

// ── extractPlanTopic ──
test('extractPlanTopic: v2(shorts_v2) 우선', () => {
  assert.equal(
    extractPlanTopic({ shorts_v2: { topic: ' 임플란트 후 통증 ' }, shorts: { topic: 'v1주제' } }),
    '임플란트 후 통증',
  );
});

test('extractPlanTopic: v2 없으면 v1(shorts) 폴백', () => {
  assert.equal(extractPlanTopic({ shorts: { topic: '무릎 통증 운동' } }), '무릎 통증 운동');
});

test('extractPlanTopic: 없거나 형태 불일치 → null', () => {
  assert.equal(extractPlanTopic(null), null);
  assert.equal(extractPlanTopic({}), null);
  assert.equal(extractPlanTopic({ shorts_v2: { topic: '' } }), null);
  assert.equal(extractPlanTopic({ shorts: 'not-object' }), null);
});

test('extractPlanTopic: 과도하게 긴 topic 은 200자로 절단', () => {
  const long = '가'.repeat(500);
  assert.equal(extractPlanTopic({ shorts_v2: { topic: long } })?.length, 200);
});

// ── parseCharacterFaceUrl (전속 캐릭터 전용 얼굴 — 1회 생성·영구 고정) ──

test('parseCharacterFaceUrl: 정상 https URL → 그대로 반환', () => {
  const raw = {
    preset_id: 'calm_male_doctor',
    face_url: 'https://cdn.example.com/face.png',
  };
  assert.equal(parseCharacterFaceUrl(raw), 'https://cdn.example.com/face.png');
});

test('parseCharacterFaceUrl: face_url 없음/비객체 → null (미고정과 동일)', () => {
  assert.equal(parseCharacterFaceUrl({ preset_id: 'calm_male_doctor' }), null);
  assert.equal(parseCharacterFaceUrl(null), null);
  assert.equal(parseCharacterFaceUrl('문자열'), null);
});

test('parseCharacterFaceUrl: https 아닌 값·비정상 URL 거부', () => {
  assert.equal(parseCharacterFaceUrl({ face_url: 'http://insecure.com/f.png' }), null);
  assert.equal(parseCharacterFaceUrl({ face_url: 'javascript:alert(1)' }), null);
  assert.equal(parseCharacterFaceUrl({ face_url: '   ' }), null);
  assert.equal(parseCharacterFaceUrl({ face_url: 123 }), null);
  assert.equal(parseCharacterFaceUrl({ face_url: 'not-a-url' }), null);
});

test('parseCharacterFaceUrl: 과도하게 긴 URL 거부 (외부 입력 방어)', () => {
  const long = 'https://x.com/' + 'a'.repeat(600);
  assert.equal(parseCharacterFaceUrl({ face_url: long }), null);
});
