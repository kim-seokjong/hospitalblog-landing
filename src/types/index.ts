import type { SerpBenchmark } from '@/content/lib/serp-benchmark';
import type { AiComplianceReview } from '@/content/lib/medical-compliance-ai';
import type { ComplianceReportSnapshot } from '@/content/lib/compliance-report';

export type { SerpBenchmark } from '@/content/lib/serp-benchmark';
export type { AiComplianceReview, AiComplianceFinding, AiViolationSeverity } from '@/content/lib/medical-compliance-ai';
export type {
  ComplianceReportSnapshot,
  ComplianceGrade,
  AuditPostResult,
  AuditViolation,
  BlogAuditResults,
} from '@/content/lib/compliance-report';

export interface SeoDetails {
  keywordPlacement: number;  // 키워드 앞배치 점수
  titleLength: number;        // 제목 길이 적정성
  clickability: number;       // 클릭 유도성
  compliance: number;         // 의료광고법 준수
  format: '질문형' | '정보형' | '가이드형' | '노하우형' | '숫자형' | '비교형';
  explanation: string;        // SEO 강점 설명
}

export interface BlogTitle {
  id: string;
  title: string;
  seoScore: number;
  keyword: string;
  seoDetails: SeoDetails;
}

export type ViolationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface ComplianceViolation {
  word: string;
  index: number;
  suggestion: string;
  rule: string;
  severity: ViolationSeverity;
}

export interface ComplianceResult {
  isCompliant: boolean;
  violations: ComplianceViolation[];
  warnings: string[];
  filteredContent: string;
}

export interface ImagePlacementHint {
  section: string;
  description: string;
}

export interface ImageGuidelines {
  recommendedCount: number;
  placementHints: ImagePlacementHint[];
  altTextSuggestions: string[];
}

export interface BlogContent {
  title: string;
  body: string;
  charCount: number;
  compliance: ComplianceResult;
  autoReplaced?: { word: string; suggestion: string }[];
  /**
   * A층이 검출해 자동교정한 위반 — 최종 본문에는 없지만 "검사가 작동했다"는 증빙.
   * compliance_report.keyword.autoFixed 로 저장된다.
   */
  autoFixedViolations?: ComplianceViolation[];
  imageGuidelines: ImageGuidelines;
  seoAnalysis: {
    keywordCount: number;
    h2Count: number;
    h3Count: number;
    estimatedReadingTime: number;
    structureScore: number;
    firstParaKeyword: boolean;
    subheadingWithKeyword: number;
    longtailCoverage: number;
    longtailTotal: number;
  };
  geoAnalysis?: {
    hasSummaryBox: boolean;
    hasFaqSection: boolean;
    faqCount: number;
    definitiveStatementCount: number;
    numericalDataCount: number;
    authoritySignalCount: number;
    geoScore: number;
  };
  /**
   * 상위노출 역분석 벤치마크 — 키워드 상위 글의 공통 골격(목표 글자수/소제목/이미지 등).
   * 분석 실패·키워드 없음 등으로 산출 불가 시 null/undefined (SeoAnalysis 는 고정 기준 폴백).
   */
  serpBenchmark?: SerpBenchmark | null;
  /**
   * Layer B — LLM 심의관 결과. 심의를 수행하지 못했거나(reviewed=false) 구버전 응답은 undefined.
   * "위반 소지/심의 필요" 톤의 지적 목록이며, 최종 판단은 검수팀 몫(isCompliant 를 뒤집지 않음).
   */
  aiReview?: AiComplianceReview | null;
  /**
   * 발행 게이트 권고 플래그 — Layer A HIGH/CRITICAL 위반 또는 Layer B HIGH 지적이 있으면 true.
   * 하드 차단이 아니라 "발행 전 검수팀 확인 권장" 권고 플래그.
   */
  needsManualReview?: boolean;
}

export interface BlogTag {
  tag: string;
  category: '질환' | '치료' | '병원' | '지역' | '증상' | '정보';
  priority: number;
  searchVolume: '높음' | '중간' | '낮음';
}

export interface TagResult {
  tags: BlogTag[];
  hashtags: string[];
  naverTags: string[];
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  revised_prompt?: string;
}

export type AppStep = 'keyword' | 'titles' | 'content' | 'images' | 'preview';

export type WritingStyle = '전문가' | '고객이해' | '사무장';

export type OptimizationMode = 'seo+geo' | 'seo';

export type TargetSite = 'naver' | 'google';

/**
 * 글 난이도(가독성) 축 — 글쓰기 시점(WritingStyle)과 독립(직교)으로 곱해진다.
 * - 'easy'     = DUMBIFY ON / L1 균형: 중학생도 이해할 쉬운 말로 풀되 전문성·신뢰는 유지.
 * - 'standard' = 끔: 난이도 조정 없음.
 * 미지정/구버전 하위호환 시 기본값은 'easy'(쉬운 쪽).
 */
export type Readability = 'easy' | 'standard';

/**
 * 본문 생성 선택 옵션 — 의료광고법 리스크가 있어 기본 OFF인 작문 강화 토글.
 * ANTI-AI/DUMBIFY/VOICE-DNA·SEO/GEO와 독립으로 곱해지며, 의료광고법이 항상 최종 우선.
 * - viralHook: "검색의도 즉답형 인트로"(과장·공포·클릭베이트·수치단정 금지) ON/OFF.
 * - storytelling: "증상→원인→관리 서사 흐름"(환자 후기·치료경험담·가공 사례 금지, 의료법 제56조) ON/OFF.
 * 미지정/구버전 하위호환 시 둘 다 false(끔).
 */
export interface ContentEnhancers {
  viralHook: boolean;
  storytelling: boolean;
}

export interface SlideStyleConfig {
  name: string;
  emoji: string;
  bgGradient: [string, string];
  accentColor: string;
  accentTextColor: string;
  mainTextColor: string;
  subTextColor: string;
  boxFillColor: string;
  infoBgColor: string;
  decorColor: string;
  dividerColor: string;
  tagBgColor: string;
}

export interface CardNewsTopic {
  icon: string;
  title: string;
  desc: string;
}

export interface CardNewsStep {
  num: string;
  icon: string;
  title: string;
  desc: string;
}

export interface CardNewsData {
  hospitalName: string;
  coverTitle: string;
  coverSubtitle: string;
  coverTopics: CardNewsTopic[];
  stepsTitle: string;
  steps: CardNewsStep[];
  conclusionSub: string;
  conclusionTitle: string;
  conclusionPoints: string[];
  footerText: string;
}

export interface SavedPost {
  id: string
  user_id: string
  title: string
  content: string
  keyword: string | null
  tags: string[] | null
  specialty: string | null
  seo_score: number | null
  image_urls: string[] | null
  sns_copy: string | null
  sms_copy: string | null
  status: 'draft' | 'scheduled' | 'published'
  scheduled_at: string | null
  published_at: string | null
  /** 게시 사이트 — 마이그레이션 018 적용 전 행/구버전 행은 null (네이버로 간주) */
  target_site?: TargetSite | null
  /** 발행된 글 URL — 마이그레이션 027 적용 전/URL 미수집 행은 null (순위 매칭은 블로그ID로 폴백) */
  published_url?: string | null
  /** 의료광고법 검사 증빙 스냅샷 — 마이그레이션 034 적용 전/구버전 글은 null (리포트 페이지에서 즉석 재검사) */
  compliance_report?: ComplianceReportSnapshot | null
  /** 병원 서브도메인 블로그 공개 여부 — 마이그레이션 043 적용 전 행은 undefined/null (미발행 간주) */
  published_to_site?: boolean | null
  /** 서브도메인 블로그 발행 시각 — 발행 취소 시 null */
  site_published_at?: string | null
  created_at: string
  updated_at: string
}
