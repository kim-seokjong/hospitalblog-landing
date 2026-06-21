/**
 * 마이페이지 API 응답 타입 (인사팀 소관).
 * /api/mypage/subscription, /api/mypage/usage 라우트와 탭 컴포넌트가 공유.
 */

export interface SubscriptionInfo {
  plan: string | null;
  planName: string | null;
  price: number | null;
  usageLimit: number | null; // -1 = 무제한
  planExpiresAt: string | null;
  isActive: boolean; // 만료일 기준 플랜 활성 여부
  autoRenew: boolean; // 활성 빌링키 존재 여부 (자동갱신)
  isTrial: boolean; // 무료 체험 진행 중
  trialUntil: string | null;
  nextBillingAt: string | null;
  cardName: string | null;
  cardLast4: string | null;
}

export interface MonthlyUsagePoint {
  month: string; // 'YYYY-MM'
  posts: number; // 글 생성 횟수
  images: number; // 이미지 생성 수
}

export interface ClinicflixUsageView {
  video: { used: number; limit: number };
  channel: { used: number; limit: number; softCap: number | null; cap: number };
}

export interface UsageSummary {
  planName: string | null;
  usageCount: number; // 이번 달 글 생성 횟수 (월간 리셋 반영)
  monthlyLimit: number; // -1 = 무제한, 0 = 플랜 없음
  imageCount: number; // 이번 달 이미지 생성 수
  monthly: MonthlyUsagePoint[]; // 최근 6개월 추이 (과거 → 현재 순)
  clinicflix?: ClinicflixUsageView | null; // 번들 플랜 한정 영상/멀티채널 사용량
}
