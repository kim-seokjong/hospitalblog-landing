import { complianceRiskCounts } from './compliance-scan.ts';
import type { PostSeoResult } from './post-seo.ts';
import {
  channelLinks,
  contentLinks,
  evidenceText,
  scanScopeText,
  SOCIAL_PRESENCE_LABEL,
  youtubePresenceText,
} from './social-detect.ts';
import type {
  AiAxis,
  BlogAxis,
  ComplianceAxis,
  DiagnosisReport,
  Finding,
  FindingDetail,
  FindingGroup,
  FindingTone,
  PlaceAxis,
  PlaceRankRow,
  SiteAxis,
  SiteCheckState,
  SocialAxis,
  SocialLink,
} from './types.ts';

/**
 * 3단계 — 결과 카드 생성 (규칙 기반 순수 함수, LLM 호출 없음).
 *
 * 점수만 보여주면 아무 일도 일어나지 않는다. 항목마다 반드시 셋이 붙는다:
 *   ① 지금 상태 (사실·수치)
 *   ② 이게 왜 문제인가 (한 줄, 원장 언어)
 *   ③ 그래서 뭘 해야 하나 (구체적 행동)
 *
 * ★ 읽는 사람은 원장이지 개발자가 아니다.
 *   구조화 데이터·robots.txt·sitemap 같은 이름을 앞에 세우지 않는다. 원장은 그게
 *   뭔지 모르고, 알아도 직접 할 수 있는 일이 없다. "몇 가지가 갖춰졌고 몇 가지가
 *   빠졌다"까지만 말하고, 이름이 궁금한 사람을 위해 details 로 접어 둔다.
 *
 * 균형 규칙(의도적으로 코드에 박아 둔다):
 *   · ourScope=false 항목(홈페이지 HTTPS·모바일·robots 등)을 반드시 섞는다.
 *     전부 우리 제품으로 귀결되면 광고로 읽히고 신뢰를 잃는다.
 *   · 잘하고 있는 항목은 그대로 칭찬한다(tone:'good'). 전부 빨간불이면 신뢰가 안 간다.
 *   · 확인하지 못한 항목은 tone:'unknown' + "확인하지 못했습니다"로 정직하게 남긴다.
 *   · 파는 문장을 쓰지 않는다. action 은 "무엇을 해야 하는가"까지만 쓴다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/**
 * 네이버 검색 API 순위의 한계 — 결과 어디에든 이 문구가 함께 나가야 한다.
 * 실측: 같은 글이 API 5위 / 실제 검색 화면 2위로 달랐다.
 */
export const RANK_CAVEAT =
  '순위는 네이버 검색 API 기준이라 실제 검색 화면 순위와 다를 수 있어요(실측에서 몇 계단 차이가 났어요). 추세 참고용으로만 봐 주세요.';

/**
 * 작은 수는 우리말 수관형사로 쓴다 — "3가지 중 2가지"보다 "세 가지 중 두 가지"가
 * 원장이 읽는 문장이다. 범위를 벗어나면 숫자로 떨어진다(질의 상한이 3이라 실사용은 1~3).
 */
const KO_COUNT: readonly string[] = ['0', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

export function koCount(n: number): string {
  return KO_COUNT[n] ?? String(n);
}

/** 질문 원문을 그대로 인용한다 — 원장이 자기 눈으로 확인할 수 있어야 한다. */
function quoteQuestions(questions: readonly string[]): string {
  return questions.map((q) => `“${q}”`).join(', ');
}

/**
 * "N 가지 질문" 표기. 하나뿐이면 수를 세지 않는다 —
 * "한 가지 질문 모두에서"는 어색하고, 표본이 하나라는 사실도 흐린다.
 */
function questionsPhrase(count: number): string {
  return count === 1 ? '질문' : `${koCount(count)} 가지 질문`;
}

/* ── ① 네이버 블로그 ─────────────────────────────────────── */

export function buildBlogFindings(blog: BlogAxis): readonly Finding[] {
  const out: Finding[] = [];

  // 1) 블로그 존재·특정
  if (!blog.checked || blog.resolution.kind === 'unavailable') {
    out.push({
      id: 'blog.exists',
      axis: 'blog',
      label: '병원 블로그',
      tone: 'unknown',
      state: '블로그를 확인하지 못했습니다. (검색 연동을 사용할 수 없었어요)',
      why: null,
      action: '상세 진단에서 블로그 주소를 직접 넣어 주시면 그대로 진단해 드릴게요.',
      ourScope: false,
    });
    return out;
  }

  if (blog.resolution.kind === 'none') {
    out.push({
      id: 'blog.exists',
      axis: 'blog',
      label: '병원 블로그',
      tone: 'warn',
      state: '병원명으로 검색했지만 병원이 직접 운영하는 블로그를 찾지 못했습니다.',
      why: '환자가 증상·시술명을 검색할 때 병원 이름이 걸릴 접점이 없습니다.',
      action:
        '블로그를 운영 중이신데 안 잡혔다면 주소를 직접 넣어 다시 진단해 주세요. 없다면 블로그 개설이 첫 단계입니다.',
      ourScope: true,
    });
    return out;
  }

  if (blog.resolution.kind === 'uncertain') {
    const names = blog.resolution.guesses.slice(0, 3).map((g) => g.blogId).join(', ');
    out.push({
      id: 'blog.exists',
      axis: 'blog',
      label: '병원 블로그',
      tone: 'unknown',
      state: `병원 이름이 블로그 이름에도 글 제목에도 나오지 않아 어느 것이 병원 블로그인지 특정하지 못했습니다. (후보 ${blog.resolution.guesses.length}개: ${names})`,
      why: null,
      action: '아래 후보에서 직접 고르시거나 블로그 주소를 넣어 주세요. 잘못 짚은 블로그로 진단해 드리지 않으려고 여기서 멈췄어요.',
      ourScope: false,
    });
    return out;
  }

  /**
   * ★ 중복 제거 (대표 지적 2026-07-27).
   *
   *   결과 화면 맨 위 "진단한 블로그" 블록이 이미 같은 말을 한다 —
   *   주소·수집한 글 편수·1위 후보로 진행했다는 사실·바꾸는 법까지 전부.
   *   같은 내용을 카드로 한 번 더 내면 "잘하고 있는 것" 개수만 한 칸 부풀고
   *   원장은 "이거 아까 본 건데?"가 된다.
   *
   *   그래서 **블로그가 특정된 상태(blogId 있음)에서는 카드를 만들지 않는다.**
   *   blogId 가 없는 예외 상황에서는 위 블록이 렌더되지 않으므로 카드를 남긴다(폴백).
   *   ⚠️ 이미 저장된 옛 공유 리포트에는 이 카드가 그대로 들어 있다 — 화면은 그것을
   *      그대로 그린다(깨지지 않는다).
   */
  if (blog.blogId === null) {
    const assumed = blog.resolution.kind === 'assumed';
    const guess = blog.resolution.guess;
    const closeNote =
      blog.resolution.kind === 'assumed' && blog.resolution.close
        ? ' 비슷한 후보가 하나 더 있었어요.'
        : '';
    out.push({
      id: 'blog.exists',
      axis: 'blog',
      label: '병원 블로그',
      tone: 'good',
      state: assumed
        ? `이 블로그를 병원 블로그로 보고 진단했습니다.${
            blog.postCount !== null ? ` (최근 글 ${blog.postCount}편 수집)` : ''
          }${closeNote}`
        : `블로그를 확인했습니다.${blog.postCount !== null ? ` (최근 글 ${blog.postCount}편 수집)` : ''}`,
      why: null,
      // ⚠️ 이 문구는 저장돼 공유 화면에서도 그대로 나온다 — 화면 위치("아래")를 가리키지 않는다.
      //    공유 화면에는 후보 선택기도 상세 진단 폼도 없다.
      action: assumed
        ? '주소를 눌러 맞는 블로그인지 확인해 주세요. 다른 블로그라면 진단 페이지에서 주소를 직접 넣어 다시 진단할 수 있어요.'
        : '이 블로그를 기준으로 나머지 항목을 진단했어요. 주소를 눌러 맞는 블로그인지 확인해 보세요.',
      ourScope: false,
      // 눌러서 바로 열 수 있어야 "우리 블로그가 맞나"를 그 자리에서 확인한다.
      link: {
        href: `https://blog.naver.com/${guess.blogId}`,
        label: `blog.naver.com/${guess.blogId}`,
        insecure: false,
      },
    });
  }

  // 2) 최근 발행일 — 방치 여부
  if (blog.daysSinceLatest === null) {
    out.push({
      id: 'blog.freshness',
      axis: 'blog',
      label: '최근 발행',
      tone: 'unknown',
      state: '마지막 발행일을 확인하지 못했습니다.',
      why: null,
      action: '블로그 RSS 공개 설정을 확인해 주세요.',
      ourScope: false,
    });
  } else if (blog.daysSinceLatest <= 14) {
    out.push({
      id: 'blog.freshness',
      axis: 'blog',
      label: '최근 발행',
      tone: 'good',
      state: `마지막 글이 ${blog.daysSinceLatest}일 전입니다. 발행이 살아 있어요.`,
      why: null,
      action: '지금 리듬을 그대로 유지하시면 됩니다. 이 항목은 손댈 게 없어요.',
      ourScope: false,
    });
  } else {
    const stale = blog.daysSinceLatest > 90;
    out.push({
      id: 'blog.freshness',
      axis: 'blog',
      label: '최근 발행',
      tone: 'warn',
      state: `마지막 글이 ${blog.daysSinceLatest}일 전입니다.${stale ? ' 사실상 멈춰 있는 상태예요.' : ''}`,
      why: '네이버는 최신성과 꾸준함을 같이 봅니다. 발행이 비는 동안 기존 글 노출도 함께 내려갑니다.',
      action: '주 1~2회로 발행 간격을 고정하는 것이 먼저입니다. 편수보다 끊기지 않는 것이 중요해요.',
      ourScope: true,
    });
  }

  // 3) 발행량
  if (blog.postsPerWeek !== null) {
    const enough = blog.postsPerWeek >= 1;
    out.push({
      id: 'blog.cadence',
      axis: 'blog',
      label: '발행량',
      tone: enough ? 'good' : 'warn',
      state: `최근 기준 주당 약 ${blog.postsPerWeek.toFixed(1)}편 발행하고 있습니다.`,
      why: enough ? null : '검색에서 병원 글이 쌓이는 속도가 경쟁 병원보다 느립니다.',
      action: enough
        ? '발행량은 충분합니다. 이제 어떤 키워드를 잡을지가 다음 문제예요.'
        : '주 2편을 목표로 잡고, 진료과 핵심 키워드부터 하나씩 채우세요.',
      ourScope: !enough,
    });
  }

  // 4) 키워드 노출
  if (!blog.rankChecked || blog.keywords.length === 0) {
    out.push({
      id: 'blog.rank',
      axis: 'blog',
      label: '키워드 노출',
      tone: 'unknown',
      state: '키워드 노출 순위를 확인하지 못했습니다.',
      why: null,
      action: '상세 진단에서 노리는 키워드를 직접 넣어 주시면 실측해 드릴게요.',
      ourScope: false,
    });
  } else {
    const exposed = blog.keywords.filter((k) => k.apiRank !== null);
    const top10 = exposed.filter((k) => (k.apiRank ?? 999) <= 10);
    if (top10.length > 0) {
      out.push({
        id: 'blog.rank',
        axis: 'blog',
        label: '키워드 노출',
        tone: 'good',
        state: `확인한 ${blog.keywords.length}개 키워드 중 ${top10.length}개가 상위권에 잡혔습니다 (${top10
          .slice(0, 3)
          .map((k) => `${k.keyword} ${k.apiRank}위`)
          .join(', ')}). ${RANK_CAVEAT}`,
        why: null,
        action: '이미 잡힌 키워드는 지키고, 아직 안 잡힌 키워드로 글을 넓히는 것이 다음 순서예요.',
        ourScope: false,
      });
    } else {
      out.push({
        id: 'blog.rank',
        axis: 'blog',
        label: '키워드 노출',
        tone: 'warn',
        state: `확인한 ${blog.keywords.length}개 키워드 중 상위권에 잡힌 것이 없습니다${
          exposed.length > 0 ? ` (가장 높은 순위 ${Math.min(...exposed.map((k) => k.apiRank ?? 999))}위)` : ''
        }. ${RANK_CAVEAT}`,
        why: '글은 있는데 환자가 실제로 검색하는 자리에서는 보이지 않습니다. 발행이 성과로 이어지지 않는 상태예요.',
        action: '글 수를 늘리기 전에 키워드부터 다시 잡아야 합니다. 경쟁 문서 수가 적으면서 검색량이 있는 키워드로 좁히세요.',
        ourScope: true,
      });
    }
  }

  // 5) 최근 글이 검색에 잡히는 형태인가 — 항목별 ✓/✕ 는 접어두기로 내린다
  out.push(...buildPostSeoFindings(blog.postSeo ?? null));

  return out;
}

/**
 * 최근 글 SEO 점검 결과 → 결과 카드 1장.
 *
 * ★ 카드를 쪼개지 않는다. 화면에는 이미 카드가 열 장 가까이 있고, 원장이 볼 것은
 *   "몇 가지가 갖춰졌고 몇 가지가 빠졌나"까지다. 항목별 판정은 전부 details 로 접는다.
 *
 * ★ 어디까지 봤는지 반드시 함께 말한다 — 블로그 RSS 설정이 '부분'이면 본문 앞부분만
 *   오고, 그 글에서는 분량·구조를 판정하지 않았다(확인 못 함으로 남는다).
 */
export function buildPostSeoFindings(postSeo: PostSeoResult | null): readonly Finding[] {
  if (!postSeo || !postSeo.checked || postSeo.checks.length === 0) return [];

  const details: readonly FindingDetail[] = postSeo.checks.map((check) => ({
    label: check.label,
    ok: check.ok,
    hint: `${check.detail} · ${check.hint}`,
  }));

  const scope =
    postSeo.fullBodies > 0 && postSeo.summaryOnly > 0
      ? `(본문 전문 ${postSeo.fullBodies}편 · 나머지 ${postSeo.summaryOnly}편은 블로그가 공개한 글 앞부분까지 기준)`
      : postSeo.fullBodies > 0
        ? '(본문 전문 기준)'
        : '(블로그가 글 앞부분만 공개하고 있어 제목과 앞부분까지만 봤어요)';

  const head = `최근 글 ${postSeo.postsAnalyzed}편을 열어 검색에 잡히는 형태인지 ${postSeo.checks.length}가지를 확인했습니다 ${scope}.`;
  const tail = postSeo.unknownCount > 0 ? ` (${postSeo.unknownCount}가지는 확인하지 못했어요)` : '';

  if (postSeo.missingCount === 0 && postSeo.readyCount === 0) {
    return [
      {
        id: 'blog.postSeo',
        axis: 'blog',
        label: '최근 글 검색 최적화',
        tone: 'unknown',
        state: '최근 글의 내용을 열어보지 못해 글의 형태까지는 확인하지 못했습니다.',
        why: null,
        action: '블로그 RSS 공개 설정을 켜 두시면 다음 진단에서 글 형태까지 봐 드릴 수 있어요.',
        ourScope: false,
        details,
      },
    ];
  }

  if (postSeo.missingCount === 0) {
    return [
      {
        id: 'blog.postSeo',
        axis: 'blog',
        label: '최근 글 검색 최적화',
        tone: 'good',
        state: `${head} 확인한 ${postSeo.readyCount}가지가 모두 갖춰져 있습니다.${tail}`,
        why: null,
        action: '글 쓰는 방식은 지금 그대로 유지하시면 됩니다. 이 항목은 손댈 게 없어요.',
        ourScope: false,
        details,
      },
    ];
  }

  return [
    {
      id: 'blog.postSeo',
      axis: 'blog',
      label: '최근 글 검색 최적화',
      tone: 'warn',
      state: `${head} ${postSeo.readyCount}가지는 갖춰져 있고 ${postSeo.missingCount}가지가 빠져 있습니다.${tail}`,
      why: '검색은 글을 몇 편 썼는지가 아니라 글 하나하나의 형태를 봅니다. 형태가 어긋나 있으면 아무리 써도 상위로 올라오지 않아요.',
      action:
        '아래 목록에서 ✕ 표시된 것부터 다음 글에 적용해 보세요. 이미 올린 글도 제목과 소제목만 손보면 대부분 회복됩니다.',
      ourScope: true,
      details,
    },
  ];
}

/* ── ② 홈페이지 ─────────────────────────────────────────── */

/** pass/fail/unknown → true/false/null (세부 항목 표기용). */
function okOf(value: SiteCheckState): boolean | null {
  return value === 'pass' ? true : value === 'fail' ? false : null;
}

/** 병원으로 인식되는 구조화 데이터 타입. */
const CLINIC_SCHEMA_TYPES: readonly string[] = [
  'MedicalClinic', 'MedicalBusiness', 'Hospital', 'Dentist', 'Physician', 'LocalBusiness',
];

/**
 * 홈페이지가 "검색·AI에 읽히는 상태"인가를 이루는 세부 항목 (순수 함수).
 *
 * 이 목록은 **기본 화면에 나가지 않는다.** 접어두기 안에만 들어간다.
 * 원장에게 필요한 정보는 "몇 개가 갖춰졌고 몇 개가 빠졌나"까지다.
 */
export function buildReadableDetails(site: SiteAxis): readonly FindingDetail[] {
  const indexing: SiteCheckState =
    site.robotsTxt === 'unknown' && site.sitemapXml === 'unknown'
      ? 'unknown'
      : site.robotsTxt === 'pass' && site.sitemapXml === 'pass'
        ? 'pass'
        : 'fail';

  const hasClinicSchema = site.jsonLdTypes.some((t) => CLINIC_SCHEMA_TYPES.includes(t));
  const schema: SiteCheckState = site.jsonLd === 'unknown' ? 'unknown' : hasClinicSchema ? 'pass' : 'fail';

  const aiAccess: SiteCheckState =
    site.aiCrawler === 'allowed' ? 'pass' : site.aiCrawler === 'blocked' ? 'fail' : 'unknown';

  return [
    { label: '휴대폰 화면 대응', ok: okOf(site.viewport), hint: '환자 대부분이 휴대폰으로 들어옵니다.' },
    { label: '검색결과에 뜨는 소개 문장', ok: okOf(site.metaDescription), hint: '없으면 검색결과에 주소만 나옵니다.' },
    { label: '카톡·문자 공유 미리보기', ok: okOf(site.openGraph), hint: '링크를 보냈을 때 뜨는 제목·사진입니다.' },
    { label: '병원 정보 기계 표기', ok: okOf(schema), hint: '진료과·주소·진료시간을 검색엔진이 읽는 형식입니다.' },
    { label: '검색엔진 안내 파일', ok: okOf(indexing), hint: '새 페이지를 빨리 찾아가게 하는 안내입니다.' },
    { label: 'AI 검색 접근 허용', ok: okOf(aiAccess), hint: '챗GPT·퍼플렉시티가 이 사이트를 읽을 수 있는지입니다.' },
  ];
}

export function buildSiteFindings(site: SiteAxis): readonly Finding[] {
  if (!site.checked || !site.url) {
    return [
      {
        id: 'site.exists',
        axis: 'site',
        label: '병원 홈페이지',
        tone: 'unknown',
        state: '홈페이지 주소를 확인하지 못했습니다.',
        why: null,
        action: '상세 진단에서 홈페이지 주소를 직접 넣어 주시면 접속·검색 설정을 점검해 드릴게요.',
        ourScope: false,
      },
    ];
  }

  const out: Finding[] = [];

  /**
   * 결과에 나온 주소는 반드시 눌러서 열려야 한다 — 원장이 자기 홈페이지가 맞는지
   * 그 자리에서 확인해야 하기 때문이다. HTTPS 가 안 되는 사이트는 실제로 응답한
   * http 주소로 연결하고 그 사실을 표시한다.
   */
  const href = site.finalUrl ?? site.url;
  const insecure = !href.toLowerCase().startsWith('https:');
  const link = { href, label: href.replace(/^https?:\/\//i, '').replace(/\/$/, ''), insecure };

  // 1) HTTPS — 원장도 아는 유일한 기술 항목("안전하지 않음 경고")이라 단독으로 남긴다.
  if (site.https === 'pass') {
    out.push({
      id: 'site.https',
      axis: 'site',
      label: '홈페이지 접속(보안 연결)',
      tone: 'good',
      state: '홈페이지가 안전한 주소(https)로 정상적으로 열립니다.',
      why: null,
      action: '문제없습니다. 인증서 만료일만 캘린더에 걸어 두세요.',
      ourScope: false,
      link,
    });
  } else {
    out.push({
      id: 'site.https',
      axis: 'site',
      label: '홈페이지 접속(보안 연결)',
      tone: site.https === 'fail' ? 'warn' : 'unknown',
      state: site.httpsNote ?? '홈페이지 접속 상태를 확인하지 못했습니다.',
      why: '브라우저에 "이 사이트는 안전하지 않습니다" 경고가 뜨면 환자는 그 자리에서 뒤로 갑니다. 검색엔진 평가에도 직접 영향이 있어요.',
      action: '홈페이지를 관리하는 업체에 "보안 인증서(SSL)가 만료됐는지 확인해 달라"고 하시면 됩니다. 글 문제가 아니라 서버 설정 문제라 하루면 고쳐집니다.',
      ourScope: false,
      link,
    });
  }

  // 2) 나머지 전부를 하나로 — "검색·AI가 읽을 수 있는 상태인가"
  const details = buildReadableDetails(site);
  const ready = details.filter((d) => d.ok === true).length;
  const missing = details.filter((d) => d.ok === false).length;
  const unsure = details.filter((d) => d.ok === null).length;

  if (missing === 0 && ready === 0) {
    out.push({
      id: 'site.readable',
      axis: 'site',
      label: '검색·AI가 읽을 수 있는 상태',
      tone: 'unknown',
      state: '홈페이지가 열리지 않아 안쪽 설정까지는 확인하지 못했습니다.',
      why: null,
      action: '접속 문제부터 해결되면 이 항목은 다시 확인해 드릴 수 있어요.',
      ourScope: false,
      details,
    });
  } else if (missing === 0) {
    out.push({
      id: 'site.readable',
      axis: 'site',
      label: '검색·AI가 읽을 수 있는 상태',
      tone: 'good',
      state: `검색엔진과 AI가 홈페이지를 읽는 데 필요한 것이 ${ready}가지 모두 갖춰져 있습니다.${
        unsure > 0 ? ` (${unsure}가지는 확인하지 못했어요)` : ''
      }`,
      why: null,
      action: '홈페이지 쪽은 손댈 게 없습니다. 남은 문제는 "읽을 내용이 있는가"예요.',
      ourScope: false,
      details,
    });
  } else {
    out.push({
      id: 'site.readable',
      axis: 'site',
      label: '검색·AI가 읽을 수 있는 상태',
      tone: 'warn',
      state: `검색엔진과 AI가 홈페이지를 읽는 데 필요한 ${details.length}가지 중 ${ready}가지는 갖춰져 있고 ${missing}가지가 빠져 있습니다.${
        unsure > 0 ? ` (${unsure}가지는 확인하지 못했어요)` : ''
      }`,
      why: '빠진 것이 있으면 검색결과에 병원 소개가 안 뜨고 주소만 나오거나, AI 답변에서 아예 후보에 못 듭니다.',
      action:
        '원장님이 직접 하실 일은 없습니다. 홈페이지 관리 업체에 아래 목록을 그대로 보내 "빠진 것을 채워 달라"고 요청하시면 한 번에 끝납니다.',
      ourScope: false,
      details,
    });
  }

  return out;
}

/* ── ③ AI 인용 ──────────────────────────────────────────── */

/**
 * AI 항목 제목 — **제목만으로 서로 구분돼야 한다** (대표 지적 2026-07-27).
 *
 * "AI 검색 노출"과 "AI가 병원을 아는지"는 실제로 다른 지표인데 제목이 비슷해
 * 원장 눈에는 같은 말로 보였다. 합치지 않는다 — 물어본 방식이 다르고 결론도 다르다.
 * 대신 **어떻게 물었는지를 제목에 넣어** 둘을 갈라 놓는다.
 *   · 이름 없이 물었을 때 = 환자가 실제로 하는 검색. 종합 판정의 정본.
 *   · 이름을 넣고 물었을 때 = 나오는 게 기본. 배경 사실.
 */
const AI_PRESENCE_LABEL = 'AI 추천 등장 (이름 없이 물었을 때)';
const AI_KNOWN_LABEL = 'AI 병원 인지 (이름을 넣고 물었을 때)';

/**
 * AI 축 결과 카드.
 *
 * ★ 판정 규칙 (실측 오판 회귀 방지 — 사고 2건이 이 주석의 근거다):
 *
 *   ① 종합 판정은 **추천 질의(이름 없이 지역+진료과)** 로만 한다.
 *      이름 확인 질의는 나오는 게 기본이라 **칭찬 대상이 아니다.** 배경 사실로만 쓴다.
 *      대신 이름을 넣었는데도 안 나오면 그건 심각한 문제로 올린다.
 *      이 구분이 없던 판에서는 "질문 6개 중 2개 등장 → 잘하고 있어요"가 나갔다.
 *      그 2개는 전부 병원 이름을 넣은 질의였고 추천 질의 4개는 전부 미등장이었다.
 *
 *   ② 분모는 **질문 수**다. 엔진 호출 수가 아니다.
 *      브이성형외과 진단에서 "6번 중 4번(67%) → 잘된 점"이 나갔는데, 그 6은
 *      질문 3개 × 엔진 2곳이었다. 질문별로 보면 한 표현("대구 중구에서 성형외과
 *      어디로 가는 게 좋을까?")은 두 엔진 모두에서 미등장이었다. 엔진 호출을 분모로
 *      쓰면 "한 표현으로 물으면 아예 안 나온다"는 사실이 백분율에 묻힌다.
 *
 *   ③ 3단계 판정. **절반만 나와도 good 이던 것을 막는다.**
 *        모든 질문 등장   → good
 *        일부 질문만 등장 → warn (ai.presence.partial · 개선할 점)
 *        어느 질문에서도 미등장 → warn (ai.presence · severity losing · 못된 점)
 *
 *   ④ 문구에 백분율을 앞세우지 않는다. 6분의 4 같은 숫자는 실제보다 좋게 들린다.
 *      **안 나온 질문의 원문을 그대로 인용**해 원장이 직접 확인할 수 있게 한다.
 */
export function buildAiFindings(ai: AiAxis, hasOwnBlog: boolean): readonly Finding[] {
  if (!ai.checked) {
    return [
      {
        id: 'ai.presence',
        axis: 'ai',
        label: AI_PRESENCE_LABEL,
        tone: 'unknown',
        state: 'AI 검색 노출은 이번 진단에서 확인하지 못했습니다.',
        why: null,
        action: '상세 진단에서 실제 질문을 넣어 AI가 어떻게 답하는지 확인해 드릴 수 있어요.',
        ourScope: false,
      },
    ];
  }

  const out: Finding[] = [];

  /* ① 종합 판정 — 추천 질의를 **질문 단위**로 본다 */
  const questions = ai.questions ?? [];
  const recommend = questions.filter((q) => q.kind === 'recommend');
  const shown = recommend.filter((q) => q.mentioned);
  const missing = recommend.filter((q) => !q.mentioned);
  // 한쪽 엔진에서만 나오는 질문 — "나오긴 나온다"로 넘기지 않고 사실로 적는다.
  const split = recommend.filter(
    (q) => q.engineTotal > 1 && q.engineMentioned > 0 && q.engineMentioned < q.engineTotal,
  );
  const splitNote =
    split.length > 0
      ? ` 다만 그중 ${koCount(split.length)} 가지는 AI 서비스에 따라 나오기도 하고 나오지 않기도 했습니다 — 아직 안정적으로 자리 잡은 상태는 아니에요.`
      : '';

  /** 질문별 등장 여부를 그대로 펼쳐 둔다 — 백분율 대신 원문으로 확인하게 한다. */
  const questionDetails: readonly FindingDetail[] = recommend.map((q) => ({
    label: q.question,
    ok: q.mentioned,
    hint: q.mentioned
      ? q.engineTotal > 1 && q.engineMentioned < q.engineTotal
        ? `물어본 AI ${q.engineTotal}곳 중 ${q.engineMentioned}곳에서만 병원 이름이 나왔어요.`
        : '물어본 AI 모두에서 병원 이름이 나왔어요.'
      : q.engineTotal > 1
        ? `물어본 AI ${q.engineTotal}곳 모두에서 병원 이름이 나오지 않았어요.`
        : '이 표현으로 물었을 때 병원 이름이 나오지 않았어요.',
  }));

  if (recommend.length === 0) {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: AI_PRESENCE_LABEL,
      tone: 'unknown',
      state: '환자가 병원 이름 없이 물었을 때의 결과는 이번에 확인하지 못했습니다.',
      why: null,
      action: '잠시 후 다시 진단하시면 이 항목까지 확인해 드릴 수 있어요.',
      ourScope: false,
    });
  } else if (shown.length === 0) {
    // 전무 — 못된 점 대역(FINDING_WEIGHT: ai.presence = losing)
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: AI_PRESENCE_LABEL,
      tone: 'warn',
      state:
        recommend.length === 1
          ? '환자가 병원 이름 없이 "지역 + 진료과"로 물었을 때 병원이 나오지 않았습니다.'
          : `환자가 병원 이름 없이 "지역 + 진료과"로 물어본 ${questionsPhrase(
              recommend.length,
            )} 어느 것에서도 병원이 나오지 않았습니다.`,
      why: '환자는 병원 이름을 모르는 상태에서 물어봅니다. 그 답변에 없으면 후보에도 못 듭니다. 이름을 알고 찾아오는 환자만 남는다는 뜻이에요.',
      action:
        'AI는 웹에 있는 글을 근거로 답합니다. 지역·진료과·증상을 정면으로 다룬 글이 병원 이름으로 쌓여 있어야 추천 후보에 들어갑니다.',
      ourScope: true,
      details: questionDetails,
    });
  } else if (missing.length > 0) {
    // 일부만 등장 — 개선할 점 대역(FINDING_WEIGHT: ai.presence.partial = improving)
    out.push({
      id: 'ai.presence.partial',
      axis: 'ai',
      label: AI_PRESENCE_LABEL,
      tone: 'warn',
      state: `${questionsPhrase(recommend.length)} 중 ${koCount(
        shown.length,
      )} 가지에서는 병원이 나왔지만, ${quoteQuestions(
        missing.map((q) => q.question),
      )}로 물었을 때는 나오지 않았습니다.${splitNote}`,
      why: '환자마다 묻는 표현이 다릅니다. 나오지 않은 표현으로 검색한 환자에게는 이 병원이 아예 보이지 않습니다 — 그 환자들은 통째로 놓치고 있는 셈이에요.',
      action:
        '나오지 않은 질문이 어떤 표현인지 보시고, 그 표현을 제목으로 잡아 정면으로 답하는 글을 병원 이름과 함께 쌓아야 합니다.',
      ourScope: true,
      details: questionDetails,
    });
  } else {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: AI_PRESENCE_LABEL,
      tone: 'good',
      state:
        recommend.length === 1
          ? `환자가 병원 이름 없이 물어본 질문에서 병원이 추천에 올랐습니다.${splitNote}`
          : `환자가 병원 이름 없이 물어본 ${questionsPhrase(
              recommend.length,
            )} 모두에서 병원이 추천에 올랐습니다.${splitNote}`,
      why: null,
      action: '이름을 모르는 환자에게도 후보로 잡히고 있습니다. 다음 문제는 "무엇을 근거로 그렇게 답했는가"예요.',
      ourScope: false,
      details: questionDetails,
    });
  }

  /* ② 배경 사실 — 이름을 넣고 물었을 때. 나오는 건 기본이라 성과로 세지 않는다. */
  if (ai.namedTotal > 0) {
    out.push(
      ai.namedMentioned > 0
        ? {
            id: 'ai.known',
            axis: 'ai',
            label: AI_KNOWN_LABEL,
            tone: 'good',
            state: '병원 이름을 넣고 물었을 때는 AI가 답을 했습니다 — AI가 병원 존재는 알고 있습니다.',
            why: null,
            action:
              '이름을 넣고 물으면 나오는 것은 기본입니다. 성과로 보실 항목은 아니고, 위의 "이름 없이 물었을 때"가 진짜 지표예요.',
            ourScope: false,
          }
        : {
            id: 'ai.known',
            axis: 'ai',
            label: AI_KNOWN_LABEL,
            tone: 'warn',
            state: '병원 이름을 그대로 넣고 물었는데도 AI가 이 병원을 설명하지 못했습니다.',
            why: 'AI가 병원 존재 자체를 모르는 상태입니다. 이름을 알고 검색한 환자마저 엉뚱한 답을 받게 됩니다.',
            action:
              '병원 이름으로 된 설명 문서가 웹에 거의 없다는 뜻입니다. 병원명·진료과·위치가 함께 들어간 글부터 쌓여야 합니다.',
            ourScope: true,
          },
    );
  }

  /*
   * ② 인용 경로 — 이 진단에서 가장 설득력 있는 항목.
   *
   * 여기도 분모는 **질문 수**다. 엔진 호출 단위로 세면 "3건 중 1건이 병원 글" 같은
   * 상태가 ownedCount > 0 하나로 '잘된 점'이 돼 버린다(실측에서 그렇게 나갔다).
   * 자기 콘텐츠가 근거로 잡힌 질문이 전부가 아니면 칭찬하지 않는다.
   */
  const answered = questions.filter((q) => q.mentioned);
  if (answered.length === 0) return out;

  const ownedQuestions = answered.filter((q) => q.path === 'owned');
  const directoryQuestions = answered.filter((q) => q.path === 'directory');
  const unsourcedQuestions = answered.filter((q) => q.path === 'name_only');

  const pathAction = hasOwnBlog
    ? '지금 쓰는 글이 AI가 인용할 형태가 아닙니다. 질문을 제목으로 잡고 첫 문단에서 바로 답하는 구조로 바꿔야 근거로 잡힙니다.'
    : '병원 이름으로 된 설명 문서가 웹에 없습니다. 진료과·지역 질문에 정면으로 답하는 글부터 쌓아야 합니다.';
  const pathWhy =
    '병원이 설명을 못 하고 남이 만든 한 줄 정보로 소개되고 있다는 뜻입니다. 목록에서 빠지면 그대로 사라지고, 어떤 병원인지도 병원이 정하지 못합니다.';

  if (ownedQuestions.length === answered.length) {
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'good',
      state:
        answered.length === 1
          ? 'AI는 병원이 직접 만든 글(블로그·홈페이지)을 근거로 삼았습니다.'
          : `병원이 나온 ${questionsPhrase(
              answered.length,
            )} 모두에서, AI는 병원이 직접 만든 글(블로그·홈페이지)을 근거로 삼았습니다.`,
      why: null,
      action: '병원 콘텐츠가 AI 답변의 근거로 쓰이고 있습니다. 이 상태를 유지하는 것이 목표예요.',
      ourScope: false,
    });
  } else if (ownedQuestions.length > 0) {
    // 일부만 자기 글 — 여기서 칭찬하면 실제보다 좋게 읽힌다.
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'warn',
      state: `병원이 나온 ${questionsPhrase(answered.length)} 중 ${koCount(
        ownedQuestions.length,
      )} 가지만 병원이 직접 만든 글을 근거로 삼았고, 나머지 ${koCount(
        answered.length - ownedQuestions.length,
      )} 가지는 외부 디렉터리·목록이거나 출처가 표시되지 않았습니다.`,
      why: pathWhy,
      action: pathAction,
      ourScope: true,
    });
  } else if (directoryQuestions.length > 0) {
    const allDirectory = directoryQuestions.length === answered.length;
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'warn',
      state: allDirectory
        ? `${
            answered.length === 1
              ? '병원 이름이 나온 질문에서 AI가 참고한'
              : `병원 이름이 나온 ${questionsPhrase(answered.length)} 모두, AI가 참고한`
          } 근거는 병원이 만든 글이 아니라 외부 디렉터리·목록이었습니다. 병원 블로그나 홈페이지가 근거로 잡힌 질문은 하나도 없습니다.`
        : `병원 이름이 나온 ${questionsPhrase(answered.length)} 중 ${koCount(
            directoryQuestions.length,
          )} 가지는 외부 디렉터리·목록이 근거였고, 나머지 ${koCount(
            unsourcedQuestions.length,
          )} 가지는 AI가 출처를 밝히지 않았습니다. 병원 블로그나 홈페이지가 근거로 잡힌 질문은 하나도 없습니다.`,
      why: pathWhy,
      action: pathAction,
      ourScope: true,
    });
  } else {
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'unknown',
      state: '병원 이름은 나왔지만 AI가 출처를 밝히지 않아 무엇을 근거로 답했는지 확인하지 못했습니다.',
      why: null,
      action: '출처가 표시되는 엔진으로 다시 확인해 볼 수 있어요.',
      ourScope: false,
    });
  }

  return out;
}

/* ── ④ 의료광고법 ───────────────────────────────────────── */

export function buildComplianceFindings(compliance: ComplianceAxis): readonly Finding[] {
  if (!compliance.checked) {
    return [
      {
        id: 'compliance.risk',
        axis: 'compliance',
        label: '의료광고법 표현',
        tone: 'unknown',
        state: '검사할 글을 확보하지 못해 확인하지 못했습니다.',
        why: null,
        action: '상세 진단에서 글 본문을 붙여넣어 주시면 그 자리에서 점검해 드릴게요.',
        ourScope: false,
      },
    ];
  }

  /**
   * 어디까지 봤는지 정확히 적는다.
   * 본문 전문 / 글 앞부분 / 제목만 — 셋을 뭉개면 "다 봤다"로 읽히고,
   * 반대로 매번 "본문을 다 본 것은 아니다"만 붙이면 실제로 다 본 경우까지 깎아내린다.
   */
  const titleOnly = Math.max(
    0,
    compliance.postsScanned - compliance.bodiesScanned - compliance.summariesScanned,
  );
  const scope = `글 ${compliance.postsScanned}편을 확인했어요 (${[
    compliance.bodiesScanned > 0 ? `본문 전문 ${compliance.bodiesScanned}편` : '',
    compliance.summariesScanned > 0 ? `글 앞부분 ${compliance.summariesScanned}편` : '',
    titleOnly > 0 ? `제목만 ${titleOnly}편` : '',
  ]
    .filter((part) => part.length > 0)
    .join(' · ')}).`;

  /** 전문까지 못 본 글이 남아 있을 때만 그 사실을 덧붙인다. */
  const partial = compliance.summariesScanned + titleOnly;
  const caveat =
    partial > 0
      ? ` 다만 ${partial}편은 글 뒤쪽까지 열어보지 못했으니, 이벤트·가격 안내가 글 아래에 붙는 편이라면 그 부분은 따로 확인해 보세요.`
      : '';

  if (compliance.hits.length === 0) {
    return [
      {
        id: 'compliance.risk',
        axis: 'compliance',
        label: '의료광고법 표현',
        tone: 'good',
        state: `${scope} 심의에서 자주 지적되는 표현은 발견되지 않았습니다.`,
        why: null,
        action: `지금 톤을 유지하시면 됩니다.${caveat}`,
        ourScope: false,
      },
    ];
  }

  /**
   * 위험(명시적 금지 유형)과 주의(문맥에 따라 갈리는 표현)를 나눠 말한다.
   * 하나라도 위험이 있으면 카드 자체가 'compliance.prohibited'(지금 고쳐야 할 것)로,
   * 주의만 있으면 'compliance.risk'(챙기면 좋을 것)로 내려간다 — FINDING_WEIGHT 참조.
   */
  const counts = complianceRiskCounts(compliance);
  const total = counts.prohibited + counts.caution;

  if (counts.prohibited > 0) {
    const types = Array.from(
      new Set(compliance.hits.filter((h) => h.risk === 'prohibited' && h.riskLabel).map((h) => h.riskLabel as string)),
    );
    const typePhrase = types.length > 0 ? ` (${types.join(' · ')})` : '';
    return [
      {
        id: 'compliance.prohibited',
        axis: 'compliance',
        label: '의료광고법 표현',
        tone: 'warn',
        state: `${scope} ${
          counts.postsWithProhibited > 0 ? `${counts.postsWithProhibited}편에서 ` : ''
        }의료법이 광고에서 명시적으로 금지한 유형에 해당하는 표현이 ${counts.prohibited}건 확인됐습니다${typePhrase}.${
          counts.caution > 0 ? ` 문맥에 따라 갈리는 표현도 ${counts.caution}건 함께 나왔어요.` : ''
        }`,
        why: '환자 후기·치료 전후 비교·효과 보장처럼 의료법이 광고에서 유형 자체를 금지한 항목이에요. 저희가 위반 여부를 판단한 것은 아니지만, 민원·심의가 들어왔을 때 가장 먼저 문제가 되는 자리입니다.',
        action: `아래 "위험" 표시가 붙은 표현부터 먼저 보세요. 걸린 문장을 그대로 붙여 두었으니 읽어보시고, 해당 유형이 맞다면 문장을 바꾸거나 내리는 편이 안전합니다. 애매하면 심의 담당자에게 확인해 보시는 것이 좋습니다.${caveat}`,
        ourScope: true,
      },
    ];
  }

  const review = compliance.hits.filter((h) => h.level === 'review').length;
  return [
    {
      id: 'compliance.risk',
      axis: 'compliance',
      label: '의료광고법 표현',
      tone: 'warn',
      state: `${scope} ${compliance.postsWithHits}편에서 심의에서 자주 지적되는 표현이 ${total}건 확인됐습니다${
        review > 0 ? ` (그중 ${review}건은 우선 확인이 필요한 유형)` : ''
      }. 앞뒤 문장까지 같이 봤을 때, 의료법이 명시적으로 금지한 유형에 해당하는 표현은 없었어요.`,
      why: '지적 사례가 많은 표현들이라 민원이나 심의가 들어왔을 때 다시 설명해야 할 소지가 있습니다. 지금 위반이라는 판단은 아닙니다.',
      action: `아래에 걸린 문장을 그대로 붙여 두었으니 한 번 읽어보시고, 단정적인 표현만 완곡하게 바꾸면 대부분 정리됩니다. 앞으로 쓰는 글은 발행 전 점검을 습관으로 두시는 것이 안전해요.${caveat}`,
      ourScope: true,
    },
  ];
}

/* ── ⑤ 인스타 · 유튜브 ──────────────────────────────────── */

/**
 * 블로그가 사실상 멈춘 것으로 보는 기준(일).
 * blog.freshness 의 '사실상 멈춰 있는 상태' 문구와 같은 90일을 쓴다 — 화면 두 곳이
 * 서로 다른 기준으로 말하면 원장이 어느 쪽을 믿어야 할지 알 수 없다.
 */
export const SOCIAL_BLOG_STALE_DAYS = 90;

/** 링크 목록 → "@handle, @handle2" 표기. content 링크는 계정명이 없어 제외된다. */
function handleList(links: readonly SocialLink[]): string {
  return links
    .map((l) => (l.platform === 'instagram' ? `@${l.handle}` : l.handle))
    .filter((h) => h.length > 1)
    .slice(0, 3)
    .join(', ');
}

/**
 * 인스타·유튜브 결과 카드.
 *
 * ★ 이 카드의 존재 이유는 **다른 카드가 틀리지 않게 하는 것**이다.
 *   성형외과·피부과의 주 채널은 블로그가 아니라 인스타다. 인스타를 매일 올리는
 *   원장에게 "블로그가 멈췄습니다"만 말하면 진단이 헛다리를 짚은 것으로 읽힌다.
 *   반대로 인스타를 하고 있다는 사실을 함께 말하면 문장이 정확해진다 —
 *   "인스타는 운영하시는데 블로그는 비어 있습니다. 검색으로 찾는 환자는 못 만나고 계십니다."
 *
 * ⚠️ 문구 규칙(절대):
 *   · 링크가 없다고 "인스타를 안 하신다"고 **단정하지 않는다**. 링크가 없을 뿐일 수 있다.
 *     우리가 말할 수 있는 한계는 "홈페이지·블로그에서 확인되지 않았습니다"까지다.
 *   · 그래서 not_found 는 tone:'warn' 이 아니라 tone:'unknown'(확인하지 못한 것)이다.
 *     확인 못 한 것을 문제로 세면 "지금 고쳐야 할 것" 개수가 거짓으로 부푼다.
 */
export function buildSocialFindings(
  social: SocialAxis | null | undefined,
  blog: Pick<BlogAxis, 'daysSinceLatest' | 'blogId'>,
): readonly Finding[] {
  if (!social || !social.checked) return [];

  const scope = scanScopeText(social);
  const channels = channelLinks(social);
  const instagram = channels.filter((l) => l.platform === 'instagram');
  const youtube = channels.filter((l) => l.platform === 'youtube');
  const contents = contentLinks(social);
  const found = channels.length > 0;

  if (!found) {
    const hint =
      contents.length > 0
        ? ' 게시물·영상 링크는 걸려 있었지만 계정 주소는 찾지 못했어요.'
        : '';
    return [
      {
        id: 'social.presence',
        axis: 'social',
        label: '인스타·유튜브',
        tone: 'unknown',
        state: `${scope}에서 인스타그램·유튜브 계정을 확인하지 못했습니다.${hint}`,
        // ⚠️ "안 하신다"가 아니다 — 왜 문제인지 쓸 자리가 아니라 한계를 밝히는 자리다.
        why: null,
        action:
          '운영 중이신데 여기서 안 잡혔다면, 홈페이지와 블로그에 계정 링크를 걸어 두시는 것만으로도 환자가 찾아가는 길이 하나 늘어납니다.',
        ourScope: false,
      },
    ];
  }

  const names: string[] = [];
  if (instagram.length > 0) names.push(SOCIAL_PRESENCE_LABEL.instagram.found);
  // 유튜브는 최근 업로드 시점까지 붙는다 — 있고 없고보다 "언제까지 했나"가 더 중요하다.
  if (youtube.length > 0) names.push(youtubePresenceText(youtube));
  const primary = instagram[0] ?? youtube[0];
  const detail = handleList(channels);
  /**
   * 어디서 찾았는지 — **오탐 추적에 필요하다.**
   * 네이버 검색으로 찾은 계정은 홈페이지 링크만큼 확실하지 않다. 원장이 화면에서
   * 바로 "이건 우리 계정이 아닌데"를 알아챌 수 있어야 오탐이 신뢰 손상으로 안 번진다.
   */
  const evidence = evidenceText(channels);
  const evidenceNote = evidence ? ` (확인 경로: ${evidence})` : '';

  /**
   * ★ 영업·진단 양쪽에서 가장 쓸모 있는 문장이 여기서 나온다.
   *   "인스타는 하고 계신데, 검색에서 만나는 환자는 놓치고 있다."
   *   블로그가 멈춰 있을 때만 말한다 — 둘 다 잘 돌고 있으면 훈수가 된다.
   */
  const blogStale =
    blog.daysSinceLatest !== null && blog.daysSinceLatest >= SOCIAL_BLOG_STALE_DAYS;
  const blogMissing = blog.blogId === null;

  const gapNote = blogStale
    ? ` 다만 블로그는 마지막 글이 ${blog.daysSinceLatest}일 전입니다.`
    : blogMissing
      ? ' 다만 병원이 운영하는 블로그는 찾지 못했습니다.'
      : '';

  return [
    {
      id: blogStale || blogMissing ? 'social.gap' : 'social.presence',
      axis: 'social',
      label: '인스타·유튜브',
      tone: blogStale || blogMissing ? 'warn' : 'good',
      state: `${names.join(' · ')}${detail ? ` (${detail})` : ''}을 확인했습니다.${evidenceNote}${gapNote}`,
      why:
        blogStale || blogMissing
          ? 'SNS는 이미 병원을 아는 사람에게 닿고, 검색은 아직 병원을 모르는 사람에게 닿습니다. 지금은 뒤쪽 통로가 비어 있어서, 증상·시술명으로 검색해 병원을 고르는 환자는 만나지 못하고 계십니다.'
          : null,
      action:
        blogStale || blogMissing
          ? 'SNS에 이미 쓰고 계신 내용을 검색용 글 형태로 옮기는 것부터가 가장 빠릅니다. 소재를 새로 만들 필요가 없어요.'
          : '두 통로가 같이 돌고 있습니다. SNS 글과 블로그 글이 서로를 가리키게 링크만 걸어 두시면 됩니다.',
      ourScope: blogStale || blogMissing,
      ...(primary
        ? {
            link: {
              href: primary.url,
              label: primary.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
              insecure: false,
            },
          }
        : {}),
    },
  ];
}

/* ── 종합 ───────────────────────────────────────────────── */

/** 확인하지 못한 축 이름 목록. */
export function collectUnchecked(input: {
  readonly blog: BlogAxis;
  readonly site: SiteAxis;
  readonly ai: AiAxis;
  readonly compliance: ComplianceAxis;
  readonly place?: PlaceAxis;
}): readonly string[] {
  const out: string[] = [];
  if (!input.blog.checked || input.blog.blogId === null) out.push('네이버 블로그');
  if (!input.site.checked || !input.site.url) out.push('홈페이지');
  if (!input.ai.checked) out.push('AI 검색 인용');
  if (!input.compliance.checked) out.push('의료광고법 표현');
  if (input.place && !input.place.checked) out.push('네이버 플레이스');
  return out;
}

/* ── 네이버 플레이스 ──────────────────────────────────────── */

const PLACE_SCOPE_LABEL: Readonly<Record<'dong' | 'gu' | 'city', string>> = {
  dong: '동네',
  gu: '구·군',
  city: '시·도',
};

/** 한 줄 표기 — "범어동 2위" / "수성구 5위 밖" / "대구 확인 못 함". */
function placeRankText(row: PlaceRankRow, topN: number): string {
  if (row.state === 'ranked' && row.rank !== null) return `${row.region} ${row.rank}위`;
  if (row.state === 'outside_top') return `${row.region} ${topN}위 밖`;
  return `${row.region} 확인 못 함`;
}

/**
 * 플레이스 결과 카드.
 *
 * ★ 왜 키워드마다 한 장인가.
 *   "플레이스 노출이 나쁩니다" 한 줄은 행동으로 이어지지 않는다. 원장이 실제로
 *   움직이려면 **어떤 말로 검색했을 때 어디서부터 안 보이는지**가 있어야 한다.
 *   지역을 넓힐수록 밀리는 낙차가 그 자체로 메시지다.
 *
 * ⚠️ 경쟁 병원 이름은 절대 싣지 않는다 — 타 병원 비교·비방 광고 금지(회사 공통 규칙).
 *    우리 병원이 어디쯤인지만 말한다.
 */
export function buildPlaceFindings(place: PlaceAxis | null | undefined): readonly Finding[] {
  if (!place || !place.checked) return [];

  if (place.presence !== 'found') {
    return [
      {
        id: 'place.presence',
        axis: 'place',
        label: '네이버 플레이스 등록',
        tone: 'warn',
        state: '병원 이름으로 검색했을 때 네이버 플레이스에서 확인되지 않았습니다.',
        why: '지역 검색은 병원을 찾는 가장 흔한 경로인데, 플레이스에 없으면 그 검색 결과에 아예 나오지 않습니다.',
        action:
          '네이버 스마트플레이스에서 업체 등록 상태를 확인해 주세요. 등록돼 있는데 안 잡혔다면 등록 상호가 실제 간판과 다를 수 있습니다.',
        ourScope: false,
      },
    ];
  }

  const out: Finding[] = [];

  if (place.registeredKeywords.length === 0) {
    out.push({
      id: 'place.keywords',
      axis: 'place',
      label: '플레이스 대표 키워드',
      tone: 'warn',
      state: '플레이스에 등록된 대표 키워드가 없습니다.',
      why: '대표 키워드는 환자가 그 말로 검색했을 때 병원이 후보에 들어갈지를 정합니다. 비어 있으면 업종 검색에만 기대게 됩니다.',
      action: '스마트플레이스에서 진료 항목 중심으로 대표 키워드를 등록해 주세요.',
      ourScope: false,
    });
  }

  for (const keyword of place.measuredKeywords) {
    const rows = place.ranks.filter((r) => r.keyword === keyword);
    if (rows.length === 0) continue;

    const checkedRows = rows.filter((r) => r.state !== 'unchecked');
    if (checkedRows.length === 0) {
      out.push({
        id: `place.rank.${keyword}`,
        axis: 'place',
        label: `플레이스 노출 — ${keyword}`,
        tone: 'unknown',
        state: `'${keyword}' 노출 순위를 확인하지 못했습니다.`,
        why: null,
        action: '잠시 후 다시 진단해 주세요.',
        ourScope: false,
      });
      continue;
    }

    const ranked = checkedRows.filter((r) => r.state === 'ranked');
    const widest = ranked.reduce<PlaceRankRow | null>(
      (best, row) =>
        !best || SCOPE_WIDTH[row.scope] > SCOPE_WIDTH[best.scope] ? row : best,
      null,
    );
    const summary = rows.map((r) => placeRankText(r, place.topN)).join(' · ');

    const tone: FindingTone = ranked.length === 0 ? 'warn' : widest?.scope === 'city' ? 'good' : 'warn';

    const why =
      ranked.length === 0
        ? `'${keyword}'로 찾는 환자에게는 첫 화면에 병원이 보이지 않습니다.`
        : widest && widest.scope !== 'city'
          ? `${PLACE_SCOPE_LABEL[widest.scope]} 범위에서는 보이지만, 더 넓혀 검색하면 첫 화면에서 사라집니다.`
          : null;

    out.push({
      id: `place.rank.${keyword}`,
      axis: 'place',
      label: `플레이스 노출 — ${keyword}`,
      tone,
      state: `${summary} (상위 ${place.topN}개 기준)`,
      why,
      action:
        ranked.length === 0
          ? `플레이스 정보와 소식을 '${keyword}' 중심으로 채워 지역 검색 후보에 들어가게 해야 합니다.`
          : '지금 보이는 범위를 넓히려면 해당 키워드의 소식·사진을 꾸준히 쌓아야 합니다.',
      ourScope: true,
      details: rows.map((row) => ({
        label: row.query,
        ok: row.state === 'unchecked' ? null : row.state === 'ranked',
        hint:
          row.state === 'ranked'
            ? `상위 ${place.topN}개 중 ${row.rank}번째로 보입니다.`
            : row.state === 'outside_top'
              ? `상위 ${place.topN}개 안에 없습니다.`
              : '확인하지 못했습니다.',
      })),
    });
  }

  return out;
}

/** 넓을수록 큰 값 — "어디까지 보이는가"를 비교하는 데만 쓴다. */
const SCOPE_WIDTH: Readonly<Record<'dong' | 'gu' | 'city', number>> = { dong: 1, gu: 2, city: 3 };

/* ── 저장된 옛 리포트 보정 ──────────────────────────────── */

/**
 * 위험/주의 2단 등급 이전에 저장된 의료광고법 항목의 전용 id.
 * 저장된 값이 아니라 **읽을 때만** 붙인다(DB 를 고쳐 쓰지 않는다).
 */
export const LEGACY_COMPLIANCE_RISK_ID = 'compliance.risk.legacy';

/**
 * 이 리포트가 위험/주의 2단 등급 **이전**에 저장된 것인가.
 * prohibitedCount 는 등급 분리와 함께 들어온 필드라 그 유무가 세대 구분선이다.
 */
export function isLegacyComplianceReport(compliance: ComplianceAxis): boolean {
  return typeof compliance.prohibitedCount !== 'number';
}

/**
 * 저장된 리포트를 **오늘 화면 기준으로 읽기 위한 보정** (순수 함수).
 *
 * 저장된 findings 는 발급 시점의 문구·id 를 그대로 갖고 있다. 화면 규칙이 바뀌면
 * 같은 링크가 어제와 다른 등급·개수를 보여주게 되므로 읽을 때 두 가지를 맞춘다:
 *
 *   ① 의료광고법 등급 — 옛 리포트의 'compliance.risk' 는 그때 등급(지금 고쳐야 할 것)으로.
 *      (지금 기준으로 읽으면 전부 '주의'가 되어 조용히 한 단계 내려간다)
 *   ② 중복 카드 — 결과 맨 위 "진단한 블로그" 블록이 같은 말을 하므로, 블로그가 특정된
 *      리포트의 'blog.exists'(잘하고 있는 것) 카드는 빼서 배지 숫자를 오늘 것과 맞춘다.
 *
 * 오늘 만들어지는 리포트에는 둘 다 해당 사항이 없어 그대로 통과한다.
 */
export function normalizeStoredFindings(report: {
  readonly blog: Pick<BlogAxis, 'blogId'>;
  readonly compliance: ComplianceAxis;
  readonly findings: readonly Finding[];
}): readonly Finding[] {
  const legacy = isLegacyComplianceReport(report?.compliance ?? ({} as ComplianceAxis));
  const hasBlog = report?.blog?.blogId != null;

  const out: Finding[] = [];
  for (const finding of Array.isArray(report?.findings) ? report.findings : []) {
    if (hasBlog && finding.id === 'blog.exists' && finding.tone === 'good') continue;
    if (legacy && finding.id === 'compliance.risk' && finding.tone === 'warn') {
      out.push({ ...finding, id: LEGACY_COMPLIANCE_RISK_ID });
      continue;
    }
    out.push(finding);
  }
  return out;
}

/* ── 3분류 · 중요도 ─────────────────────────────────────── */

/**
 * 덩어리 화면 문구 — **여기 한 곳에서만 정한다**(결과 화면·공유 리포트 공용).
 *
 * ⚠️ "못된 점"은 병원을 흉보는 말로 읽힌다(대표 실사용 지적). 읽는 사람은 원장이고,
 *    진단은 훈수가 아니라 할 일 목록이어야 한다 — 그래서 전부 "무엇을 할지"로 쓴다.
 *    내부 식별자(bad/improve/good)는 저장된 리포트 호환 때문에 그대로 둔다.
 */
export const FINDING_GROUP_LABEL: Readonly<Record<FindingGroup, { readonly title: string; readonly subtitle: string }>> = {
  bad: {
    title: '지금 고쳐야 할 것',
    subtitle: '지금 이 순간 환자를 놓치고 있거나 리스크를 지고 있는 항목이에요.',
  },
  improve: {
    title: '챙기면 좋을 것',
    subtitle: '당장 손해는 아니지만 해두면 확실히 나아지는 항목이에요.',
  },
  good: {
    title: '잘하고 있는 것',
    subtitle: '이미 잘 되고 있는 항목이에요.',
  },
  unknown: {
    title: '확인하지 못한 것',
    subtitle: '추정으로 채우지 않고 그대로 비워 뒀어요.',
  },
};

/**
 * 항목별 무게 — **화면 정렬의 유일한 근거**다. 여기 없는 id 는 맨 뒤로 간다.
 *
 * severity (경고일 때 어느 덩어리로 갈지)
 *   losing    : 지금 이 순간 환자를 놓치고 있거나 리스크를 지고 있다  → "지금 고쳐야 할 것"
 *   improving : 당장 손해는 아니지만 해두면 나아진다                 → "챙기면 좋을 것"
 *
 * rank (덩어리 안에서의 순서 — 낮을수록 위)
 *   10~19 : 환자 유입·이탈에 직접 영향한다 (들어온 환자가 나가거나, 아예 후보에 못 든다)
 *   20~39 : 검색 노출에 영향한다 (시간이 걸리지만 매출로 이어지는 경로)
 *   40~   : 기술 위생·다듬기 (지금 당장 환자가 줄지는 않는다)
 *
 * 이 표를 코드에 박아 두는 이유: 축(블로그/홈페이지/AI)별로 나열하면 원장이
 * 뭐부터 봐야 할지 알 수 없다. 순서 자체가 조언이므로 근거를 남겨야 한다.
 */
export const FINDING_WEIGHT: Readonly<
  Record<string, { readonly severity: 'losing' | 'improving'; readonly rank: number }>
> = {
  // 들어온 환자가 그 자리에서 이탈한다 — 가장 직접적인 손해
  'site.https': { severity: 'losing', rank: 10 },
  // 이름을 모르는 환자에게 **아예** 안 보인다 (추천 질문 전부 미등장)
  'ai.presence': { severity: 'losing', rank: 12 },
  // AI가 병원 존재 자체를 모른다
  'ai.known': { severity: 'losing', rank: 14 },
  // 일부 표현에서만 보인다 — 그 표현으로 검색하는 환자는 놓치지만 접점 자체는 있다.
  // 전무(losing)와 같은 칸에 두면 "전부 빨간불"이 되어 신뢰를 잃으므로 개선 대역에 둔다.
  'ai.presence.partial': { severity: 'improving', rank: 22 },
  // 의료법이 광고에서 명시적으로 금지한 유형(후기·전후사진·효과보장·비교)이 실제로 실려 있다
  'compliance.prohibited': { severity: 'losing', rank: 16 },
  /**
   * 문맥에 따라 갈리는 표현만 나온 상태 — 최상급·"최신"·유명인 언급 등.
   * 명시적 금지 유형과 같은 칸에 두면 빨간색이 흔해져 정작 위험한 건이 묻힌다.
   * 그래서 '챙기면 좋을 것'으로 내리되, 순서는 검색 노출 항목보다 앞에 둔다.
   */
  'compliance.risk': { severity: 'improving', rank: 21 },
  /**
   * ★ 위험/주의 2단 등급 **이전에 저장된** 리포트의 의료광고법 항목.
   *
   *   옛 리포트는 전부 id 가 'compliance.risk' 이고 hits 에 risk 필드가 없어
   *   지금 기준으로 읽으면 통째로 '주의'가 된다. 그러면 어제까지 "지금 고쳐야 할 것"
   *   이던 항목이 **같은 링크에서** "챙기면 좋을 것"으로 내려가 보인다 —
   *   대표가 전화로 말한 등급과 원장이 보는 화면이 어긋난다.
   *   그래서 옛 리포트는 그때 등급(losing/16)으로 읽는다. normalizeStoredFindings 참조.
   */
  [LEGACY_COMPLIANCE_RISK_ID]: { severity: 'losing', rank: 16 },
  // 환자와 만날 접점이 아예 없다
  'blog.exists': { severity: 'losing', rank: 20 },
  // 글은 쓰는데 검색에서 안 보인다 — 노력이 성과로 안 이어지는 상태
  'blog.rank': { severity: 'losing', rank: 24 },
  // 글은 쓰는데 글의 형태가 검색에 안 맞는다 — 원인 쪽이라 '개선할 점',
  // 다만 성과로 이어지는 경로라 검색 노출 대역(20~39)에 둔다
  'blog.postSeo': { severity: 'improving', rank: 26 },
  // 방치되면 기존 글 노출까지 함께 내려간다
  'blog.freshness': { severity: 'losing', rank: 28 },
  /**
   * SNS 는 도는데 검색 통로가 비어 있다 — 콘텐츠를 이미 만들고 계신데 그 노력이
   * 검색 유입으로 전혀 이어지지 않는 상태다. 발행 정체(28)와 같은 원인을 다른
   * 각도에서 보는 항목이라 바로 뒤에 둔다.
   */
  'social.gap': { severity: 'losing', rank: 29 },
  // 두 통로가 다 도는 상태 — 경고가 아니므로 severity 는 표시상 의미가 없다.
  'social.presence': { severity: 'improving', rank: 48 },
  // 남의 목록으로 소개되고 있다 — 당장 손해는 아니나 통제권이 없다
  'ai.path': { severity: 'improving', rank: 42 },
  // 쌓이는 속도 문제
  'blog.cadence': { severity: 'improving', rank: 46 },
  // 기술 위생 — 업체에 맡기면 끝나는 일
  'site.readable': { severity: 'improving', rank: 50 },
  'site.exists': { severity: 'improving', rank: 60 },
};

/** 표에 없는 항목은 맨 뒤 — 새 항목을 추가하면서 표를 빠뜨려도 순서가 깨지지 않는다. */
const DEFAULT_RANK = 900;

export function findingRank(finding: Finding): number {
  return FINDING_WEIGHT[finding.id]?.rank ?? DEFAULT_RANK;
}

/** 이 경고가 "지금 손해"인가 "해두면 나아짐"인가. 표에 없으면 보수적으로 개선 쪽. */
export function findingGroupOf(finding: Finding): FindingGroup {
  if (finding.tone === 'unknown') return 'unknown';
  if (finding.tone === 'good') return 'good';
  return FINDING_WEIGHT[finding.id]?.severity === 'losing' ? 'bad' : 'improve';
}

export interface GroupedFindings {
  /** 지금 고쳐야 할 것 — 지금 손해 보고 있거나 리스크를 지고 있는 것. */
  readonly bad: readonly Finding[];
  /** 챙기면 좋을 것 — 해두면 나아지는 것. */
  readonly improve: readonly Finding[];
  /** 잘하고 있는 것 — 이미 되고 있는 것. */
  readonly good: readonly Finding[];
  /** 확인하지 못한 것. */
  readonly unknown: readonly Finding[];
}

/**
 * 결과 카드를 화면 순서 그대로 3분류(+미확인)로 나눈다.
 * 각 덩어리 안은 FINDING_WEIGHT.rank 오름차순, 동점이면 원래 순서를 유지한다.
 */
export function groupFindings(findings: readonly Finding[]): GroupedFindings {
  const buckets: Record<FindingGroup, Finding[]> = { bad: [], improve: [], good: [], unknown: [] };
  // 저장된 옛 리포트가 배열이 아닐 수 있다 — 여기서 죽으면 공유 링크가 통째로 500 이 된다.
  (Array.isArray(findings) ? findings : []).forEach((finding) => {
    buckets[findingGroupOf(finding)].push(finding);
  });

  const sorted = (list: readonly Finding[]): readonly Finding[] =>
    list
      .map((finding, index) => ({ finding, index }))
      .sort((a, b) => findingRank(a.finding) - findingRank(b.finding) || a.index - b.index)
      .map((entry) => entry.finding);

  return {
    bad: sorted(buckets.bad),
    improve: sorted(buckets.improve),
    good: sorted(buckets.good),
    unknown: sorted(buckets.unknown),
  };
}

/* ── 채널(축) 묶기 — 화면의 1차 그룹 ───────────────────────── */

/**
 * ★ 왜 채널이 1차 그룹인가 (대표 지적 2026-07-27).
 *
 *   심각도로만 나누면 같은 채널 항목이 세 덩어리에 흩어진다. 실제 프라이브성형외과
 *   결과에서 AI 항목은 "챙기면 좋을 것"에 하나, "잘하고 있는 것"에 둘로 갈라져 있었고,
 *   그래서 **"그래서 AI는 되는 건가 안 되는 건가"를 알 수 없었다.**
 *
 *   채널을 1차 그룹으로 올리면 그 질문에 한 화면에서 답이 나온다.
 *   ⚠️ 심각도를 버리는 게 아니다 — 각 항목의 배지와 채널 안 정렬로 그대로 남는다.
 *      심각도를 버리면 "뭐부터 손대나"를 잃는다.
 */
export const CHANNEL_LABEL: Readonly<Record<Finding['axis'], string>> = {
  compliance: '의료광고법',
  ai: 'AI 검색',
  place: '네이버 플레이스',
  blog: '네이버 블로그',
  site: '홈페이지',
  social: '인스타·유튜브',
};

/** 점수가 같을 때만 쓰는 최후 순서(표시 안정용). 화면 순서를 여기서 정하지 않는다. */
export const CHANNEL_ORDER: readonly Finding['axis'][] = [
  'compliance',
  'place',
  'ai',
  'blog',
  'social',
  'site',
];

/**
 * 분류 자체의 무게 — 채널 정렬의 1차 기준.
 * 미확인을 잘하고 있는 것보다 뒤에 두는 이유: 급한 것이 위로 와야 하는 화면인데
 * "확인 못 함"은 급한 일이 아니라 빈칸이다.
 */
const GROUP_TIER: Readonly<Record<FindingGroup, number>> = { bad: 0, improve: 1, good: 2, unknown: 3 };

export interface ChannelSection {
  readonly axis: Finding['axis'];
  readonly label: string;
  /** 채널 안 항목 — 나쁜 것부터(분류 → rank → 원래 순서). */
  readonly findings: readonly Finding[];
  /** 분류별 개수 — 채널 머리의 배지 숫자가 이 값이다. */
  readonly counts: Readonly<Record<FindingGroup, number>>;
  /** 지금 손대야 할 항목 수 (지금 고쳐야 할 것 + 챙기면 좋을 것). */
  readonly problemCount: number;
  /** 이 채널에서 가장 나쁜 항목의 분류 — 채널 순서와 요약 칸 상태의 근거. */
  readonly worst: FindingGroup;
  /** 그 항목의 rank — 같은 분류끼리 줄 세우는 값(기존 중요도 표 재사용). */
  readonly worstRank: number;
}

/**
 * 결과 카드를 채널별로 묶고, **문제가 심한 채널을 위로** 올린다.
 *
 * 채널 점수(위에서부터 적용):
 *   ① 가장 나쁜 항목의 분류 (지금 고쳐야 할 것 > 챙기면 좋을 것 > 잘하고 있는 것 > 미확인)
 *   ② 그 항목의 rank (기존 FINDING_WEIGHT 재사용 — 새 기준을 만들지 않는다)
 *   ③ 손대야 할 항목 수가 많은 채널이 위
 *   ④ 그래도 같으면 고정 순서 (표시가 매번 흔들리지 않게)
 *
 * 알 수 없는 축이 섞여 있어도(옛 리포트) 버리지 않고 맨 뒤에 붙인다.
 */
export function groupFindingsByChannel(findings: readonly Finding[]): readonly ChannelSection[] {
  const byAxis = new Map<Finding['axis'], { finding: Finding; index: number }[]>();
  (Array.isArray(findings) ? findings : []).forEach((finding, index) => {
    const list = byAxis.get(finding.axis);
    if (list) list.push({ finding, index });
    else byAxis.set(finding.axis, [{ finding, index }]);
  });

  const axes: Finding['axis'][] = [
    ...CHANNEL_ORDER.filter((axis) => byAxis.has(axis)),
    ...Array.from(byAxis.keys()).filter((axis) => !CHANNEL_ORDER.includes(axis)),
  ];

  const sections = axes.map((axis): ChannelSection => {
    const entries = byAxis.get(axis) ?? [];
    const sorted = [...entries].sort(
      (a, b) =>
        GROUP_TIER[findingGroupOf(a.finding)] - GROUP_TIER[findingGroupOf(b.finding)] ||
        findingRank(a.finding) - findingRank(b.finding) ||
        a.index - b.index,
    );
    const counts: Record<FindingGroup, number> = { bad: 0, improve: 0, good: 0, unknown: 0 };
    sorted.forEach((entry) => {
      counts[findingGroupOf(entry.finding)] += 1;
    });
    const head = sorted[0]?.finding ?? null;
    return {
      axis,
      label: CHANNEL_LABEL[axis] ?? axis,
      findings: sorted.map((entry) => entry.finding),
      counts,
      problemCount: counts.bad + counts.improve,
      worst: head === null ? 'unknown' : findingGroupOf(head),
      worstRank: head === null ? DEFAULT_RANK : findingRank(head),
    };
  });

  return sections.sort(
    (a, b) =>
      GROUP_TIER[a.worst] - GROUP_TIER[b.worst] ||
      a.worstRank - b.worstRank ||
      b.problemCount - a.problemCount ||
      CHANNEL_ORDER.indexOf(a.axis) - CHANNEL_ORDER.indexOf(b.axis),
  );
}

/**
 * 상단 요약 한 칸의 상태 문구 — 채널이 지금 어떤 상태인지 한 마디로.
 * 문구는 FINDING_GROUP_LABEL 을 그대로 쓴다(이름을 여기서 새로 만들지 않는다).
 */
export function channelStatusText(section: ChannelSection): string {
  if (section.counts.bad > 0) return `${FINDING_GROUP_LABEL.bad.title} ${section.counts.bad}`;
  if (section.counts.improve > 0) return `${FINDING_GROUP_LABEL.improve.title} ${section.counts.improve}`;
  if (section.counts.good > 0) return '잘하고 있어요';
  return '확인하지 못했어요';
}

/** 채널 머리에 붙는 배지 — 있는 분류만, 화면 순서 그대로. */
export function channelBadges(
  section: ChannelSection,
): readonly { readonly group: FindingGroup; readonly text: string }[] {
  return (['bad', 'improve', 'good', 'unknown'] as const)
    .filter((group) => section.counts[group] > 0)
    .map((group) => ({ group, text: `${FINDING_GROUP_LABEL[group].title} ${section.counts[group]}` }));
}

/**
 * 축별 결과 → 결과 카드 전체.
 * 순서는 화면 순서와 동일하다 (블로그 → 홈페이지 → AI → 의료광고법 → 인스타·유튜브).
 *
 * ⚠️ social 은 옵셔널이다 — 이 축이 생기기 전에 만들어진 호출부·테스트를 깨지 않는다.
 *    없으면 카드도 만들어지지 않는다(빈 자리를 추정으로 채우지 않는다).
 */
export function buildFindings(input: {
  readonly blog: BlogAxis;
  readonly site: SiteAxis;
  readonly ai: AiAxis;
  readonly compliance: ComplianceAxis;
  readonly social?: SocialAxis;
  readonly place?: PlaceAxis;
}): readonly Finding[] {
  return [
    ...buildBlogFindings(input.blog),
    ...buildSiteFindings(input.site),
    ...buildAiFindings(input.ai, input.blog.blogId !== null),
    ...buildComplianceFindings(input.compliance),
    ...buildSocialFindings(input.social, input.blog),
    ...buildPlaceFindings(input.place),
  ];
}

/** 요약 카운트 — 화면 상단 배지용. 점수 하나로 뭉개지 않는다(오해 방지). */
export function summarizeFindings(findings: readonly Finding[]): {
  readonly good: number;
  readonly warn: number;
  readonly unknown: number;
} {
  return {
    good: findings.filter((f) => f.tone === 'good').length,
    warn: findings.filter((f) => f.tone === 'warn').length,
    unknown: findings.filter((f) => f.tone === 'unknown').length,
  };
}

/** 리포트 전체가 "확인된 것이 하나도 없는" 상태인지 — 화면에서 안내를 바꾼다. */
export function isEmptyReport(report: DiagnosisReport): boolean {
  return report.findings.every((f) => f.tone === 'unknown');
}
