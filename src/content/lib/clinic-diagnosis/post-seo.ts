import { hasAnswerFirstSection } from '../geo-tracking.ts';
import { computeTitleQuality } from '../blog-check-score.ts';

/**
 * 2단계 ①-b — 최근 글 검색 최적화 점검 (규칙 기반 순수 함수, LLM 호출 없음).
 *
 * 대표 요청: "병원 블로그를 직접 찾아가서 최근 5개 글을 분석해서 SEO 최적화를 봤으면".
 *
 * ★ 판정 재료는 이미 수집한 것만 쓴다 — 추가 호출을 만들지 않는다.
 *   · 제목·발행일·요약·대표 이미지 : 공식 RSS(rss.blog.naver.com) 1회 수집분
 *   · 본문 전문                     : 파이프라인이 이미 받아 두는 최신 글 본문
 *   크롤링·스크래핑을 새로 만들지 않는다.
 *
 * ★ RSS 가 본문 전문을 주지 않는 경우가 있다(블로그 RSS 설정이 '부분'이면 앞부분
 *   400자쯤에서 '.......' 로 잘려 온다). 그래서 글마다 확보 수준을 bodyKind 로
 *   구분하고, **요약만 확보된 글에서는 분량·구조 판정을 아예 하지 않는다**(null).
 *   요약을 전문인 척 채점하면 멀쩡한 글이 "너무 짧다"로 나간다.
 *
 * ★ 원장이 읽는다. 기술 용어를 앞에 세우지 않는다.
 *   결과는 카드 1장으로 압축하고 항목별 ✓/✕ 는 접어두기(details)로 내려보낸다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/* ── 상수 (전부 판정 경계라 이름을 붙여 밖으로 뺀다) ────────── */

/** 분석 대상 글 수 — 비용·시간 때문에 최근 5편으로 제한한다. */
export const SEO_POST_LIMIT = 5;

/**
 * RSS 요약이 아니라 본문 전문으로 볼 최소 길이(공백 제외).
 * 네이버 부분 RSS 는 400자 안팎에서 잘리므로 그 두 배 가까이를 경계로 둔다.
 */
export const RSS_FULL_MIN_CHARS = 700;

/** 제목 길이 적정 구간(자). 짧으면 검색어를 못 담고, 길면 검색결과에서 잘린다. */
export const TITLE_MIN_CHARS = 12;
export const TITLE_MAX_CHARS = 45;

/** 본문 분량 하한(공백 제외). 이보다 짧으면 상위 노출 경쟁에서 밀린다. */
export const BODY_MIN_CHARS = 800;

/** 소제목 최소 개수 — 하나도 없으면 한 덩어리 글이다. */
export const SUBHEADING_MIN = 2;

/** 한 항목을 "갖춰짐"으로 볼 최소 충족 비율. */
export const PASS_RATIO = 0.6;

/**
 * 대표 키워드 반복 상한 — 본문 1,000자당 등장 횟수.
 *
 * ⚠️ "등장횟수 × 키워드 길이 / 본문 길이" 식의 밀도는 쓰지 않는다. 병원 블로그가
 *    흔히 쓰는 긴 롱테일 키워드("대구보조개수술유명한곳")가 자동으로 밀도를 부풀려,
 *    정상적으로 쓴 글까지 "억지 반복"으로 몰았다(실측 5편 중 2편 오탐).
 *    길이와 무관한 등장 빈도로 재고, 임계는 넉넉하게 둔다 — 겁주는 오탐보다
 *    확실한 것만 잡는 쪽이 낫다.
 */
export const KEYWORD_REPEAT_PER_1000_MAX = 12;

/** 제목 안에서 같은 말이 이만큼 반복되면 억지 반복. */
export const TITLE_REPEAT_MAX = 3;

/** 밀도 판정을 시도할 최소 본문 길이(공백 제외) — 짧은 글은 밀도가 요동친다. */
export const DENSITY_MIN_BODY_CHARS = 300;

/** 소제목으로 볼 수 있는 줄 길이. */
const HEADING_LINE_MIN = 4;
const HEADING_LINE_MAX = 60;

/** 종결 부호로 끝나는 줄 = 완결된 본문 문장. */
const CLOSED_LINE_PATTERN = /[.!?。！？…]\s*$/;
/** 한국어 종결 어미로 끝나는 줄 — 부호가 없어도 문장일 가능성이 높다. */
const SENTENCE_TAIL_PATTERN = /[다요]\s*$/;
/**
 * 조사·연결어미로 끝나는 줄 — 소제목이 아니라 **줄바꿈으로 끊긴 문장 조각**이다.
 * ("턱 아래 지방은" 같은 줄을 소제목으로 세면 소제목 개수가 부풀고 뒤 문장이 잘린다)
 */
const FRAGMENT_TAIL_PATTERN = /(은|는|이|가|을|를|와|과|의|에|로|며|고|서|만|도|랑|랄)\s*$/;
/** 질문 의도를 담은 줄 — 종결 어미로 끝나도 소제목으로 인정한다. */
const QUESTION_ISH_PATTERN = /[?？]|나요|까요|은가요|인가요|무엇|왜|어디|언제|얼마|어떻게/;
/** 구조 마커 줄(목록 기호·인용 등) — 소제목 후보에서 뺀다. */
const MARKER_LINE_PATTERN = /^(\[|■|▷|▶|·|-|—|\*|#|Q\d*[.)]|A\d*[.)])/;

/** 한글 덩어리 — 대표 키워드 후보 추출용. */
const HANGUL_RUN_PATTERN = /[가-힣]{3,20}/g;

/* ── 입력 타입 ──────────────────────────────────────────── */

/** 글 1편의 본문 확보 수준. */
export type PostBodyKind = 'full' | 'summary' | 'none';

export interface SeoPostInput {
  readonly title: string;
  readonly link: string;
  /** 본문 텍스트 (전문 또는 RSS 요약). 없으면 ''. */
  readonly body: string;
  readonly bodyKind: PostBodyKind;
  /** 글에 사진이 들어 있는가 (RSS 대표 이미지 기준). */
  readonly hasImage: boolean;
}

/** 제목 키워드 판정에 쓰는 병원 정보. */
export interface SeoClinicContext {
  /** 구·군 (예: '중구'). */
  readonly region: string;
  /** 시·도 축약형 (예: '대구'). */
  readonly shortProvince: string;
  /** 진료과 (예: '성형외과'). */
  readonly specialty: string;
}

/* ── 결과 타입 ──────────────────────────────────────────── */

export type PostSeoCheckId =
  | 'titleLength'
  | 'titleKeyword'
  | 'bodyLength'
  | 'subheading'
  | 'answerFirst'
  | 'image'
  | 'keywordStuffing'
  | 'topicVariety';

export interface PostSeoCheck {
  readonly id: PostSeoCheckId;
  /** 원장이 읽을 항목 이름. */
  readonly label: string;
  /** 이게 왜 필요한지 한 줄. */
  readonly hint: string;
  /** true=갖춰짐, false=빠짐, null=확인 못 함. */
  readonly ok: boolean | null;
  /** 판정 근거 요약 (예: '최근 5편 중 4편'). */
  readonly detail: string;
}

export interface PostSeoResult {
  readonly checked: boolean;
  /** 실제로 본 글 수. */
  readonly postsAnalyzed: number;
  /** 그중 본문 전문까지 확보한 글 수. */
  readonly fullBodies: number;
  /** 앞부분 요약까지만 확보한 글 수. */
  readonly summaryOnly: number;
  readonly checks: readonly PostSeoCheck[];
  readonly readyCount: number;
  readonly missingCount: number;
  readonly unknownCount: number;
}

export const EMPTY_POST_SEO: PostSeoResult = {
  checked: false,
  postsAnalyzed: 0,
  fullBodies: 0,
  summaryOnly: 0,
  checks: [],
  readyCount: 0,
  missingCount: 0,
  unknownCount: 0,
};

/* ── 본문 확보 수준 판정 ─────────────────────────────────── */

/**
 * 확보한 텍스트가 전문인지 요약인지 가른다.
 *
 * fromBodyFetch=true 는 본문 페이지에서 받아온 것이라 전문으로 본다.
 * RSS 요약은 네이버가 '.......' 로 잘라 주므로 그 흔적을 먼저 보고,
 * 흔적이 없으면 길이로 가른다(RSS 설정이 '전체'면 본문이 통째로 온다).
 */
export function classifyBodyKind(text: string, fromBodyFetch: boolean): PostBodyKind {
  const value = (text ?? '').trim();
  if (value.length === 0) return 'none';
  if (fromBodyFetch) return 'full';
  if (/\.{4,}\s*$/.test(value)) return 'summary';
  return value.replace(/\s/g, '').length >= RSS_FULL_MIN_CHARS ? 'full' : 'summary';
}

/* ── 본문 구조 복원 ─────────────────────────────────────── */

export interface ParagraphBlock {
  readonly kind: 'heading' | 'body';
  readonly text: string;
}

/**
 * 네이버 본문 텍스트를 "소제목 / 단락" 구조로 되돌린다.
 *
 * 왜 필요한가: 본문 추출기(htmlToText)가 연속 빈 줄을 한 줄로 접어 버려서, 단락
 * 경계가 사라진 상태로 온다. geo-tracking 의 직답 판정은 "소제목 앞뒤가 빈 줄"이라는
 * 서식 규칙을 전제로 하므로, 그대로 넣으면 **모든 글이 직답 없음으로 떨어진다.**
 * 그래서 여기서 줄들을 단락으로 다시 묶은 뒤 넘긴다(판정 로직 자체는 재사용).
 *
 * 소제목 판정: 앞 단락이 닫혀 있고(종결 부호), 짧고, 종결 부호가 없는 줄.
 * 종결 어미(~다/~요)로 끝나는 줄은 문장으로 보되, 질문 의도가 있으면 소제목으로 본다
 * ("이중턱근육묶기란 무엇인가요" 같은 실제 소제목을 놓치지 않기 위해).
 */
export function toParagraphBlocks(body: string): readonly ParagraphBlock[] {
  const lines = (body ?? '')
    .split('\n')
    // 폭 없는 공백(U+200B 등)만 있는 줄은 빈 줄이다 — 네이버 본문에 자주 섞인다
    .map((line) => line.replace(/[​-‏﻿]/g, '').trim())
    .filter((line) => line.length > 0);

  const blocks: ParagraphBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    const prevClosed = !last || last.kind === 'heading' || CLOSED_LINE_PATTERN.test(last.text);
    const headingShaped =
      line.length >= HEADING_LINE_MIN &&
      line.length <= HEADING_LINE_MAX &&
      !CLOSED_LINE_PATTERN.test(line) &&
      !MARKER_LINE_PATTERN.test(line) &&
      (QUESTION_ISH_PATTERN.test(line) ||
        (!SENTENCE_TAIL_PATTERN.test(line) && !FRAGMENT_TAIL_PATTERN.test(line)));

    if (prevClosed && headingShaped) {
      blocks.push({ kind: 'heading', text: line });
      continue;
    }
    if (last && last.kind === 'body') {
      blocks[blocks.length - 1] = { kind: 'body', text: `${last.text} ${line}` };
      continue;
    }
    blocks.push({ kind: 'body', text: line });
  }
  return blocks;
}

/**
 * 실제 "소제목"으로 셀 수 있는 줄 수 — **바로 아래에 내용이 붙은 것만** 센다.
 *
 * 네이버 본문 끝에는 병원명·주소·"이 장소의 다른 글" 같은 위젯 줄이 딸려 오는데,
 * 짧고 종결부호가 없어 소제목 모양이다. 내용이 따라오는지를 함께 보면 이 줄들이
 * 소제목 개수를 부풀리는 것을 막을 수 있다(글에 소제목이 없는데 있다고 나가면 오진).
 */
export function countSectionHeadings(blocks: readonly ParagraphBlock[]): number {
  return blocks.filter((block, index) => block.kind === 'heading' && blocks[index + 1]?.kind === 'body')
    .length;
}

/** 복원한 구조를 빈 줄로 구분된 텍스트로 — geo-tracking 직답 판정 입력 형태. */
export function toParagraphText(body: string): string {
  return toParagraphBlocks(body)
    .map((block) => block.text)
    .join('\n\n');
}

/* ── 글 1편 판정 ────────────────────────────────────────── */

/** 제목에서 뽑은 대표 키워드 후보 (긴 것부터). */
export function titleKeywordCandidates(title: string): readonly string[] {
  const runs = (title ?? '').match(HANGUL_RUN_PATTERN) ?? [];
  const unique = Array.from(new Set(runs));
  return unique.sort((a, b) => b.length - a.length);
}

/** 문자열 안에서 부분문자열이 몇 번 나오는지 (겹침 없이). */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 대표 키워드 반복률 최댓값 (본문 1,000자당 등장 횟수) — 억지 반복 판정용.
 * 제목에서 뽑은 후보 각각을 세고 가장 많이 나온 것의 비율을 쓴다.
 */
export function maxKeywordRepeatRate(title: string, body: string): number {
  const chars = body.replace(/\s/g, '').length;
  if (chars < DENSITY_MIN_BODY_CHARS) return 0;
  let max = 0;
  for (const candidate of titleKeywordCandidates(title)) {
    const rate = (countOccurrences(body, candidate) * 1000) / chars;
    if (rate > max) max = rate;
  }
  return max;
}

/** 글 1편의 항목별 판정. null = 이 글로는 판정할 수 없음. */
export interface PostVerdict {
  readonly titleLength: boolean;
  readonly titleKeyword: boolean;
  readonly image: boolean;
  readonly bodyLength: boolean | null;
  readonly subheading: boolean | null;
  readonly answerFirst: boolean | null;
  readonly keywordStuffing: boolean | null;
}

/**
 * 제목에 환자가 검색할 말이 들어 있는가.
 *
 * 지역(구·군 또는 시·도)이나 진료과 어간이 제목에 있으면 통과.
 * 진료과 어간은 앞 두 글자를 쓴다 — 성형외과→'성형', 이비인후과→'이비',
 * 정신건강의학과→'정신' 처럼 우리 진료과목 어휘 전부에서 의미가 남는다.
 */
export function titleHasSearchKeyword(title: string, clinic: SeoClinicContext): boolean {
  const text = (title ?? '').replace(/\s/g, '');
  if (text.length === 0) return false;
  const needles = [clinic.region, clinic.shortProvince, (clinic.specialty ?? '').slice(0, 2)]
    .map((value) => (value ?? '').replace(/\s/g, ''))
    .filter((value) => value.length >= 2);
  return needles.some((needle) => text.includes(needle));
}

export function judgePost(post: SeoPostInput, clinic: SeoClinicContext): PostVerdict {
  const title = (post.title ?? '').trim();
  const full = post.bodyKind === 'full';
  const body = full ? post.body : '';
  const bodyChars = body.replace(/\s/g, '').length;

  const headings = full ? countSectionHeadings(toParagraphBlocks(body)) : 0;

  return {
    titleLength: title.length >= TITLE_MIN_CHARS && title.length <= TITLE_MAX_CHARS,
    titleKeyword: titleHasSearchKeyword(title, clinic),
    image: post.hasImage === true,
    bodyLength: full ? bodyChars >= BODY_MIN_CHARS : null,
    subheading: full ? headings >= SUBHEADING_MIN : null,
    answerFirst: full ? hasAnswerFirstSection(toParagraphText(body)) : null,
    keywordStuffing:
      full && bodyChars >= DENSITY_MIN_BODY_CHARS
        ? maxKeywordRepeatRate(title, body) <= KEYWORD_REPEAT_PER_1000_MAX &&
          titleKeywordCandidates(title).every(
            (candidate) => countOccurrences(title, candidate) < TITLE_REPEAT_MAX,
          )
        : null,
  };
}

/* ── 종합 ───────────────────────────────────────────────── */

const CHECK_META: Readonly<
  Record<Exclude<PostSeoCheckId, 'topicVariety'>, { readonly label: string; readonly hint: string }>
> = {
  titleLength: {
    label: '제목 길이',
    hint: '너무 짧으면 검색어를 못 담고, 너무 길면 검색결과에서 뒷부분이 잘립니다.',
  },
  titleKeyword: {
    label: '제목에 지역·진료 키워드',
    hint: '환자는 "대구 성형외과"처럼 지역을 붙여 검색합니다. 제목에 그 말이 없으면 걸리지 않습니다.',
  },
  bodyLength: {
    label: '글 분량',
    hint: '내용이 얕으면 상위에 올라가지 않습니다. 짧은 글을 여러 편 쓰는 것보다 한 편을 제대로 쓰는 쪽이 낫습니다.',
  },
  subheading: {
    label: '소제목으로 나뉜 글',
    hint: '한 덩어리로 이어진 글은 환자도 검색엔진도 끝까지 읽지 않습니다.',
  },
  answerFirst: {
    label: '질문에 바로 답하는 구조',
    hint: '"~인가요?" 소제목 바로 아래에서 답을 끝내면 검색 요약과 AI 답변에 그대로 인용됩니다.',
  },
  image: {
    label: '사진 포함',
    hint: '사진이 없는 글은 검색결과에서 눈에 띄지 않고 체류 시간도 짧습니다.',
  },
  keywordStuffing: {
    label: '키워드를 억지로 반복하지 않음',
    hint: '같은 말을 억지로 반복하면 오히려 감점됩니다. 자연스럽게 쓰는 편이 안전합니다.',
  },
};

/** 항목별 충족 수 → ok. 판정 가능한 글이 하나도 없으면 null. */
export function aggregateVerdicts(values: readonly (boolean | null)[]): {
  ok: boolean | null;
  evaluated: number;
  passed: number;
} {
  const evaluable = values.filter((value): value is boolean => value !== null);
  if (evaluable.length === 0) return { ok: null, evaluated: 0, passed: 0 };
  const passed = evaluable.filter(Boolean).length;
  return { ok: passed / evaluable.length >= PASS_RATIO, evaluated: evaluable.length, passed };
}

/**
 * 제목이 서로 다른 주제를 다루는가 — 같은 키워드만 돌려쓰면 글이 서로를 잡아먹는다.
 * 판정은 blog-check-score.computeTitleQuality(제목 bigram 유사도) 를 그대로 쓴다.
 * 허용 중복 쌍은 제목 10편당 1쌍 — 시리즈 글 몇 편은 정상으로 본다.
 */
export function judgeTopicVariety(titles: readonly string[]): {
  ok: boolean | null;
  detail: string;
} {
  const list = titles.filter((title) => typeof title === 'string' && title.trim().length > 0);
  if (list.length < 3) return { ok: null, detail: '비교할 제목이 부족해 확인하지 못했어요' };
  const quality = computeTitleQuality(list);
  const allowed = Math.floor(list.length / 10);
  return {
    ok: quality.duplicatePairs <= allowed,
    detail:
      quality.duplicatePairs === 0
        ? `제목 ${list.length}편 모두 서로 다른 주제`
        : `제목 ${list.length}편 중 사실상 같은 제목이 ${quality.duplicatePairs}쌍`,
  };
}

/**
 * 최근 글 SEO 점검 (순수 함수).
 *
 * posts 는 최신 글부터 SEO_POST_LIMIT 편까지만 쓴다.
 * titles 는 주제 다양성 판정용으로 수집한 제목 전체(최대 50편)를 받는다.
 */
export function analyzePostSeo(
  posts: readonly SeoPostInput[],
  clinic: SeoClinicContext,
  titles: readonly string[] = [],
): PostSeoResult {
  const sample = posts.slice(0, SEO_POST_LIMIT);
  if (sample.length === 0) return EMPTY_POST_SEO;

  const verdicts = sample.map((post) => judgePost(post, clinic));
  const scope = `최근 ${sample.length}편`;

  const checks: PostSeoCheck[] = (
    Object.keys(CHECK_META) as Array<Exclude<PostSeoCheckId, 'topicVariety'>>
  ).map((id) => {
    const agg = aggregateVerdicts(verdicts.map((verdict) => verdict[id]));
    return {
      id,
      label: CHECK_META[id].label,
      hint: CHECK_META[id].hint,
      ok: agg.ok,
      detail:
        agg.ok === null
          ? '본문을 확보하지 못해 확인하지 못했어요'
          : `${scope} 중 ${agg.passed}편 충족${agg.evaluated < sample.length ? ` (본문 확보 ${agg.evaluated}편 기준)` : ''}`,
    };
  });

  const variety = judgeTopicVariety(titles.length > 0 ? titles : sample.map((post) => post.title));
  checks.push({
    id: 'topicVariety',
    label: '글마다 다른 주제',
    hint: '같은 키워드만 반복하면 병원 글끼리 순위를 나눠 갖게 됩니다.',
    ok: variety.ok,
    detail: variety.detail,
  });

  return {
    checked: true,
    postsAnalyzed: sample.length,
    fullBodies: sample.filter((post) => post.bodyKind === 'full').length,
    summaryOnly: sample.filter((post) => post.bodyKind === 'summary').length,
    checks,
    readyCount: checks.filter((check) => check.ok === true).length,
    missingCount: checks.filter((check) => check.ok === false).length,
    unknownCount: checks.filter((check) => check.ok === null).length,
  };
}
