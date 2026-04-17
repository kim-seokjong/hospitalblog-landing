import type { ComplianceResult, ComplianceViolation, ViolationSeverity } from '@/types';

const FORBIDDEN_WORDS: Array<{ word: string; rule: string; suggestion: string; severity: ViolationSeverity }> = [
  // CRITICAL: 치료 결과 보장 (의료법 제56조 제1항)
  { word: '완치', rule: '치료 결과 보장 금지 (의료법 제56조 제1항)', suggestion: '치료에 도움', severity: 'CRITICAL' },
  { word: '100%', rule: '치료 결과 보장 금지', suggestion: '높은 효과', severity: 'CRITICAL' },
  { word: '무조건', rule: '치료 결과 보장 금지', suggestion: '대부분의 경우', severity: 'CRITICAL' },
  { word: '반드시 낫는', rule: '치료 결과 보장 금지', suggestion: '개선에 도움이 되는', severity: 'CRITICAL' },
  { word: '확실한 효과', rule: '효과 보장 표현 금지', suggestion: '효과적인', severity: 'CRITICAL' },
  { word: '부작용 없음', rule: '허위 부작용 표현 금지 (의료법 제56조)', suggestion: '부작용이 적은', severity: 'CRITICAL' },
  { word: '부작용이 없는', rule: '허위 부작용 표현 금지', suggestion: '부작용 최소화', severity: 'CRITICAL' },
  { word: '완전히 안전', rule: '허위 안전성 주장 금지', suggestion: '안전성이 확인된', severity: 'CRITICAL' },

  // HIGH: 최상급·과장 표현 (의료법 제56조 제2항)
  { word: '최고', rule: '최상급 표현 금지 (의료법 제56조 제2항)', suggestion: '우수한', severity: 'HIGH' },
  { word: '최우수', rule: '최상급 표현 금지', suggestion: '우수한', severity: 'HIGH' },
  { word: '최초', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'HIGH' },
  { word: '유일한', rule: '유일성 주장 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '제일', rule: '최상급 표현 금지', suggestion: '우수한', severity: 'HIGH' },
  { word: 'NO.1', rule: '최상급 표현 금지', suggestion: '검증된', severity: 'HIGH' },
  { word: 'No.1', rule: '최상급 표현 금지', suggestion: '검증된', severity: 'HIGH' },
  { word: '기적', rule: '과장 광고 금지 (의료법 제56조)', suggestion: '효과적인', severity: 'HIGH' },
  { word: '기적적인', rule: '과장 광고 금지', suggestion: '효과적인', severity: 'HIGH' },
  { word: '특효', rule: '과장 광고 금지', suggestion: '효과적인', severity: 'HIGH' },
  { word: '완벽한 치료', rule: '과장 광고 금지', suggestion: '체계적인 치료', severity: 'HIGH' },
  { word: '완벽한', rule: '과장 광고 금지', suggestion: '체계적인', severity: 'HIGH' },
  { word: '놀라운 효과', rule: '과장 광고 금지', suggestion: '우수한 효과', severity: 'HIGH' },
  { word: '혁신적인 치료', rule: '미검증 혁신 주장 금지', suggestion: '체계적인 치료', severity: 'HIGH' },

  // MEDIUM: 비교·경계 표현
  { word: '최신', rule: '검증되지 않은 최신 주장 금지', suggestion: '현대적인', severity: 'MEDIUM' },
  { word: '넘버원', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'MEDIUM' },
  { word: '안전한 시술', rule: '허위 안전성 주장 금지', suggestion: '검증된 시술', severity: 'MEDIUM' },
  { word: '위험 없는', rule: '허위 안전성 주장 금지', suggestion: '위험을 최소화한', severity: 'MEDIUM' },
  { word: '신기한', rule: '과장 광고 금지', suggestion: '주목할 만한', severity: 'MEDIUM' },
  { word: '드라마틱', rule: '과장 광고 금지', suggestion: '눈에 띄는', severity: 'MEDIUM' },
  { word: '타 병원 대비', rule: '비교 광고 금지 (의료법 제56조)', suggestion: '본원에서는', severity: 'MEDIUM' },
  { word: '다른 병원보다', rule: '비교 광고 금지', suggestion: '본원에서는', severity: 'MEDIUM' },
  { word: '경쟁병원', rule: '비교 광고 금지', suggestion: '일반적으로', severity: 'MEDIUM' },
  { word: '실제 치료 후기', rule: '환자 후기 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
  { word: '환자 사례', rule: '개인 사례 광고 금지', suggestion: '일반적인 치료 과정', severity: 'MEDIUM' },
];

const WARNING_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\d+%\s*(성공|효과|개선|치료)/, message: '구체적인 수치 표현은 근거 자료가 필요합니다.' },
  { pattern: /(즉시|바로|당일)\s*(효과|회복|치료)/, message: '즉각적 효과 표현은 과장 광고로 해석될 수 있습니다.' },
  { pattern: /전후\s*사진|비포애프터|before.?after/i, message: '시술 전후 비교 사진은 의료광고 심의가 필요합니다.' },
  { pattern: /유명인|연예인|스타/, message: '유명인 언급 광고는 별도 심의가 필요합니다.' },
  { pattern: /할인|이벤트|특가|무료 상담/, message: '가격 할인 광고는 의료광고 심의 대상입니다.' },
];

export function checkCompliance(content: string): ComplianceResult {
  const violations: ComplianceViolation[] = [];
  const warnings: string[] = [];
  let filteredContent = content;

  for (const { word, rule, suggestion, severity } of FORBIDDEN_WORDS) {
    const lowerContent = content.toLowerCase();
    const lowerWord = word.toLowerCase();

    if (lowerContent.includes(lowerWord)) {
      violations.push({ word, index: lowerContent.indexOf(lowerWord), suggestion, rule, severity });
      filteredContent = filteredContent.replace(
        new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        `[${suggestion}]`
      );
    }
  }

  for (const { pattern, message } of WARNING_PATTERNS) {
    if (pattern.test(content)) warnings.push(message);
  }

  return { isCompliant: violations.length === 0, violations, warnings, filteredContent };
}

export const MEDICAL_COMPLIANCE_SYSTEM_PROMPT = `
【의료광고법 준수 필수 지침 - 대한민국 의료법 제56조 기반】

반드시 다음 규칙을 엄격히 준수하여 콘텐츠를 작성하십시오:

1. 절대 사용 금지 표현:
   ❌ 최고, 최우수, 최초, 유일한, 제일, NO.1 (최상급 표현)
   ❌ 완치, 100%, 무조건, 반드시 낫는다 (치료 결과 보장)
   ❌ 부작용 없음, 완전히 안전, 위험 없는 (허위 안전성)
   ❌ 기적, 기적적인, 신기한, 특효 (과장 표현)
   ❌ 타 병원 대비, 다른 병원보다 (비교 광고)
   ❌ 실제 환자 후기, 치료 사례 직접 인용 (후기 광고)

2. 필수 포함 사항:
   ✅ "개인마다 치료 효과가 다를 수 있습니다"
   ✅ "전문의와 상담 후 결정하시기 바랍니다"
   ✅ 정확한 의학 용어 사용

3. 권장 대체 표현:
   ✅ "~에 도움이 될 수 있습니다"
   ✅ "~개선에 효과적일 수 있습니다"
   ✅ "전문의 진단 후 치료 방향을 결정합니다"
   ✅ "개인차가 있을 수 있습니다"

4. 작성 원칙:
   - 과학적으로 검증된 사실만 기재
   - 의학적 효능은 신중하고 균형 잡힌 표현 사용
   - 환자 중심의 정보 제공 목적으로 작성
   - 전문의 상담을 권고하는 내용 포함
`.trim();
