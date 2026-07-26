import type { PostSeoResult } from './post-seo.ts';
import type {
  AiAxis,
  BlogAxis,
  ComplianceAxis,
  DiagnosisReport,
  Finding,
  FindingDetail,
  FindingGroup,
  SiteAxis,
  SiteCheckState,
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

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
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
      state: `비슷한 이름의 블로그가 ${blog.resolution.guesses.length}개 나와 어느 것이 병원 블로그인지 특정하지 못했습니다. (${names})`,
      why: null,
      action: '아래 후보에서 직접 고르시거나 블로그 주소를 넣어 주세요. 잘못 짚은 블로그로 진단해 드리지 않으려고 여기서 멈췄어요.',
      ourScope: false,
    });
    return out;
  }

  const guess = blog.resolution.guess;
  out.push({
    id: 'blog.exists',
    axis: 'blog',
    label: '병원 블로그',
    tone: 'good',
    state: `블로그를 확인했습니다.${blog.postCount !== null ? ` (최근 글 ${blog.postCount}편 수집)` : ''}`,
    why: null,
    action: '이 블로그를 기준으로 아래 항목을 진단했어요. 주소를 눌러 맞는 블로그인지 확인해 보세요.',
    ourScope: false,
    // 눌러서 바로 열 수 있어야 "우리 블로그가 맞나"를 그 자리에서 확인한다.
    link: {
      href: `https://blog.naver.com/${guess.blogId}`,
      label: `blog.naver.com/${guess.blogId}`,
      insecure: false,
    },
  });

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
 * AI 축 결과 카드.
 *
 * ★ 판정 규칙 (실측 오판 회귀 방지):
 *   · 종합 판정은 **추천 질의(이름 없이 지역+진료과)** 로만 한다.
 *   · 이름 확인 질의는 나오는 게 기본이라 **칭찬 대상이 아니다.** 배경 사실로만 쓴다.
 *     대신 이름을 넣었는데도 안 나오면 그건 심각한 문제로 올린다.
 *
 *   이 구분이 없던 판에서는 "질문 6개 중 2개 등장 → 잘하고 있어요"가 나갔다.
 *   그 2개는 전부 병원 이름을 넣은 질의였고, 정작 환자가 하는 추천 질의 4개는
 *   전부 미등장이었다. 결론이 정반대로 뒤집혀 나간 사고다.
 */
export function buildAiFindings(ai: AiAxis, hasOwnBlog: boolean): readonly Finding[] {
  if (!ai.checked) {
    return [
      {
        id: 'ai.presence',
        axis: 'ai',
        label: 'AI 검색 노출',
        tone: 'unknown',
        state: 'AI 검색 노출은 이번 진단에서 확인하지 못했습니다.',
        why: null,
        action: '상세 진단에서 실제 질문을 넣어 AI가 어떻게 답하는지 확인해 드릴 수 있어요.',
        ourScope: false,
      },
    ];
  }

  const out: Finding[] = [];

  /* ① 종합 판정 — 추천 질의만으로 낸다 */
  if (ai.recommendTotal === 0) {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: 'AI 검색 노출',
      tone: 'unknown',
      state: '환자가 병원 이름 없이 물었을 때의 결과는 이번에 확인하지 못했습니다.',
      why: null,
      action: '잠시 후 다시 진단하시면 이 항목까지 확인해 드릴 수 있어요.',
      ourScope: false,
    });
  } else if (ai.recommendMentioned === 0) {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: 'AI 검색 노출',
      tone: 'warn',
      state: `환자가 병원 이름 없이 "지역 + 진료과"로 물었을 때는 ${ai.recommendTotal}번 모두 나오지 않았습니다.`,
      why: '환자는 병원 이름을 모르는 상태에서 물어봅니다. 그 답변에 없으면 후보에도 못 듭니다. 이름을 알고 찾아오는 환자만 남는다는 뜻이에요.',
      action:
        'AI는 웹에 있는 글을 근거로 답합니다. 지역·진료과·증상을 정면으로 다룬 글이 병원 이름으로 쌓여 있어야 추천 후보에 들어갑니다.',
      ourScope: true,
    });
  } else {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: 'AI 검색 노출',
      tone: 'good',
      state: `환자가 병원 이름 없이 "지역 + 진료과"로 물은 ${ai.recommendTotal}번 중 ${ai.recommendMentioned}번(${pct(
        ai.recommendMentioned,
        ai.recommendTotal,
      )}%)에서 병원이 추천에 올랐습니다.`,
      why: null,
      action: '이름을 모르는 환자에게도 후보로 잡히고 있습니다. 다음 문제는 "무엇을 근거로 그렇게 답했는가"예요.',
      ourScope: false,
    });
  }

  /* ② 배경 사실 — 이름을 넣고 물었을 때. 나오는 건 기본이라 성과로 세지 않는다. */
  if (ai.namedTotal > 0) {
    out.push(
      ai.namedMentioned > 0
        ? {
            id: 'ai.known',
            axis: 'ai',
            label: 'AI가 병원을 아는지',
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
            label: 'AI가 병원을 아는지',
            tone: 'warn',
            state: '병원 이름을 그대로 넣고 물었는데도 AI가 이 병원을 설명하지 못했습니다.',
            why: 'AI가 병원 존재 자체를 모르는 상태입니다. 이름을 알고 검색한 환자마저 엉뚱한 답을 받게 됩니다.',
            action:
              '병원 이름으로 된 설명 문서가 웹에 거의 없다는 뜻입니다. 병원명·진료과·위치가 함께 들어간 글부터 쌓여야 합니다.',
            ourScope: true,
          },
    );
  }

  if (ai.mentionedCount === 0) return out;

  // 인용 경로 — 이 진단에서 가장 설득력 있는 항목
  if (ai.ownedCount > 0) {
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'good',
      state: `${ai.ownedCount}건은 병원이 직접 만든 글(블로그·홈페이지)을 근거로 인용했습니다.`,
      why: null,
      action: '병원 콘텐츠가 AI 답변의 근거로 쓰이고 있습니다. 이 상태를 유지하는 것이 목표예요.',
      ourScope: false,
    });
  } else if (ai.directoryCount > 0) {
    out.push({
      id: 'ai.path',
      axis: 'ai',
      label: 'AI가 참고한 근거',
      tone: 'warn',
      state: `병원 이름이 나온 ${ai.mentionedCount}건 모두, AI가 참고한 근거는 병원이 만든 글이 아니라 외부 디렉터리·목록이었습니다. 병원 블로그나 홈페이지가 근거로 잡힌 건 0건입니다.`,
      why:
        '병원이 설명을 못 하고 남이 만든 한 줄 정보로 소개되고 있다는 뜻입니다. 목록에서 빠지면 그대로 사라지고, 어떤 병원인지도 병원이 정하지 못합니다.',
      action: hasOwnBlog
        ? '지금 쓰는 글이 AI가 인용할 형태가 아닙니다. 질문을 제목으로 잡고 첫 문단에서 바로 답하는 구조로 바꿔야 근거로 잡힙니다.'
        : '병원 이름으로 된 설명 문서가 웹에 없습니다. 진료과·지역 질문에 정면으로 답하는 글부터 쌓아야 합니다.',
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

  const review = compliance.hits.filter((h) => h.level === 'review').length;
  return [
    {
      id: 'compliance.risk',
      axis: 'compliance',
      label: '의료광고법 표현',
      tone: 'warn',
      state: `${scope} ${compliance.postsWithHits}편에서 심의에서 자주 지적되는 표현이 ${compliance.hits.length}건 확인됐습니다${
        review > 0 ? ` (그중 ${review}건은 우선 확인이 필요한 유형)` : ''
      }.`,
      why: '지적 사례가 많은 표현들이라 민원이나 심의가 들어왔을 때 다시 설명해야 할 소지가 있습니다. 지금 위반이라는 판단은 아닙니다.',
      action: `아래 문구들을 한 번 읽어보시고, 단정적인 표현만 완곡하게 바꾸면 대부분 정리됩니다. 앞으로 쓰는 글은 발행 전 점검을 습관으로 두시는 것이 안전해요.${caveat}`,
      ourScope: true,
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
}): readonly string[] {
  const out: string[] = [];
  if (!input.blog.checked || input.blog.blogId === null) out.push('네이버 블로그');
  if (!input.site.checked || !input.site.url) out.push('홈페이지');
  if (!input.ai.checked) out.push('AI 검색 인용');
  if (!input.compliance.checked) out.push('의료광고법 표현');
  return out;
}

/* ── 3분류 · 중요도 ─────────────────────────────────────── */

/**
 * 항목별 무게 — **화면 정렬의 유일한 근거**다. 여기 없는 id 는 맨 뒤로 간다.
 *
 * severity (경고일 때 어느 덩어리로 갈지)
 *   losing    : 지금 이 순간 환자를 놓치고 있거나 리스크를 지고 있다  → "못된 점"
 *   improving : 당장 손해는 아니지만 해두면 나아진다                 → "개선할 점"
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
  // 이름을 모르는 환자에게 아예 안 보인다
  'ai.presence': { severity: 'losing', rank: 12 },
  // AI가 병원 존재 자체를 모른다
  'ai.known': { severity: 'losing', rank: 14 },
  // 심의·민원 리스크를 지금 지고 있다
  'compliance.risk': { severity: 'losing', rank: 16 },
  // 환자와 만날 접점이 아예 없다
  'blog.exists': { severity: 'losing', rank: 20 },
  // 글은 쓰는데 검색에서 안 보인다 — 노력이 성과로 안 이어지는 상태
  'blog.rank': { severity: 'losing', rank: 24 },
  // 글은 쓰는데 글의 형태가 검색에 안 맞는다 — 원인 쪽이라 '개선할 점',
  // 다만 성과로 이어지는 경로라 검색 노출 대역(20~39)에 둔다
  'blog.postSeo': { severity: 'improving', rank: 26 },
  // 방치되면 기존 글 노출까지 함께 내려간다
  'blog.freshness': { severity: 'losing', rank: 28 },
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
  /** 못된 점 — 지금 손해 보고 있는 것. */
  readonly bad: readonly Finding[];
  /** 개선할 점 — 해두면 나아지는 것. */
  readonly improve: readonly Finding[];
  /** 잘된 점 — 이미 되고 있는 것. */
  readonly good: readonly Finding[];
  /** 확인 못 한 것. */
  readonly unknown: readonly Finding[];
}

/**
 * 결과 카드를 화면 순서 그대로 3분류(+미확인)로 나눈다.
 * 각 덩어리 안은 FINDING_WEIGHT.rank 오름차순, 동점이면 원래 순서를 유지한다.
 */
export function groupFindings(findings: readonly Finding[]): GroupedFindings {
  const buckets: Record<FindingGroup, Finding[]> = { bad: [], improve: [], good: [], unknown: [] };
  findings.forEach((finding) => {
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

/**
 * 4축 결과 → 결과 카드 전체.
 * 순서는 화면 순서와 동일하다 (블로그 → 홈페이지 → AI → 의료광고법).
 */
export function buildFindings(input: {
  readonly blog: BlogAxis;
  readonly site: SiteAxis;
  readonly ai: AiAxis;
  readonly compliance: ComplianceAxis;
}): readonly Finding[] {
  return [
    ...buildBlogFindings(input.blog),
    ...buildSiteFindings(input.site),
    ...buildAiFindings(input.ai, input.blog.blogId !== null),
    ...buildComplianceFindings(input.compliance),
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
