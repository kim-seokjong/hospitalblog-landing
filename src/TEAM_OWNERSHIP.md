# src/app/ 라우트 팀 소관 매핑

> Next.js App Router 강제 규약으로 `src/app/`은 이동할 수 없어, 라우트별 소관 팀만 여기에 기록합니다. 코드 수정 시 해당 팀 CLAUDE.md 규칙을 적용하세요.
>
> 참조: `C:\Users\PC\OneDrive\바탕 화면\클로드코드\hospitalblog\` 의 팀별 CLAUDE.md

## 페이지 (src/app/**/page.tsx)

| 경로 | 소관 팀 | 설명 |
|---|---|---|
| `/` (page.tsx) | content | 메인 랜딩 |
| `/app` | content | 워크스페이스 (블로그 생성 메인) |
| `/app/subscription` | payment | 구독 관리·해지 |
| `/admin` | hr | 관리자 대시보드 |
| `/calendar` | content | 발행 캘린더 |
| `/history` | content | 글 작성 히스토리 |
| `/monitor` | research | 경쟁사 모니터 |
| `/payment/success` | payment | 결제 완료 |
| `/payment/fail` | payment | 결제 실패 |
| `/payment/history` | payment | 결제 내역 |
| `/pricing` | payment | 요금제 안내 |
| `/privacy` | legal | 개인정보처리방침 |
| `/refund` | legal | 환불 정책 |
| `/terms` | legal | 이용약관 |
| `/settings/profile` | hr | 회원 프로필 |
| `/settings/team` | hr | 팀원 관리 |
| `/usage` | analytics | 사용량 통계 |

## API 라우트 (src/app/api/**)

| 경로 | 소관 팀 | 비고 |
|---|---|---|
| `/api/admin/users` | hr | 회원 조회 |
| `/api/admin/stats` | analytics | 관리자 통계 |
| `/api/admin/sync-payment` | payment | 결제 동기화 (hr 협업) |
| `/api/auth/callback` | hr | Clerk OAuth 콜백 |
| `/api/check-originality` | content | 표절 검사 |
| `/api/competitor-monitor` | research | 경쟁사 분석 |
| `/api/credentials` | publish | 네이버 발행 자격증명 |
| `/api/cron/billing-notify` | payment | 결제 예정 알림 (Vercel Cron) |
| `/api/cron/billing-charge` | payment | 자동 결제 청구 (Vercel Cron) |
| `/api/cron/billing-retry` | payment | 결제 재시도 (Vercel Cron) |
| `/api/cron/billing-cancel` | payment | 미납 자동 해지 (Vercel Cron) |
| `/api/generate-cardnews-slides` | content | 카드뉴스 슬라이드 생성 |
| `/api/generate-content` | content | 블로그 본문 생성 (Claude API) |
| `/api/generate-images` | content | GPT Image 이미지 생성 |
| `/api/generate-style` | content | 글 스타일 생성 |
| `/api/generate-tags` | content | 태그 생성 |
| `/api/generate-titles` | content | 제목 후보 생성 |
| `/api/regenerate-image` | content | 이미지 재생성 |
| `/api/keyword-trend` | research | 키워드 트렌드 |
| `/api/keywords/recommend` | research | 키워드 추천 |
| `/api/notifications` | cs | 알림 조회·수신 |
| `/api/payment/prepare` | payment | 결제 준비 |
| `/api/payment/confirm` | payment | 결제 확인 |
| `/api/payment/webhook` | payment | PortOne webhook (절대 이동 금지) |
| `/api/payment/history` | payment | 결제 내역 |
| `/api/payment/billing/confirm` | payment | 정기결제 등록 확인 |
| `/api/posts` | content | 글 목록·생성 |
| `/api/posts/[id]` | content | 글 조회·수정·삭제 |
| `/api/posts/schedule` | content | 발행 예약 |
| `/api/profile` | hr | 사용자 프로필 |
| `/api/proxy-image` | dev | 이미지 프록시 |
| `/api/publish-naver` | publish | 네이버 블로그 발행 |
| `/api/subscription/cancel` | payment | 구독 해지 |
| `/api/team` | hr | 팀 조회 |
| `/api/team/[memberId]` | hr | 팀원 수정·삭제 |
| `/api/team/accept` | hr | 팀 초대 수락 |
| `/api/team/invites` | hr | 팀 초대 |
| `/api/usage` | analytics | 사용량 로그 |

## 기타 루트

| 경로 | 소관 팀 | 비고 |
|---|---|---|
| `src/middleware.ts` | hr + security | Clerk 인증 미들웨어 |
| `src/types/` | dev | 전역 타입 정의 |
| `src/app/layout.tsx`, `globals.css` | dev | 루트 레이아웃·전역 스타일 |

## 코드 폴더 (이동 완료)

| 폴더 | 소관 팀 | 내용 |
|---|---|---|
| `src/content/{lib,components}` | content | 블로그·이미지·카드뉴스 생성 로직 |
| `src/payment/{lib,email,components}` | payment | PortOne·KPN 결제, 정기결제, 환불 알림 메일 |
| `src/hr/{lib,components}` | hr | 회원·관리자·인증 UI |
| `src/dev/{lib,components}` | dev | Supabase, Meta Pixel/CAPI, crypto, cron, 알림 서비스 |
| `src/publish/{lib,components}` | publish | 네이버 발행 자격증명·발행 컴포넌트 |

## 변경 이력
- 2026-05-19: `src/lib/*`, `src/components/*` → 팀별 폴더로 재배치 (56개 파일, 149개 import 수정)
- 백업 브랜치: `backup/before-team-restructure`
