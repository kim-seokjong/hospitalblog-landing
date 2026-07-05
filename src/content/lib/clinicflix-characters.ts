// 클리닉픽스 병원 전속 AI 캐릭터 — 웹 표시용 프리셋 메타 + 순수 헬퍼.
//
// ⚠️ 원본(단일 소스)과 동기화 필수:
//    clinicflix_pipeline/clinicflix/characters.py (PRESETS 6종)
//    id·이름·캐치프레이즈·말투가 달라지면 회원에게 보이는 카드와 실제 영상이 어긋난다.
//    (persona_en 영어 외형 묘사는 파이프라인 전용 — 웹에는 두지 않는다.)
//
// 캐치프레이즈는 의료광고법 안전 문구만(효과 단정·과장·최상급 금지) — 파이프라인과 동일 규칙.

/** 전속 캐릭터 프리셋 1종의 웹 표시 메타. */
export interface ClinicflixCharacterPreset {
  id: string
  /** 한국어 표시명 (예: "차분한 서 원장님") */
  name: string
  /** 카드에 보여줄 한 줄 소개 */
  intro: string
  /** 말투 설명 (파이프라인 tone_ko 와 동일) */
  tone: string
  /** 시그니처 한 줄 — CTA 부근 최대 1회, 자연스러울 때만 */
  catchphrase: string
  /** 캐릭터 목소리 성별 (선택 시 영상 음성도 이 성별로 통일됨) */
  voiceGender: 'male' | 'female'
}

export const CLINICFLIX_CHARACTER_PRESETS: readonly ClinicflixCharacterPreset[] = [
  {
    id: 'calm_male_doctor',
    name: '차분한 서 원장님',
    intro: '서두르지 않는 신뢰형 — 무게감 있는 진료 설명에 어울려요',
    tone: '차분하고 단정한 존댓말, 문장을 짧게 끊는 신뢰감 있는 어조',
    catchphrase: '궁금하면, 물어보세요.',
    voiceGender: 'male',
  },
  {
    id: 'warm_female_doctor',
    name: '따뜻한 윤 원장님',
    intro: '다독이는 공감형 — 불안한 환자 마음을 먼저 읽어요',
    tone: '따뜻하고 안정감 있는 존댓말, 천천히 또박또박',
    catchphrase: '몸이 보내는 신호, 그냥 지나치지 마세요.',
    voiceGender: 'female',
  },
  {
    id: 'energetic_male_coach',
    name: '에너지 강 선생님',
    intro: '활기찬 코치형 — 운동·생활습관 콘텐츠에 딱이에요',
    tone: '활기차고 리듬감 있는 해요체, 짧고 시원시원한 문장',
    catchphrase: '오늘은 딱 하나만 기억해요!',
    voiceGender: 'male',
  },
  {
    id: 'friendly_female_guide',
    name: '친근한 하은 쌤',
    intro: '옆집 언니형 — 어려운 용어를 바로 쉬운 말로 풀어줘요',
    tone: '친근한 해요체, 어려운 용어는 바로 쉬운 말로 설명',
    catchphrase: '어렵죠? 쉽게 풀어드릴게요.',
    voiceGender: 'female',
  },
  {
    id: 'witty_presenter',
    name: '엉뚱한 봉 피디',
    intro: '위트 스킷형 — 지루한 주제도 반전으로 끝까지 보게 해요',
    tone: '위트 있는 존댓말, 한 박자 쉼과 가벼운 반전 멘트',
    catchphrase: '자, 여기서 반전 하나.',
    voiceGender: 'male',
  },
  {
    id: 'coordinator_female',
    name: '든든한 소이 실장',
    intro: '야무진 실장형 — 예약·준비·안내 등 실무 정보에 강해요',
    tone: '싹싹하고 야무진 존댓말, 안내데스크처럼 구체적으로',
    catchphrase: '방문 전에, 이것부터 확인하세요.',
    voiceGender: 'female',
  },
] as const

const PRESET_IDS = new Set(CLINICFLIX_CHARACTER_PRESETS.map((p) => p.id))

/** 유효한 프리셋 id 인지 (외부 입력 화이트리스트 검증). */
export function isCharacterPresetId(value: unknown): value is string {
  return typeof value === 'string' && PRESET_IDS.has(value)
}

/** 프리셋 id → 메타 (없으면 null). */
export function getCharacterPreset(id: string): ClinicflixCharacterPreset | null {
  return CLINICFLIX_CHARACTER_PRESETS.find((p) => p.id === id) ?? null
}

/**
 * profiles.clinicflix_character(jsonb, 신뢰 불가 외부 데이터) → 프리셋 id.
 * 형태 불일치·모르는 id 는 null (미선택과 동일 취급 — 변환을 막지 않는다).
 */
export function parseCharacterSelection(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const presetId = (raw as Record<string, unknown>).preset_id
  return isCharacterPresetId(presetId) ? presetId : null
}

const FACE_URL_MAX_LEN = 500

/**
 * profiles.clinicflix_character(jsonb) → 전용 얼굴 face_url (1회 생성·영구 고정본).
 * https URL 만 허용, 형태 불일치·비정상 값은 null (미고정과 동일 — 렌더는 기존 폴백).
 */
export function parseCharacterFaceUrl(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const faceUrl = (raw as Record<string, unknown>).face_url
  if (typeof faceUrl !== 'string') return null
  const trimmed = faceUrl.trim()
  if (!trimmed || trimmed.length > FACE_URL_MAX_LEN) return null
  try {
    const u = new URL(trimmed)
    return u.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

/**
 * ClinicFlix 기획(plan, 신뢰 불가 외부 데이터)에서 에피소드 topic 추출.
 * v2(shorts_v2) 우선, 없으면 v1(shorts). 없거나 형태 불일치면 null.
 */
export function extractPlanTopic(plan: unknown): string | null {
  if (typeof plan !== 'object' || plan === null) return null
  const p = plan as Record<string, unknown>
  for (const key of ['shorts_v2', 'shorts'] as const) {
    const sb = p[key]
    if (typeof sb === 'object' && sb !== null) {
      const topic = (sb as Record<string, unknown>).topic
      if (typeof topic === 'string' && topic.trim()) return topic.trim().slice(0, 200)
    }
  }
  return null
}

/**
 * 최근 변환 topic 들 → series_context (파이프라인 전달용).
 * 문자열만 · 공백 정리 · 빈값 제거 · 중복 제거 · 최대 3건.
 */
export function buildSeriesContext(topics: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const t of topics) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim()
    if (!trimmed || out.includes(trimmed)) continue
    out.push(trimmed)
    if (out.length >= 3) break
  }
  return out
}
