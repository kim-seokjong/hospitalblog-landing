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
