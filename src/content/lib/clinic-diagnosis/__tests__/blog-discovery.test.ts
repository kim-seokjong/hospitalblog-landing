import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverClinicBlog,
  extractBlogId,
  parseBlogSearch,
  hasNameSignal,
  meetsAssumeBar,
  resolveBlogGuesses,
  scoreBlogGuesses,
  stripSearchMarkup,
  type BlogSearchItem,
} from '../blog-discovery.ts';
import type { BlogGuess } from '../types.ts';

/**
 * 픽스처는 전부 **실제 네이버 blog.json 응답**에서 가져왔다.
 * 브이비 = 자동 확정되어야 하는 케이스, 플로르 = 동명 블로그 2개라
 * 의도적으로 확정하지 말아야 하는 케이스다.
 */

function item(over: Partial<BlogSearchItem>): BlogSearchItem {
  return { title: '', link: '', bloggerName: '', bloggerLink: '', postDate: '', ...over };
}

const VB_ITEMS: BlogSearchItem[] = [
  item({ title: '대구 코수술 사후관리, 브이비성형외과 고압산소치료', link: 'https://blog.naver.com/vbps_official/224286309905', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official' }),
  item({ title: '브이비성형외과, 3D 시뮬레이션 기반 맞춤형 코성형 상담', link: 'https://blog.naver.com/vbps_official/224043321728', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official' }),
  item({ title: '대구 브이비성형외과의원 위치 및 진료시간 안내', link: 'https://blog.naver.com/vbps_official/224013202051', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official' }),
  item({ title: '전국성형외과 주소록 전화번호부', link: 'https://blog.naver.com/dote9/224065188602', bloggerName: '전국 사업자 주소록', bloggerLink: 'blog.naver.com/dote9' }),
];

const VB = { name: '브이비성형외과의원', specialty: '성형외과', region: '중구', province: '대구광역시' };
const FLOR = { name: '플로르 성형외과 의원', specialty: '성형외과', region: '수성구', province: '대구광역시' };
const LEETING = { name: '리팅성형외과의원', specialty: '성형외과', region: '수성구', province: '대구광역시' };

const FLOR_ITEMS: BlogSearchItem[] = [
  item({ title: '플로르성형외과의원 고우리스킨부스터 런칭 기념 이벤트', link: 'https://blog.naver.com/ehdrjsdlgud1/224338004754', bloggerName: '플로르성형외과의원', bloggerLink: 'blog.naver.com/ehdrjsdlgud1' }),
  item({ title: '플로르성형외과의원 진료과목 소개합니다', link: 'https://blog.naver.com/florps1/223728828078', bloggerName: '플로르 성형외과의원', bloggerLink: 'blog.naver.com/florps1' }),
  item({ title: '대구 플로르 성형외과', link: 'https://blog.naver.com/goqlsdl222/223891214181', bloggerName: '블로그 하는 해로로;-)', bloggerLink: 'blog.naver.com/goqlsdl222' }),
  item({ title: '내돈내산 피부 투자 공구 플로르 하이드로 마스크팩', link: 'https://blog.naver.com/dasombokji/222571704465', bloggerName: '사랑님의블로그', bloggerLink: 'blog.naver.com/dasombokji' }),
];

test('stripSearchMarkup 은 <b> 강조와 엔티티를 제거한다', () => {
  assert.equal(stripSearchMarkup('대구 <b>브이비성형외과</b>의원'), '대구 브이비성형외과의원');
  assert.equal(stripSearchMarkup('분당 &lt; 플로르 &gt;'), '분당 < 플로르 >');
});

test('extractBlogId 는 blog.naver.com 경로에서만 ID 를 뽑는다', () => {
  assert.equal(extractBlogId('blog.naver.com/vbps_official'), 'vbps_official');
  assert.equal(extractBlogId('https://blog.naver.com/florps1/223728828078'), 'florps1');
  assert.equal(extractBlogId('https://example.com/vbps_official'), null);
  assert.equal(extractBlogId(''), null);
  // 3자 미만은 진단 ID 패턴 미달
  assert.equal(extractBlogId('blog.naver.com/ab'), null);
});

test('parseBlogSearch 는 형태가 어긋나면 빈 배열 (throw 금지)', () => {
  for (const bad of [null, undefined, 'x', 3, {}, { items: 'x' }]) {
    assert.deepEqual(parseBlogSearch(bad), []);
  }
});

test('브이비: 블로거명 정확일치 + 다수 점유 → 확신 확정된다', () => {
  const guesses = scoreBlogGuesses(VB_ITEMS, VB);
  assert.equal(guesses[0].blogId, 'vbps_official');
  assert.equal(guesses[0].confidence, 100);
  const resolution = resolveBlogGuesses(guesses);
  assert.equal(resolution.kind, 'confident');
  assert.equal(resolution.kind === 'confident' && resolution.guess.blogId, 'vbps_official');
});

test('브이비: 무관한 블로거(주소록 계정)는 이름 가점을 받지 못한다', () => {
  const guesses = scoreBlogGuesses(VB_ITEMS, VB);
  const noise = guesses.find((g) => g.blogId === 'dote9');
  assert.ok(!noise || noise.confidence < 70, '주소록 계정이 확정 후보가 되면 안 된다');
});

test('병원 특정 결과(지역·진료과)가 채점에 반영된다', () => {
  const guesses = scoreBlogGuesses(VB_ITEMS, VB);
  const top = guesses[0];
  assert.ok((top.regionMentions ?? 0) > 0, '글에 나온 지역(대구)을 세야 한다');
  assert.ok((top.specialtyMentions ?? 0) > 0, '글에 나온 진료과(성형외과)를 세야 한다');
});

test('아이디·블로거명에 병원명이 없어도 제목·지역 신호가 있으면 진단을 진행한다 (리팅 사례)', () => {
  // 실측: 리팅성형외과의 블로그는 night140160 — 이름만으로는 확신이 서지 않는다.
  const items: BlogSearchItem[] = [
    item({ title: '대구 수성구 리팅성형외과 눈매교정 안내', link: 'https://blog.naver.com/night140160/1', bloggerName: '리팅 이야기', bloggerLink: 'blog.naver.com/night140160', description: '대구 수성구 성형외과에서 알려드립니다' }),
    item({ title: '리팅성형외과의원 진료시간 안내', link: 'https://blog.naver.com/night140160/2', bloggerName: '리팅 이야기', bloggerLink: 'blog.naver.com/night140160', description: '수성구 성형외과' }),
    item({ title: '리팅성형외과 코재수술 상담 후 알아두실 점', link: 'https://blog.naver.com/night140160/3', bloggerName: '리팅 이야기', bloggerLink: 'blog.naver.com/night140160', description: '대구 성형외과' }),
  ];
  const guesses = scoreBlogGuesses(items, LEETING);
  assert.equal(guesses[0].blogId, 'night140160');
  assert.equal(guesses[0].nameInBloggerName, false, '블로거명에는 병원명이 없다');
  const resolution = resolveBlogGuesses(guesses);
  assert.equal(resolution.kind, 'assumed', '흐름을 끊지 않고 1위 후보로 진행한다');
  assert.equal(resolution.kind === 'assumed' && resolution.guess.blogId, 'night140160');
  assert.equal(resolution.kind === 'assumed' && resolution.close, false, '단독 후보라 붙어 있지 않다');
});

test('플로르: 같은 이름 블로그가 2개로 붙어 있으면 임의로 고르지 않고 물어본다', () => {
  const guesses = scoreBlogGuesses(FLOR_ITEMS, FLOR);
  const resolution = resolveBlogGuesses(guesses);
  /**
   * ★ 2026-07-27 변경. 예전에는 1위로 그냥 진행했다(격차 요건이 없었다).
   *   두 후보가 동점인데 하나를 골라 진단하면 그 발행주기·키워드·의료광고법 검출이
   *   전부 그 병원 것으로 표시되고, 그 수치가 리드에 저장돼 전화 대본 재료가 된다.
   *   붙어 있으면 사용자에게 묻는다.
   */
  assert.equal(resolution.kind, 'uncertain');
  const ids = resolution.kind === 'uncertain' ? resolution.guesses.map((g) => g.blogId) : [];
  assert.ok(ids.includes('ehdrjsdlgud1') && ids.includes('florps1'));
});

test('플로르: 병원과 무관한 개인 블로그는 후보에서 밀린다', () => {
  const guesses = scoreBlogGuesses(FLOR_ITEMS, FLOR);
  const personal = guesses.find((g) => g.blogId === 'dasombokji');
  assert.ok(!personal || personal.confidence === 0 || personal.confidence < 70);
});

test('이름이 전혀 안 맞는 블로그만 나오면 후보로 남기지 않는다 (none)', () => {
  assert.deepEqual(resolveBlogGuesses([]), { kind: 'none' });
  // 병원명 신호가 0(블로거명·제목 어디에도 없음) → confidence 0 → 후보 목록에서 제외된다.
  const guesses = scoreBlogGuesses(
    [item({ bloggerLink: 'blog.naver.com/stranger', bloggerName: '아무개', title: '대구 성형외과 다녀온 이야기', description: '수성구 성형외과' })],
    VB,
  );
  assert.deepEqual(guesses, []);
  assert.deepEqual(resolveBlogGuesses(guesses), { kind: 'none' });
});

/* ── 자동 진행 판정 ─────────────────────────────────────── */

function guess(over: Partial<BlogGuess>): BlogGuess {
  return { blogId: 'a', bloggerName: 'A', hits: 1, nameInBloggerName: false, titleMentions: 0, confidence: 0, ...over };
}

test('이름 신호가 0이면 점수가 높아도 물어본다 (uncertain)', () => {
  const resolution = resolveBlogGuesses([guess({ confidence: 90 })]);
  assert.equal(resolution.kind, 'uncertain');
  assert.equal(hasNameSignal(guess({ confidence: 90 })), false);
});

test('블로거명 신호가 있으면 자동 진행 임계는 그대로 40점이다', () => {
  // 블로거명은 남이 흉내 낼 수 없는 소유 신호라 기준을 올리지 않았다.
  assert.equal(resolveBlogGuesses([guess({ nameInBloggerName: true, confidence: 39 })]).kind, 'uncertain');
  assert.equal(resolveBlogGuesses([guess({ nameInBloggerName: true, confidence: 40 })]).kind, 'assumed');
});

/**
 * ★ 2026-07-27 점검 지적의 핵심 회귀.
 *   제목 언급 2편(22) + 점유 2편(12) + 지역 1편(7) = 41 이 기존 임계 40 을 넘어
 *   자동 진행됐다. 병원 리뷰·체험단·마케팅 대행 블로그가 흔히 만족하는 조합이다.
 */
test('제목 언급만으로 올라온 후보는 3편 이상 + 55점을 넘어야 자동 진행한다', () => {
  // 제목 2편 조합은 점수가 아무리 높아도 통과하지 못한다(편수 요건).
  assert.equal(resolveBlogGuesses([guess({ titleMentions: 2, confidence: 41 })]).kind, 'uncertain');
  assert.equal(resolveBlogGuesses([guess({ titleMentions: 2, confidence: 62 })]).kind, 'uncertain');
  // 제목 3편이어도 점수가 모자라면 물어본다.
  assert.equal(resolveBlogGuesses([guess({ titleMentions: 3, confidence: 54 })]).kind, 'uncertain');
  assert.equal(resolveBlogGuesses([guess({ titleMentions: 3, confidence: 55 })]).kind, 'assumed');
  assert.equal(meetsAssumeBar(guess({ titleMentions: 2, confidence: 62 })), false);
  assert.equal(meetsAssumeBar(guess({ titleMentions: 3, confidence: 55 })), true);
});

test('블로거명에 병원명이 없으면 아무리 점수가 높아도 확신(confident)으로 올리지 않는다', () => {
  const resolution = resolveBlogGuesses([guess({ titleMentions: 5, confidence: 100 })]);
  assert.equal(resolution.kind, 'assumed');
});

test('2위와 12점 미만으로 붙어 있으면 자동 진행하지 않는다 (assumed 격차 요건)', () => {
  const close = resolveBlogGuesses([
    guess({ blogId: 'a', hits: 3, nameInBloggerName: true, titleMentions: 2, confidence: 90 }),
    guess({ blogId: 'b', hits: 3, nameInBloggerName: true, titleMentions: 2, confidence: 80 }),
  ]);
  assert.equal(close.kind, 'uncertain', '10점 차는 임의 선택이다 — 물어본다');

  // 1점 차도 예전에는 그냥 진행했다. 이제는 물어본다.
  assert.equal(
    resolveBlogGuesses([
      guess({ blogId: 'a', nameInBloggerName: true, confidence: 66 }),
      guess({ blogId: 'b', nameInBloggerName: true, confidence: 65 }),
    ]).kind,
    'uncertain',
  );
});

test('격차는 넘었지만 확신 격차(20)에는 못 미치면 진행하되 붙어 있음을 표시한다', () => {
  const resolution = resolveBlogGuesses([
    guess({ blogId: 'a', hits: 3, nameInBloggerName: true, titleMentions: 2, confidence: 90 }),
    guess({ blogId: 'b', hits: 3, nameInBloggerName: true, titleMentions: 2, confidence: 75 }),
  ]);
  assert.equal(resolution.kind, 'assumed');
  assert.equal(resolution.kind === 'assumed' && resolution.close, true);
});

/* ── 체험단·리뷰 블로그 배제 ────────────────────────────── */

/**
 * ⚠️ 병원이 인근 지역·시술을 키워드로 붙인 제목("경산리프팅성형외과…")은
 *    남의 병원 이름이 아니다. 실측(프라이브성형외과)에서 그 규칙을 넣었더니
 *    자기 병원 블로그가 통째로 후보에서 빠졌다 — 그래서 넣지 않는다.
 */
test('인근 지역·시술 키워드가 제목에 붙어도 자기 블로그 신호를 잃지 않는다', () => {
  const items: BlogSearchItem[] = [
    item({ title: '브이비성형외과의원 눈성형 안내', link: 'https://blog.naver.com/vbps_official/11', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official', description: '대구 성형외과' }),
    item({ title: '경산리프팅성형외과, 상담실에서 자주 듣는 이야기', link: 'https://blog.naver.com/vbps_official/12', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official', description: '대한성형외과의사회 연수강좌 참석 후기를 남깁니다' }),
    item({ title: '브이비성형외과의원 진료시간', link: 'https://blog.naver.com/vbps_official/13', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official', description: '대구 중구 성형외과' }),
  ];
  const guesses = scoreBlogGuesses(items, VB);
  assert.equal(guesses[0]?.blogId, 'vbps_official');
  assert.ok((guesses[0]?.confidence ?? 0) >= 70);
});

test('체험단·협찬 어휘가 있는 블로그는 제목 신호를 받지 못한다', () => {
  const items: BlogSearchItem[] = [
    item({ title: '브이비성형외과의원 체험단 다녀왔어요', link: 'https://blog.naver.com/tester01/1', bloggerName: '일상기록', bloggerLink: 'blog.naver.com/tester01', description: '대구 성형외과 체험단으로 다녀왔습니다' }),
    item({ title: '브이비성형외과의원 시술 받은 날', link: 'https://blog.naver.com/tester01/2', bloggerName: '일상기록', bloggerLink: 'blog.naver.com/tester01', description: '소정의 원고료를 제공받아 작성했습니다' }),
    item({ title: '브이비성형외과의원 재방문', link: 'https://blog.naver.com/tester01/3', bloggerName: '일상기록', bloggerLink: 'blog.naver.com/tester01', description: '대구 성형외과' }),
  ];
  const guesses = scoreBlogGuesses(items, VB);
  assert.deepEqual(guesses, []);
});

test('병원이 직접 운영하는 블로그는 협찬 어휘가 있어도 후보로 남는다 (블로거명 신호 보호)', () => {
  const items: BlogSearchItem[] = [
    item({ title: '브이비성형외과의원 체험단 모집 안내', link: 'https://blog.naver.com/vbps_official/9', bloggerName: '브이비성형외과의원', bloggerLink: 'blog.naver.com/vbps_official', description: '대구 성형외과' }),
  ];
  const guesses = scoreBlogGuesses(items, VB);
  assert.equal(guesses[0]?.blogId, 'vbps_official');
  assert.equal(guesses[0]?.nameInBloggerName, true);
});

test('병원명이 2자 미만이면 채점 자체를 하지 않는다', () => {
  assert.deepEqual(scoreBlogGuesses(VB_ITEMS, { name: '브', specialty: '성형외과' }), []);
});

/* ── HTTP 계층 ──────────────────────────────────────────── */

test('discoverClinicBlog: 네이버 키가 없으면 호출 없이 unavailable', async () => {
  let called = 0;
  const resolution = await discoverClinicBlog(VB, {
    env: {},
    fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(resolution, { kind: 'unavailable' });
  assert.equal(called, 0);
});

test('discoverClinicBlog: 검색이 전부 실패하면 unavailable — none 으로 속이지 않는다', async () => {
  const resolution = await discoverClinicBlog(VB, {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' },
    fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(resolution, { kind: 'unavailable' });
});

test('discoverClinicBlog: 두 질의에 겹쳐 나온 같은 글은 중복 가중되지 않는다', async () => {
  const payload = {
    items: VB_ITEMS.map((it) => ({
      title: it.title, link: it.link, bloggername: it.bloggerName, bloggerlink: it.bloggerLink, postdate: '20260101',
    })),
  };
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const resolution = await discoverClinicBlog(VB, {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }, fetchImpl,
  });
  assert.equal(calls, 2, '병원명 그대로 + 접미사 제거형 2콜');
  assert.equal(resolution.kind, 'confident');
  // dedup 이 되었으면 hits 는 4(원본 건수)를 넘지 않는다
  assert.ok(resolution.kind === 'confident' && resolution.guess.hits <= 3);
});

test('discoverClinicBlog: 타임아웃이 걸려도 throw 하지 않는다', async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_r, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); })) as unknown as typeof fetch;
  const resolution = await discoverClinicBlog(VB, {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' }, fetchImpl, timeoutMs: 20,
  });
  assert.deepEqual(resolution, { kind: 'unavailable' });
});
