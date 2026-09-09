import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyLocalLink } from '../naver-local.ts';

/**
 * 지역검색 대표 링크의 종류 (2026-09-09 신설).
 *
 * ⛔실측 8곳 중 3곳의 대표 링크가 홈페이지가 아니었는데, 진단은 그걸 홈페이지로
 *   재고 점수까지 매기고 있었다. 아래 URL 들은 그때 실제로 돌아온 값이다.
 */
describe('classifyLocalLink', () => {
  it('실측에서 홈페이지로 잘못 재던 것들을 걸러낸다', () => {
    // 글로미의원 — 대표 링크가 인스타였다
    assert.equal(classifyLocalLink('https://www.instagram.com/glowme_clinic'), 'social');
    // 아산더본의원 · 연센트럴치과의원 — 대표 링크가 네이버 블로그였다
    assert.equal(classifyLocalLink('https://blog.naver.com/asan_thebone'), 'blog');
    assert.equal(classifyLocalLink('https://blog.naver.com/hellodentkim1'), 'blog');
  });

  it('진짜 홈페이지는 그대로 통과시킨다', () => {
    assert.equal(classifyLocalLink('https://www.framecheongdam.com'), 'site');
    assert.equal(classifyLocalLink('http://www.prive.co.kr'), 'site');
    assert.equal(classifyLocalLink('https://www.hedok75.com/'), 'site');
    // 한글 도메인도 홈페이지다
    assert.equal(classifyLocalLink('http://www.윤용현성형외과.com/'), 'site');
    // 단축 URL 도 홈페이지로 본다 — 열어봐야 아는 것이고, 열어보는 건 site 축의 일이다
    assert.equal(classifyLocalLink('https://tla.so/6nFhG'), 'site');
  });

  it('네이버가 만들어 주는 페이지는 홈페이지로 본다', () => {
    // 병원이 이걸 홈페이지로 쓰고 있으면 실제로 그게 홈페이지다
    assert.equal(classifyLocalLink('https://mystore.modoo.at'), 'site');
  });

  it('블로그 계열을 두루 잡는다', () => {
    assert.equal(classifyLocalLink('https://someone.tistory.com/12'), 'blog');
    assert.equal(classifyLocalLink('https://post.naver.com/abc'), 'blog');
    assert.equal(classifyLocalLink('https://brunch.co.kr/@abc'), 'blog');
  });

  it('SNS 계열을 두루 잡는다', () => {
    assert.equal(classifyLocalLink('https://www.facebook.com/clinic'), 'social');
    assert.equal(classifyLocalLink('https://www.youtube.com/@clinic'), 'social');
    assert.equal(classifyLocalLink('https://cafe.naver.com/abc'), 'social');
    assert.equal(classifyLocalLink('https://pf.kakao.com/_xabc'), 'social');
  });

  it('빈 값·주소가 아닌 것은 none', () => {
    assert.equal(classifyLocalLink(''), 'none');
    assert.equal(classifyLocalLink('   '), 'none');
    assert.equal(classifyLocalLink('http://'), 'none');
    assert.equal(classifyLocalLink('그냥글자'), 'none');
  });

  it('호스트 끝을 정확히 본다 — 남의 도메인에 붙은 이름에 속지 않는다', () => {
    // 'blog.naver.com.evil.kr' 을 블로그로 읽으면 안 된다
    assert.equal(classifyLocalLink('https://blog.naver.com.evil.kr/x'), 'site');
    // 반대로 서브도메인이 붙은 정상 케이스는 잡아야 한다
    assert.equal(classifyLocalLink('https://m.blog.naver.com/abc'), 'blog');
  });

  it('대소문자를 가리지 않는다', () => {
    assert.equal(classifyLocalLink('HTTPS://WWW.INSTAGRAM.COM/Clinic'), 'social');
  });
});
