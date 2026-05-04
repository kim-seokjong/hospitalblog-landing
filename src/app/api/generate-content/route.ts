import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';
import { MEDICAL_COMPLIANCE_SYSTEM_PROMPT, checkCompliance, autoFix } from '@/lib/medical-compliance';
import { logUsage } from '@/lib/usage-logger';
import { searchNaverBlogs, buildCompetitorInsightText } from '@/lib/naver-search';

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
  try {
    const {
      title, keyword, hospitalType, additionalInfo, titleFormat,
      writingStyle = '전문가', region = '', hospitalName = '',
    } = await req.json();

    if (!title || !keyword) {
      return NextResponse.json({ error: '제목과 키워드를 입력해주세요.' }, { status: 400 });
    }

    // 경쟁 블로그 분석 (병렬 실행)
    const [competitorResults] = await Promise.all([
      searchNaverBlogs(keyword, 5),
    ]);
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

    const systemPrompt = `당신은 해당 진료과에서 10년 이상 임상 경험을 가진 전문의이자 의학 콘텐츠 전문 작가입니다.
환자들이 실제로 궁금해하는 내용을 의학적으로 정확하면서도 이해하기 쉽게 설명합니다.

${writingStyleGuide}

${MEDICAL_COMPLIANCE_SYSTEM_PROMPT}

【E-E-A-T 전문성 기준 — 반드시 충족할 것】
- 의학적 메커니즘을 구체적으로 설명 (예: "디스크 수핵이 섬유륜을 압박하면서" 같은 임상적 설명)
- 증상·진단 기준을 임상적으로 명확히 서술 (막연한 표현 금지)
- 치료 방법은 보존적 치료부터 수술적 치료까지 단계적으로 안내
- 생활 지도 내용은 의학적 근거를 바탕으로 구체적으로 제시
- 독자가 읽고 나서 "이 글을 쓴 사람은 이 분야 전문가구나"라고 느낄 수 있어야 함

【네이버 SEO 구조 규칙 — 핵심】
- 선택된 제목이 약속하는 내용을 본문에서 반드시 충족할 것
- 제목 형식(질문형/가이드형 등)에 맞는 본문 구조를 사용할 것
- 첫 번째 단락 첫 문장에 핵심 키워드 반드시 포함 (D.I.A+ 첫 200자 가산점)
- 주요 소제목(H2) 중 절반 이상에 핵심 키워드 또는 연관어 포함
- 각 주요 소제목(H2) 아래에 세부 소제목(H3)을 1~2개 작성할 것
  세부 소제목 형식: 반드시 ▶ 기호로 시작하는 독립 줄 (예: ▶ 디스크가 눌리는 정확한 위치)

【절대 금지 - 서식 규칙】
- #, ##, ###, **텍스트**, *텍스트*, ---, ***, ~~~, == 등 마크다운 기호 절대 사용 금지
- 볼드, 이탤릭 서식 기호 절대 사용 금지
- 목록 기호(-, *, •, 1.) 절대 사용 금지
- 이모지 사용 금지 (▶ 기호만 세부 소제목에 허용)
- AI가 쓴 것처럼 보이는 표현 금지: "먼저", "또한", "따라서", "이처럼", "정리하자면", "중요한 것은", "핵심은", "결론적으로"

【자연스러운 글쓰기 원칙】
- 소제목은 검색하는 사람 입장에서 궁금할 법한 말투로
- 주요 소제목 앞뒤 빈 줄로만 구분, 기호 없음
- 문장마다 시작 방식을 다르게 (같은 패턴 반복 금지)
- 짧은 문장과 긴 문장을 불규칙하게 섞기
- 전문적이지만 어렵지 않은 표현 사용 (환자가 이해할 수 있는 수준)
- 단락은 2~4문장으로 자연스럽게 끊기`;

    const writingStyleLabel = writingStyle === '고객이해' ? '고객이해시점 (전문용어 없이 쉽게)' : writingStyle === '사무장' ? '사무장시점 (병원 서비스·프로세스 중심)' : '전문가시점 (의학적 전문성 강조)';

    const competitorSection = competitorText
      ? `\n【경쟁 블로그 분석 — 검색 의도 파악 후 차별화 필수】\n현재 네이버에서 "${keyword}"으로 상위 노출된 블로그들이 다루는 주제:\n${competitorText}\n→ 위 경쟁 글들이 공통으로 다루는 핵심 주제는 반드시 포함하되, 의학적 깊이와 구체성으로 차별화하세요.\n→ 경쟁 글에서 빠진 관점이나 더 구체적인 정보를 발굴하여 독자에게 추가 가치를 제공하세요.\n`
      : '';

    const regionSection = region
      ? `\n【지역 SEO — 자연스럽게 2~3회 삽입】\n대상 지역: ${region}\n예시: "${region} 환자분들의 경우", "${region} 인근에서", "${region}에 위치한 병원에서는"\n소제목에 지역명 포함 금지 (부자연스러움). 본문 단락 안에만 자연스럽게 삽입.\n`
      : '';

    const hospitalSection = hospitalName
      ? `\n【병원 개인화 — 최대 1회 자연스럽게】\n병원명: ${hospitalName}\n"저희 병원에서는" 또는 "내원하시면" 형태로 최대 1회만 언급. 직접 홍보 광고 느낌 금지.\n`
      : '';

    const userPrompt = `아래 제목으로 네이버 블로그 본문을 작성해주세요. [글쓰기 시점: ${writingStyleLabel}]

제목: "${title}"
핵심 키워드: "${keyword}"
연관 롱테일 키워드 (본문 전체에 자연스럽게 분산 포함): ${longtailKeywords.join(', ')}
병원 유형: ${hospitalType || '일반 병원'}
추가 정보: ${additionalInfo || '없음'}
${competitorSection}${regionSection}${hospitalSection}
${formatGuide}

【네이버 SEO 키워드 배치 — 반드시 준수】
- 첫 번째 단락의 첫 문장에 "${keyword}" 반드시 포함 (D.I.A+ 가산점)
- 주요 소제목(H2) 중 2개 이상에 "${keyword}" 또는 연관 롱테일 키워드 포함
- 연관 롱테일 키워드(${longtailKeywords.join(', ')})를 각각 자연스러운 위치에 분산 배치

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
- 총 1,500~1,800자 (공백 포함)
- 의료광고법 준수 (완치, 최고, 100% 등 표현 금지)
- 핵심 키워드 "${keyword}" 4~6회 자연스럽게 포함
- 각 소제목 아래 단락 2~3개 (2~4문장씩)
- 이미지 위치는 [이미지 N: 설명] 형식으로 소제목 아래 표시 (총 5~6개)
- 마지막 문장: "개인마다 차이가 있을 수 있으니, 전문의와 상담 후 결정하시길 권해드립니다."

【절대 쓰지 말 것】
- "먼저", "또한", "따라서", "이처럼", "정리하자면", "중요한 것은", "결론적으로" 같은 AI 티 나는 표현
- # ## ** * - 등 마크다운 기호 (▶ 제외)
- 모든 단락을 같은 방식으로 시작하는 것
- 막연하고 추상적인 표현 ("도움이 될 수 있습니다" 남발 금지 — 구체적 내용으로 대체)

본문만 작성 (제목 제외).`;

    const anthropic = getAnthropicClient();

    const createMessage = () => anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
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
    const { fixed: body, replaced: autoReplaced } = autoFix(mdCleaned);

    const bodyForCount = body.replace(/\[이미지\s*\d+:[^\]]*\]/g, '');
    const charCount = bodyForCount.length;
    const compliance = checkCompliance(body);

    // SEO 분석
    // H2: 앞뒤 빈 줄로 둘러싸인 단독 줄 (15~45자, ▶ 시작 아님)
    const h2Matches = body.match(/(?:^|\n\n)([^\n▶][^\n]{14,44})(?:\n\n|$)/g) || [];
    const h2Count = h2Matches.length;
    // H3: ▶ 로 시작하는 줄
    const h3Matches = body.match(/^▶.+/gm) || [];
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
    });
  } catch (error) {
    console.error('본문 생성 오류:', error);
    const raw = error instanceof Error ? error.message : '';
    const userMessage = raw.includes('Internal server error') || raw.includes('500') || raw.includes('529')
      ? 'AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.'
      : raw.includes('rate_limit') || raw.includes('429')
        ? '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
        : '본문 생성에 실패했습니다. 다시 시도해주세요.';
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
