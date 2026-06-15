import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL, proofreadContent } from '@/content/lib/anthropic';
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT, checkCompliance, autoFix } from '@/content/lib/medical-compliance';
import { logUsage } from '@/dev/lib/usage-logger';
import { searchNaverBlogs, buildCompetitorInsightText } from '@/dev/lib/naver-search';
import { checkAndConsumeUsage, refundUsage } from '@/payment/lib/usage-guard';
import { buildGoogleContentSystemPrompt, buildGoogleContentUserPrompt } from '@/content/lib/google-prompts';
import type { TargetSite } from '@/types';

export const maxDuration = 300;

type TitleFormat = '질문형' | '정보형' | '가이드형' | '노하우형' | '숫자형' | string;

function buildFormatSpecificStructure(format: TitleFormat, keyword: string): string {
  switch (format) {
    case '질문형':
      return `【제목 형식: 질문형 — SEO 연관성 지침】
이 제목은 독자의 궁금증을 담은 질문 형태입니다.
- 첫 번째 소제목에서 제목의 질문에 직접 명확하게 답할 것 (검색 의도 즉시 충족)
- 이후 소제목은 답의 근거, 원인, 메커니즘을 의학적으로 설명
- 흐름: [질문에 대한 직접 답변] → [의학적 원인·메커니즘] → [증상·진단 기준] → [치료·관리 방법] → [예방·생활습관]`;
    case '가이드형':
      return `【제목 형식: 가이드형 — SEO 연관성 지침】
이 제목은 실용적인 방법·절차를 안내하는 형태입니다.
- 각 소제목이 구체적 행동 지침을 담을 것 (단계별 안내 형식)
- 의학적 권고 근거를 함께 제시하여 신뢰성 확보
- 흐름: [왜 이 가이드가 필요한가] → [단계별 핵심 행동] → [주의해야 할 상황] → [전문 치료가 필요한 시점] → [유지 관리 방법]`;
    case '숫자형':
      return `【제목 형식: 숫자형 — SEO 연관성 지침】
이 제목은 구체적 항목을 나열하는 형태입니다.
- 제목에서 약속한 숫자만큼의 핵심 항목을 본문에 명확히 담을 것
- 각 항목은 의학적 근거와 함께 구체적으로 서술
- 흐름: [개요·중요성] → [핵심 항목 1~N (각각 소제목)] → [종합 관리 방법]`;
    case '노하우형':
      return `【제목 형식: 노하우형 — SEO 연관성 지침】
이 제목은 전문가의 실전 지식을 전달하는 형태입니다.
- 임상 현장에서 얻은 전문 인사이트를 구체적으로 서술할 것
- 일반인이 잘 모르는 의학적 사실이나 오해 교정 포함
- 흐름: [흔한 오해·문제 상황] → [전문가 관점의 실제 원인] → [진단 핵심 포인트] → [효과적인 치료·관리 노하우] → [재발 방지 전략]`;
    case '정보형':
    default:
      return `【제목 형식: 정보형 — SEO 연관성 지침】
이 제목은 ${keyword}에 대한 포괄적 정보를 제공하는 형태입니다.
- 독자가 검색 후 더 찾아볼 필요 없을 정도로 종합적인 정보를 담을 것
- 정의 → 원인 → 증상 → 진단 → 치료 → 예방의 의학적 완결 구조로 작성
- 흐름: [정의·개념] → [발생 원인·위험 요소] → [주요 증상·진단] → [치료 방법] → [예방·관리]`;
  }
}

function buildWritingStylePrompt(style: string): string {
  switch (style) {
    case '고객이해':
      return `【글쓰기 시점: 고객이해시점】
당신은 환자가 쉽게 이해할 수 있도록 설명하는 친절한 의료진입니다.
- 전문용어를 최대한 피하고, 반드시 사용해야 할 경우 괄호 안에 쉬운 설명 추가
- 마치 상담실에서 환자에게 직접 이야기하듯 따뜻하고 편안한 문체
- 어려운 의학 개념은 일상 속 비유나 예시로 풀어서 설명
- "~하실 수 있습니다", "걱정하지 않으셔도 됩니다", "쉽게 말씀드리면" 같은 친근한 표현 사용
- 증상·원인·치료를 '환자 입장에서 궁금한 것' 순서로 서술`;
    case '사무장':
      return `【글쓰기 시점: 사무장시점】
당신은 병원 행정·운영을 총괄하는 경험 많은 사무장입니다.
- 병원 서비스와 진료 프로세스를 명확하고 신뢰감 있게 안내
- 내원 절차, 치료 과정, 비용 구조, 보험 적용 여부 등 실용적 정보 중심
- 환자가 '이 병원에서 어떻게 치료받는지'를 구체적으로 알 수 있도록 서술
- 병원의 전문성과 시설·장비를 자연스럽게 어필
- 단호하고 명확한 문체, 군더더기 없이 핵심 정보 전달`;
    default:
      return '';
  }
}

export async function POST(req: NextRequest) {
  let consumedUserId: string | null = null;
  try {
    const {
      title, keyword, hospitalType, additionalInfo, titleFormat,
      writingStyle = '전문가', region = '', hospitalName = '',
      optimizationMode = 'seo+geo', targetSite: rawTargetSite,
    } = await req.json();

    const isGeoMode = optimizationMode === 'seo+geo';
    // 게시 사이트 검증 — 미지정·잘못된 값은 'naver' 기본값 (하위 호환)
    const targetSite: TargetSite = rawTargetSite === 'google' ? 'google' : 'naver';
    const isGoogle = targetSite === 'google';

    if (!title || !keyword) {
      return NextResponse.json({ error: '제목과 키워드를 입력해주세요.' }, { status: 400 });
    }

    // 인증·플랜·사용량 체크 (원자적 1 증가 포함)
    const guard = await checkAndConsumeUsage();
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.message, reason: guard.reason },
        { status: guard.status }
      );
    }
    consumedUserId = guard.userId;

    // 경쟁 블로그 분석 — 실패해도 본문 생성은 계속 진행 (사용량 보호)
    let competitorResults: Awaited<ReturnType<typeof searchNaverBlogs>> = [];
    try {
      competitorResults = await searchNaverBlogs(keyword, 5);
    } catch {
      // 네이버 검색 실패는 선택적 기능이므로 무시하고 빈 배열로 대체
    }
    const competitorText = buildCompetitorInsightText(competitorResults);

    const format: TitleFormat = titleFormat || '정보형';
    const formatGuide = buildFormatSpecificStructure(format, keyword);
    const writingStyleGuide = buildWritingStylePrompt(writingStyle);

    const longtailKeywords = [
      `${keyword} 원인`,
      `${keyword} 증상`,
      `${keyword} 치료`,
      `${keyword} 관리`,
      `${keyword} 예방`,
    ];

    const subHeadingBlock = isGeoMode
      ? `- 각 주요 소제목(H2) 아래에 세부 소제목(H3)을 1~2개 작성할 것
  세부 소제목 형식: 반드시 ▶ 기호로 시작하는 독립 줄 (예: ▶ 디스크가 눌리는 정확한 위치)`
      : `- 세부 소제목(H3, ▶ 기호)은 선택사항 — 자연스러운 본문 흐름이 우선
  꼭 필요할 때만 사용 (없어도 OK)`;

    const geoBlock = isGeoMode ? `

【GEO 최적화 — 생성형 AI 인용 가능성 (단, 자연체 톤은 절대 유지)】
- H2 첫 문장만 "정의문/단정문" 형식으로 작성 — 자족 문장이어야 AI 검색엔진이 발췌 인용
  다만 한자어 남발 금지, 평이한 표현으로 풀어쓸 것
  좋은 예: "허리 디스크는 척추뼈 사이의 쿠션이 제자리에서 밀려나 신경을 누르는 상태입니다."
  나쁜 예: "추간판 탈출증은 디스크 수핵이 섬유륜을 뚫고 신경근을 압박하는 질환이다." (한자어 과다, 학술적)
  금지 도입: "이번에는 ○○에 대해 살펴보겠습니다" 류
- H2 첫 문장 이후 단락 본문은 위 "자연스러운 톤" 가이드 그대로 — 부드럽게 풀어 작성
- 통계·수치 1~2개 자연스럽게 녹임 (강박적 나열 금지, 꼭 필요한 곳에만)
- 권위 출처 표현 1~2회 부드럽게: "최근 학회 권고에서는", "임상 권고안에서는" — 직접 URL 금지
- 자족 문장은 H2 첫 문장 + FAQ 답변에 집중. 본문 단락은 자연체로` : '';

    const baseStyleBlock = `
【리듬·문장 구조 (모든 모드 공통)】
- 소제목은 검색자가 실제 궁금해할 법한 일상어·질문형 권장
- 주요 소제목 앞뒤 빈 줄로만 구분, 기호 없음
- 문장 시작 방식 매번 다르게 — "○○은", "○○이", "○○하면" 같은 패턴 반복 금지
- 짧은 문장(10자 이하) ~ 긴 문장 자유롭게 섞기, 가끔 도치·생략으로 리듬감
- 단락은 흐름 따라 1~5문장 유연하게 (정형화된 2~4 강제 X)
- 완벽한 구조보다 자연스러운 호흡이 우선`;

    const writingStyleLabel = writingStyle === '고객이해' ? '고객이해시점 (전문용어 없이 쉽게)' : writingStyle === '사무장' ? '사무장시점 (병원 서비스·프로세스 중심)' : '전문가시점 (의학적 전문성 강조)';

    // 게시 사이트 = 구글 분기용 파라미터 (네이버 프롬프트는 아래 리터럴 그대로 유지 — 품질 회귀 방지)
    const googlePromptParams = {
      title, keyword, hospitalType, additionalInfo,
      writingStyleGuide, writingStyleLabel, formatGuide, longtailKeywords,
      competitorText, region, hospitalName, isGeoMode,
    };

    const systemPrompt = isGoogle ? buildGoogleContentSystemPrompt(googlePromptParams) : `당신은 동네 단골 병원의 따뜻한 원장님입니다. 진료실에서 환자분과 마주 앉아 편하게 풀어 설명하듯이 글을 씁니다.
의학 지식은 정확하지만, 말투는 가까운 사람이 알려주듯 부드럽고 자연스럽습니다. 학술 논문이나 보고서가 아니라, 실제 사람이 직접 쓴 진솔한 블로그 글을 만듭니다.

${writingStyleGuide}

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}

【의학 정확성은 유지하되 톤은 부드럽게 — 모든 모드 공통】
- 정보는 정확해야 하지만, 한자어·임상 용어 남발 금지 — 일상어로 풀어 설명
  (예: "추간판 탈출증" → "허리 디스크가 빠져나오는 상태", 필요시 전문 용어를 괄호로 병기)
- 메커니즘 설명도 비유·사례로 친근하게: "마치 고무 호스가 안에서 부풀어 신경을 누르는 것처럼"
- 단정·결론적 문장 대신 환자가 들었을 때 안심되는 어투
- "이런 분들은 이런 패턴이더라" 같은 임상 관찰 1인칭이 자연스러움
- 독자가 "전문성 + 인간미"를 동시에 느낄 수 있어야 함

【사람이 직접 쓴 듯한 자연스러움 — 모든 모드 공통, 최우선】

✅ 좋은 도입 패턴 (실제 사람이 쓰는 식)
- "허리 한쪽이 아침마다 묵직하다고 오시는 분들이 꽤 많아요."
- "보톡스 맞으면 표정이 어색해질까봐 망설이시는 분들 정말 많죠."
- "사실 무릎이 시큰거리는 이유, 의외로 단순할 수 있습니다."
- "처음 진료실에 오셔서 이런 말씀하시는 분들이 종종 있어요."

❌ AI 티 나는 도입 (절대 쓰지 마세요)
- "이번에는 ○○에 대해 알아보겠습니다."
- "여러분, 안녕하세요. 오늘은 ○○에 대해 설명해드리는 시간을 가져보겠습니다."
- "○○○에 대해 자세히 살펴보면" / "꼼꼼히 들여다보면"

【구어체·구체성 활용 권장】
- 가끔 구어체 표현 OK: "근데", "그래서", "말이죠", "사실은", "솔직히"
- 1인칭 임상 관찰: "환자분들 보면", "진료실에서 자주 듣는 얘기인데", "제가 환자분들께 늘 강조하는 건"
- 환자 입장 공감 표현: "이게 진짜 답답하시죠", "걱정되시는 게 당연해요"

【피해야 할 AI 단골 패턴 — 반드시 차단】
- 자기참조: "이 글에서는", "본문에서 다룬", "위에서 살펴본 바와 같이"
- 마무리 인사: "마지막으로", "끝으로", "정리하면", "마무리하며"
- 결론 강조: "결론적으로", "요약하자면", "한 마디로", "핵심은"
- 강의 톤: "알려드리겠습니다", "설명해드리는 시간", "함께 살펴보겠습니다"
- 과한 형용사: "올바른", "효과적인", "체계적인", "철저한", "꼼꼼한" (남발 금지, 1편당 2회 미만)
- 정형 문구: "도움이 될 수 있습니다" 남발, "건강한 일상을 위해" 류
- 답답한 hedging: "~할 수 있습니다" 연속 3문장 이상 금지

【실제 자연스러운 단락 예시 — 이 정도 톤으로】
"무릎이 갑자기 아프다고 오시는 분들 중에는 사실 활동량이 갑자기 늘어난 분들이 많습니다. 한동안 안 걷다가 등산을 시작하셨다거나, 갑자기 운동을 빡세게 하신 경우죠. 이럴 때 무릎 안쪽이 시큰거리는 게 가장 흔합니다.

진료실에서 보면 처음엔 그냥 무리해서 그런 거 아닐까 하고 넘기시는 분들이 많은데, 며칠 쉬어도 통증이 안 가시면 그땐 한 번 봐드리는 게 좋아요. 단순한 근육통이 아니라 연골에 부담이 갔을 수 있거든요."

이 정도의 부드러움·구체성·1인칭 관찰을 모든 단락에 녹이세요.

【네이버 SEO 구조 규칙 — 핵심】
- 선택된 제목이 약속하는 내용을 본문에서 반드시 충족할 것
- 제목 형식(질문형/가이드형 등)에 맞는 본문 구조를 사용할 것
- 첫 번째 단락 첫 문장에 핵심 키워드 반드시 포함 (D.I.A+ 첫 200자 가산점)
- 주요 소제목(H2) 중 절반 이상에 핵심 키워드 또는 연관어 포함

【키워드는 자연스러움이 최우선 — 비문 절대 금지】
- 키워드는 문장이 자연스러운 곳에만 넣어라. 문법이 어색해지면 키워드를 빼라. 억지로 끼워 넣어 비문이 되느니 키워드를 생략하는 편이 낫다.
- 키워드를 명사구에 억지로 결합하지 마라. 같은 키워드를 기계적으로 반복하지 말고, 동의어·연관어·대명사·생략으로 자연스럽게 변주하라.
- 핵심 키워드는 본문 전체에서 4~6회면 충분하다. 그 이상 도배하지 마라.

❌ 이렇게 쓰지 마라 (실제로 발생한 비문 — 절대 재현 금지)
- "보톡스의 원인이 되는 구조적 특성" ← 보톡스가 원인이 아님, 의미가 붕괴된 키워드 억지 결합
- "보톡스 증상 반응이 평소보다 과하게" ← 의미 불명의 키워드 명사구 강제 결합
- "보톡스 예방" 을 문맥 없이 반복 ← 키워드 도배
→ 위처럼 키워드를 조사·명사구에 강제로 붙여 의미가 무너지면, 차라리 키워드를 빼고 자연스러운 문장으로 써라.
${subHeadingBlock}
${geoBlock}

【절대 금지 - 서식 규칙】
- #, ##, ###, **텍스트**, *텍스트*, ---, ***, ~~~, == 등 마크다운 기호 절대 사용 금지
- 볼드, 이탤릭 서식 기호 절대 사용 금지
- 목록 기호(-, *, •, 1.) 절대 사용 금지
- 이모지 사용 금지 (▶ 기호만 세부 소제목에 허용)
${baseStyleBlock}`;

    const competitorSection = competitorText
      ? `\n【경쟁 블로그 분석 — 검색 의도 파악 후 차별화 필수】\n현재 네이버에서 "${keyword}"으로 상위 노출된 블로그들이 다루는 주제:\n${competitorText}\n→ 위 경쟁 글들이 공통으로 다루는 핵심 주제는 반드시 포함하되, 의학적 깊이와 구체성으로 차별화하세요.\n→ 경쟁 글에서 빠진 관점이나 더 구체적인 정보를 발굴하여 독자에게 추가 가치를 제공하세요.\n`
      : '';

    const regionSection = region
      ? `\n【지역 SEO — 자연스럽게 2~3회 삽입】\n대상 지역: ${region}\n예시: "${region} 환자분들의 경우", "${region} 인근에서", "${region}에 위치한 병원에서는"\n소제목에 지역명 포함 금지 (부자연스러움). 본문 단락 안에만 자연스럽게 삽입.\n`
      : '';

    const hospitalSection = hospitalName
      ? `\n【병원 개인화 — 최대 1회 자연스럽게】\n병원명: ${hospitalName}\n"저희 병원에서는" 또는 "내원하시면" 형태로 최대 1회만 언급. 직접 홍보 광고 느낌 금지.\n`
      : '';

    const summaryAndFaqSection = isGeoMode ? `

【필수 부가 섹션 1 — 핵심 요약 박스 (TL;DR)】
첫 번째 단락 직후, 첫 H2 시작 전에 아래 형식으로 정확히 삽입:

[핵심 요약]
${keyword}의 핵심 정의 또는 가장 중요한 사실 1줄 (자족 문장)
가장 중요한 증상·원인·진단 기준 중 하나 1줄 (수치 포함 권장)
치료·관리의 핵심 권고 1줄 (구체적 행동 지침)
[/핵심 요약]

규칙:
- 정확히 [핵심 요약] 으로 시작, [/핵심 요약] 으로 종료
- 정확히 3줄, 각 줄은 독립된 자족 문장 (불릿/번호/기호 사용 금지)
- 각 줄은 50자 이내
- 박스 앞뒤로 빈 줄

【필수 부가 섹션 2 — 자주 묻는 질문 (FAQ)】
본문 마지막 문장 ("개인마다 차이가...") 직후에 아래 형식으로 정확히 삽입:

[자주 묻는 질문]
Q1. (실제 환자가 검색할 법한 구체적 질문 1, ${keyword} 관련)
A1. (의학적으로 정확한 답변 2~3문장, 자족 문장 위주, 수치 포함 권장)

Q2. (질문 2 — Q1과 다른 관점, 예: 치료/비용/일상생활/예방)
A2. (답변 2~3문장)

Q3. (질문 3 — 임상 현장에서 자주 받는 질문)
A3. (답변 2~3문장)
[/자주 묻는 질문]

규칙:
- 정확히 [자주 묻는 질문] 으로 시작, [/자주 묻는 질문] 으로 종료
- Q1./A1./Q2./A2./Q3./A3. 형식 그대로 사용
- 각 답변은 인용 가능한 자족 문장 (앞뒤 맥락 없어도 의미 전달)
- AI 검색엔진이 그대로 인용할 수 있도록 명확하고 단정적으로 서술` : `

【부가 섹션 — 사용 안 함】
- 핵심 요약 박스([핵심 요약]) 작성하지 말 것
- FAQ 섹션([자주 묻는 질문]) 작성하지 말 것
- 본문이 자연스럽게 흐르도록 작성 — 박스/구조화된 양식은 AI티가 나므로 제외`;

    const lengthHint = isGeoMode ? '1,500~1,800자 (공백 포함, 요약 박스 + FAQ 제외)' : '1,500~1,800자 (공백 포함, 본문만)';

    const userPrompt = isGoogle ? buildGoogleContentUserPrompt(googlePromptParams) : `아래 제목으로 네이버 블로그 본문을 작성해주세요. [글쓰기 시점: ${writingStyleLabel}]

제목: "${title}"
핵심 키워드: "${keyword}"
연관 롱테일 키워드 (본문 전체에 자연스럽게 분산 포함): ${longtailKeywords.join(', ')}
병원 유형: ${hospitalType || '일반 병원'}
추가 정보: ${additionalInfo || '없음'}
${competitorSection}${regionSection}${hospitalSection}
${formatGuide}

【네이버 SEO 키워드 배치 — 자연스러움 우선, 비문 금지】
- 첫 번째 단락의 첫 문장에 "${keyword}" 포함 (D.I.A+ 가산점) — 단 문장이 자연스러워야 함
- 주요 소제목(H2) 중 2개 이상에 "${keyword}" 또는 연관 롱테일 키워드 포함
- 연관 롱테일 키워드(${longtailKeywords.join(', ')})를 각각 자연스러운 위치에 분산 배치
- ⚠️ 키워드를 억지로 끼워 넣어 문장이 어색해지면 키워드를 빼라. 동의어·대명사·생략으로 변주.
  "키워드+의 원인이 되는", "키워드 증상 반응" 같은 의미가 붕괴된 결합 절대 금지.

【소제목 계층 구조 — 반드시 준수】
- 주요 소제목(H2): 4~5개, 기호 없이 독립 줄 (앞뒤 빈 줄)
- 세부 소제목(H3): 각 H2 아래 1~2개, 반드시 ▶ 기호로 시작 (예: ▶ 진단 방법과 검사 종류)
- H3는 H2보다 짧고 구체적인 주제 (15~25자)

【전문성 작성 기준】
- 의학적 원인을 해부학적·생리학적으로 설명 (단순 나열 금지)
- 진단 기준 또는 증상 판별 기준을 구체적으로 서술
- 치료 방법은 보존적 → 비수술적 → 수술적 순서로 단계 안내
- 예방·관리는 임상 근거가 있는 구체적 행동 지침으로 제시

【작성 조건】
- 본문 분량: ${lengthHint}
- 의료광고법 준수 (완치, 최고, 100% 등 표현 금지)
- 핵심 키워드 "${keyword}"는 4~6회 정도, 오직 자연스러운 위치에만 (어색하면 빼고 동의어·대명사로 변주 — 도배·억지 결합 금지)
- 각 소제목 아래 단락 2~3개 (2~4문장씩)
- 이미지 위치는 [이미지 N: 설명] 형식으로 소제목 아래 표시 (총 5~6개)
- 본문 마지막 문장: "개인마다 차이가 있을 수 있으니, 전문의와 상담 후 결정하시길 권해드립니다."

【이미지 설명 작성 규칙 — 시술 특이성 강화】
[이미지 N: 설명] 의 설명 부분은 단순 "관련 사진"이 아닌, 키워드 "${keyword}"가 시각적으로 명확히 드러나는 구체 묘사로 작성:

- 장면을 구체적으로: 시술 단계(준비/시술중/직후), 사용 도구, 시술 부위, 의료진 동작, 환자 표정·자세 중 최소 2가지 명시
- 시각 단서를 구체적으로: 어떤 도구가 보이는지(예: 미세주사기, 메소건, 레이저 핸드피스), 시술 부위는 어디인지(예: 미간, 광대, 무릎 슬개골)
- 5~6장 모두 다른 각도·단계: 클로즈업 / 미디엄샷 / 시술 도구 단독 / 의료진과 환자 상호작용 / 시술 환경 / 진료 상담 등으로 분산 (같은 구도 반복 금지)
- 한 줄당 30~50자, 길지 않게

🚨 의료광고법(의료법 제56조) — 절대 금지:
- 시술 전후 비교, before-after, "전 vs 후", split frame, side-by-side 표현 일절 금지
- 효과 보장·과장 표현 금지 ("기적", "완벽한", "100%", "완전히 깨끗한" 등)
- 수치 결과 암시 금지 ("70% 개선", "주름 90% 감소" 등)
- 실제 환자 후기 형식 금지

좋은 예시 (키워드: 보톡스):
[이미지 1: 환자 미간에 마킹된 주사 포인트와 의료진의 미세 주사기 클로즈업]
[이미지 2: 시술 직후 환자가 거울로 시술 부위를 확인하는 모습]
[이미지 3: 사전 상담 중 의료진이 보톡스 적용 부위를 그림으로 설명]

좋은 예시 (키워드: 물광):
[이미지 1: 메소건이 광대 부위에 닿기 직전 클로즈업, 작은 주사 자국]
[이미지 2: 의료진이 메소건 디바이스를 점검하는 손 클로즈업]
[이미지 3: 시술 의자에 앉아 차분히 시술을 받는 환자 모습]

나쁜 예시 (피해야 함):
[이미지 2: 보톡스 시술 전후 미간 주름 비교 split frame] — 의료법 위반
[이미지 3: 시술 전 건조한 피부 vs 시술 후 글로우 split frame] — 의료법 위반
[이미지 1: 보톡스 관련 의료 장면] — 추상적, 키워드 특이성 없음${summaryAndFaqSection}

【절대 쓰지 말 것】
- "먼저", "또한", "따라서", "이처럼", "정리하자면", "중요한 것은", "결론적으로" 같은 AI 티 나는 표현
- # ## ** * - 등 마크다운 기호 (▶ 제외)
- 모든 단락을 같은 방식으로 시작하는 것
- 막연하고 추상적인 표현 ("도움이 될 수 있습니다" 남발 금지 — 구체적 내용으로 대체)

본문만 작성 (제목 제외).`;

    const anthropic = getAnthropicClient();

    const createMessage = () => anthropic.messages.create({
      model: MODEL,
      max_tokens: 6144,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let response;
    try {
      response = await createMessage();
    } catch (firstErr) {
      const isServerError = firstErr instanceof Error &&
        (firstErr.message.includes('Internal server error') || firstErr.message.includes('529') || firstErr.message.includes('500'));
      if (isServerError) {
        await new Promise((r) => setTimeout(r, 2000));
        response = await createMessage();
      } else {
        throw firstErr;
      }
    }

    const textContent = response.content.find((b) => b.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      if (consumedUserId) await refundUsage(consumedUserId);
      return NextResponse.json({ error: '본문 생성에 실패했습니다.' }, { status: 500 });
    }

    const rawBody = textContent.text;
    // 마크다운 기호 제거 (AI 감지 방지)
    const mdCleaned = rawBody
      .replace(/^#{1,6}\s+/gm, '')           // # ## ### 헤더
      .replace(/\*\*(.+?)\*\*/gs, '$1')      // **볼드** (멀티라인 포함)
      .replace(/__(.+?)__/gs, '$1')          // __볼드__
      .replace(/\*(.+?)\*/gs, '$1')          // *이탤릭*
      .replace(/_(.+?)_/gs, '$1')            // _이탤릭_
      .replace(/~~(.+?)~~/gs, '$1')          // ~~취소선~~
      .replace(/^[-*]{3,}\s*$/gm, '')        // --- *** 구분선
      .replace(/^[\s]*[-*+]\s+/gm, '')       // 목록 기호 (- * +)
      .replace(/^\d+\.\s+/gm, '')            // 번호 목록 (1. 2.)
      .replace(/\*\*/g, '')                  // 남은 ** 모두 제거
      .replace(/(?<!\[이미지[^\]]*)-{2,}/g, '') // 남은 -- --- 제거 (이미지 태그 제외)
      .replace(/\n{3,}/g, '\n\n')            // 3줄 이상 빈줄 → 2줄로
      .trim();

    // 의료광고법 금지어 자동 교체 — Claude가 생성했더라도 100% 필터링
    const { fixed: cleanedBody, replaced: autoReplaced } = autoFix(mdCleaned);

    // 교정(프루프리드) 패스 — 비문·오타·글리치·억지 키워드만 정리. 실패 시 원본 유지(graceful).
    // 의료광고법 금지어가 다시 들어올 일은 없도록 교정 후 autoFix 한 번 더 적용.
    const proofread = await proofreadContent(cleanedBody);
    const { fixed: body } = proofread === cleanedBody ? { fixed: cleanedBody } : autoFix(proofread);

    const bodyForCount = body.replace(/\[이미지\s*\d+:[^\]]*\]/g, '');
    const charCount = bodyForCount.length;
    const compliance = checkCompliance(body);

    // SEO 분석은 본문 영역만 (TL;DR, FAQ 블록 제외)
    const bodyForSeo = body
      .replace(/\[핵심 요약\][\s\S]+?\[\/핵심 요약\]/g, '')
      .replace(/\[자주 묻는 질문\][\s\S]+?\[\/자주 묻는 질문\]/g, '');
    // H2: 앞뒤 빈 줄로 둘러싸인 단독 줄 (15~45자, ▶ 시작 아님)
    const h2Matches = bodyForSeo.match(/(?:^|\n\n)([^\n▶][^\n]{14,44})(?:\n\n|$)/g) || [];
    const h2Count = h2Matches.length;
    // H3: ▶ 로 시작하는 줄
    const h3Matches = bodyForSeo.match(/^▶.+/gm) || [];
    const h3Count = h3Matches.length;
    const keywordCount = (body.toLowerCase().split(keyword.toLowerCase()).length - 1);
    // 첫 200자 키워드 포함 여부
    const firstParaKeyword = body.slice(0, 200).toLowerCase().includes(keyword.toLowerCase());
    // 소제목 내 키워드 포함 수
    const subheadingWithKeyword = h2Matches.filter(m => m.toLowerCase().includes(keyword.toLowerCase())).length;
    // 롱테일 키워드 커버리지
    const longtailCoverage = longtailKeywords.filter(lk => body.includes(lk)).length;
    const estimatedReadingTime = Math.ceil(charCount / 500);
    const structureScore = Math.min(100,
      h2Count * 10 +
      h3Count * 5 +
      (keywordCount >= 4 && keywordCount <= 6 ? 20 : 10) +
      (firstParaKeyword ? 10 : 0) +
      (subheadingWithKeyword >= 2 ? 10 : 5) +
      Math.min(longtailCoverage * 3, 15)
    );

    // GEO 분석 — 생성형 AI 인용 가능성 측정
    const hasSummaryBox = /\[핵심 요약\][\s\S]+?\[\/핵심 요약\]/.test(body);
    const faqBlockMatch = body.match(/\[자주 묻는 질문\]([\s\S]+?)\[\/자주 묻는 질문\]/);
    const hasFaqSection = !!faqBlockMatch;
    const faqCount = faqBlockMatch
      ? (faqBlockMatch[1].match(/^Q\d+\./gm) || []).length
      : 0;
    // 단정문: "~이다", "~한다", "~된다", "~있다" 등 단정형 어미로 끝나는 문장
    const definitiveStatementCount = (body.match(/[가-힣]+(?:이다|한다|된다|있다|없다|아니다)\.(?:\s|$)/g) || []).length;
    // 수치 데이터: 숫자 + 단위(%, 일, 주, 개월, 년, 회, 명, 배 등)
    const numericalDataCount = (body.match(/\d+(?:\.\d+)?\s*(?:%|일|주|개월|달|년|회|차|명|배|건|시간|분|초|cm|mm|kg|mg|ml)/g) || []).length;
    // 권위 출처 시그널
    const authoritySignals = [
      '학회', '가이드라인', '권고안', '권고', '보건복지부',
      '식품의약품안전처', '식약처', '질병관리청', '임상 연구',
      '임상연구', '논문', '연구 결과', '연구결과', '의학적으로', '임상적으로',
    ];
    const authoritySignalCount = authoritySignals.reduce(
      (sum, sig) => sum + (body.split(sig).length - 1),
      0
    );
    const geoScore = Math.min(100,
      (hasSummaryBox ? 25 : 0) +
      (hasFaqSection ? 25 : 0) +
      Math.min(faqCount * 5, 15) +
      Math.min(definitiveStatementCount * 2, 15) +
      Math.min(numericalDataCount * 2, 10) +
      Math.min(authoritySignalCount * 2, 10)
    );

    // 이미지 가이드라인
    const imageMatches = body.match(/\[이미지\s*\d+:\s*([^\]]+)\]/g) || [];
    const placementHints = imageMatches.map((m, i) => ({
      section: `이미지 ${i + 1}`,
      description: m.replace(/\[이미지\s*\d+:\s*/, '').replace(']', '').trim(),
    }));

    logUsage({
      feature: 'generate-content',
      api_provider: 'anthropic',
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      user_id: guard.userId,
      user_agent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({
      title,
      body,
      charCount,
      compliance,
      autoReplaced: autoReplaced.length > 0 ? autoReplaced : undefined,
      imageGuidelines: {
        recommendedCount: Math.max(6, placementHints.length),
        placementHints,
        altTextSuggestions: [keyword, `${keyword} 치료`, `${hospitalType} ${keyword}`, `${keyword} 증상`, `${keyword} 방법`, `${keyword} 관리`],
      },
      seoAnalysis: {
        keywordCount,
        h2Count,
        h3Count,
        estimatedReadingTime,
        structureScore,
        firstParaKeyword,
        subheadingWithKeyword,
        longtailCoverage,
        longtailTotal: longtailKeywords.length,
      },
      geoAnalysis: {
        hasSummaryBox,
        hasFaqSection,
        faqCount,
        definitiveStatementCount,
        numericalDataCount,
        authoritySignalCount,
        geoScore,
      },
    });
  } catch (error) {
    console.error('본문 생성 오류:', error);
    if (consumedUserId) await refundUsage(consumedUserId);
    const raw = error instanceof Error ? error.message : '';
    const userMessage = raw.includes('Internal server error') || raw.includes('500') || raw.includes('529')
      ? 'AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.'
      : raw.includes('rate_limit') || raw.includes('429')
        ? '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
        : '본문 생성에 실패했습니다. 다시 시도해주세요.';
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
