# 닥터포스트 이미지 기능 재설계 스펙 (썸네일/카드 엔진 + VISUAL-DNA)

> 작성 2026-07-08 (Opus 4.8). **구현 착수 = 2026-07-10(금) Fable 5 세션 예정.** 이 문서만 열면 바로 구현 가능하도록 확정.
> 원칙: 회사 공통 규칙(한국어, 의료광고법 절대금지, 모듈화) 준수. 코드 변경 전 계획 승인은 이 문서로 갈음.

---

## 0. 배경 — 왜 만드나 (진단 결과)

- **현재 이미지 기능 채택률 = 0%.** 전체 `saved_posts` 15편 전부 `image_urls` 0장. 회원(예: 바르다권치과)은 우리 글은 100% 쓰면서, 사진은 100% 직접 제작(`편집2/3/4.png`·`썸네일` = 글자 박힌 타이포 정보카드·제목 썸네일)해서 네이버에 올림.
- **근본 원인:** 우리는 `generate-images`에서 "실사 임상장면 사진"(가짜 한국인 인물, 프롬프트에 `no text` 명시)만 생성 → 네이버 블로그가 실제 필요로 하는 **글자 박힌 썸네일·정보카드를 구조적으로 못 만듦**. + "AI 이미지" 라벨 강제 각인 + 가짜 인물 진정성 문제.
- **결론:** 문제는 "AI 이미지 품질"이 아니라 **만드는 이미지 종류가 틀렸다.** → 실제 텍스트를 렌더한 **디자인 카드/썸네일**을 제공한다.

## 1. 목표 & 성공지표

- 목표: 회원이 네이버에 그대로 올릴 만한 **제목 썸네일 + 소제목 정보카드**를 글 생성 흐름에서 자동 제작.
- 성공지표: `saved_posts.image_urls` 채택률(현재 0%) 상승, 카드 다운로드 수, 발행글 내 우리 카드 사용 비율(Phase 2 수집으로 측정).

## 2. 범위 (v1 = Phase 1+2+3 통째, 대표 결정 2026-07-08)

| Phase | 내용 | 산출물 |
|---|---|---|
| 1 | 텍스트 썸네일/정보카드 렌더 엔진 | `next/og` PNG 생성 + UI + 저장/다운로드 |
| 2 | VISUAL-DNA 수집·분석 | 회원 네이버 블로그 이미지 수집 → 비전 태깅 → 회원별 비주얼 프로필 |
| 3 | 개별화 | 프로필로 Phase1 템플릿 자동 매칭 + 실사 업로드 자동배치 |

---

## 3. Phase 1 — 카드/썸네일 렌더 엔진 (핵심)

### 3.1 산출물 종류
1. **제목 썸네일 (표지 1장)** — 글 제목 + 병원명/로고 + 브랜드 배경. 네이버 대표 이미지용(정사각 1080×1080 + 가로 1200×630 옵션).
2. **소제목 정보카드 (N장)** — 본문 소제목(H2/H3)마다 1장. 소제목 + 핵심 1줄 요약. 섹션 구분·가독용.
3. **(옵션) 요약/체크리스트 카드** — 글의 "핵심 요약"/FAQ를 카드화.

### 3.2 기술 (확정)
- **`next/og` 의 `ImageResponse`** (Next 14.2.5 내장, Satori 기반, 새 의존성 0). JSX → PNG 서버 렌더. Vercel Edge/Node 호환.
  - 참고: App Router라 `import { ImageResponse } from 'next/og'` 사용. **구현 전 `node_modules/next/dist/` 문서 확인**(AGENTS.md: 이 Next는 관례가 다를 수 있음).
- **한글 폰트 임베드 필수** — `next/og`는 폰트를 `ArrayBuffer`로 넘겨야 함. Pretendard 또는 Noto Sans KR (Bold/Regular) `.ttf/.woff`를 `public/fonts/` 또는 `src/assets`에 두고 `fs`로 읽어 `fonts` 옵션에 주입. (한글 폰트 없으면 글자 깨짐 — 최우선 검증 포인트.)
- 복잡한 레이아웃(그라데이션·다단)이 Satori 제약에 걸리면 이미 있는 `playwright-core`로 HTML 렌더 폴백 가능(무겁지만 자유도↑). **1순위 = next/og.**

### 3.3 입력/데이터
- 입력: `{ title, subheadings: string[], summaryLine?: string, brand: BrandTokens, template: TemplateId }`
- 소제목 파싱: 생성 본문에서 마크다운/`##` 또는 기존 `[이미지 N:]`처럼 구조 파싱(기존 `extractImageDescriptions` 패턴 참고, `generate-images/route.ts`).
- `BrandTokens`: `{ primary: '#ff4628'(기본 코랄), logoText?: 'ㄷ', hospitalName, font }`. 회원 브랜드 없으면 닥터포스트 기본 팔레트([[브랜딩]] 코랄 #ff4628, ㄷ/D 모노그램).

### 3.4 템플릿 세트 (3~4종, **미감은 Fable 세션에서 확정**)
- `minimal` — 흰 배경 + 코랄 포인트 라인, 큰 타이포.
- `coral-bold` — 코랄 배경 + 흰 글자(표지 강조형).
- `calm` — 연회색/네이비 차분형(진료과 톤).
- `checklist` — 요약·체크리스트 카드 전용.
- 각 템플릿은 React 컴포넌트(JSX)로 작성 → `ImageResponse`에 전달. Tailwind 아닌 **인라인 style**(Satori는 Tailwind 미지원, inline CSS만).

### 3.5 API
- 신규 `POST /api/generate-cards`
  - `requirePaidPlan()` 게이트 재사용(`src/payment/lib/usage-guard.ts`). 무료 크레딧 정책과 일관.
  - body: `{ title, subheadings, summaryLine?, template, count }`
  - 응답: `{ cards: { id, url(dataURL png), kind: 'cover'|'section'|'summary' }[] }`
  - `logUsage({ feature: 'generate-cards', ... })` 추가.
- **컴플라이언스:** 카드 텍스트도 의료광고법 대상. 카드에 들어가는 문구(제목·요약)는 **기존 검수 파이프라인 통과분만** 사용(과장·수치·before/after 금지). 생성 텍스트를 새로 만들지 말고 이미 검수된 본문 소제목/요약을 그대로 렌더 → 위험 최소화. [[feedback_compliance_strictness_moat]] 정합.

### 3.6 라벨/다운로드
- **"AI 이미지" 라벨 불필요** — 실제 텍스트를 디자인 렌더한 것이지 AI 생성 이미지가 아님. (사진이 아닌 정보 그래픽.) → `ai-image-label.ts` 미적용. ⚠️ 단, 카드 안에 **AI로 생성한 사진을 배경으로 넣는 변형을 추가하면** 그때는 라벨 필요([[feedback_ai_image_label_required]]). v1 카드는 사진 배경 없이 타이포/도형만 → 라벨 없음.
- 다운로드: 기존 이미지 다운로드 UX 재사용, PNG 저장. 저장 시 `saved_posts.image_urls`에 포함(기존 저장 경로 `src/app/api/posts/route.ts` line 97 그대로).

### 3.7 UI 통합
- `src/content/components/ContentPreview.tsx` 의 이미지 스타일 토글에 **'카드/썸네일'** 추가(현재 `photo|cardnews|upload` → `+ 'cards'`).
- 카드 미리보기 그리드(`ImageGallery.tsx` 재사용/확장) + 템플릿 선택 드롭다운.
- 모바일 최적화 필수([[feedback_mobile_optimization]]).

---

## 4. Phase 2 — VISUAL-DNA 수집·분석

> VOICE-DNA(글 학습, [[project_doctorpost_writing_quality_skills]])와 **동일 구조**의 이미지 버전.

### 4.1 수집
- 회원 프로필의 네이버 블로그 주소(이미 VOICE-DNA용으로 `profiles`에 블로그 주소 입력 존재, `profile_naver_blog` 마이그028).
- 수집 경로: **RSS(`rss.blog.naver.com/{id}.xml`)로 글 목록 → 각 글 HTML(`m.blog.naver.com/{id}/{logNo}`)을 서버에서 fetch → `pstatic.net` 이미지 URL 추출.**
  - ⚠️ **WebFetch는 네이버 차단됨** — 서버 `fetch`(User-Agent 모바일) 또는 `playwright-core`로 직접 수집. (2026-07-08 검증: curl+모바일 UA로 블로그 글 HTML·이미지 URL 추출 성공.)
- 우리 이미지 제외: `image_urls` 대조 + "AI 이미지" 워터마크 영역 휴리스틱. (실무상 현재 채택 0%라 사실상 전부 회원 자체 업로드.)

### 4.2 비전 분석
- 각 이미지를 Claude vision(멀티모달)로 태깅. 스키마 예:
  ```json
  {
    "type": "real_photo | staff | equipment | text_thumbnail | info_card | illustration",
    "has_text": true,
    "palette": ["#...","#..."],
    "tone": "bright_warm | clean_clinical | calm_muted | bold",
    "layout": "centered_title | top_bar | split | grid",
    "aspect": "1:1 | 4:3 | 16:9"
  }
  ```
- 집계 → 회원별 프로필: 대표 팔레트, 텍스트카드 비율, 선호 톤/레이아웃, 실사 vs 그래픽 비중.

### 4.3 저장 (마이그레이션 필요)
- 신규 테이블 `visual_dna_profiles(user_id pk, palette jsonb, thumbnail_style text, tone text, real_photo_ratio numeric, sample_count int, updated_at)` + 원본 태깅 로그 `visual_dna_samples`.
- service_role 전용 RLS(기존 패턴 따름).

### 4.4 동의/법무 (선처리 필수)
- 회원 블로그 학습·이미지 분석 = 약관/개인정보 처리방침에 명시 + 동의. **클리닉픽스 `clinic_doctor_consent`(마이그025) 선례** 그대로 확장.
- VOICE-DNA가 이미 블로그 주소를 학습하므로 그 동의 틀에 "이미지 스타일 학습" 항목 추가. 법무팀 검토 후 반영.

---

## 5. Phase 3 — 개별화

- VISUAL-DNA 프로필 → Phase 1 카드 **템플릿/팔레트/톤 자동 선택.** (예: 회원이 밝고 따뜻·중앙정렬 제목 선호 → `minimal`+회원 팔레트로 기본값.)
- **실사 사진은 생성 불가** — 회원 실제 병원/직원은 물리적 실사진. → "한 번 업로드 → 자동 배치/리사이즈/재사용"(이미 `upload` 스타일 존재)으로 해결. 스타일만 학습해 배치·톤 보정.
- (옵션) 스타일-컨디션드 AI 실사: 회원 팔레트/무드를 참조로 AI 사진 생성. 단 AI라벨·가짜인물 벽 여전 → 우선순위 낮음.

---

## 6. 데이터 모델 변경 요약 (마이그레이션)
1. (선택) `profiles`에 브랜드 토큰 컬럼: `brand_primary text, brand_logo_text text, brand_font text` — 없으면 기본값.
2. `visual_dna_profiles` + `visual_dna_samples` 테이블.
3. 동의 컬럼(약관 동의 플래그) — clinic_doctor_consent 패턴.
- 적용은 Supabase SQL Editor 수동([[project_doctorpost_supabase_migration_manual]]).

## 7. 구현 순서 체크리스트 (금요일)
- [ ] `next/og` + 한글 폰트 임베드로 **카드 1장 PNG 실렌더** 검증(가장 먼저, 폰트 깨짐 리스크 제거).
- [ ] 템플릿 3~4종 JSX 작성 (**미감 = Fable로 확정**).
- [ ] `POST /api/generate-cards` + 게이트 + usage 로그.
- [ ] ContentPreview 토글 '카드/썸네일' + 미리보기/다운로드 + 저장(image_urls).
- [ ] tsc 통과 → 커밋/배포.
- [ ] Phase 2: 블로그 수집기(서버 fetch/playwright) + 비전 태깅 + `visual_dna_profiles` 마이그.
- [ ] 동의/약관 법무 반영.
- [ ] Phase 3: 프로필→템플릿 개별화 + 업로드 자동배치.

## 8. 리스크 / 미결정 (Fable 세션에서 판단)
- **템플릿 디자인 미감** — 이 기능 성패의 핵심. Fable 5의 디자인 강점 활용 지점.
- next/og Satori 제약(폰트/복잡 레이아웃) → 폴백 playwright 필요 여부.
- 네이버 수집 안정성(HTML 구조 변경 대비 파싱 견고화).
- 컴플라이언스: 카드 문구는 반드시 검수 통과분만 렌더.

## 9. 재사용할 기존 자산
- `src/app/api/generate-images/route.ts` — 게이트·usage·소제목 파싱·백필 패턴.
- `src/content/lib/ai-image-label.ts` — 라벨 캔버스(사진 배경 카드 변형 시).
- `src/content/components/ImageGallery.tsx` / `ContentPreview.tsx` — 미리보기 UI.
- `src/payment/lib/usage-guard.ts` — `requirePaidPlan`.
- 브랜드 토큰 = 코랄 #ff4628, ㄷ/D 모노그램([[project_doctorpost_branding]]).
