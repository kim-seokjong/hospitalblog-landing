import type {
  AiAxis,
  BlogAxis,
  ComplianceAxis,
  DiagnosisReport,
  Finding,
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
    state: `블로그를 확인했습니다 — blog.naver.com/${guess.blogId}${
      blog.postCount !== null ? ` (최근 글 ${blog.postCount}편 수집)` : ''
    }`,
    why: null,
    action: '이 블로그를 기준으로 아래 항목을 진단했어요.',
    ourScope: false,
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

  return out;
}

/* ── ② 홈페이지 ─────────────────────────────────────────── */

function stateLabel(value: SiteCheckState, pass: string, fail: string): string {
  return value === 'pass' ? pass : value === 'fail' ? fail : '확인하지 못했습니다.';
}

function toneOf(value: SiteCheckState): Finding['tone'] {
  return value === 'pass' ? 'good' : value === 'fail' ? 'warn' : 'unknown';
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

  // 1) HTTPS — 가장 먼저, 가장 크게
  if (site.https === 'pass') {
    out.push({
      id: 'site.https',
      axis: 'site',
      label: '보안 연결(HTTPS)',
      tone: 'good',
      state: `${site.url} 가 HTTPS로 정상 응답합니다.`,
      why: null,
      action: '문제없습니다. 인증서 만료일만 캘린더에 걸어 두세요.',
      ourScope: false,
    });
  } else {
    out.push({
      id: 'site.https',
      axis: 'site',
      label: '보안 연결(HTTPS)',
      tone: site.https === 'fail' ? 'warn' : 'unknown',
      state: `${site.url} — ${site.httpsNote ?? '접속 상태를 확인하지 못했습니다.'}`,
      why: '브라우저가 "안전하지 않음" 경고를 띄우면 환자는 그 자리에서 뒤로 갑니다. 검색엔진 평가에도 직접 영향이 있어요.',
      action: '홈페이지를 관리하는 업체에 SSL 인증서 상태를 확인해 달라고 요청하세요. 이건 콘텐츠 문제가 아니라 서버 설정 문제입니다.',
      ourScope: false,
    });
  }

  // 2) 모바일 대응
  out.push({
    id: 'site.viewport',
    axis: 'site',
    label: '모바일 대응',
    tone: toneOf(site.viewport),
    state: stateLabel(
      site.viewport,
      '모바일 화면 대응 설정(viewport)이 들어가 있습니다.',
      '모바일 화면 대응 설정(viewport)이 없습니다.',
    ),
    why: site.viewport === 'fail' ? '환자 대부분은 휴대폰으로 들어옵니다. PC용 화면이 그대로 뜨면 글씨가 작아 바로 이탈합니다.' : null,
    action:
      site.viewport === 'pass'
        ? '기본 설정은 되어 있습니다. 실제 휴대폰에서 한 번 열어보시는 것으로 충분해요.'
        : '홈페이지 업체에 모바일 반응형 적용을 요청하세요.',
    ourScope: false,
  });

  // 3) 검색결과에 표시되는 설명문
  const metaOk = site.metaDescription === 'pass' && site.openGraph === 'pass';
  out.push({
    id: 'site.meta',
    axis: 'site',
    label: '검색·공유 설명문',
    tone: site.metaDescription === 'unknown' ? 'unknown' : metaOk ? 'good' : 'warn',
    state:
      site.metaDescription === 'unknown'
        ? '확인하지 못했습니다.'
        : `검색 설명문(meta description) ${site.metaDescription === 'pass' ? '있음' : '없음'} · 링크 공유용 정보(OG) ${
            site.openGraph === 'pass' ? '있음' : '없음'
          }`,
    why: metaOk || site.metaDescription === 'unknown' ? null : '검색결과와 카톡 공유 미리보기에 병원 소개 문장이 안 뜨고 주소만 나옵니다. 클릭률이 떨어집니다.',
    action: metaOk
      ? '기본 설정이 되어 있습니다. 문구가 진료 내용과 맞는지만 한 번 읽어보세요.'
      : '홈페이지 각 페이지에 80~120자 소개 문장과 대표 이미지를 넣어 달라고 요청하세요.',
    ourScope: false,
  });

  // 4) 구조화 데이터 — AI·검색엔진이 병원 정보를 이해하는 방식
  const hasClinicSchema = site.jsonLdTypes.some((t) =>
    ['MedicalClinic', 'MedicalBusiness', 'Hospital', 'Dentist', 'Physician', 'LocalBusiness'].includes(t),
  );
  out.push({
    id: 'site.jsonld',
    axis: 'site',
    label: '구조화 데이터',
    tone: site.jsonLd === 'unknown' ? 'unknown' : hasClinicSchema ? 'good' : 'warn',
    state:
      site.jsonLd === 'unknown'
        ? '확인하지 못했습니다.'
        : site.jsonLd === 'pass'
          ? `구조화 데이터가 있습니다 (${site.jsonLdTypes.join(', ')})${hasClinicSchema ? '' : ' — 다만 병원 정보용 항목은 없습니다.'}`
          : '구조화 데이터(JSON-LD)가 없습니다.',
    why: hasClinicSchema || site.jsonLd === 'unknown' ? null : '검색엔진과 AI가 이 사이트를 "병원"으로 인식할 근거가 없습니다. 진료과·주소·진료시간을 기계가 읽지 못합니다.',
    action: hasClinicSchema
      ? '병원 정보가 기계가 읽는 형태로 들어가 있습니다. 진료시간이 바뀌면 여기도 같이 고치세요.'
      : '홈페이지에 MedicalClinic 스키마(진료과·주소·전화·진료시간)를 넣어 달라고 요청하세요.',
    ourScope: false,
  });

  // 5) AI 크롤러 접근
  if (site.aiCrawler === 'blocked') {
    out.push({
      id: 'site.aiCrawler',
      axis: 'site',
      label: 'AI 검색 접근',
      tone: 'warn',
      state: `robots.txt가 AI 크롤러를 막고 있습니다 (${site.blockedAiBots.slice(0, 5).join(', ')}${
        site.blockedAiBots.length > 5 ? ' 외' : ''
      }).`,
      why: '환자가 챗GPT·퍼플렉시티에 물어볼 때 이 홈페이지 내용은 근거로 쓰이지 못합니다.',
      action:
        '콘텐츠 보호가 목적이었다면 그대로 두셔도 됩니다. AI 검색 노출을 원하신다면 robots.txt에서 해당 차단을 풀어야 해요.',
      ourScope: false,
    });
  } else if (site.aiCrawler === 'allowed') {
    out.push({
      id: 'site.aiCrawler',
      axis: 'site',
      label: 'AI 검색 접근',
      tone: 'good',
      state: 'robots.txt가 AI 크롤러를 막고 있지 않습니다.',
      why: null,
      action: '접근은 열려 있습니다. 남은 문제는 "읽을 내용이 있는가"예요.',
      ourScope: false,
    });
  } else {
    out.push({
      id: 'site.aiCrawler',
      axis: 'site',
      label: 'AI 검색 접근',
      tone: 'unknown',
      state: 'robots.txt를 확인하지 못했습니다.',
      why: null,
      action: '홈페이지 주소를 직접 넣어 다시 진단해 보세요.',
      ourScope: false,
    });
  }

  // 6) 색인 안내 파일
  if (site.robotsTxt !== 'unknown' || site.sitemapXml !== 'unknown') {
    const both = site.robotsTxt === 'pass' && site.sitemapXml === 'pass';
    out.push({
      id: 'site.indexing',
      axis: 'site',
      label: '색인 안내 파일',
      tone: both ? 'good' : 'warn',
      state: `robots.txt ${stateLabel(site.robotsTxt, '있음', '없음')} · sitemap.xml ${stateLabel(
        site.sitemapXml,
        '있음',
        '없음',
      )}`,
      why: both ? null : '검색엔진이 어떤 페이지를 봐야 하는지 안내가 없어 새 페이지가 늦게 잡히거나 누락될 수 있습니다.',
      action: both
        ? '검색엔진 안내는 갖춰져 있습니다.'
        : '홈페이지 업체에 sitemap.xml 생성과 서치콘솔 제출을 요청하세요. 한 번만 해두면 되는 작업입니다.',
      ourScope: false,
    });
  }

  return out;
}

/* ── ③ AI 인용 ──────────────────────────────────────────── */

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

  const total = ai.probes.length;
  const out: Finding[] = [];

  if (ai.mentionedCount === 0) {
    out.push({
      id: 'ai.presence',
      axis: 'ai',
      label: 'AI 검색 노출',
      tone: 'warn',
      state: `환자가 물어볼 법한 질문 ${total}개를 실제로 AI에 넣어봤는데, 답변에 병원 이름이 한 번도 나오지 않았습니다.`,
      why: '요즘 환자는 검색 대신 AI에게 먼저 물어봅니다. 그 답변에 없으면 후보군에도 못 듭니다.',
      action:
        'AI는 웹에 있는 문서를 근거로 답합니다. 진료과·지역·증상을 정면으로 다룬 글이 병원 이름으로 쌓여 있어야 후보에 들어갑니다.',
      ourScope: true,
    });
    return out;
  }

  out.push({
    id: 'ai.presence',
    axis: 'ai',
    label: 'AI 검색 노출',
    tone: 'good',
    state: `질문 ${total}개 중 ${ai.mentionedCount}개(${pct(ai.mentionedCount, total)}%)의 답변에 병원 이름이 등장했습니다.`,
    why: null,
    action: 'AI가 병원을 인지하고 있습니다. 다음 문제는 "무엇을 근거로 그렇게 답했는가"예요.',
    ourScope: false,
  });

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

  const scope = `제목 ${compliance.postsScanned}편${
    compliance.bodiesScanned > 0 ? ` · 본문 ${compliance.bodiesScanned}편` : ''
  }을 확인했어요.`;

  if (compliance.hits.length === 0) {
    return [
      {
        id: 'compliance.risk',
        axis: 'compliance',
        label: '의료광고법 표현',
        tone: 'good',
        state: `${scope} 심의에서 자주 지적되는 표현은 발견되지 않았습니다.`,
        why: null,
        action:
          '지금 톤을 유지하시면 됩니다. 다만 본문 전체를 다 본 것은 아니니, 이벤트·가격 안내 글은 따로 한 번 확인해 보세요.',
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
      action:
        '아래 문구들을 한 번 읽어보시고, 단정적인 표현만 완곡하게 바꾸면 대부분 정리됩니다. 앞으로 쓰는 글은 발행 전 점검을 습관으로 두시는 것이 안전해요.',
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
