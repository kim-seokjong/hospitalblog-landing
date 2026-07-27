import type { PostBodyKind } from './post-seo.ts';
import type { ComplianceAxis, ComplianceHit, ComplianceRisk } from './types.ts';

/**
 * 2단계 ④ — 의료광고법 위험 신호 점검.
 *
 * ⚠️ 표현 규칙(가장 중요):
 *   우리는 심의기관이 아니다. **"위반입니다" · "처분 대상입니다"라고 단정하지 않는다.**
 *   전부 "심의에서 자주 지적되는 표현" · "확인이 필요합니다" 수준으로 쓴다.
 *   원장을 겁주면 방어부터 하고 대화가 끝난다.
 *
 * ⚠️ 게이트를 느슨하게 만들지 않는다:
 *   검출 자체는 기존 medical-compliance(A층 키워드 + 경고 패턴)를 **그대로** 쓴다.
 *   이 모듈이 하는 일은 검출 결과를 진단 화면 문구로 옮기는 것뿐이며,
 *   임계값을 낮추거나 항목을 제외하지 않는다.
 *
 * 데이터 한계:
 *   확보 수준이 글마다 다르다 — 최신 글은 본문 전문, 나머지는 RSS 가 준 앞부분
 *   요약, 그마저 없으면 제목뿐이다. 셋을 postsScanned/bodiesScanned/summariesScanned
 *   로 나눠 그대로 노출한다(어디까지 봤는지 뭉개지 않는다).
 *   본문 전문 점검은 상세 진단에서 사용자가 붙여넣게 한다.
 *
 * 크롤링 금지 — 공식 RSS·모바일 본문 1회 GET(blog-check-rss 재사용)만 쓴다.
 */

/** 심각도 → 진단 화면 등급. CRITICAL/HIGH 는 review, 그 외는 caution. */
export type SourceSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** 진단 화면에 노출할 검출 상한 (한 화면에 다 못 담으면 겁만 준다). */
export const MAX_HITS = 12;

/**
 * 검출 근거 문구 — 단정하지 않는 표현으로 통일한다.
 * medical-compliance 의 rule 문자열(법조문 인용)을 그대로 노출하면 "위반 판정"으로
 * 읽히므로, 여기서 "심의에서 자주 지적됩니다" 톤으로 감싼다.
 */
export function softenRule(rule: string): string {
  const base = (rule ?? '').replace(/\s*\(의료법[^)]*\)\s*/g, '').replace(/금지$/, '').trim();
  if (!base) return '의료광고 심의에서 자주 지적되는 표현이에요. 확인이 필요합니다.';
  return `${base} 관련 표현이라 의료광고 심의에서 자주 지적돼요. 확인이 필요합니다.`;
}

/* ── 위험 등급 분류 ─────────────────────────────────────── */

/**
 * **의료법이 광고에서 명시적으로 금지한 유형**만 여기에 넣는다.
 *
 * 왜 나누나: 실측(리팅성형외과)에서 11건이 전부 같은 무게로 나열됐는데,
 * 그 안에는 "후기"(환자 경험담)처럼 법이 유형 자체를 금지한 것과
 * "최신"·"제일"처럼 문맥에 따라 갈리는 것이 섞여 있었다. 같은 색으로 늘어놓으면
 * 원장은 어느 것부터 손대야 할지 알 수 없고, 전부 무시하게 된다.
 *
 * ⚠️ 등재 기준(느슨하게 만들지 말 것):
 *   · 의료법이 **광고 유형 자체를 금지**한다고 말할 수 있는 것만 넣는다.
 *   · 조문 번호·항·호는 적지 않는다. 유형만 서술한다(우리는 심의기관이 아니다).
 *   · 최상급("제일"·"최고")·"최신"·유명인 언급·이벤트/할인 유인처럼 **문맥에 따라
 *     갈리거나 광역 탐색(recall 우선)으로 오탐이 섞이는 것**은 절대 넣지 않는다.
 *     빨간 등급이 흔해지면 빨간색이 아무 의미도 없어진다.
 *
 * 매칭 대상 문자열은 검출 단어 + 규칙명(또는 경고 문구)을 합친 것이다.
 */
const PROHIBITED_TYPES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  // 환자 후기·치료경험담 — 의료법이 광고에서 금지한 대표 유형.
  // ('사례'는 단독으로 쓰면 규칙 설명문의 "시정명령 사례"까지 걸리므로 환자·개인에 붙을 때만)
  { label: '환자 후기·치료경험담', pattern: /후기|경험담|체험담|내돈내산|직접\s*받아\s*보니|환자\s*사례|개인\s*사례/ },
  // 치료 전후 비교 사진·표현.
  { label: '치료 전후 비교', pattern: /전후\s*사진|전후\s*비교|비포애프터|before\s*.?\s*after/i },
  // 치료효과·결과 보장, 부작용 없음·완전 안전 단정.
  {
    label: '치료효과 보장·부작용 없음 단정',
    pattern: /결과\s*보장|효과\s*보장|치료\s*결과\s*보장|완치|100%|무조건|확실한\s*효과|부작용\s*없|부작용이\s*없|완전히\s*안전|위험\s*없/,
  },
  // 다른 의료기관·의료인과의 비교, 비방.
  { label: '다른 병원과의 비교·비방', pattern: /비교\s*광고|타\s*병원|다른\s*병원|경쟁병원|비방/ },
];

/**
 * 검출 1건의 위험 등급을 매긴다 (순수 함수).
 * signal 은 "검출 단어 + 규칙명"(위반) 또는 경고 문구(패턴 경고)를 합친 문자열.
 */
export function classifyComplianceRisk(signal: string): {
  readonly risk: ComplianceRisk;
  readonly label: string | null;
} {
  const text = signal ?? '';
  for (const type of PROHIBITED_TYPES) {
    if (type.pattern.test(text)) return { risk: 'prohibited', label: type.label };
  }
  return { risk: 'caution', label: null };
}

/**
 * 위험 등급 검출의 근거 문구.
 * ⚠️ "위반입니다"라고 쓰지 않는다 — "명시적으로 금지한 유형"까지가 한계다.
 */
export function prohibitedNote(label: string): string {
  return `${label} — 의료법이 광고에서 명시적으로 금지한 유형이에요. 이 표현이 실제로 그 유형에 해당하는지 먼저 확인해 보세요.`;
}

/** 저장된 리포트 호환 — risk 가 없던 시절 리포트는 전부 '주의'로 읽는다. */
export function riskOf(hit: Pick<ComplianceHit, 'risk'>): ComplianceRisk {
  return hit.risk ?? 'caution';
}

export interface ComplianceSource {
  readonly title: string;
  readonly link: string;
  /** 검사 대상 텍스트 (제목 또는 제목+본문). */
  readonly text: string;
  /** 본문 전문까지 확보했는가. */
  readonly hasBody: boolean;
  /** 확보 수준 — 미지정이면 hasBody 로 유추한다(기존 호출부 호환). */
  readonly bodyKind?: PostBodyKind;
}

/** medical-compliance.checkCompliance 의 반환 형태 중 이 모듈이 쓰는 부분. */
export interface ComplianceCheckShape {
  readonly violations: ReadonlyArray<{
    readonly word: string;
    readonly rule: string;
    readonly severity: SourceSeverity | string;
  }>;
  readonly warnings: readonly string[];
}

/**
 * 검사 결과 → 진단 화면 항목 (순수 함수).
 * checkFn 은 호출부가 주입한다(테스트에서 목 주입 가능, 운영은 medical-compliance).
 */
export function buildComplianceAxis(
  sources: readonly ComplianceSource[],
  checkFn: (text: string) => ComplianceCheckShape,
): ComplianceAxis {
  const hits: ComplianceHit[] = [];
  const postsWithHits = new Set<string>();
  const postsWithProhibited = new Set<string>();

  const push = (hit: ComplianceHit): void => {
    hits.push(hit);
    postsWithHits.add(hit.postLink);
    if (hit.risk === 'prohibited') postsWithProhibited.add(hit.postLink);
  };

  for (const source of sources) {
    const result = checkFn(source.text);
    for (const violation of result.violations) {
      const severity = String(violation.severity).toUpperCase();
      const { risk, label } = classifyComplianceRisk(`${violation.word} ${violation.rule}`);
      push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: violation.word,
        note: risk === 'prohibited' && label ? prohibitedNote(label) : softenRule(violation.rule),
        level: severity === 'CRITICAL' || severity === 'HIGH' ? 'review' : 'caution',
        risk,
        ...(risk === 'prohibited' && label ? { riskLabel: label } : {}),
      });
    }
    for (const warning of result.warnings) {
      const { risk, label } = classifyComplianceRisk(warning);
      push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: '(문장 패턴)',
        note:
          risk === 'prohibited' && label
            ? prohibitedNote(label)
            : `${warning.replace(/입니다\.$/, '어요.')} 확인이 필요합니다.`,
        level: 'caution',
        risk,
        ...(risk === 'prohibited' && label ? { riskLabel: label } : {}),
      });
    }
  }

  /**
   * 위험(명시적 금지 유형) → 그다음 review → 나머지 순.
   * 정렬만 바꿀 뿐 항목을 버리지 않는다(표시 상한 MAX_HITS 제외).
   * ⚠️ 상한에 잘려도 위험 건수는 아래 prohibitedCount 로 정확히 남는다.
   */
  const weight = (hit: ComplianceHit): number =>
    (riskOf(hit) === 'prohibited' ? 0 : 2) + (hit.level === 'review' ? 0 : 1);
  const sorted = [...hits].sort((a, b) => weight(a) - weight(b));

  const kindOf = (source: ComplianceSource): PostBodyKind =>
    source.bodyKind ?? (source.hasBody ? 'full' : 'none');
  const prohibitedCount = hits.filter((h) => riskOf(h) === 'prohibited').length;

  return {
    checked: sources.length > 0,
    postsScanned: sources.length,
    bodiesScanned: sources.filter((s) => kindOf(s) === 'full').length,
    summariesScanned: sources.filter((s) => kindOf(s) === 'summary').length,
    hits: sorted.slice(0, MAX_HITS),
    postsWithHits: postsWithHits.size,
    prohibitedCount,
    cautionCount: hits.length - prohibitedCount,
    postsWithProhibited: postsWithProhibited.size,
  };
}

export const EMPTY_COMPLIANCE_AXIS: ComplianceAxis = {
  checked: false,
  postsScanned: 0,
  bodiesScanned: 0,
  summariesScanned: 0,
  hits: [],
  postsWithHits: 0,
  prohibitedCount: 0,
  cautionCount: 0,
  postsWithProhibited: 0,
};

/**
 * 위험·주의 건수 (저장된 구 리포트 호환).
 * prohibitedCount 가 없던 시절 리포트는 표시된 hits 로 세어 폴백한다.
 */
export function complianceRiskCounts(axis: ComplianceAxis): {
  readonly prohibited: number;
  readonly caution: number;
  readonly postsWithProhibited: number;
} {
  if (typeof axis.prohibitedCount === 'number') {
    return {
      prohibited: axis.prohibitedCount,
      caution: axis.cautionCount ?? Math.max(0, axis.hits.length - axis.prohibitedCount),
      postsWithProhibited: axis.postsWithProhibited ?? 0,
    };
  }
  const prohibited = axis.hits.filter((h) => riskOf(h) === 'prohibited').length;
  return {
    prohibited,
    caution: axis.hits.length - prohibited,
    postsWithProhibited: new Set(axis.hits.filter((h) => riskOf(h) === 'prohibited').map((h) => h.postLink)).size,
  };
}
