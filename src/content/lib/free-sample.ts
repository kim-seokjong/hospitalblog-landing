import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT, autoFix } from '@/content/lib/medical-compliance';

/**
 * 가입 전 무료 맞춤 샘플(전체 글).
 *
 * 과거에는 "티저(맛보기)"만 보여줬으나, 이제는 발행 가능한 수준의
 * 완성된 블로그 글 전체(제목 + 인트로 + 소제목 4~6개 각각 충실한 본문 + 마무리)를
 * 비로그인 누구에게나 보여준다. 전환 유인은 글 자체가 아니라 발행·이미지·
 * 멀티채널·무제한·수정 등 "가입 후 기능"으로 유지한다.
 *
 * `version: 2`는 캐시 호환성 키다 — 과거 티저 모양 캐시(version 없음/sections 없음)와
 * 구분해 호출부가 재생성 여부를 판단한다.
 */
export const FREE_SAMPLE_VERSION = 2 as const;

export interface FreeSampleSection {
  heading: string;
  body: string;
}

export interface FreeSample {
  version: typeof FREE_SAMPLE_VERSION;
  clinicName: string;
  specialty: string;
  region: string;
  title: string;
  intro: string;
  sections: FreeSampleSection[];
  closing: string;
}

/**
 * 임의의 캐시 값이 "전체 글(version 2)" 형태인지 검사한다.
 * 과거 티저 캐시(sections 없음 / version 없음)는 false → 호출부에서 재생성.
 */
export function isFullSample(value: unknown): value is FreeSample {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === FREE_SAMPLE_VERSION &&
    typeof v.title === 'string' &&
    typeof v.intro === 'string' &&
    typeof v.closing === 'string' &&
    Array.isArray(v.sections) &&
    v.sections.length > 0
  );
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

/**
 * 전체 글 생성 시스템 프롬프트.
 *
 * 운영 본문 생성기(/api/generate-content)의 "동네 단골 병원 원장님" 자연체 톤과
 * 의료광고법 준수 규칙을 그대로 가져와, 키워드/제목 입력 없이 병원 유형·지역만으로
 * 발행 가능한 완성 글을 만들도록 적응시킨 버전이다.
 */
const FULL_SAMPLE_SYSTEM_PROMPT = `당신은 동네 단골 병원의 따뜻한 원장님입니다. 진료실에서 환자분과 마주 앉아 편하게 풀어 설명하듯이 블로그 글을 씁니다.
의학 지식은 정확하지만, 말투는 가까운 사람이 알려주듯 부드럽고 자연스럽습니다. 학술 논문이나 보고서가 아니라, 실제 사람이 직접 쓴 진솔한 블로그 글을 만듭니다.

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}

【이 작업의 목적 — 매우 중요】
- 이것은 잠재 고객(병원)에게 보여줄 "완성된 실제 블로그 글" 전체입니다. 티저가 아니라 그대로 발행해도 될 수준으로 끝까지 충실히 작성합니다.
- 해당 병원의 진료과목·지역에 맞는, 환자에게 정말 유용한 정보성 글이어야 합니다.
- 특정 시술 가격·이벤트·전후사진·환자 후기·개인 사례는 절대 넣지 않습니다.

【의학 정확성은 유지하되 톤은 부드럽게】
- 정보는 정확해야 하지만 한자어·임상 용어 남발 금지 — 일상어로 풀어 설명(필요 시 괄호로 전문 용어 병기)
- 메커니즘 설명도 비유로 친근하게: "마치 고무 호스가 안에서 부풀어 신경을 누르는 것처럼"
- "이런 분들은 이런 패턴이더라" 같은 일반화된 1인칭 임상 관찰이 자연스러움
- 독자가 "전문성 + 인간미"를 동시에 느끼게

【사람이 직접 쓴 듯한 자연스러움 — 최우선】
✅ 좋은 도입: "허리 한쪽이 아침마다 묵직하다고 오시는 분들이 꽤 많아요."
❌ AI 티 나는 도입(절대 금지): "이번에는 ○○에 대해 알아보겠습니다", "여러분 안녕하세요, 오늘은…"
- 자기참조("이 글에서는", "위에서 살펴본"), 마무리 인사("끝으로", "정리하면"), 강의 톤("알려드리겠습니다") 금지
- "먼저/또한/따라서/이처럼/결론적으로" 같은 접속 상투어 금지
- 과한 형용사("올바른·효과적인·철저한") 남발 금지, "도움이 될 수 있습니다" 남발 금지
- 문장 시작을 매번 다르게, 짧은 문장과 긴 문장을 섞어 사람의 호흡으로

【절대 금지 — 서식 규칙】
- #, ##, ** **, * *, ---, 목록 기호(-, *, •, 1.), 이모지 등 마크다운/특수 서식 일절 사용 금지
- 본문(body)은 순수한 줄글로만 작성(소제목은 heading 필드로 분리되어 들어감)`;

function buildUserPrompt({ clinicName, specialty, region }: GenerateInput): string {
  const specialtyHint = specialty ? `진료과목: ${specialty}` : '진료과목: (일반 병원)';
  const regionHint = region ? `지역: ${region}` : '';
  const regionRule = region
    ? `- 지역명("${region}")을 본문 단락 안에 자연스럽게 1~2회만 녹입니다(소제목에는 넣지 않음).`
    : '';
  return `다음 병원의 환자용 정보성 블로그 글 "전체"를 완성해 주세요.

병원명: ${clinicName}
${specialtyHint}
${regionHint}

작성 요구사항:
- 제목 1개: 25~38자, 검색 의도가 분명한 정보형/가이드형. 과장·최상급 금지.
- 인트로: 2~3문장. 독자의 공감을 여는 자연스러운 도입(AI 티 나는 도입 금지).
- 소제목(섹션) 4~6개: 각 소제목은 12~25자. 각 섹션 본문은 충실하게 3~5문장(2개 단락 권장)으로, 원인·증상·진단·치료·관리·예방 흐름이 자연스럽게 이어지도록.
- 진료과목에 맞는 흔한 증상/관리 주제를 스스로 정해 일관성 있게 작성(특정 시술 홍보가 아니라 정보 제공).
${regionRule}
- 마무리(closing): 1~2문장. 반드시 "개인마다 차이가 있을 수 있으니, 전문의와 상담 후 결정하시길 권해드립니다." 문장을 포함.
- 의료광고법 완전 준수: 100%·완치·최고·1위·부작용 없음·전후 비교·효과 단정·수치 보장 표현 절대 금지.

반드시 아래 JSON 형식으로만 응답하세요(설명·코드블록 없이 JSON만, 모든 본문은 줄글):
{
  "title": "제목",
  "intro": "인트로 2~3문장",
  "sections": [
    { "heading": "소제목1", "body": "충실한 본문 3~5문장" },
    { "heading": "소제목2", "body": "충실한 본문 3~5문장" }
  ],
  "closing": "마무리 1~2문장(전문의 상담 권고 포함)"
}`;
}

interface RawSection {
  heading?: unknown;
  body?: unknown;
}

interface RawSample {
  title?: unknown;
  intro?: unknown;
  sections?: unknown;
  closing?: unknown;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 모델이 실수로 넣을 수 있는 마크다운/특수 서식을 제거한다(줄글 보장).
 * 운영 본문 생성기의 정리 규칙을 본문 필드용으로 가볍게 적용.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/_(.+?)_/gs, '$1')
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 모든 출력 텍스트 필드에 금지어 2차 필터(autoFix) + 서식 제거를 적용한다. */
function sanitize(text: string): string {
  return autoFix(stripMarkdown(text)).fixed;
}

export interface GenerateResult {
  sample: FreeSample;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * 전체 글 샘플을 생성한다. Claude 호출 + JSON 파싱 + 의료광고법 2차 필터까지 수행.
 * 실패 시 예외를 던진다(호출부에서 처리).
 */
export async function generateFreeSample(input: GenerateInput): Promise<GenerateResult> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    // 전체 글 분량 — 발행 가능한 완성 글(제목+인트로+4~6섹션+마무리)
    max_tokens: 4000,
    system: FULL_SAMPLE_SYSTEM_PROMPT,
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

  const sections: FreeSampleSection[] = Array.isArray(raw.sections)
    ? (raw.sections as RawSection[])
        .map((s) => ({
          heading: sanitize(asString(s?.heading)),
          body: sanitize(asString(s?.body)),
        }))
        .filter((s) => s.heading.length > 0 && s.body.length > 0)
        .slice(0, 6)
    : [];

  const sample: FreeSample = {
    version: FREE_SAMPLE_VERSION,
    clinicName: input.clinicName,
    specialty: input.specialty,
    region: input.region,
    title: sanitize(asString(raw.title)),
    intro: sanitize(asString(raw.intro)),
    sections,
    closing: sanitize(asString(raw.closing)),
  };

  if (!sample.title || !sample.intro || sample.sections.length < 3) {
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
