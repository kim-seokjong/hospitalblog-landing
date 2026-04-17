import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDecryptedCredentials } from '@/lib/credentials';

export const maxDuration = 300;

function markdownToPlainText(body: string): string {
  return body
    .replace(/^## (.+)$/gm, '\n[$1]\n')
    .replace(/^▶ (.+)$/gm, '  ▶ $1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function POST(req: NextRequest) {
  // 인증 먼저 확인 (파싱 전)
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let title: string, body: string, tags: string[];
  try {
    const parsed = await req.json() as { title?: string; body?: string; tags?: string[] };
    title = parsed.title ?? '';
    body = parsed.body ?? '';
    tags = parsed.tags ?? [];
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  // DB에서 복호화된 자격증명 가져오기
  const creds = await getDecryptedCredentials(user.id);
  if (!creds) {
    return NextResponse.json(
      { error: '네이버 자격증명을 먼저 설정해주세요. (설정 → 네이버 계정)' },
      { status: 400 }
    );
  }

  const blogId = creds.naverId;
  const password = creds.naverPw;

  if (!title || !body) {
    return NextResponse.json(
      { error: '제목과 본문이 필요합니다.' },
      { status: 400 }
    );
  }

  let browser: import('playwright').Browser | null = null;

  try {
    const { chromium } = await import('playwright');

    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // ── 1. 로그인 ──────────────────────────────────────────────────
    await page.goto('https://nid.naver.com/nidlogin.login?mode=form', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1000);

    // 아이디/비밀번호 JavaScript 방식으로 입력 (자동화 감지 우회)
    await page.evaluate(
      (creds: { id: string; pw: string }) => {
        function setNativeValue(el: HTMLInputElement, value: string) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          nativeInputValueSetter?.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const idEl = document.querySelector('#id') as HTMLInputElement;
        const pwEl = document.querySelector('#pw') as HTMLInputElement;
        if (idEl) setNativeValue(idEl, creds.id);
        if (pwEl) setNativeValue(pwEl, creds.pw);
      },
      { id: blogId, pw: password }
    );

    await page.waitForTimeout(500);
    await page.click('.btn_login');
    await page.waitForTimeout(4000);

    // 로그인 실패 감지
    const currentUrl = page.url();
    if (currentUrl.includes('nidlogin') || currentUrl.includes('login')) {
      const errorMsg = await page
        .locator('.error_message, .msg_error, #err_common')
        .first()
        .textContent()
        .catch(() => null);
      throw new Error(
        errorMsg?.trim() ||
          '로그인에 실패했습니다. 아이디/비밀번호를 확인해주세요. (CAPTCHA가 표시된 경우 잠시 후 다시 시도해주세요.)'
      );
    }

    // ── 2. 블로그 글쓰기 페이지 이동 ──────────────────────────────
    await page.goto(`https://blog.naver.com/${blogId}/postwrite`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    // mainFrame 대기
    const mainFrame =
      page.frame({ name: 'mainFrame' }) ??
      page.frames().find((f) => f.url().includes('blog.naver.com'));

    if (!mainFrame) {
      throw new Error('블로그 에디터 프레임을 찾을 수 없습니다.');
    }

    await mainFrame.waitForTimeout(2000);

    // ── 3. 제목 입력 ──────────────────────────────────────────────
    const titleSelector = '.se-title-input';
    await mainFrame.waitForSelector(titleSelector, { timeout: 15000 });
    await mainFrame.click(titleSelector);
    await mainFrame.waitForTimeout(500);

    await mainFrame.evaluate((t: string) => {
      const el = document.querySelector('.se-title-input') as HTMLElement;
      if (el) {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, t);
      }
    }, title);

    await mainFrame.waitForTimeout(500);

    // ── 4. 본문 입력 ──────────────────────────────────────────────
    const contentSelectors = [
      '.se-main-container .se-text-paragraph',
      '.se-content',
      '[contenteditable="true"]:not(.se-title-input)',
    ];

    let contentClicked = false;
    for (const sel of contentSelectors) {
      const el = await mainFrame.$(sel);
      if (el) {
        await el.click();
        contentClicked = true;
        break;
      }
    }

    if (!contentClicked) {
      // 제목 아래 Enter로 이동
      await page.keyboard.press('Tab');
    }

    await mainFrame.waitForTimeout(500);

    const cleanBody = markdownToPlainText(body);
    const lines = cleanBody.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        await mainFrame.evaluate((text: string) => {
          document.execCommand('insertText', false, text);
        }, line);
      }
      if (i < lines.length - 1) {
        await page.keyboard.press('Enter');
      }
      // 긴 글은 조금씩 입력
      if (i % 10 === 9) await mainFrame.waitForTimeout(100);
    }

    await mainFrame.waitForTimeout(500);

    // ── 5. 태그 입력 ──────────────────────────────────────────────
    if (tags && tags.length > 0) {
      const tagInput = await mainFrame
        .$('.se-tag-input input, input[placeholder*="태그"]')
        .catch(() => null);

      if (tagInput) {
        const tagList: string[] = tags.slice(0, 10);
        for (const tag of tagList) {
          await tagInput.click();
          await tagInput.type(tag, { delay: 30 });
          await page.keyboard.press('Enter');
          await mainFrame.waitForTimeout(200);
        }
      }
    }

    await mainFrame.waitForTimeout(500);

    // ── 6. 발행 버튼 클릭 ─────────────────────────────────────────
    const publishBtn = await page
      .$('.publish_btn, button[data-type="publish"], .btn_publish')
      .catch(() => null);

    if (publishBtn) {
      await publishBtn.click();
    } else {
      // 키보드 단축키 시도
      await page.keyboard.press('Control+Enter');
    }

    await page.waitForTimeout(3000);

    // 발행된 URL 추출
    const publishedUrl = await page
      .evaluate(() => {
        const link = document.querySelector('a[href*="/postview"]');
        return link ? (link as HTMLAnchorElement).href : null;
      })
      .catch(() => null);

    const blogUrl = publishedUrl || `https://blog.naver.com/${blogId}`;

    await page.waitForTimeout(2000);

    return NextResponse.json({
      success: true,
      url: blogUrl,
      message: '네이버 블로그에 발행되었습니다.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (browser) {
      // 사용자가 결과를 확인할 수 있도록 5초 후 닫기
      setTimeout(() => browser?.close().catch(() => {}), 5000);
    }
  }
}
