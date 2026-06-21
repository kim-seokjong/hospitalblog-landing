import { getAnthropicClient, MODEL } from '@/content/lib/anthropic'
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT } from '@/content/lib/medical-compliance'

/** 병원 소개문·키워드 생성 결과 */
export interface ClinicProfileSuggestion {
  hospital_desc: string
  keywords: string[]
}

/** Claude 호출 상한(ms) — 가입 흐름이 무한 대기하지 않도록 보호. */
const SUGGEST_TIMEOUT_MS = 15_000

const SYSTEM_PROMPT = `당신은 병의원 마케팅 카피라이터입니다.
주어진 병원 정보를 바탕으로 ① 병원 소개문과 ② 자주 쓰는 키워드를 생성합니다.

【병원 소개문 규칙】
- 2~3문장으로 작성하며, 진료 철학·차별점이 자연스럽게 드러나야 합니다.
- 과장·의료광고법 위반 표현 금지: 효과 단정, "최고/최우수/유일", "100%/완치/무조건", 부작용 없음 등 절대 사용 금지.
- 환자 중심의 신뢰감 있는 어조로 작성합니다.

【키워드 규칙】
- 진료과목과 관련된 검색 키워드 6~8개를 생성합니다.
- 지역·진료과목·증상 등 환자가 실제로 검색할 만한 키워드 위주로 작성합니다.

【출력 형식 — 반드시 아래 JSON 만 출력】
{"hospital_desc": "소개문", "keywords": ["키워드1", "키워드2"]}
설명·머리말·코드블록 없이 JSON 객체만 출력하세요.

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}`

/** 모델 텍스트에서 첫 { ~ 마지막 } 구간을 추출해 JSON 파싱. 실패 시 graceful 기본값. */
function parseSuggestion(text: string): ClinicProfileSuggestion {
  const fallback: ClinicProfileSuggestion = { hospital_desc: '', keywords: [] }
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return fallback
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown
    if (typeof raw !== 'object' || raw === null) return fallback
    const obj = raw as Record<string, unknown>
    const desc = typeof obj.hospital_desc === 'string' ? obj.hospital_desc.trim() : ''
    const keywords = Array.isArray(obj.keywords)
      ? obj.keywords
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 10)
      : []
    return { hospital_desc: desc, keywords }
  } catch {
    return fallback
  }
}

/**
 * 병원 정보로 소개문·키워드 초안을 생성한다.
 *
 * 안전: 호출/파싱 실패·타임아웃 시 throw 하지 않고 `{ hospital_desc: '', keywords: [] }`
 *       를 반환한다(graceful). 호출부(가입 흐름 등)가 생성 실패로 깨지지 않도록 보장.
 */
export async function suggestClinicProfile(params: {
  hospitalName: string
  specialty: string
  specialtyDetail?: string
  region?: string
}): Promise<ClinicProfileSuggestion> {
  const fallback: ClinicProfileSuggestion = { hospital_desc: '', keywords: [] }

  const hospitalName = params.hospitalName?.trim() ?? ''
  const specialty = params.specialty?.trim() ?? ''
  const specialtyDetail = params.specialtyDetail?.trim() ?? ''
  const region = params.region?.trim() ?? ''

  if (!hospitalName || !specialty) return fallback

  const userPrompt = [
    `병원명: ${hospitalName}`,
    `진료과목: ${specialty}`,
    specialtyDetail ? `세부 진료과목: ${specialtyDetail}` : '',
    region ? `지역: ${region}` : '',
    '',
    '위 정보를 바탕으로 병원 소개문과 키워드를 JSON 으로 생성해주세요.',
  ]
    .filter(Boolean)
    .join('\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS)
  try {
    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal },
    )
    const textBlock = response.content.find((b) => b.type === 'text')
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    return parseSuggestion(text)
  } catch {
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}
