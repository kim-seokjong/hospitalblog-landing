import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';

const HEAD_KEYWORDS: Record<string, string[]> = {
  피부과: ['피부과 추천', '여드름 치료', '피부 관리', '레이저 시술', '미백', '보톡스', '필러', '색소 치료'],
  정형외과: ['허리 디스크', '무릎 통증', '관절염', '도수치료', '재활치료', '척추 교정', '어깨 통증', '스포츠 손상'],
  치과: ['임플란트', '치아 교정', '스케일링', '충치 치료', '미백', '라미네이트', '사랑니', '잇몸 치료'],
  한의원: ['추나요법', '침 치료', '한약', '다이어트 한의원', '불임', '갱년기', '아토피', '면역력'],
  성형외과: ['쌍꺼풀', '코 성형', '지방흡입', '가슴 성형', '눈 성형', '안면윤곽'],
  내과: ['건강검진', '당뇨', '고혈압', '소화기', '갑상선', '내시경', '대장암'],
  산부인과: ['산부인과 검진', '임신', '출산', '난임', '자궁근종', '여성 건강'],
  소아청소년과: ['소아과', '예방접종', '성장 클리닉', '소아 건강'],
  소아과: ['소아과', '예방접종', '성장 클리닉', '소아 건강'],
  안과: ['라식', '라섹', '백내장', '녹내장', '드림렌즈', '눈 건강'],
  이비인후과: ['코막힘', '축농증', '편도선', '중이염', '이명', '수면무호흡'],
  외과: ['탈장', '맹장염', '담석', '치질', '갑상선 결절', '유방 결절', '하지정맥류', '외상 봉합'],
  신경과: ['두통', '어지럼증', '손발 저림', '뇌졸중 예방', '파킨슨병', '치매 검사', '수전증', '안면마비'],
  정신건강의학과: ['불면증', '우울증', '공황장애', '불안장애', '성인 ADHD', '스트레스 상담', '수면장애'],
  재활의학과: ['도수치료', '목 디스크', '허리 디스크', '오십견', '척추 측만증', '체외충격파', '보행 재활', '거북목'],
  비뇨기과: ['전립선', '요로결석', '방광염', '과민성 방광', '발기부전', '요실금', '정관수술', '혈뇨'],
  가정의학과: ['건강검진', '만성피로', '비만 치료', '금연 클리닉', '예방접종', '영양 수액', '고혈압 관리', '당뇨 관리'],
};

const SUB_KEYWORDS: Record<string, string[]> = {
  피부과: ['손바닥 붉은 반점', '얼굴 두드러기', '갑자기 가려운 피부', '여드름이 안 나아요', '피부에 작은 물집', '얼굴 홍조'],
  정형외과: ['허리에서 다리로 저림', '무릎 굽힐 때 통증', '아침에 손가락 뻣뻣함', '걸을 때 발바닥 통증', '어깨 들기 힘들 때', '목이 자주 뻐근'],
  치과: ['찬물에 시린 이', '잇몸에서 피', '입에서 냄새', '턱에서 딱딱 소리', '음식 씹을 때 통증', '이가 흔들림'],
  한의원: ['손발이 차요', '소화가 잘 안돼요', '잠을 못 자요', '갑자기 살이 쪄요', '생리가 불규칙', '만성 피로'],
  성형외과: ['눈이 자주 처져요', '코가 휘어 보임', '얼굴이 비대칭', '피부가 처졌어요', '눈밑 지방', '주름이 깊어요'],
  내과: ['속이 자주 더부룩', '혈압이 높게 나왔어요', '갑자기 살이 빠져요', '쉽게 피곤해요', '식은땀이 자주', '갈증이 자주'],
  산부인과: ['생리통이 심해요', '하혈이 있어요', '아랫배 묵직함', '냉이 늘었어요', '가슴 멍울', '갑자기 무월경'],
  소아청소년과: ['아이가 열이 안 떨어져요', '밤에 자꾸 깨요', '식욕이 없어요', '아이 키가 또래보다 작아요', '아이 코피가 자주', '아이 두드러기'],
  소아과: ['아이가 열이 안 떨어져요', '밤에 자꾸 깨요', '식욕이 없어요', '아이 키가 또래보다 작아요'],
  안과: ['눈이 침침해요', '눈이 자주 충혈', '눈물이 갑자기 줄었어요', '시야가 뿌예져요', '눈에 모기 같은 점', '아침에 눈곱'],
  이비인후과: ['코가 자주 막혀요', '귀에서 윙윙 소리', '목이 자주 따끔', '코피가 자주 나요', '잘 때 코골이', '귀가 먹먹'],
  외과: ['오른쪽 아랫배 통증', '항문 출혈', '다리 혈관이 튀어나와요', '목에 만져지는 멍울', '상처가 안 아물어요', '배꼽 주변이 아파요'],
  신경과: ['머리가 자주 아파요', '자꾸 어지러워요', '손이 떨려요', '손발이 저려요', '자꾸 깜빡해요', '한쪽 얼굴이 마비돼요'],
  정신건강의학과: ['잠이 안 와요', '자꾸 우울해요', '가슴이 두근거려요', '집중이 안돼요', '의욕이 없어요', '불안하고 초조해요'],
  재활의학과: ['목이 자주 뻐근해요', '어깨가 안 올라가요', '허리 펴기 힘들어요', '걸을 때 다리가 아파요', '자세가 자꾸 굽어요', '무릎이 시큰해요'],
  비뇨기과: ['소변이 자주 마려워요', '소변 볼 때 따가워요', '소변에 피가 섞여요', '밤에 자주 화장실에 가요', '소변 줄기가 약해요', '아랫배가 묵직해요'],
  가정의학과: ['늘 피곤해요', '살이 안 빠져요', '자꾸 어지러워요', '소화가 안돼요', '두통이 잦아요', '기운이 없어요'],
};

function getStaticHead(specialty: string, region?: string): string[] {
  const base = HEAD_KEYWORDS[specialty] ?? [];
  if (!region || !region.trim()) return base;
  const regionKeywords = base.slice(0, 3).map((kw) => `${region} ${kw}`);
  return [...regionKeywords, ...base];
}

function getStaticSub(specialty: string): string[] {
  return SUB_KEYWORDS[specialty] ?? [];
}

interface AiKeywordResult {
  headKeywords: string[];
  subKeywords: string[];
}

async function fetchAiKeywords(specialty: string, region: string, existingHead: string[], existingSub: string[]): Promise<AiKeywordResult> {
  const regionText = region.trim() ? `지역: ${region.trim()}` : '';
  const prompt = `${specialty} 진료과 블로그 SEO 키워드를 두 그룹으로 추천해 주세요.
${regionText}

[고관여 키워드 (4개)]
- 진료과목·시술명·치료명 등 직접적인 SEO 키워드
- 검색량이 많고 진료 분야를 그대로 대표하는 단어
- 이미 있는 키워드 제외: ${existingHead.slice(0, 5).join(', ')}
${region.trim() ? `- "${region}" 지역 키워드 1개 이상 포함` : ''}

[서브 키워드 (4개)]
- 환자가 증상·상태로 검색할 법한 일상적인 표현 (예: "손바닥 붉은 반점", "얼굴 두드러기")
- 의학용어가 아닌 환자의 입말로 작성
- 이미 있는 키워드 제외: ${existingSub.slice(0, 5).join(', ')}

조건:
- 의료법 제56조 준수 ("완치", "최고", "100%", "기적" 등 과장 표현 금지)
- 중복 없이

반드시 다음 JSON 형식으로만 응답:
{"headKeywords": ["키워드1","키워드2","키워드3","키워드4"], "subKeywords": ["증상키워드1","증상키워드2","증상키워드3","증상키워드4"]}`;

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 768,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return { headKeywords: [], subKeywords: [] };
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { headKeywords: [], subKeywords: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { headKeywords?: unknown; subKeywords?: unknown };
    const head = Array.isArray(parsed.headKeywords)
      ? parsed.headKeywords.filter((k): k is string => typeof k === 'string').slice(0, 6)
      : [];
    const sub = Array.isArray(parsed.subKeywords)
      ? parsed.subKeywords.filter((k): k is string => typeof k === 'string').slice(0, 6)
      : [];
    return { headKeywords: head, subKeywords: sub };
  } catch {
    return { headKeywords: [], subKeywords: [] };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { specialty?: string; region?: string };
    const { specialty, region } = body;

    if (!specialty || typeof specialty !== 'string') {
      return NextResponse.json({ error: '진료과목을 입력해주세요.' }, { status: 400 });
    }

    const trimmedSpecialty = specialty.trim();
    const trimmedRegion = (region ?? '').trim();

    const staticHead = getStaticHead(trimmedSpecialty, trimmedRegion);
    const staticSub = getStaticSub(trimmedSpecialty);

    const { headKeywords: aiHead, subKeywords: aiSub } = await fetchAiKeywords(
      trimmedSpecialty,
      trimmedRegion,
      staticHead,
      staticSub,
    );

    const headKeywords = Array.from(new Set([...staticHead, ...aiHead])).slice(0, 12);
    const subKeywords = Array.from(new Set([...staticSub, ...aiSub])).slice(0, 10);

    return NextResponse.json({ headKeywords, subKeywords });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `키워드 추천 실패: ${message}` }, { status: 500 });
  }
}
