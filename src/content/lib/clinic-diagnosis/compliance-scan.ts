import type { PostBodyKind } from './post-seo.ts';
import type { ComplianceAxis, ComplianceHit } from './types.ts';

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

  for (const source of sources) {
    const result = checkFn(source.text);
    for (const violation of result.violations) {
      const severity = String(violation.severity).toUpperCase();
      hits.push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: violation.word,
        note: softenRule(violation.rule),
        level: severity === 'CRITICAL' || severity === 'HIGH' ? 'review' : 'caution',
      });
      postsWithHits.add(source.link);
    }
    for (const warning of result.warnings) {
      hits.push({
        postTitle: source.title || '(제목 없음)',
        postLink: source.link,
        phrase: '(문장 패턴)',
        note: `${warning.replace(/입니다\.$/, '어요.')} 확인이 필요합니다.`,
        level: 'caution',
      });
      postsWithHits.add(source.link);
    }
  }

  // review 를 먼저 보여준다 — 다만 정렬만 바꿀 뿐 항목을 버리지 않는다(상한 제외).
  const sorted = [...hits].sort((a, b) => (a.level === b.level ? 0 : a.level === 'review' ? -1 : 1));

  const kindOf = (source: ComplianceSource): PostBodyKind =>
    source.bodyKind ?? (source.hasBody ? 'full' : 'none');

  return {
    checked: sources.length > 0,
    postsScanned: sources.length,
    bodiesScanned: sources.filter((s) => kindOf(s) === 'full').length,
    summariesScanned: sources.filter((s) => kindOf(s) === 'summary').length,
    hits: sorted.slice(0, MAX_HITS),
    postsWithHits: postsWithHits.size,
  };
}

export const EMPTY_COMPLIANCE_AXIS: ComplianceAxis = {
  checked: false,
  postsScanned: 0,
  bodiesScanned: 0,
  summariesScanned: 0,
  hits: [],
  postsWithHits: 0,
};
