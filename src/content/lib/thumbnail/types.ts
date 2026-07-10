/**
 * 제목 썸네일/카드 엔진 — 공용 타입.
 *
 * 대표 확정(2026-07-10): 실사 사진 배경 + HTML 실텍스트 오버레이 카드를
 * 여러 템플릿 중 골라 만드는 범용 엔진. 전 회원·전 진료과 공용.
 */

/** 지원 템플릿 3종 */
export type ThumbnailTemplate = 'bottom-gradient' | 'full-scrim' | 'footer-bar';

export const THUMBNAIL_TEMPLATES: readonly ThumbnailTemplate[] = Object.freeze([
  'bottom-gradient',
  'full-scrim',
  'footer-bar',
]);

/** 배경 사진의 출처 — AI 생성이면 출처 메타데이터를 삽입, 실제 업로드 사진이면 원본 그대로. */
export type ThumbnailImageSource = 'ai' | 'upload';

/** 카드 렌더 입력. 특정 병원에 종속되지 않는 범용 파라미터. */
export interface ThumbnailParams {
  /** 배경 실사 사진 URL (AI 생성 이미지 또는 업로드 사진). https 또는 data URL. */
  readonly imageUrl: string;
  /** 카드 대표 제목 (글 제목). 자동 줄바꿈/폰트 축소로 오버플로 방지. */
  readonly title: string;
  /** 상단/키워드 라벨 (예: "신림동 치아교정"). 선택. */
  readonly klabel?: string;
  /** 해시태그 목록 (예: ["신림동치과", "투명교정"]). 선택. */
  readonly tags?: readonly string[];
  /** 병원명 (예: "바르다권치과"). 선택. */
  readonly clinicName?: string;
  /**
   * 강조색 (CSS 변수 --accent 주입 지점). 미지정 시 기본 코랄.
   * VISUAL-DNA 프로필이 나중에 병원색을 주입할 수 있게 파라미터로 열어 둔다.
   */
  readonly accentColor?: string;
  /** 사용할 템플릿. */
  readonly template: ThumbnailTemplate;
  /** 배경 출처 — 'ai'면 PNG에 출처 메타데이터 삽입, 'upload'면 원본 그대로. */
  readonly imageSource: ThumbnailImageSource;
}

/** 기본 강조색 — 닥터포스트 코랄. */
export const DEFAULT_ACCENT_COLOR = '#ff4628';

/** 출력 카드 한 변 픽셀 (정사각 고해상). */
export const THUMBNAIL_SIZE = 1080;
