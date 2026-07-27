import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSocialAxis,
  channelLinks,
  classifySocialUrl,
  contentLinks,
  daysSince,
  EMPTY_SOCIAL_AXIS,
  evidenceText,
  extractSocialLinks,
  MAX_SOCIAL_LINKS,
  mergeSocialLinks,
  scanScopeText,
  SOCIAL_PRESENCE_LABEL,
  youtubePresenceText,
} from '../social-detect.ts';
import { buildSocialFindings, CHANNEL_LABEL, CHANNEL_ORDER, groupFindingsByChannel } from '../findings.ts';
import type { BlogAxis, SocialLink } from '../types.ts';

/* ── URL 판정 ──────────────────────────────────────────── */

test('인스타 프로필 주소는 채널로, 게시물 주소는 콘텐츠로 나뉜다', () => {
  const profile = classifySocialUrl('instagram.com', 'vb_clinic/');
  assert.deepEqual(profile, {
    platform: 'instagram',
    kind: 'channel',
    handle: 'vb_clinic',
    url: 'https://www.instagram.com/vb_clinic/',
  });

  const post = classifySocialUrl('instagram.com', 'p/CxYz123/');
  assert.equal(post?.kind, 'content');
  assert.equal(post?.handle, '');
});

test('인스타 예약 경로를 계정으로 읽지 않는다 (reel/explore/accounts)', () => {
  for (const path of ['reel/abc/', 'explore/tags/코성형/', 'accounts/login/']) {
    const link = classifySocialUrl('instagram.com', path);
    assert.equal(link?.kind, 'content', `${path} 는 계정이 아니다`);
  }
});

test('유튜브 채널 주소 3형식(@handle · /channel/UC · /c/)을 모두 채널로 본다', () => {
  assert.equal(classifySocialUrl('youtube.com', '@daegu-clinic')?.kind, 'channel');
  assert.equal(classifySocialUrl('youtube.com', 'channel/UCabcdefghijklmnopqrstuv')?.kind, 'channel');
  assert.equal(classifySocialUrl('youtube.com', 'c/브이비성형외과')?.kind, 'channel');
});

test('★유튜브 영상 링크는 채널 근거로 쓰지 않는다 — 남의 영상 임베드일 수 있다', () => {
  assert.equal(classifySocialUrl('youtube.com', 'watch?v=dQw4w9WgXcQ')?.kind, 'content');
  assert.equal(classifySocialUrl('youtu.be', 'dQw4w9WgXcQ')?.kind, 'content');
  assert.equal(classifySocialUrl('youtube.com', 'embed/dQw4w9WgXcQ')?.kind, 'content');
});

test('망가진 채널 id 는 계정으로 인정하지 않는다 (추정으로 메우지 않는다)', () => {
  assert.equal(classifySocialUrl('youtube.com', 'channel/짧음'), null);
  assert.equal(classifySocialUrl('instagram.com', 'a'), null); // 1자 계정은 없다
  assert.equal(classifySocialUrl('instagram.com', ''), null);
});

/* ── HTML·본문에서 뽑기 ────────────────────────────────── */

test('href 안의 링크와 본문에 텍스트로 적힌 주소를 모두 잡는다', () => {
  const html = `<!doctype html><html><body>
    <a href="https://www.instagram.com/vb_clinic/?hl=ko">인스타</a>
    <p>유튜브는 https://www.youtube.com/@vbclinic 에서 보실 수 있어요</p>
  </body></html>`;
  const links = extractSocialLinks(html);
  assert.equal(links.length, 2);
  assert.ok(links.some((l) => l.platform === 'instagram' && l.handle === 'vb_clinic'));
  assert.ok(links.some((l) => l.platform === 'youtube' && l.handle === '@vbclinic'));
});

test('같은 계정이 여러 번 나와도 1건으로 합치고 채널을 앞에 둔다', () => {
  const html = `
    <a href="//instagram.com/p/AAA/">게시물</a>
    <a href="https://instagram.com/vb_clinic">프로필</a>
    <a href="https://www.instagram.com/vb_clinic/">푸터 프로필</a>`;
  const links = extractSocialLinks(html);
  assert.equal(links.filter((l) => l.kind === 'channel').length, 1);
  assert.equal(links[0].kind, 'channel');
});

test('쿼리스트링·HTML 엔티티가 붙어도 계정 이름을 정확히 뽑는다', () => {
  const links = extractSocialLinks(
    '<a href="https://www.instagram.com/vb_clinic/?utm_source=home&amp;utm_medium=footer">인스타</a>' +
      '<a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv?sub_confirmation=1">유튜브</a>',
  );
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.kind === 'channel'));
  assert.ok(links.some((l) => l.handle === 'vb_clinic'));
  assert.ok(links.some((l) => l.handle === 'UCabcdefghijklmnopqrstuv'));
});

test('빈 입력·소셜 없는 HTML 에서는 아무것도 만들지 않는다', () => {
  assert.deepEqual(extractSocialLinks(''), []);
  assert.deepEqual(extractSocialLinks('<html><body>전화 053-000-0000</body></html>'), []);
});

test('링크가 폭주해도 상한을 넘지 않는다', () => {
  const many = Array.from({ length: 60 }, (_, i) => `https://instagram.com/clinic_${i}`).join(' ');
  assert.ok(extractSocialLinks(many).length <= MAX_SOCIAL_LINKS);
});

test('mergeSocialLinks 는 출처가 달라도 같은 계정을 한 번만 남긴다', () => {
  const a: SocialLink[] = [
    { platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/' },
  ];
  const b: SocialLink[] = [
    { platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/' },
    { platform: 'youtube', kind: 'channel', handle: '@vb', url: 'https://www.youtube.com/@vb' },
  ];
  assert.equal(mergeSocialLinks(a, b).length, 2);
});

/* ── 축 조립 ───────────────────────────────────────────── */

test('★아무 자료도 못 본 상태는 not_found 가 아니라 unknown 이다', () => {
  const axis = buildSocialAxis({ scannedSite: false, siteLinks: [], scannedBlog: false, blogLinks: [] });
  assert.equal(axis.checked, false);
  assert.equal(axis.instagram, 'unknown');
  assert.equal(axis.youtube, 'unknown');
  assert.deepEqual(axis, EMPTY_SOCIAL_AXIS);
});

test('봤는데 링크가 없으면 not_found — 화면 문구는 여전히 "확인되지 않음"이다', () => {
  const axis = buildSocialAxis({ scannedSite: true, siteLinks: [], scannedBlog: true, blogLinks: [] });
  assert.equal(axis.checked, true);
  assert.equal(axis.instagram, 'not_found');
  assert.equal(SOCIAL_PRESENCE_LABEL.instagram.not_found, '확인되지 않음');
  assert.equal(SOCIAL_PRESENCE_LABEL.youtube.not_found, '확인되지 않음');
});

test('★콘텐츠 링크만 있으면 found 로 올리지 않는다', () => {
  const axis = buildSocialAxis({
    scannedSite: true,
    siteLinks: [{ platform: 'youtube', kind: 'content', handle: '', url: 'https://youtu.be/' }],
    scannedBlog: false,
    blogLinks: [],
  });
  assert.equal(axis.youtube, 'not_found');
  assert.equal(contentLinks(axis).length, 1);
  assert.equal(channelLinks(axis).length, 0);
});

test('채널 링크가 있으면 found', () => {
  const axis = buildSocialAxis({
    scannedSite: false,
    siteLinks: [],
    scannedBlog: true,
    blogLinks: [{ platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/' }],
  });
  assert.equal(axis.instagram, 'found');
  assert.equal(axis.youtube, 'not_found');
  assert.equal(scanScopeText(axis), '블로그 글');
});

test('본 범위를 문구로 정확히 밝힌다', () => {
  assert.equal(scanScopeText(buildSocialAxis({ scannedSite: true, siteLinks: [], scannedBlog: true, blogLinks: [] })), '홈페이지와 블로그 글');
  assert.equal(scanScopeText(buildSocialAxis({ scannedSite: true, siteLinks: [], scannedBlog: false, blogLinks: [] })), '홈페이지');
  assert.equal(scanScopeText(EMPTY_SOCIAL_AXIS), '');
});

/* ── 결과 카드 ─────────────────────────────────────────── */

const BLOG_FRESH: Pick<BlogAxis, 'daysSinceLatest' | 'blogId'> = { daysSinceLatest: 5, blogId: 'vbclinic' };
const BLOG_STALE: Pick<BlogAxis, 'daysSinceLatest' | 'blogId'> = { daysSinceLatest: 450, blogId: 'vbclinic' };
const BLOG_NONE: Pick<BlogAxis, 'daysSinceLatest' | 'blogId'> = { daysSinceLatest: null, blogId: null };

const IG_AXIS = buildSocialAxis({
  scannedSite: true,
  siteLinks: [{ platform: 'instagram', kind: 'channel', handle: 'vb_clinic', url: 'https://www.instagram.com/vb_clinic/' }],
  scannedBlog: true,
  blogLinks: [],
});

test('확인 못 한 축은 카드를 만들지 않는다', () => {
  assert.deepEqual(buildSocialFindings(EMPTY_SOCIAL_AXIS, BLOG_FRESH), []);
  assert.deepEqual(buildSocialFindings(undefined, BLOG_FRESH), []);
});

test('★링크가 없을 때 "안 한다"고 단정하지 않는다 — tone 은 warn 이 아니라 unknown', () => {
  const axis = buildSocialAxis({ scannedSite: true, siteLinks: [], scannedBlog: true, blogLinks: [] });
  const [card] = buildSocialFindings(axis, BLOG_FRESH);
  assert.equal(card.tone, 'unknown');
  assert.match(card.state, /확인하지 못했습니다/);
  assert.match(card.state, /홈페이지와 블로그 글/);
  assert.doesNotMatch(card.state, /안 하|운영하지 않/);
  assert.equal(card.ourScope, false);
});

test('★인스타는 도는데 블로그가 멈췄으면 그 간극을 말한다 (영업 핵심 문장)', () => {
  const [card] = buildSocialFindings(IG_AXIS, BLOG_STALE);
  assert.equal(card.id, 'social.gap');
  assert.equal(card.tone, 'warn');
  assert.match(card.state, /인스타그램 운영 중/);
  assert.match(card.state, /450일 전/);
  assert.match(card.why ?? '', /검색/);
  assert.equal(card.link?.href, 'https://www.instagram.com/vb_clinic/');
});

test('블로그가 아예 없을 때도 간극으로 본다', () => {
  const [card] = buildSocialFindings(IG_AXIS, BLOG_NONE);
  assert.equal(card.id, 'social.gap');
  assert.match(card.state, /블로그는 찾지 못했습니다|블로그는 마지막 글/);
});

test('★어디서 찾았는지 카드에 남긴다 (네이버 검색으로 찾은 계정은 그렇게 밝힌다)', () => {
  const axis = buildSocialAxis({
    scannedSite: true,
    siteLinks: [],
    scannedBlog: false,
    blogLinks: [],
    searchLinks: [
      { platform: 'instagram', kind: 'channel', handle: 'edge__ps', url: 'https://www.instagram.com/edge__ps/', source: 'naver_search' },
    ],
    searchedNaver: true,
  });
  const [card] = buildSocialFindings(axis, BLOG_FRESH);
  assert.match(card.state, /인스타그램 운영 중/);
  assert.match(card.state, /확인 경로: 네이버 검색/);
});

test('★유튜브 카드에 최근 업로드 시점이 들어간다 ("채널만 있고 3년째 안 올림"과 구분)', () => {
  const axis = buildSocialAxis({
    scannedSite: true,
    siteLinks: [
      {
        platform: 'youtube',
        kind: 'channel',
        handle: 'UC1',
        url: 'https://www.youtube.com/channel/UC1',
        source: 'site',
        lastUploadAt: '2023-01-01T00:00:00.000Z',
        daysSinceUpload: 1100,
      },
    ],
    scannedBlog: false,
    blogLinks: [],
  });
  const [card] = buildSocialFindings(axis, BLOG_FRESH);
  assert.match(card.state, /유튜브 채널 있음 \(최근 업로드 1100일 전\)/);
  assert.match(card.state, /확인 경로: 홈페이지 링크/);
});

test('검색까지 돌리고도 못 찾으면 그 사실을 문구에 밝힌다 (여전히 unknown)', () => {
  const axis = buildSocialAxis({
    scannedSite: true,
    siteLinks: [],
    scannedBlog: true,
    blogLinks: [],
    searchLinks: [],
    searchedNaver: true,
  });
  const [card] = buildSocialFindings(axis, BLOG_FRESH);
  assert.equal(card.tone, 'unknown');
  assert.match(card.state, /네이버 검색/);
  assert.match(card.state, /확인하지 못했습니다/);
  assert.doesNotMatch(card.state, /안 하|운영하지 않/);
});

test('둘 다 잘 돌면 훈수하지 않는다 (good)', () => {
  const [card] = buildSocialFindings(IG_AXIS, BLOG_FRESH);
  assert.equal(card.id, 'social.presence');
  assert.equal(card.tone, 'good');
  assert.equal(card.why, null);
  assert.equal(card.ourScope, false);
});

/* ── 출처(근거) · 최근 업로드 ───────────────────────────── */

test('찾은 링크에 출처를 새긴다 — 오탐 추적의 유일한 단서', () => {
  const [link] = extractSocialLinks('<a href="https://instagram.com/vb_clinic">인스타</a>', 'site');
  assert.equal(link.source, 'site');
  const [plain] = extractSocialLinks('<a href="https://instagram.com/vb_clinic">인스타</a>');
  assert.equal(plain.source, undefined, '출처를 안 주면 붙이지 않는다(옛 리포트 호환)');
});

test('같은 계정이 여러 출처에서 나오면 먼저 온 출처를 남긴다 (링크 > 검색)', () => {
  const merged = mergeSocialLinks(
    [{ platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/', source: 'site' }],
    [{ platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/', source: 'naver_search' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'site');
});

test('★뒤에서만 얻은 최근 업로드 시점은 앞선 링크에 채워 넣는다 (정보를 버리지 않는다)', () => {
  const merged = mergeSocialLinks(
    [{ platform: 'youtube', kind: 'channel', handle: 'UC1', url: 'https://www.youtube.com/channel/UC1', source: 'site' }],
    [
      {
        platform: 'youtube',
        kind: 'channel',
        handle: 'UC1',
        url: 'https://www.youtube.com/channel/UC1',
        source: 'youtube_api',
        lastUploadAt: '2026-07-01T00:00:00.000Z',
        daysSinceUpload: 26,
      },
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'site');
  assert.equal(merged[0].daysSinceUpload, 26);
});

test('어디까지 봤는지에 검색 경로도 함께 밝힌다', () => {
  const axis = buildSocialAxis({
    scannedSite: true,
    siteLinks: [],
    scannedBlog: true,
    blogLinks: [],
    searchLinks: [],
    searchedNaver: true,
  });
  assert.equal(scanScopeText(axis), '홈페이지, 블로그 글과 네이버 검색');
  assert.equal(axis.searchedNaver, true);
});

test('★자료를 하나도 못 봤어도 검색을 돌렸으면 확인한 것이다', () => {
  const axis = buildSocialAxis({
    scannedSite: false,
    siteLinks: [],
    scannedBlog: false,
    blogLinks: [],
    searchLinks: [
      { platform: 'instagram', kind: 'channel', handle: 'vb', url: 'https://www.instagram.com/vb/', source: 'naver_search' },
    ],
    searchedNaver: true,
  });
  assert.equal(axis.checked, true);
  assert.equal(axis.instagram, 'found');
  assert.equal(scanScopeText(axis), '네이버 검색');
});

test('출처 표기는 중복 없이 홈페이지→블로그→검색 순이다', () => {
  assert.equal(
    evidenceText([
      { platform: 'instagram', kind: 'channel', handle: 'a', url: 'u', source: 'naver_search' },
      { platform: 'youtube', kind: 'channel', handle: 'b', url: 'u', source: 'site' },
      { platform: 'instagram', kind: 'channel', handle: 'c', url: 'u', source: 'site' },
    ]),
    '홈페이지 링크와 네이버 검색',
  );
  assert.equal(evidenceText([]), '');
});

test('★유튜브는 최근 업로드 시점까지 말한다 (모르면 아무 말도 안 붙인다)', () => {
  const base = { platform: 'youtube' as const, kind: 'channel' as const, handle: 'UC1', url: 'u' };
  assert.equal(youtubePresenceText([{ ...base, daysSinceUpload: 1200 }]), '유튜브 채널 있음 (최근 업로드 1200일 전)');
  assert.equal(youtubePresenceText([{ ...base, daysSinceUpload: 0 }]), '유튜브 채널 있음 (오늘 업로드)');
  assert.equal(youtubePresenceText([base]), '유튜브 채널 있음');
  assert.equal(youtubePresenceText([]), '유튜브 채널 있음');
});

test('daysSince 는 못 읽는 값을 null 로 돌린다 (0으로 속이지 않는다)', () => {
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  assert.equal(daysSince('2026-07-20T00:00:00.000Z', now), 7);
  assert.equal(daysSince('없는날짜', now), null);
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince('2026-08-01T00:00:00.000Z', now), 0, '미래여도 음수를 내지 않는다');
});

test('social 카드가 채널 묶기에서 제 이름으로 잡힌다', () => {
  const sections = groupFindingsByChannel(buildSocialFindings(IG_AXIS, BLOG_STALE));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].axis, 'social');
  assert.equal(sections[0].label, '인스타·유튜브');
  assert.equal(sections[0].counts.bad, 1);
  assert.ok(CHANNEL_ORDER.includes('social'));
  assert.equal(CHANNEL_LABEL.social, '인스타·유튜브');
});
