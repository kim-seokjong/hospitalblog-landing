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

  // HIGH: 최상급·배타·1위 표현 확대 (의료법 제56조 제2항) — recall 우선 커버리지
  { word: '국내 최고', rule: '최상급 표현 금지 (의료법 제56조 제2항)', suggestion: '신뢰받는', severity: 'HIGH' },
  { word: '국내최고', rule: '최상급 표현 금지', suggestion: '신뢰받는', severity: 'HIGH' },
  { word: '국내 최초', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'HIGH' },
  { word: '국내최초', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'HIGH' },
  { word: '세계 최초', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'HIGH' },
  { word: '세계최초', rule: '최상급 표현 금지', suggestion: '선도적인', severity: 'HIGH' },
  { word: '세계 최고', rule: '최상급 표현 금지', suggestion: '신뢰받는', severity: 'HIGH' },
  { word: '유일무이', rule: '유일성 주장 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '베스트', rule: '최상급 표현 금지', suggestion: '우수한', severity: 'HIGH' },
  { word: '대한민국 대표', rule: '배타적 대표성 주장 금지', suggestion: '신뢰받는', severity: 'HIGH' },
  { word: '명불허전', rule: '과장 광고 금지', suggestion: '신뢰받는', severity: 'HIGH' },
  { word: '1위', rule: '순위 단정 표현 금지', suggestion: '검증된', severity: 'HIGH' },
  // 2026-07-28 리콜 측정에서 통과했던 최상급 어휘 — 단어형이라 목록으로 충분하다.
  { word: '최상의', rule: '최상급 표현 금지 (의료법 제56조 제2항)', suggestion: '우수한', severity: 'HIGH' },
  { word: '압도적', rule: '최상급 표현 금지', suggestion: '충분한', severity: 'HIGH' },
  { word: '독보적', rule: '유일성·최상급 주장 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '타의 추종', rule: '배타적 최상급 표현 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '국내 유일', rule: '유일성 주장 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '국내유일', rule: '유일성 주장 금지', suggestion: '차별화된', severity: 'HIGH' },
  { word: '평생 보장', rule: '치료 결과 보장 금지 (의료법 제56조)', suggestion: '체계적인 관리', severity: 'HIGH' },
  { word: '평생보장', rule: '치료 결과 보장 금지', suggestion: '체계적인 관리', severity: 'HIGH' },
  { word: '책임보장', rule: '치료 결과 보장 금지', suggestion: '체계적인 관리', severity: 'HIGH' },
  { word: '책임 보장', rule: '치료 결과 보장 금지', suggestion: '체계적인 관리', severity: 'HIGH' },

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

  // STORYTELLING/VIRAL-HOOKS 가드 — 후기·경험담·과장 도입 표현 (보수적: 명백한 광고성 어구만)
  // 일반화된 임상 관찰("진료실에서 보면", "환자분들 보면")은 정상 톤이므로 절대 매칭하지 않는다.
  { word: '치료 후기', rule: '환자 후기 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
  { word: '치료 경험담', rule: '환자 경험담 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
  { word: '환자 후기', rule: '환자 후기 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
  { word: '후기 모음', rule: '환자 후기 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
  { word: '생생한 후기', rule: '환자 후기 광고 금지 (의료법 제56조)', suggestion: '치료 안내', severity: 'MEDIUM' },
];

/**
 * 패턴 규칙 — 정규식으로 잡는 위반/경고.
 *
 * `severity` 가 지정된 항목은 **위반(violations)** 으로 승격되어 등급 산정에 반영된다.
 * 지정이 없으면 기존대로 경고(warnings)로만 표면화한다(등급 LOW).
 *
 * 승격 기준(2026-W30): 유인·후기·결과보장·전후사진·배타적 최상급처럼 **표현 자체로
 * 위반 소지가 명백한** 것만 승격한다. 회색지대(유명인 언급·즉시효과·수치·실손·공포조장)는
 * 경고로 남겨 오탐이 등급을 밀어올리지 않게 한다.
 *
 * ⚠️ 승격 항목도 **자동치환하지 않는다**(검출·표시만). 문맥 파괴 위험이 크기 때문.
 */
interface PatternRule {
  pattern: RegExp;
  message: string;
  /** 지정 시 위반으로 승격(등급 반영). 미지정이면 경고로만 표면화. */
  severity?: ViolationSeverity;
  /** 승격 시 위반 목록에 표기할 근거 조문(미지정이면 message 사용). */
  rule?: string;
  /** 승격 시 제시할 권고(자동치환 아님 — 사람이 판단). */
  suggestion?: string;
}

const WARNING_PATTERNS: PatternRule[] = [
  { pattern: /\d+%\s*(성공|효과|개선|치료)/, message: '구체적인 수치 표현은 근거 자료가 필요합니다.' },
  { pattern: /(즉시|바로|당일)\s*(효과|회복|치료)/, message: '즉각적 효과 표현은 과장 광고로 해석될 수 있습니다.' },
  {
    pattern: /전후\s*사진|전후\s*비교|비포애프터|before.?after|전\s*vs\s*후/i,
    message: '시술 전후 비교·비포애프터 표현은 의료광고 심의 대상입니다(전후 사진 광고 원칙 금지).',
    severity: 'HIGH',
    rule: '치료 전후 비교 광고 금지 (의료법 제56조 제2항)',
    suggestion: '전후 비교 표현 삭제 — 시술 과정·원리 설명으로 대체',
  },
  // 2026-W28: 경험담 위장 표현(내돈내산·직접 받아보니)을 기존 후기 패턴에 합류(검출·표시만).
  {
    pattern: /후기|리얼\s*후기|생생\s*후기|체험\s*후기|내돈내산|직접\s*받아\s*보니/,
    message: '환자 후기·체험담 형식(경험담 위장 표현 포함)은 의료법 제56조 심의 대상입니다.',
    severity: 'MEDIUM',
    rule: '환자 후기·경험담 광고 금지 (의료법 제56조)',
    suggestion: '후기 형식 삭제 — 일반화된 치료 안내로 대체',
  },
  // 2026-W29: 경험담 위장 '유인' 표현 — 공정위 성형외과 뒷광고 시정명령(7/12) 근거. 검출·표시만(LOW).
  // `후기 이벤트`·`후기 작성 시`는 위 후기 패턴이 이미 부분 커버하지만, 유인 결합형은
  // 별도 라벨(자발적 후기 오인 기만 표시광고)로 한 번 더 표면화한다. `체험단 모집`은 신규 커버.
  {
    pattern: /체험단\s*모집|후기\s*이벤트|후기\s*작성\s*시/,
    message: '체험단 모집·후기 이벤트 등 대가성 후기 유인 표현은 자발적 후기로 오인시키는 기만적 표시광고 소지가 있습니다(공정위 시정명령 사례).',
    severity: 'MEDIUM',
    rule: '대가성 후기 유인·기만적 표시광고 금지 (표시광고법·공정위 시정명령 사례)',
    suggestion: '체험단·후기 유인 문구 삭제',
  },
  { pattern: /유명인|연예인|스타\b|셀럽|인플루언서/, message: '유명인·인플루언서 언급 광고는 별도 심의가 필요합니다.' },
  // 유인·이벤트·가격 — recall 우선 광역 탐색(검출만, 치환 없음)
  // 2026-W28: 한정 수량·동반 방문·지인 소개 합류. "선착순"·"한정 특가"(특가)는 기존 알터네이션이 이미 커버.
  // 오탐 배제: "무료 상담"은 기존 관행이라 `무료(?!\s*상담)`으로 제외(무료 검사·무료 시술은 계속 검출).
  {
    pattern: /할인|이벤트|특가|파격가|반값|선착순|사은품|추첨|경품|특별\s*할인|무제한|평생|무료(?!\s*상담)|1\s*\+\s*1|지금\s*예약|한정\s*수량|동반\s*방문|지인\s*소개/,
    message: '가격 할인·이벤트·유인성 표현은 의료광고 심의 대상입니다(환자 유인·알선 소지).',
    severity: 'MEDIUM',
    rule: '환자 유인·알선 금지 (의료법 제27조 제3항)',
    suggestion: '할인·이벤트 문구 삭제 — 진료 안내로 대체',
  },
  // 2026-W29: 실손보험 오인 유도 — 복지부 의료법 하위법령 개정 입법예고(실손 적용·실비 처리 광고 금지 신설).
  // `(실손|실비)\s*(적용|처리|청구)` 로 4개 승인 표현(실손 적용·실비 처리·실비 청구·실손 청구 가능)과
  // 붙여쓰기 변형을 모두 커버한다. 검출·표시만(자동치환 금지).
  // 오탐 가능성 명기: "실손 적용 여부는 보험사에 확인" 같은 정보성 안내도 매칭될 수 있으나
  // recall 최우선 + WARNING(표시만) 경로라 허용. ("실손보험 가입 여부" 류는 매칭되지 않음 — 보험≠적용/처리/청구)
  { pattern: /(실손|실비)\s*(적용|처리|청구)/, message: '실손·실비 적용/처리/청구 표현은 실손보험 오인 유도 광고 금지(의료법 하위법령 개정 신설)에 저촉될 소지가 있습니다.' },
  // 2026-W28: 비급여 비용 면제 — 환자 유인행위(의료법 제27조 제3항) 소지. 검출·표시만.
  // 오탐 배제: "책임 면제 조항" 같은 법률 문구는 매칭하지 않도록 비용 명사 근접일 때만 잡는다.
  {
    pattern: /(비급여|본인\s*부담금?|검사비|시술비|수술비|진료비|치료비)[^.!?\n]{0,10}면제|면제\s*(이벤트|혜택|프로모션)/,
    message: '비급여 비용 면제 표현은 환자 유인행위(의료법 제27조 제3항) 소지가 있습니다.',
    severity: 'MEDIUM',
    rule: '비급여 진료비 면제·할인 등 환자 유인행위 금지 (의료법 제27조 제3항)',
    suggestion: '비용 면제·할인 문구 삭제',
  },
  // 2026-W28: 전문가 프레임 — 전문가 보증으로 오인시킬 소지(검출·표시만).
  // "전문가의 의견을 인용" 같은 정상 서술은 매칭하지 않는다(추천 어구 결합 시에만).
  { pattern: /전문가\s*추천|의사가\s*추천하는/, message: '전문가 추천·의사 추천 프레임은 전문가 보증 오인 소지가 있어 의료광고 심의 대상입니다.' },
  // 보장성 — 결과·환불 보장
  {
    pattern: /재수술\s*무료|책임\s*보장|평생\s*보장|100\s*%\s*환불|전액\s*환불|환불\s*보장/,
    message: '결과·환불 보장 표현은 치료 결과 보장 금지(의료법 제56조)에 저촉될 소지가 큽니다.',
    severity: 'HIGH',
    rule: '치료 결과·환불 보장 금지 (의료법 제56조 제1항)',
    suggestion: '보장 표현 삭제 — 체계적 관리 안내로 대체',
  },
  // 비급여 가격 단정 + 시술 근접 노출
  {
    pattern: /(\d[\d,]{2,}\s*원)[^.!?\n]{0,25}(시술|수술|성형|필러|보톡스|레이저|주사|시술비|이벤트|할인|특가|부터)/,
    message: '구체 금액과 시술을 함께 노출하는 비급여 가격 광고는 의료광고 심의 대상입니다.',
    severity: 'MEDIUM',
    rule: '비급여 진료비 광고 심의 대상 (의료법 제57조)',
    suggestion: '구체 금액 삭제 — 비용은 내원 상담 안내로 대체',
  },
  {
    pattern: /(시술|수술|성형|필러|보톡스|레이저|주사)[^.!?\n]{0,15}(\d[\d,]{2,}\s*원)/,
    message: '구체 금액과 시술을 함께 노출하는 비급여 가격 광고는 의료광고 심의 대상입니다.',
    severity: 'MEDIUM',
    rule: '비급여 진료비 광고 심의 대상 (의료법 제57조)',
    suggestion: '구체 금액 삭제 — 비용은 내원 상담 안내로 대체',
  },
  // 지역명 + 최상급 결합 (예: "강남 최고", "수성구 최초", "부산 1위")
  {
    pattern: /[가-힣]{2,}(?:시|군|구|동|읍|면|역)\s*(?:최고|최초|최우수|유일|제일|1위|넘버원|대표)/,
    message: '지역명과 최상급을 결합한 표현은 배타성·최상급 광고 금지에 저촉될 소지가 있습니다.',
    severity: 'HIGH',
    rule: '배타적 최상급 표현 금지 (의료법 제56조 제2항)',
    suggestion: '지역+최상급 결합 삭제 — 진료 내용 중심 서술로 대체',
  },
  // 2026-W30: '전문병원' 명칭 표방 — 복지부 지정 없이 사용 금지(의료법 제3조의5 제4항).
  //
  // 범위를 '전문병원' 으로만 좁힌다. 조문이 규제하는 명칭이 '전문병원' 이고,
  // '전문 의원·클리닉·센터' 까지 묶으면 일반 표현까지 걸린다.
  // ("전문의와 상담" 같은 권장 문구는 병원 명사 결합이 아니라 애초에 매칭되지 않는다.)
  //
  // ⚠️ 지정 여부는 본문만으로 판정할 수 없다. "지정" 인접 문맥을 예외로 두는 방식은
  //    "미지정 전문병원"·"전문병원으로 지정되지 않은" 같은 부정문까지 통과시켜
  //    우회로가 되고, 반대로 기관명이 길면 적법 표기를 오탐한다. 그래서 예외를 두지 않고
  //    **모두 검출하되 MEDIUM(표면화)** 로 둔다 — 지정 사실 확인은 검수팀 몫이고,
  //    발행 게이트(HIGH 이상)를 적법 기관에까지 잠그지는 않는다.
  {
    pattern: /전문\s*병원/,
    message: '‘전문병원’ 명칭은 보건복지부 지정 기관만 사용할 수 있습니다(의료법 제3조의5). 지정 사실을 확인하세요.',
    severity: 'MEDIUM',
    rule: '전문병원 명칭 표방 — 복지부 지정 여부 확인 필요 (의료법 제3조의5 제4항)',
    suggestion: '지정 사실이 없으면 명칭 삭제 — 진료과목 표기로 대체',
  },
  // STORYTELLING 가드 — 1인칭 환자 치료경험담·후기 서사 (의료법 제56조). 검출만(autoFix 미개입).
  // 보수적: "저는/제가" 뒤에 치료·시술 + 나았다/효과 가 함께 올 때만 매칭 (정상 1인칭 임상관찰 보호).
  {
    pattern: /(저는|제가)[^.!?\n]{0,40}(치료|시술|수술|받|맞)[^.!?\n]{0,40}(나았|완치|호전|효과를 봤|좋아졌)/,
    message: '1인칭 환자 치료경험담·후기 서사는 의료법 제56조 위반 소지가 있습니다(일반화된 임상 관찰로 서술 권장).',
    severity: 'MEDIUM',
    rule: '환자 치료경험담 광고 금지 (의료법 제56조)',
    suggestion: '1인칭 경험담 삭제 — 일반화된 임상 관찰로 서술',
  },
  // VIRAL-HOOKS 가드 — 공포 조장형 도입. 검출만.
  { pattern: /(방치하면|放置)[^.!?\n]{0,20}(큰일|위험|악화|늦)/, message: '공포 조장형 도입은 과장 광고로 해석될 수 있습니다.' },
  { pattern: /충격(적인|적|!)|경악|소름/, message: '자극적·과장 도입 표현은 의료광고 심의 대상입니다.' },

  /* ════════════════════════════════════════════════════════════════════
   * 2026-07-28: 활용형 공백 메우기 — A층 리콜 5/29 → 측정 후 보강.
   *
   * ★ 무엇이 뚫려 있었나.
   *   FORBIDDEN_WORDS 는 '부작용 없음'·'부작용이 없는' 처럼 **고정 명사형**만 담고
   *   있었다. 한국어 용언 활용("없이·없는·없습니다·않습니다")과 사이에 낀 수식어
   *   ("부작용 걱정 없이")를 부분문자열로는 잡을 수 없다. 실측 결과 부작용·통증·
   *   흉터·재발 계열이 **전부** 통과했고, 결과 단정("확실히 개선")과 비교 표현
   *   ("타 병원보다")도 함께 뚫려 있었다.
   *
   * ★ 그래서 단어가 아니라 **패턴**으로 잡는다. 사이 간격을 허용해 수식어가 껴도
   *   놓치지 않는다. 회귀는 medical-compliance.test.ts 가 고정한다.
   *
   * ⚠️ 여기서도 자동치환하지 않는다(검출·표시만) — [[feedback_compliance_strictness_moat]].
   * ══════════════════════════════════════════════════════════════════ */

  // 무위해 단정 — 의료광고에서 가장 전형적인 허위 표현. 명백하므로 CRITICAL.
  // 간격 8자를 허용해 "부작용 걱정 없이"·"부작용이 전혀 없습니다" 를 함께 잡는다.
  {
    /**
     * ⚠️ 어미를 가려 받는다. `없으면`·`없어도`·`없는지`·`없을까` 는 **조건·확인 서술**이라
     *    정상 임상 문장이다("통증이 없으면 방치하기 쉽습니다", "재발이 없는지 확인합니다").
     *    이걸 CRITICAL 로 잡으면 발행 게이트가 정상 글을 막는다. 단정 어미만 남긴다.
     */
    pattern:
      /(부작용|후유증|합병증|통증|흉터|붓기|염증|감염|재발)[^.!?\n]{0,8}(없이|없는(?!지)|없다|없습니다|없어요|없음|없을(?!까))/,
    message: '부작용·통증·흉터·재발이 “없다”는 단정은 허위·과장 광고로 직결됩니다(의료법 제56조 제1항).',
    severity: 'CRITICAL',
    rule: '허위 안전성·무위해 단정 금지 (의료법 제56조 제1항)',
    suggestion: '“없다” 단정 삭제 — 발생 가능성과 관리 방법 안내로 대체',
  },
  // 같은 주장을 '않' 으로 표현한 형태. "흉터가 남지 않습니다"·"재발하지 않습니다".
  {
    pattern: /(부작용|후유증|흉터|붓기|통증|재발)[^.!?\n]{0,8}(남지|생기지|나타나지|하지|되지)\s*않/,
    message: '흉터·재발 등이 생기지 “않는다”는 단정은 치료 결과 보장 금지에 저촉됩니다.',
    severity: 'CRITICAL',
    rule: '허위 안전성·치료 결과 보장 금지 (의료법 제56조 제1항)',
    suggestion: '단정 삭제 — 개인차와 발생 가능성 안내로 대체',
  },
  // 제로·zero 표기 변형.
  {
    pattern: /(부작용|통증|흉터|재발|후유증)\s*(제로|zero)/i,
    message: '“제로” 표기는 무위해 단정과 동일한 허위·과장 광고입니다.',
    severity: 'CRITICAL',
    rule: '허위 안전성 단정 금지 (의료법 제56조 제1항)',
    suggestion: '“제로” 표기 삭제',
  },
  // 결과 보장 — "효과를 보장", "결과 보장", "만족 보장".
  {
    pattern: /(효과|결과|만족|치료)\s*(를|을|은|는)?\s*보장/,
    message: '효과·결과 보장 표현은 치료 결과 보장 금지(의료법 제56조 제1항)에 정면으로 저촉됩니다.',
    severity: 'CRITICAL',
    rule: '치료 결과 보장 금지 (의료법 제56조 제1항)',
    suggestion: '보장 표현 삭제 — 기대 효과와 개인차 안내로 대체',
  },
  // 확정 부사 + 호전 서술 — "확실히 개선됩니다", "반드시 좋아집니다".
  {
    pattern: /(확실히|반드시|틀림없이|무조건|100\s*%)\s*(개선|호전|낫|좋아|효과|만족|성공)/,
    message: '확정적 부사와 호전 서술의 결합은 치료 결과 단정으로 해석됩니다.',
    severity: 'HIGH',
    rule: '치료 결과 단정·보장 금지 (의료법 제56조 제1항)',
    suggestion: '확정 부사 삭제 — “도움이 될 수 있습니다” 등 가능성 표현으로 대체',
  },
  // 전칭 주장 — "누구나 효과", "모두 만족", "누구나 안전".
  {
    pattern: /(누구나|누구든지|모든\s*환자|모두가)\s*[^.!?\n]{0,6}(효과|만족|가능|안전|개선)/,
    message: '모든 환자에게 동일한 결과를 약속하는 전칭 표현은 과장 광고입니다(개인차 고지 필요).',
    severity: 'HIGH',
    rule: '치료 효과 단정·과장 광고 금지 (의료법 제56조 제2항)',
    suggestion: '전칭 표현 삭제 — 개인차가 있다는 안내 추가',
  },
  // 비교 광고 확대 — "타 병원보다", "다른 곳보다", "여느 클리닉 대비".
  {
    pattern: /(타|다른|여느|타사)\s*(병원|의원|치과|한의원|클리닉|곳|업체)[^.!?\n]{0,4}(보다|대비)/,
    message: '다른 의료기관과 비교하는 표현은 비교 광고 금지(의료법 제56조)에 저촉됩니다.',
    severity: 'MEDIUM',
    rule: '비교 광고 금지 (의료법 제56조 제2항)',
    suggestion: '비교 표현 삭제 — 본원 진료 내용 중심 서술로 대체',
  },
  // 무통·무흉터 접두 — 회색지대라 **경고만**(등급 미반영).
  // '무통분만'·'무통주사'는 정식 의료 용어이므로 제외한다(오탐 방지).
  {
    pattern: /무통(?!분만|주사)|무흉터|무자극/,
    message: '“무통·무흉터” 접두 표현은 통증·흉터가 전혀 없다는 오인을 줄 수 있어 심의 대상입니다.',
  },
  // 수치 단정 확대 — 기존 `\d+%\s*(성공|효과…)` 가 못 잡는 지표명 선행형. 경고만.
  {
    pattern: /(만족도|성공률|완치율|생존율|개선율|재발률)\s*(는|은|이|가)?\s*\d/,
    message: '만족도·성공률 등 수치 표현은 객관적 근거 자료가 없으면 과장 광고로 해석될 수 있습니다.',
  },
];

/**
 * 전문의약품 상품명 (비만치료제 우선) — 광고 목적 노출 금지 대상.
 *
 * ⚠️ FORBIDDEN_WORDS 와 달리 **자동치환하지 않는다**. 교육·정보성 서술
 * ("위고비란 무엇인가")은 합법이므로, 오탐 방지를 위해 검출·경고만 한다.
 * 신종 상품명은 주간 리서치(docs/compliance-weekly-research.md) 후 사람이 추가한다.
 */
export const PRESCRIPTION_DRUG_NAMES: readonly string[] = [
  '위고비', '삭센다', '마운자로', '오젬픽', '큐시미아', '펜터민', '디에타민',
  // 2026-W28 주간 리서치 반영 (사람 승인 완료) — GLP-1 계열 신약·경구제·병용 신약
  // '먹는 위고비' 류 모방 표현은 '위고비' 부분매칭으로 이미 검출되므로 별도 등록하지 않는다(테스트로 보증).
  '젭바운드', '파운다요', '오포글리프론', '카그리세마', '캐그리세마', '리벨서스',
  // 2026-W29 주간 리서치 반영 (사람 승인 완료) — GLP-1 계열 신약.
  // 레타트루타이드/레타트루티드: 릴리 3중작용제(미허가·언론 표기 혼용으로 2종 등록).
  // 에페글레나타이드: 한미약품 국산 1호 GLP-1(허가 신청 완료). 약칭 '에페'는 2글자 오탐 위험으로 미등록.
  // 기존 항목과 접두·포함 관계 없음(부분문자열 충돌 없음 — 테스트로 보증).
  '레타트루타이드', '레타트루티드', '에페글레나타이드',
];

/**
 * 전문의약품 상품명 — 영문 표기 (2026-W28 신설).
 *
 * 한글 목록(PRESCRIPTION_DRUG_NAMES)의 영문 대응 표기. 영문에는 한글 좌측 경계가
 * 무의미하므로 buildProductRegexEn(영문 단어 경계·대소문자 무시)로 별도 매칭한다.
 * 한글 목록과 동일하게 **자동치환 없이 검출·경고만** 한다.
 */
export const PRESCRIPTION_DRUG_NAMES_EN: readonly string[] = [
  'Wegovy', 'Mounjaro', 'Ozempic', 'Zepbound', 'Saxenda',
  // 기존·신규 한글 등록분의 영문 대응
  'Qsymia', 'Phentermine', 'Rybelsus', 'CagriSema', 'Orforglipron',
  // 2026-W29 주간 리서치 반영 (사람 승인 완료) — 한글 신규 등록분의 영문 대응
  'Retatrutide', 'Efpeglenatide',
];

/**
 * 의료기기·전문시술 상품명 (대표 예시, 확장 가능) — 광고 목적 노출 금지 대상.
 *
 * PRESCRIPTION_DRUG_NAMES 와 동일하게 자동치환하지 않고 검출·경고만 한다.
 * `피코슈어`·`피코웨이`·`피코`처럼 부분문자열 관계가 있는 항목은
 * detectProductNames 가 매칭 범위 겹침을 제거해 중복 검출을 막는다.
 */
export const MEDICAL_DEVICE_NAMES: readonly string[] = [
  '써마지', '울쎄라', '인모드', '포텐자', '피코슈어', '피코웨이', '피코',
  '프락셀', '슈링크', '튠페이스', '리프테라',
  // 2026-W28 주간 리서치 반영 (사람 승인 완료) — 고주파·초음파 신장비 + 스킨부스터류.
  // `텐써마`·`써마지`는 부분문자열 관계가 아니며(각각 독립 매칭), 한글 좌측 경계로
  // "텐써마지" 같은 연쇄 표기에서도 긴 이름이 중복 없이 매칭된다(테스트로 보증).
  '덴서티', '볼뉴머', '올리지오', '소프웨이브', '텐써마',
  '리쥬란', '쥬베룩', '스컬트라',
];

/**
 * 광고성·유인 어구 — 상품명과 근접(같은 문장 + 40자 이내) 등장 시 HIGH 위반으로 격상.
 * 근접 어구가 없으면 상품명 단독 등장은 약한 경고(warnings)로만 처리한다.
 */
const PROMOTIONAL_CUES: readonly string[] = [
  '처방', '도입', '이벤트', '프로모션', '특가', '할인', '최신', '유일', '국내 최초', '시술받',
];

/** 상품명 근접성 판정 창(문자 수) — 같은 문장 안에서 앞뒤 이 범위까지 광고성 어구를 탐색. */
const PROMO_PROXIMITY = 40;

/**
 * 금지어 매칭용 정규식을 생성한다.
 *
 * 한글 좌측 경계 `(?<![가-힣])`를 붙여 부분문자열 오매칭을 차단한다.
 * 예) "기적"이 "정기적인"·"장기적인" 안의 "기적"에 매칭되는 글리치를 방지.
 * - 실제 금지어는 항상 어절 시작(공백·문두·문장부호 뒤)에 오므로 좌측 경계로 누락 없음.
 * - 조사(의/이/가/를)는 단어 뒤에 붙으므로 좌측 경계는 영향 없음.
 * - 우측 경계는 추가하지 않는다 — 조사 결합("최고의")을 막아 실제 위반을 놓치기 때문.
 * - `100%`·`No.1` 등 비한글 시작 단어에도 좌측 한글 경계는 무해하다.
 */
function buildForbiddenRegex(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![가-힣])${escaped}`, 'gi');
}

/**
 * 상품명 매칭용 정규식(전역). 상품명은 한글이므로 대소문자 무시 불필요(g 플래그만).
 * buildForbiddenRegex 와 동일하게 한글 좌측 경계로 부분문자열 오매칭을 차단한다.
 */
function buildProductRegex(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![가-힣])${escaped}`, 'g');
}

/**
 * 영문 상품명 매칭용 정규식(전역·대소문자 무시) — 2026-W28 신설.
 *
 * 영문에는 한글 좌측 경계 `(?<![가-힣])`가 무의미하므로, 양쪽에 알파벳·숫자 부재
 * 경계를 적용해 다른 영단어 안의 부분문자열 오매칭(예: "awegovy"·"wegovys")을 차단한다.
 * 기존 buildProductRegex(한글 경로)의 시그니처·동작은 변경하지 않는다.
 */
function buildProductRegexEn(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
}

/** 문자열 index 를 포함하는 문장의 [시작, 끝) 경계를 구한다(문장부호·줄바꿈 기준). */
function sentenceBounds(content: string, index: number): [number, number] {
  const isSep = (ch: string): boolean => ch === '.' || ch === '!' || ch === '?' || ch === '\n';
  let start = index;
  while (start > 0 && !isSep(content[start - 1])) start -= 1;
  let end = index;
  while (end < content.length && !isSep(content[end])) end += 1;
  return [start, end];
}

/** 상품명 검출 결과 — 위반(광고 맥락)과 약한 경고(단독 등장)를 분리해 반환한다. */
export interface ProductNameFindings {
  violations: ComplianceViolation[];
  warnings: string[];
}

/**
 * 전문의약품·의료기기 상품명을 검출한다. **치환하지 않고 검출만** 한다(autoFix 미개입).
 *
 * 방침: 의료광고법 안전이 경쟁 해자 → recall 최우선(놓치느니 잡는다). 단, '차단'이
 * 아니라 '경보'를 넓게 잡는 것이며, 교육/정보성 글도 하드블록하지 않는다(발행 게이트는
 * HIGH 에서만 권고 플래그, MEDIUM 은 표면화만).
 * - 상품명 단독 등장 → **MEDIUM 위반**으로 반드시 표면화(교육/정보성이어도 검수팀 확인 유도).
 * - 상품명 + 광고성 어구(PROMOTIONAL_CUES)가 같은 문장 안 40자 이내 근접 → **HIGH** 격상.
 * - `피코슈어`가 매칭된 위치를 `피코`가 다시 매칭하지 않도록 범위 겹침을 제거한다.
 * - warnings 는 사용하지 않으나(전부 위반으로 승격), 인터페이스 호환을 위해 빈 배열로 반환.
 */
export function detectProductNames(content: string): ProductNameFindings {
  const violations: ComplianceViolation[] = [];
  const warnings: string[] = [];
  if (!content) return { violations, warnings };

  // toRegex: 한글 상품명은 한글 좌측 경계, 영문 상품명은 영문 단어 경계(대소문자 무시)로 매칭.
  const categories: Array<{
    names: readonly string[];
    label: string;
    rule: string;
    toRegex: (name: string) => RegExp;
  }> = [
    {
      names: PRESCRIPTION_DRUG_NAMES,
      label: '전문의약품 상품명',
      rule: '전문의약품 상품명 광고 노출 소지 (의료법 제56조·약사법) — 교육 목적 서술은 예외이나 유인·심의 소지 주의',
      toRegex: buildProductRegex,
    },
    {
      names: MEDICAL_DEVICE_NAMES,
      label: '의료기기·전문시술 상품명',
      rule: '의료기기·전문시술 상품명 광고 노출 소지 (의료법 제56조) — 교육 목적 서술은 예외이나 심의 소지 주의',
      toRegex: buildProductRegex,
    },
    {
      names: PRESCRIPTION_DRUG_NAMES_EN,
      label: '전문의약품 상품명(영문)',
      rule: '전문의약품 상품명(영문) 광고 노출 소지 (의료법 제56조·약사법) — 교육 목적 서술은 예외이나 유인·심의 소지 주의',
      toRegex: buildProductRegexEn,
    },
  ];

  const covered: Array<[number, number]> = []; // 이미 검출한 매칭 범위(겹침 제거용)
  const overlaps = (from: number, to: number): boolean =>
    covered.some(([s, e]) => from < e && s < to);

  for (const { names, label, rule, toRegex } of categories) {
    // 긴 이름 먼저 처리 → `피코슈어` 범위를 선점해 `피코`의 중복 매칭을 막는다.
    const sortedNames = [...names].sort((a, b) => b.length - a.length);
    for (const name of sortedNames) {
      const re = toRegex(name);
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const index = match.index;
        const rangeEnd = index + name.length;
        if (overlaps(index, rangeEnd)) continue;
        covered.push([index, rangeEnd]);

        // 같은 문장 ∩ 40자 창 안에서만 광고성 어구를 탐색(오탐 방지).
        const [sentStart, sentEnd] = sentenceBounds(content, index);
        const windowStart = Math.max(sentStart, index - PROMO_PROXIMITY);
        const windowEnd = Math.min(sentEnd, rangeEnd + PROMO_PROXIMITY);
        const contextText = content.slice(windowStart, windowEnd);
        const hasPromoCue = PROMOTIONAL_CUES.some((cue) => contextText.includes(cue));

        // 단독=MEDIUM(표면화), 광고성 어구 근접=HIGH(발행 게이트 대상). 둘 다 위반으로 승격.
        violations.push({
          word: name,
          index,
          suggestion: hasPromoCue
            ? '광고·유인 맥락 — 상품명 노출 재검토(심의 필요)'
            : `${label} 노출 — 교육 목적이면 무방하나 검수팀 확인 필요`,
          rule,
          severity: hasPromoCue ? 'HIGH' : 'MEDIUM',
        });
      }
    }
  }

  return { violations, warnings };
}

export function autoFix(content: string): { fixed: string; replaced: { word: string; suggestion: string }[] } {
  let fixed = content;
  const replaced: { word: string; suggestion: string }[] = [];
  for (const { word, suggestion } of FORBIDDEN_WORDS) {
    if (buildForbiddenRegex(word).test(fixed)) {
      fixed = fixed.replace(buildForbiddenRegex(word), suggestion);
      replaced.push({ word, suggestion });
    }
  }
  return { fixed, replaced };
}

export function checkCompliance(content: string): ComplianceResult {
  const violations: ComplianceViolation[] = [];
  const warnings: string[] = [];
  let filteredContent = content;

  for (const { word, rule, suggestion, severity } of FORBIDDEN_WORDS) {
    const matcher = buildForbiddenRegex(word);
    const match = matcher.exec(content);

    if (match) {
      violations.push({ word, index: match.index, suggestion, rule, severity });
      filteredContent = filteredContent.replace(
        buildForbiddenRegex(word),
        `[${suggestion}]`
      );
    }
  }

  // 패턴 규칙 — severity 지정분은 위반으로 승격(등급 반영), 나머지는 경고로 표면화.
  // ⚠️ 승격분도 filteredContent 를 건드리지 않는다(자동치환 금지 — 검출·표시만).
  for (const { pattern, message, severity, rule, suggestion } of WARNING_PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;
    if (severity) {
      violations.push({
        word: match[0],
        index: match.index,
        suggestion: suggestion ?? '해당 표현 재검토 — 검수팀 확인 필요',
        rule: rule ?? message,
        severity,
      });
    } else {
      warnings.push(message);
    }
  }

  // 전문의약품·의료기기 상품명 검출 — **filteredContent 는 건드리지 않는다**(치환 금지).
  // 단독=MEDIUM, 광고성 어구 근접=HIGH 로 위반 목록에만 반영(경보만).
  const productFindings = detectProductNames(content);
  for (const v of productFindings.violations) violations.push(v);
  for (const w of productFindings.warnings) warnings.push(w);

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
   ❌ 전문의약품·의료기기 상품명(예: 위고비·삭센다·써마지·울쎄라 등)을 광고·유인 목적으로 노출
      (질환·원리를 설명하는 교육 목적 서술은 예외이나, 처방·도입·이벤트 등 유인 맥락과 결합하면 심의 소지가 크므로 피할 것)

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
