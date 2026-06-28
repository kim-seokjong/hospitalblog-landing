import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT, autoFix } from '@/content/lib/medical-compliance';

/**
 * 가입 전 무료 맞춤 샘플(티저).
 *
 * 전체 글이 아니라 "맛보기"만 담는다 — 제목 + 인트로 1문단 + 소제목 3~5개 +
 * 예시 본문 섹션 1개. 전체 본문·발행·멀티채널은 가입 후로 남겨 전환 유인을 만든다.
 */
export interface FreeSample {
  clinicName: string;
  specialty: string;
  region: string;
  title: string;
  intro: string;
  subheadings: string[];
  sampleSection: { heading: string; body: string };
}

/**
 * 병원명을 캐시 키로 정규화한다.
 * - 앞뒤 공백 제거, 소문자화, 내부 공백/괄호/점 제거.
 * 같은 병원의 표기 흔들림(공백·괄호)을 하나의 키로 모아 재생성을 막는다.
 */
export function normalizeClinicKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s()[\]{}.·・]/g, '');
}

interface GenerateInput {
  clinicName: string;
  specialty: string;
  region: string;
}

const SAMPLE_SYSTEM_PROMPT = `당신은 병원 블로그 콘텐츠 전문가입니다. 잠재 고객(병원)에게 보여줄 "맛보기 샘플"을 만듭니다.

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}

【샘플의 목적과 분량 — 매우 중요】
- 이것은 전체 글이 아니라 "티저"입니다. 절대 글 전체를 쓰지 마세요.
- 예시 본문 섹션은 단 1개만, 2~3문장으로 짧게 작성합니다.
- 나머지 소제목들의 본문은 쓰지 않습니다(가입 후 제공).

【작성 원칙】
- 해당 병원의 진료과목/지역에 맞춘 정보성 블로그 글의 도입부 느낌을 줍니다.
- 환자에게 유용한 정보 전달이 목적이며, 과장·최상급·치료결과 보장 표현은 절대 금지합니다.
- 특정 시술 가격·이벤트·전후사진·환자후기는 넣지 않습니다.`;

function buildUserPrompt({ clinicName, specialty, region }: GenerateInput): string {
  const specialtyHint = specialty ? `진료과목: ${specialty}` : '진료과목: (일반 병원)';
  const regionHint = region ? `지역: ${region}` : '';
  return `다음 병원의 블로그 "맛보기 샘플(티저)"을 만들어 주세요.

병원명: ${clinicName}
${specialtyHint}
${regionHint}

요구사항:
- 제목 1개 (25~35자, 검색 의도가 분명한 정보형/가이드형)
- 인트로 1문단 (2~3문장, 독자의 궁금증을 여는 도입)
- 소제목 3~5개 (각 12~25자, 본문 없이 제목만)
- 예시 본문 섹션 1개 (위 소제목 중 첫 번째에 대한 짧은 본문 2~3문장)
- 의료광고법 완전 준수. 과장·최상급·치료결과 보장·비교·후기 표현 금지.

반드시 아래 JSON 형식으로만 응답하세요(설명·코드블록 없이 JSON만):
{
  "title": "제목",
  "intro": "인트로 1문단",
  "subheadings": ["소제목1", "소제목2", "소제목3"],
  "sampleSection": { "heading": "소제목1과 동일", "body": "짧은 예시 본문 2~3문장" }
}`;
}

interface RawSample {
  title?: unknown;
  intro?: unknown;
  subheadings?: unknown;
  sampleSection?: { heading?: unknown; body?: unknown };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 모든 출력 텍스트 필드에 금지어 2차 필터(autoFix)를 적용한다. */
function sanitize(text: string): string {
  return autoFix(text).fixed;
}

export interface GenerateResult {
  sample: FreeSample;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * 티저 샘플을 생성한다. Claude 호출 + JSON 파싱 + 의료광고법 2차 필터까지 수행.
 * 실패 시 예외를 던진다(호출부에서 처리).
 */
export async function generateFreeSample(input: GenerateInput): Promise<GenerateResult> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    // 티저 분량만 — 보수적 캡(전체 글 방지 + 비용 절감)
    max_tokens: 1024,
    system: SAMPLE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('샘플 생성에 실패했습니다.');
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('샘플 응답을 파싱할 수 없습니다.');
  }

  let raw: RawSample;
  try {
    raw = JSON.parse(jsonMatch[0]) as RawSample;
  } catch {
    throw new Error('샘플 응답 형식이 올바르지 않습니다.');
  }

  const subheadings = Array.isArray(raw.subheadings)
    ? raw.subheadings
        .map((s) => sanitize(asString(s)))
        .filter((s) => s.length > 0)
        .slice(0, 5)
    : [];

  const sample: FreeSample = {
    clinicName: input.clinicName,
    specialty: input.specialty,
    region: input.region,
    title: sanitize(asString(raw.title)),
    intro: sanitize(asString(raw.intro)),
    subheadings,
    sampleSection: {
      heading: sanitize(asString(raw.sampleSection?.heading)) || subheadings[0] || '',
      body: sanitize(asString(raw.sampleSection?.body)),
    },
  };

  if (!sample.title || !sample.intro || sample.subheadings.length === 0) {
    throw new Error('샘플 내용이 충분히 생성되지 않았습니다.');
  }

  return {
    sample,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}
