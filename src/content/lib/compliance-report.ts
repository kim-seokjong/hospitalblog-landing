/**
 * 컴플라이언스 증빙 리포트 + 소급 진단 — 순수 로직 모듈.
 *
 * 1) 리포트 스냅샷: 글 생성 시 수행된 의료광고법 검사(A층 키워드/상품명
 *    checkCompliance + B층 LLM 심의관 reviewComplianceWithAI) 결과를
 *    saved_posts.compliance_report(jsonb)에 저장할 표준 형태로 빌드·검증한다.
 * 2) 소급 진단: 기존 네이버 블로그 글 소급 스캔(/api/blog-audit)의
 *    위험점수 산정·쿨다운 판정·결과 조립.
 *
 * ⚠️ 이 모듈은 네트워크·SDK 의존이 없는 순수 로직만 담는다.
 *    node --experimental-strip-types 테스트 러너가 별칭·상대 경로 해석 없이
 *    로드할 수 있도록 값 import 를 두지 않고 type-only import 만 사용한다
 *    (medical-compliance-ai 패턴). 리포트·진단 로직이 등급 산정을 공유하므로
 *    러너 제약(상대 값 import 불가) 하에서 한 파일로 유지한다.
 */

import type { ComplianceResult, ComplianceViolation } from '@/types';
import type { AiComplianceFinding, AiComplianceReview } from './medical-compliance-ai';

/**
 * 검사 엔진 버전 라벨 — 리포트에 표기되는 증빙용 식별자.
 * 검사 체계(층 구성·룰셋 대개편)가 바뀔 때만 올린다.
 */
export const COMPLIANCE_ENGINE_VERSION = 'doctorpost-compliance v1';

/** 스냅샷 스키마 버전(파싱 하위 호환용). */
export const COMPLIANCE_REPORT_SCHEMA_VERSION = 1;

/** 최종 등급 — PASS(검출 없음) < LOW < MEDIUM < HIGH < CRITICAL. */
export type ComplianceGrade = 'PASS' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** 스냅샷에 담는 A층 위반 항목(원본 ComplianceViolation 과 동일 형태). */
export interface ReportViolation {
  word: string;
  index: number;
  suggestion: string;
  rule: string;
  severity: string;
}

/** 스냅샷에 담는 B층 지적 항목(AiComplianceFinding 과 동일 형태). */
export interface ReportAiFinding {
  category: string;
  snippet: string;
  severity: string;
  reason: string;
  needsReview: boolean;
}

/** saved_posts.compliance_report 에 저장되는 검사 증빙 스냅샷. */
export interface ComplianceReportSnapshot {
  version: number;
  /** 검사 엔진 버전 라벨(증빙 표기용). */
  engine: string;
  /** 검사 시각(ISO 8601). */
  checkedAt: string;
  /** 최종 등급. */
  grade: ComplianceGrade;
  /** 발행 전 검수 권고 플래그(하드 차단 아님). */
  needsManualReview: boolean;
  /** A층 — 키워드/상품명 검사 결과. */
  keyword: {
    isCompliant: boolean;
    violations: ReportViolation[];
    warnings: string[];
  };
  /** B층 — LLM 심의관 결과. 심의 미수행(실패/스킵) 시 null. */
  aiReview: {
    reviewed: boolean;
    findings: ReportAiFinding[];
  } | null;
}

/** 스냅샷 크기 상한(비정상 페이로드 방어) — 배열 길이·문자열 길이 캡. */
const MAX_VIOLATIONS = 100;
const MAX_WARNINGS = 50;
const MAX_FINDINGS = 50;
const MAX_TEXT_LEN = 300;

const GRADES: readonly ComplianceGrade[] = ['PASS', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * generate-content 응답 경로에서 B층 지적이 compliance.warnings 로 합류할 때
 * 붙는 접두사 — 스냅샷 A층 warnings 에서는 중복 방지를 위해 걸러낸다
 * (B층 지적은 aiReview.findings 가 원본 그대로 보관).
 */
const AI_WARNING_PREFIX = '[AI 심의·';

/**
 * 최종 등급을 산정한다.
 * - A층 CRITICAL 위반 → CRITICAL
 * - A층/B층 HIGH → HIGH
 * - A층/B층 MEDIUM → MEDIUM
 * - 경고(warnings) 또는 B층 LOW 지적만 있으면 → LOW
 * - 아무 검출 없음 → PASS
 */
export function computeComplianceGrade(input: {
  violations: ReadonlyArray<{ severity: string }>;
  warnings: ReadonlyArray<string>;
  aiFindings?: ReadonlyArray<{ severity: string }>;
}): ComplianceGrade {
  const { violations, warnings } = input;
  const aiFindings = input.aiFindings ?? [];

  if (violations.some((v) => v.severity === 'CRITICAL')) return 'CRITICAL';
  if (violations.some((v) => v.severity === 'HIGH') || aiFindings.some((f) => f.severity === 'HIGH')) {
    return 'HIGH';
  }
  if (violations.some((v) => v.severity === 'MEDIUM') || aiFindings.some((f) => f.severity === 'MEDIUM')) {
    return 'MEDIUM';
  }
  if (warnings.length > 0 || aiFindings.length > 0) return 'LOW';
  return 'PASS';
}

/** buildComplianceReport 입력 — generate-content 응답의 compliance/aiReview 형태. */
export interface BuildReportInput {
  compliance: {
    isCompliant: boolean;
    violations: ReadonlyArray<ComplianceViolation>;
    warnings: ReadonlyArray<string>;
  };
  aiReview?: Pick<AiComplianceReview, 'reviewed' | 'findings'> | null;
  /** 검사 시각(기본: 호출 시각). 재검사 경로에서 명시 전달. */
  checkedAt?: string;
}

/**
 * 검사 결과를 증빙 스냅샷으로 정리한다(불변 — 입력을 변경하지 않음).
 *
 * compliance.warnings 에 B층 지적 문자열([AI 심의·…])이 합류돼 있으면
 * A층 warnings 에서 제거한다(B층 원본은 aiReview.findings 가 보관 → 중복 방지).
 */
export function buildComplianceReport(input: BuildReportInput): ComplianceReportSnapshot {
  const { compliance } = input;
  const aiReview = input.aiReview ?? null;
  const reviewed = aiReview?.reviewed === true;
  const findings: AiComplianceFinding[] = reviewed && Array.isArray(aiReview?.findings)
    ? aiReview.findings
    : [];

  const keywordWarnings = compliance.warnings.filter((w) => !w.startsWith(AI_WARNING_PREFIX));

  const grade = computeComplianceGrade({
    violations: compliance.violations,
    warnings: keywordWarnings,
    aiFindings: findings,
  });

  const needsManualReview =
    compliance.violations.some((v) => v.severity === 'HIGH' || v.severity === 'CRITICAL') ||
    findings.some((f) => f.severity === 'HIGH');

  return {
    version: COMPLIANCE_REPORT_SCHEMA_VERSION,
    engine: COMPLIANCE_ENGINE_VERSION,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    grade,
    needsManualReview,
    keyword: {
      isCompliant: compliance.isCompliant,
      violations: compliance.violations.map((v) => ({
        word: v.word,
        index: v.index,
        suggestion: v.suggestion,
        rule: v.rule,
        severity: v.severity,
      })),
      warnings: [...keywordWarnings],
    },
    aiReview: reviewed
      ? {
          reviewed: true,
          findings: findings.map((f) => ({
            category: f.category,
            snippet: f.snippet,
            severity: f.severity,
            reason: f.reason,
            needsReview: f.needsReview,
          })),
        }
      : null,
  };
}

/** 문자열 필드를 안전하게 자른다(비문자열은 빈 문자열). */
function safeText(value: unknown, maxLen = MAX_TEXT_LEN): string {
  return typeof value === 'string' ? value.slice(0, maxLen) : '';
}

/**
 * 외부 입력(클라이언트가 POST /api/posts 로 보낸 compliance_report)을 검증·정규화한다.
 *
 * - 형태가 스냅샷 스키마와 다르면 null(저장 스킵 — 글 저장 자체는 막지 않는 방침).
 * - 배열 길이·문자열 길이를 캡해 비정상 페이로드로 인한 저장 팽창을 방어한다.
 * - 등급·시각 등 핵심 필드는 허용값으로 강제한다.
 */
export function validateComplianceReport(raw: unknown): ComplianceReportSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // 핵심 필드 형태 검증
  if (typeof obj.version !== 'number' || obj.version < 1) return null;
  if (typeof obj.checkedAt !== 'string' || Number.isNaN(Date.parse(obj.checkedAt))) return null;
  if (typeof obj.grade !== 'string' || !(GRADES as string[]).includes(obj.grade)) return null;

  const keywordRaw = obj.keyword;
  if (!keywordRaw || typeof keywordRaw !== 'object' || Array.isArray(keywordRaw)) return null;
  const keyword = keywordRaw as Record<string, unknown>;
  if (!Array.isArray(keyword.violations) || !Array.isArray(keyword.warnings)) return null;

  const violations: ReportViolation[] = [];
  for (const item of keyword.violations.slice(0, MAX_VIOLATIONS)) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const word = safeText(v.word, 100);
    const rule = safeText(v.rule);
    if (!word && !rule) continue; // 완전 빈 원소는 스킵
    violations.push({
      word,
      index: typeof v.index === 'number' && Number.isFinite(v.index) ? Math.max(0, Math.floor(v.index)) : 0,
      suggestion: safeText(v.suggestion),
      rule,
      severity: safeText(v.severity, 20) || 'MEDIUM',
    });
  }

  const warnings = keyword.warnings
    .slice(0, MAX_WARNINGS)
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.slice(0, MAX_TEXT_LEN));

  // aiReview 는 선택적(null 허용). 형태가 어긋나면 null 로 강등(저장 자체는 계속).
  let aiReview: ComplianceReportSnapshot['aiReview'] = null;
  const aiRaw = obj.aiReview;
  if (aiRaw && typeof aiRaw === 'object' && !Array.isArray(aiRaw)) {
    const ai = aiRaw as Record<string, unknown>;
    if (ai.reviewed === true && Array.isArray(ai.findings)) {
      const findings: ReportAiFinding[] = [];
      for (const item of ai.findings.slice(0, MAX_FINDINGS)) {
        if (!item || typeof item !== 'object') continue;
        const f = item as Record<string, unknown>;
        const category = safeText(f.category, 60);
        const reason = safeText(f.reason);
        if (!category && !reason) continue;
        findings.push({
          category: category || '심의미필',
          snippet: safeText(f.snippet, 200),
          severity: safeText(f.severity, 20) || 'LOW',
          reason,
          needsReview: f.needsReview === false ? false : true,
        });
      }
      aiReview = { reviewed: true, findings };
    }
  }

  return {
    version: Math.floor(obj.version),
    engine: safeText(obj.engine, 100) || COMPLIANCE_ENGINE_VERSION,
    checkedAt: obj.checkedAt,
    grade: obj.grade as ComplianceGrade,
    needsManualReview: obj.needsManualReview === true,
    keyword: {
      isCompliant: keyword.isCompliant === true,
      violations,
      warnings,
    },
    aiReview,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * 소급 진단(blog audit) — 기존 네이버 블로그 위험 스캔용 순수 로직
 * ──────────────────────────────────────────────────────────────────────── */

/** 재실행 쿨다운(시간) — 수집·LLM 비용 방어. admin 은 라우트에서 예외 처리. */
export const AUDIT_COOLDOWN_HOURS = 24;

/** 진단 수집 상한 — 최근 20편. */
export const AUDIT_POST_LIMIT = 20;

/** 진단용 본문 수집 상한(자) — VOICE-DNA(2000자)보다 넓게 잡아 위반 누락 방지. */
export const AUDIT_BODY_MAX_CHARS = 6000;

/** B층 LLM 심의 상한 — A층 위험점수 상위 N편만(비용 방어). */
export const AUDIT_AI_REVIEW_LIMIT = 5;

/** 위험 발췌 앞뒤 문맥 길이(자). */
const EXCERPT_RADIUS = 30;

/** A층 심각도별 위험점수 가중치. */
const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 8,
  HIGH: 5,
  MEDIUM: 2,
};

/** 경고(warnings) 1건당 위험점수. */
const WARNING_WEIGHT = 1;

/** 글 1편의 A층 위반 — 위험 표현 발췌 포함. */
export interface AuditViolation extends ReportViolation {
  /** 위반 표현 주변 원문 발췌(앞뒤 30자, 절단부 "…" 표시). */
  excerpt: string;
}

/** 글 1편의 진단 결과. */
export interface AuditPostResult {
  title: string;
  link: string;
  /** A층 위험점수(심각도 가중 합 + 경고 수) — B층 심의 대상 선정 기준. */
  riskScore: number;
  /** 최종 등급(B층 심의를 받은 글은 B층 지적 반영). */
  grade: ComplianceGrade;
  violations: AuditViolation[];
  warnings: string[];
  /** B층 심의 지적(심의 대상 상위 글만). 미심의 글은 undefined. */
  aiFindings?: ReportAiFinding[];
  /** 이 글이 B층 LLM 심의를 받았는가. */
  aiReviewed: boolean;
}

/** blog_audits.results 에 저장되는 진단 결과 전체. */
export interface BlogAuditResults {
  version: number;
  engine: string;
  blogId: string;
  runAt: string;
  totalPosts: number;
  /** 위반 소지 글 수(MEDIUM 이상). LOW 는 '주의'로 별도 카운트하지 않는다. */
  riskyPosts: number;
  posts: AuditPostResult[];
}

/**
 * A층 위험점수를 산정한다 — CRITICAL 8 / HIGH 5 / MEDIUM 2, 경고 1건당 1점.
 * B층 심의 대상(상위 5편) 선정과 카드 정렬에 쓴다. 미지정 심각도는 MEDIUM 가중.
 */
export function computeRiskScore(
  violations: ReadonlyArray<{ severity: string }>,
  warningCount: number,
): number {
  const violationScore = violations.reduce(
    (sum, v) => sum + (SEVERITY_WEIGHT[v.severity] ?? SEVERITY_WEIGHT.MEDIUM),
    0,
  );
  return violationScore + Math.max(0, warningCount) * WARNING_WEIGHT;
}

/**
 * 재실행 쿨다운이 아직 유효한지 판정한다.
 * lastRunAt 이 없거나 파싱 불가면 false(실행 허용 — graceful).
 */
export function isCooldownActive(
  lastRunAt: string | null | undefined,
  now: Date = new Date(),
  hours: number = AUDIT_COOLDOWN_HOURS,
): boolean {
  if (!lastRunAt) return false;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < hours * 60 * 60 * 1000;
}

/** 쿨다운 해제 시각(ISO)을 계산한다. lastRunAt 파싱 불가 시 null. */
export function cooldownEndsAt(
  lastRunAt: string,
  hours: number = AUDIT_COOLDOWN_HOURS,
): string | null {
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return null;
  return new Date(last + hours * 60 * 60 * 1000).toISOString();
}

/** 위반 위치 주변 원문을 발췌한다(앞뒤 radius 자, 절단부 "…" 표시). */
export function buildExcerpt(
  content: string,
  index: number,
  wordLength: number,
  radius: number = EXCERPT_RADIUS,
): string {
  if (!content) return '';
  const safeIndex = Math.max(0, Math.min(index, content.length));
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(content.length, safeIndex + Math.max(0, wordLength) + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * A층 검사 결과로 글 1편의 진단 결과를 조립한다(B층 미반영 상태, 불변).
 */
export function buildAuditPost(input: {
  title: string;
  link: string;
  body: string;
  compliance: Pick<ComplianceResult, 'violations' | 'warnings'>;
}): AuditPostResult {
  const { title, link, body, compliance } = input;
  const violations: AuditViolation[] = compliance.violations.map((v) => ({
    word: v.word,
    index: v.index,
    suggestion: v.suggestion,
    rule: v.rule,
    severity: v.severity,
    excerpt: buildExcerpt(body, v.index, v.word.length),
  }));
  const warnings = [...compliance.warnings];

  return {
    title,
    link,
    riskScore: computeRiskScore(violations, warnings.length),
    grade: computeComplianceGrade({ violations, warnings }),
    violations,
    warnings,
    aiReviewed: false,
  };
}

/**
 * B층 심의 지적을 글 진단 결과에 반영한 새 객체를 반환한다(불변).
 * 등급은 A층 위반 + B층 지적을 합산해 재산정한다.
 */
export function applyAiFindings(
  post: AuditPostResult,
  findings: ReadonlyArray<ReportAiFinding>,
): AuditPostResult {
  return {
    ...post,
    aiReviewed: true,
    aiFindings: [...findings],
    grade: computeComplianceGrade({
      violations: post.violations,
      warnings: post.warnings,
      aiFindings: findings,
    }),
  };
}

/** 등급이 MEDIUM 이상(위반 소지)인지 판정한다. */
export function isRiskyGrade(grade: ComplianceGrade): boolean {
  return grade === 'MEDIUM' || grade === 'HIGH' || grade === 'CRITICAL';
}

/**
 * 진단 결과 전체를 조립한다 — riskyPosts(MEDIUM 이상) 집계 포함.
 * posts 는 위험점수 내림차순으로 정렬해 반환한다(카드 표시 순서).
 */
export function buildAuditResults(input: {
  blogId: string;
  posts: ReadonlyArray<AuditPostResult>;
  runAt?: string;
}): BlogAuditResults {
  const sorted = [...input.posts].sort((a, b) => b.riskScore - a.riskScore);
  return {
    version: 1,
    engine: COMPLIANCE_ENGINE_VERSION,
    blogId: input.blogId,
    runAt: input.runAt ?? new Date().toISOString(),
    totalPosts: sorted.length,
    riskyPosts: sorted.filter((p) => isRiskyGrade(p.grade)).length,
    posts: sorted,
  };
}
