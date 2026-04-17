import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDecryptedCredentials } from '@/lib/credentials';

export const maxDuration = 300;

// Vercel 환경인지 판단
const IS_VERCEL = !!process.env.VERCEL;

// @sparticuz/chromium-min CDN URL (Chromium 131 = playwright-core 1.49 호환)
const CHROMIUM_CDN =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

/** 마크다운 → 네이버 에디터용 평문 변환 */
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

/** 로컬 환경에서 Chrome 실행 경로 자동 탐색 (Windows/Mac/Linux) */
async function findLocalChrome(): Promise<string | undefined> {
  const { existsSync } = await import('fs');
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : '',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  // 1. 인증 확인
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 2. 요청 파싱
  let title: string, body: string, tags: string[];
  try {
    const parsed = await req.json() as { title?: string; body?: string; tags?: string[] };
    title = parsed.title ?? '';
    body = parsed.body ?? '';
    tags = parsed.tags ?? [];
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  if (!title || !body) {
    return NextResponse.json({ error: '제목과 본문이 필요합니다.' }, { status: 400 });
  }

  // 3. 자격증명 로드
  const creds = await getDecryptedCredentials(user.id);
  if (!creds) {
    return NextResponse.json(
      { error: '네이버 자격증명을 먼저 설정해주세요. (설정 → 네이버 계정)' },
      { status: 400 }
    );
  }

  const { naverId, naverPw, blogCategory } = creds;

  // 4. 브라우저 실행
  let browser: import('playwright-core').Browser | null = null;

  try {
    const { chromium } = await import('playwright-core');

    if (IS_VERCEL) {
      // Vercel: @sparticuz/chromium-min 사용
      const chromiumBin = (await import('@sparticuz/chromium-min')).default;
      const executablePath = await chromiumBin.executablePath(CHROMIUM_CDN);
      browser = await chromium.launch({
        args: [...chromiumBin.args, '--disable-blink-features=AutomationControlled'],
        executablePath,
        headless: true,
      });
    } else {
      // 로컬: 시스템 Chrome 자동 탐색
      const executablePath = await findLocalChrome();
      if (!executablePath) {
        return NextResponse.json(
          { error: '로컬 Chrome을 찾을 수 없습니다. Chrome을 설치하거나 VERCEL 환경에서 실행하세요.' },
          { status: 500 }
        );
      }
      browser = await chromium.launch({
        executablePath,
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // ── 5. 네이버 로그인 ─────────────────────────────────────────
    await page.goto('https://nid.naver.com/nidlogin.login?mode=form', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    // JavaScript로 값 주입 (자동화 감지 우회)
    await page.evaluate(
      ({ id, pw }: { id: string; pw: string }) => {
        function setNativeValue(el: HTMLInputElement, value: string) {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          setter?.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const idEl = document.querySelector('#id') as HTMLInputElement | null;
        const pwEl = document.querySelector('#pw') as HTMLInputElement | null;
        if (idEl) setNativeValue(idEl, id);
        if (pwEl) setNativeValue(pwEl, pw);
      },
      { id: naverId, pw: naverPw }
    );

    await page.waitForTimeout(500);
    await page.click('.btn_login');
    await page.waitForTimeout(5000);

    // 로그인 실패 감지
    const afterLoginUrl = page.url();
    if (afterLoginUrl.includes('nidlogin') || afterLoginUrl.includes('login')) {
      const errMsg = await page
        .locator('.error_message, .msg_error, #err_common')
        .first()
        .textContent()
        .catch(() => null);
      throw new Error(
        errMsg?.trim() ||
          '로그인에 실패했습니다. 아이디/비밀번호를 확인하세요. CAPTCHA가 표시되면 잠시 후 다시 시도하세요.'
      );
    }

    // ── 6. 블로그 글쓰기 이동 ─────────────────────────────────────
    await page.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${naverId}`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.waitForTimeout(4000);

    // iframe(mainFrame) 탐색
    const mainFrame =
      page.frame({ name: 'mainFrame' }) ??
      page.frames().find((f) => f.url().includes('blog.naver.com') && f !== page.mainFrame());

    if (!mainFrame) {
      throw new Error('블로그 에디터 프레임을 찾을 수 없습니다. 네이버 블로그 URL을 확인하세요.');
    }

    await mainFrame.waitForTimeout(3000);

    // ── 7. 제목 입력 ──────────────────────────────────────────────
    await mainFrame.waitForSelector('.se-title-input', { timeout: 20000 });
    await mainFrame.click('.se-title-input');
    await mainFrame.waitForTimeout(300);

    await mainFrame.evaluate((t: string) => {
      const el = document.querySelector('.se-title-input') as HTMLElement | null;
      if (el) {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, t);
      }
    }, title);

    await mainFrame.waitForTimeout(500);

    // ── 8. 본문 입력 ──────────────────────────────────────────────
    // 본문 영역 클릭
    const bodySelectors = [
      '.se-main-container .se-text-paragraph',
      '.se-main-container',
      '.se-content-container',
      '[contenteditable="true"]:not(.se-title-input)',
    ];

    for (const sel of bodySelectors) {
      try {
        const el = await mainFrame.$(sel);
        if (el) {
          await el.click();
          break;
        }
      } catch { /* continue */ }
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
      if (i % 15 === 14) await mainFrame.waitForTimeout(100);
    }

    await mainFrame.waitForTimeout(500);

    // ── 9. 발행하기 버튼 클릭 → 발행 설정 패널 열기 ─────────────────
    // 네이버 스마트에디터 ONE: "발행하기" 버튼이 mainFrame 밖(메인 페이지)에 있음
    const publishTriggerSelectors = [
      '.publish_btn',
      'button.se-btn-publish',
      '.btn_publish',
      'button[data-action="publish"]',
    ];

    let panelOpened = false;
    for (const sel of publishTriggerSelectors) {
      try {
        // mainFrame 내부 먼저, 없으면 page에서 찾기
        const btn = (await mainFrame.$(sel).catch(() => null)) ?? (await page.$(sel).catch(() => null));
        if (btn) {
          await btn.click();
          panelOpened = true;
          break;
        }
      } catch { /* continue */ }
    }

    // XPath로 "발행하기" 텍스트 버튼 찾기
    if (!panelOpened) {
      try {
        await page.locator('button:has-text("발행하기")').first().click({ timeout: 3000 });
        panelOpened = true;
      } catch { /* continue */ }
    }

    if (panelOpened) {
      await page.waitForTimeout(2000);

      // ── 10. 카테고리 선택 ────────────────────────────────────────
      if (blogCategory) {
        try {
          // 카테고리 드롭다운 열기
          const catTriggerSelectors = [
            '.category_item',
            '.se-category-wrap button',
            '[class*="category"] button',
            'button[data-type="category"]',
          ];

          for (const sel of catTriggerSelectors) {
            try {
              const trigger =
                (await page.$(sel).catch(() => null)) ??
                (await mainFrame.$(sel).catch(() => null));
              if (trigger) {
                await trigger.click();
                await page.waitForTimeout(500);
                break;
              }
            } catch { /* continue */ }
          }

          // 카테고리 이름으로 항목 클릭
          try {
            await page
              .locator(`li:has-text("${blogCategory}"), a:has-text("${blogCategory}")`)
              .first()
              .click({ timeout: 3000 });
            await page.waitForTimeout(500);
          } catch { /* 카테고리 미일치 시 기본값으로 발행 */ }
        } catch { /* 카테고리 선택 실패해도 계속 진행 */ }
      }

      // ── 11. 태그 입력 ────────────────────────────────────────────
      if (tags.length > 0) {
        try {
          const tagInput = await page
            .$('input[placeholder*="태그"], .se-tag-input input, .tag_input input')
            .catch(() => null);

          if (tagInput) {
            for (const tag of tags.slice(0, 10)) {
              await tagInput.click();
              await tagInput.type(tag, { delay: 30 });
              await page.keyboard.press('Enter');
              await page.waitForTimeout(200);
            }
          }
        } catch { /* 태그 입력 실패 무시 */ }
      }

      await page.waitForTimeout(500);

      // ── 12. 최종 발행 버튼 ───────────────────────────────────────
      const finalPublishSelectors = [
        '.btn_submit',
        '.confirm_btn',
        'button[data-type="submit"]',
        '.btn_publish_confirm',
      ];

      let published = false;
      for (const sel of finalPublishSelectors) {
        try {
          const btn = (await page.$(sel).catch(() => null)) ?? (await mainFrame.$(sel).catch(() => null));
          if (btn) {
            await btn.click();
            published = true;
            break;
          }
        } catch { /* continue */ }
      }

      if (!published) {
        try {
          await page.locator('button:has-text("발행"):not(:has-text("발행하기"))').first().click({ timeout: 3000 });
          published = true;
        } catch { /* continue */ }
      }

      if (!published) {
        await page.keyboard.press('Enter');
      }
    } else {
      // 발행 패널을 못 열었을 경우 Ctrl+Enter 시도
      await page.keyboard.press('Control+Enter');
    }

    await page.waitForTimeout(4000);

    // ── 13. 발행된 URL 추출 ──────────────────────────────────────
    const publishedUrl = await page
      .evaluate(() => {
        const a = document.querySelector('a[href*="/postview"], a[href*="logNo="]') as HTMLAnchorElement | null;
        return a ? a.href : null;
      })
      .catch(() => null);

    const blogUrl = publishedUrl || `https://blog.naver.com/${naverId}`;

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
      setTimeout(() => browser?.close().catch(() => {}), 5000);
    }
  }
}
