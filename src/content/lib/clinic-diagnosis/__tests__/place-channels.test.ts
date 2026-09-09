import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parsePlaceChannels, placeChannelKind, parsePlaceProfile } from '../place.ts';
import { placeChannelsToSocialLinks, buildSocialAxis } from '../social-detect.ts';
import { firstPlaceBlogId } from '../run.ts';

/**
 * 플레이스 등록 채널 (2026-09-09 신설).
 *
 * 표본은 실제 응답에서 그대로 떠 왔다 — 우리 플레이스(1808648944)와
 * 글로미의원(37072932) 에서 확인한 구조다.
 */

/** 실측 그대로: url 뒤에 landingUrl 이 붙고 type 에 한글 라벨이 온다. */
const REAL = [
  '{"__typename":"HomepageRepr","url":"https:\\u002F\\u002Fblog.naver.com\\u002Fmarketer-integrity",',
  '"landingUrl":"https:\\u002F\\u002Fblog.naver.com\\u002Fmarketer-integrity","isDeadUrl":false,',
  '"type":"블로그","typeI18n":"블로그","order":1,"isRep":null},',
  '{"__typename":"HomepageRepr","url":"https:\\u002F\\u002Fwww.instagram.com\\u002Fhospitalmarketer",',
  '"landingUrl":"https:\\u002F\\u002Fwww.instagram.com\\u002Fhospitalmarketer","isDeadUrl":false,',
  '"type":"인스타그램","typeI18n":"인스타그램","order":2,"isRep":null},',
  '{"__typename":"HomepageRepr","url":"http:\\u002F\\u002Fwww.hospitalmarketing.kr",',
  '"isDeadUrl":false,"type":"홈페이지","order":0,"isRep":null}',
].join('');

describe('parsePlaceChannels', () => {
  it('실제 응답 구조에서 채널 셋을 뽑는다', () => {
    const { channels, found } = parsePlaceChannels(REAL);
    assert.equal(found, true);
    assert.equal(channels.length, 3);
    const kinds = channels.map((c) => c.kind).sort();
    assert.deepEqual(kinds, ['blog', 'homepage', 'instagram']);
    const blog = channels.find((c) => c.kind === 'blog');
    assert.equal(blog?.url, 'https://blog.naver.com/marketer-integrity');
    assert.equal(blog?.label, '블로그');
  });

  it('landingUrl 이 없는 항목도 읽는다 — 선택 필드다', () => {
    const only = REAL.slice(REAL.indexOf('{"__typename":"HomepageRepr","url":"http:'));
    const { channels } = parsePlaceChannels(only);
    assert.equal(channels.length, 1);
    assert.equal(channels[0]?.kind, 'homepage');
  });

  it('같은 URL 이 대표 링크로 또 실려도 한 번만 센다', () => {
    const { channels } = parsePlaceChannels(REAL + REAL);
    assert.equal(channels.length, 3, '중복을 안 지우면 "인스타 2개"가 된다');
  });

  it('죽은 링크도 목록에는 담되 dead 로 표시한다', () => {
    const html =
      '{"__typename":"HomepageRepr","url":"https:\\u002F\\u002Fold.example.com","isDeadUrl":true,"type":"홈페이지"}';
    const { channels } = parsePlaceChannels(html);
    assert.equal(channels[0]?.dead, true);
  });

  it('블록이 아예 없으면 found=false — "안 걸었다"와 "못 읽었다"를 가른다', () => {
    const { channels, found } = parsePlaceChannels('<html>채널 없음</html>');
    assert.equal(found, false);
    assert.equal(channels.length, 0);
  });

  it('빈 입력에도 안전하다', () => {
    assert.deepEqual(parsePlaceChannels(''), { channels: [], found: false });
  });
});

describe('placeChannelKind', () => {
  it('라벨을 먼저 본다 — 「블로그」칸에 티스토리를 넣은 경우', () => {
    assert.equal(placeChannelKind('블로그', 'https://x.tistory.com'), 'blog');
  });
  it('라벨이 비어도 주소로 가른다', () => {
    assert.equal(placeChannelKind('', 'https://www.instagram.com/abc'), 'instagram');
    assert.equal(placeChannelKind('', 'https://youtu.be/abc'), 'youtube');
    assert.equal(placeChannelKind('', 'https://blog.naver.com/abc'), 'blog');
  });
  it('모르는 것은 버리지 않고 other 로 남긴다', () => {
    assert.equal(placeChannelKind('카카오톡', 'https://pf.kakao.com/x'), 'other');
  });
});

describe('placeChannelsToSocialLinks', () => {
  it('인스타·유튜브만 소셜 링크로 넘긴다', () => {
    const links = placeChannelsToSocialLinks(parsePlaceChannels(REAL).channels);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.platform, 'instagram');
    assert.equal(links[0]?.source, 'place', '출처를 place 로 남겨야 신뢰도를 구분할 수 있다');
  });

  it('⛔죽은 링크는 "운영 중" 근거로 쓰지 않는다', () => {
    const dead = [{ kind: 'instagram', url: 'https://www.instagram.com/gone', dead: true }];
    assert.deepEqual(placeChannelsToSocialLinks(dead), []);
  });

  it('입력이 없어도 터지지 않는다', () => {
    assert.deepEqual(placeChannelsToSocialLinks(undefined), []);
  });
});

describe('buildSocialAxis + 플레이스', () => {
  it('홈페이지·블로그를 못 훑었어도 플레이스 채널만으로 축이 산다', () => {
    const axis = buildSocialAxis({
      scannedSite: false,
      siteLinks: [],
      scannedBlog: false,
      blogLinks: [],
      placeLinks: placeChannelsToSocialLinks(parsePlaceChannels(REAL).channels),
    });
    assert.equal(axis.checked, true, '이걸 놓치면 아는 사실을 두고도 축이 빈다');
    assert.equal(axis.instagram, 'found');
  });

  it('아무 근거도 없으면 예전처럼 빈 축이다', () => {
    const axis = buildSocialAxis({
      scannedSite: false, siteLinks: [], scannedBlog: false, blogLinks: [], placeLinks: [],
    });
    assert.equal(axis.checked, false);
  });
});

describe('firstPlaceBlogId', () => {
  it('네이버 블로그 id 를 뽑는다', () => {
    assert.equal(firstPlaceBlogId(parsePlaceChannels(REAL).channels), 'marketer-integrity');
  });
  it('죽은 블로그는 쓰지 않는다', () => {
    assert.equal(
      firstPlaceBlogId([{ kind: 'blog', url: 'https://blog.naver.com/gone', dead: true }]),
      null,
    );
  });
  it('네이버가 아닌 블로그는 받지 않는다 — RSS 경로가 다루지 못한다', () => {
    assert.equal(
      firstPlaceBlogId([{ kind: 'blog', url: 'https://x.tistory.com', dead: false }]),
      null,
    );
  });
});

describe('parsePlaceProfile 회귀', () => {
  it('기존 필드(업종·키워드)는 그대로 읽는다', () => {
    const html = `"category":"피부과" "keywordList":["대구피부과","대구필러"] ${REAL}`;
    const p = parsePlaceProfile(html);
    assert.equal(p.category, '피부과');
    assert.deepEqual(p.keywords, ['대구피부과', '대구필러']);
    assert.equal(p.keywordFieldFound, true);
    assert.equal(p.channels.length, 3, '채널이 같은 응답에서 함께 나온다');
    assert.equal(p.channelFieldFound, true);
  });

  it('채널이 없는 병원도 기존 동작을 유지한다', () => {
    const p = parsePlaceProfile('"category":"치과" "keywordList":[]');
    assert.equal(p.category, '치과');
    assert.deepEqual(p.channels, []);
    assert.equal(p.channelFieldFound, false);
  });
});
