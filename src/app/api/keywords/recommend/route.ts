import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, MODEL } from '@/lib/anthropic';

const SPECIALTY_KEYWORDS: Record<string, string[]> = {
  피부과: ['피부과 추천', '여드름 치료', '피부 관리', '레이저 시술', '미백', '보톡스', '필러', '색소 치료', '피부 트러블'],
  정형외과: ['허리 디스크', '무릎 통증', '관절염', '도수치료', '재활치료', '척추 교정', '어깨 통증', '스포츠 손상'],
  치과: ['임플란트', '치아 교정', '스케일링', '충치 치료', '미백', '라미네이트', '사랑니', '잇몸 치료'],
  한의원: ['추나요법', '침 치료', '한약', '다이어트 한의원', '불임', '갱년기', '아토피', '면역력'],
  성형외과: ['쌍꺼풀', '코 성형', '지방흡입', '가슴 성형', '눈 성형', '안면윤곽', '피부과 시술'],
  내과: ['건강검진', '당뇨', '고혈압', '소화기', '갑상선', '내시경', '대장암'],
  산부인과: ['산부인과 검진', '임신', '출산', '난임', '자궁근종', '여성 건강'],
  소아청소년과: ['소아과', '예방접종', '성장 클리닉', '소아 건강', '아이 열'],
  소아과: ['소아과', '예방접종', '성장 클리닉', '소아 건강', '아이 열'],
  안과: ['라식', '라섹', '백내장', '녹내장', '드림렌즈', '눈 건강'],
  이비인후과: ['코막힘', '축농증', '편도선', '중이염', '이명', '수면무호흡'],
};

function getStaticKeywords(specialty: string, region?: string): string[] {
  const base = SPECIALTY_KEYWORDS[specialty] ?? [];
  if (!region || !region.trim()) return base;
  const regionKeywords = base.slice(0, 3).map((kw) => `${region} ${kw}`);
  return [...regionKeywords, ...base];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { specialty?: string; region?: string };
    const { specialty, region } = body;

    if (!specialty || typeof specialty !== 'string') {
      return NextResponse.json({ error: '진료과목을 입력해주세요.' }, { status: 400 });
    }

    const staticKeywords = getStaticKeywords(specialty.trim(), region?.trim());

    const regionText = region?.trim() ? `지역: ${region.trim()}` : '';
    const prompt = `병원 블로그 SEO를 위한 키워드를 추천해 주세요.

진료과목: ${specialty}
${regionText}

다음 조건을 반드시 지키세요:
- 의료법 제56조 준수: "완치", "최고", "100%", "기적" 등 과장 표현 금지
- 실제 환자가 검색할 법한 자연스러운 키워드
- 중복 없이 6개 추천
- 이미 사용된 키워드와 겹치지 않게: ${staticKeywords.slice(0, 5).join(', ')}
${region?.trim() ? `- "${region}" 지역 관련 키워드 2개 이상 포함` : ''}

반드시 다음 JSON 형식으로만 응답:
{"keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6"]}`;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    let aiKeywords: string[] = [];

    if (textBlock && textBlock.type === 'text') {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { keywords?: unknown };
          if (Array.isArray(parsed.keywords)) {
            aiKeywords = parsed.keywords.filter((k): k is string => typeof k === 'string').slice(0, 6);
          }
        } catch {
          // JSON 파싱 실패 시 정적 키워드만 사용
        }
      }
    }

    const combined = [...staticKeywords, ...aiKeywords];
    const unique = Array.from(new Set(combined)).slice(0, 15);

    return NextResponse.json({ keywords: unique });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `키워드 추천 실패: ${message}` }, { status: 500 });
  }
}
