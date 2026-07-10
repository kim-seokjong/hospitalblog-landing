/**
 * 템플릿 렌더 뷰모델 — 정제·해석이 끝난 값만 담는다(순수 데이터).
 */

export interface TemplateViewModel {
  /** 배경 실사 사진 URL */
  readonly imageUrl: string;
  /** 제목(정제됨) */
  readonly title: string;
  /** 상단/키워드 라벨(없으면 빈 문자열) */
  readonly klabel: string;
  /** 해시태그(정제됨, 최대 3) */
  readonly tags: readonly string[];
  /** 병원명(없으면 빈 문자열) */
  readonly clinicName: string;
  /** 제목 안에서 강조할 어절(없으면 빈 문자열) */
  readonly accentWord: string;
  /** 강조색 */
  readonly accent: string;
  /** satori fontFamily */
  readonly fontFamily: string;
  /** 캔버스 한 변(px) */
  readonly size: number;
}
