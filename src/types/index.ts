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
  created_at: string
  updated_at: string
}
