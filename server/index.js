'use strict';

const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── 인증 미들웨어 ──────────────────────────────────────────
app.use('/api', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.PUBLISH_API_KEY || apiKey !== process.env.PUBLISH_API_KEY) {
    return res.status(401).json({ error: '인증 오류' });
  }
  next();
});

// 헬스 체크 (Render 슬립 방지용)
app.get('/', (_req, res) => res.json({ status: 'ok' }));

// ── 마크다운 → 평문 변환 ───────────────────────────────────
function markdownToPlainText(body) {
  return body
    .replace(/^## (.+)$/gm, '\n[$1]\n')
    .replace(/^▶ (.+)$/gm, '  ▶ $1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 네이버 블로그 발행 API ─────────────────────────────────
app.post('/api/publish-naver', async (req, res) => {
  const { naverId, naverCookie, title, body, tags = [], category = '' } = req.body;

  if (!naverId || !naverCookie || !title || !body) {
    return res.status(400).json({ error: '필수 파라미터가 누락됐습니다.' });
  }

  // @naver.com 등 도메인 제거 (순수 아이디만 사용)
  const blogId = naverId.includes('@') ? naverId.split('@')[0] : naverId;

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--single-process',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // ── 쿠키 인증 ─────────────────────────────────────────────
    await context.addCookies([
      { name: 'NID_AUT', value: naverCookie, domain: '.naver.com', path: '/', httpOnly: true, secure: true },
    ]);

    const page = await context.newPage();

    // 로그인 상태 확인
    await page.goto('https://www.naver.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const isLoggedIn = await page.evaluate(() => {
      return !!(document.querySelector('.MyView-module__my_naver___iyCDL') ||
                document.querySelector('#account') ||
                document.querySelector('.gnb_my_issue') ||
                document.querySelector('[class*="NM_FAVORITE"]'));
    });
    console.log('[publish-naver] isLoggedIn:', isLoggedIn);

    if (!isLoggedIn) {
      throw new Error('쿠키가 만료됐습니다. 설정에서 NID_AUT 쿠키를 다시 입력해주세요.');
    }

    // ── 글쓰기 페이지 ─────────────────────────────────────────
    await page.goto(`https://blog.naver.com/PostWriteForm.naver?blogId=${blogId}`, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // 모든 프레임에서 .se-title-input 찾기 (최대 30초 대기)
    let mainFrame = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      for (const f of page.frames()) {
        try {
          const el = await f.$('.se-title-input');
          if (el) { mainFrame = f; break; }
        } catch {}
      }
      if (mainFrame) break;
      await page.waitForTimeout(1000);
    }

    if (!mainFrame) {
      const frameList = page.frames().map(f => `${f.name()}:${f.url()}`).join(' | ');
      throw new Error(`블로그 에디터(.se-title-input)를 찾을 수 없습니다. frames: ${frameList}`);
    }
    console.log('[publish-naver] editor frame:', mainFrame.name(), mainFrame.url());

    // ── 제목 입력 ─────────────────────────────────────────────
    await mainFrame.waitForSelector('.se-title-input', { timeout: 10000 });
    await mainFrame.click('.se-title-input');
    await mainFrame.waitForTimeout(300);
    await mainFrame.evaluate((t) => {
      const el = document.querySelector('.se-title-input');
      if (el) {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, t);
      }
    }, title);
    await mainFrame.waitForTimeout(500);

    // ── 본문 입력 ─────────────────────────────────────────────
    for (const sel of [
      '.se-main-container .se-text-paragraph',
      '.se-main-container',
      '.se-content-container',
      '[contenteditable="true"]:not(.se-title-input)',
    ]) {
      try {
        const el = await mainFrame.$(sel);
        if (el) { await el.click(); break; }
      } catch {}
    }
    await mainFrame.waitForTimeout(500);

    const lines = markdownToPlainText(body).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) {
        await mainFrame.evaluate((text) => {
          document.execCommand('insertText', false, text);
        }, lines[i]);
      }
      if (i < lines.length - 1) await page.keyboard.press('Enter');
      if (i % 15 === 14) await mainFrame.waitForTimeout(100);
    }
    await mainFrame.waitForTimeout(500);

    // ── 발행 패널 열기 ────────────────────────────────────────
    let panelOpened = false;
    for (const sel of ['.publish_btn', 'button.se-btn-publish', '.btn_publish', 'button[data-action="publish"]']) {
      try {
        const btn = (await mainFrame.$(sel).catch(() => null)) ?? (await page.$(sel).catch(() => null));
        if (btn) { await btn.click(); panelOpened = true; break; }
      } catch {}
    }
    if (!panelOpened) {
      try {
        await page.locator('button:has-text("발행하기")').first().click({ timeout: 3000 });
        panelOpened = true;
      } catch {}
    }

    if (panelOpened) {
      await page.waitForTimeout(2000);

      // ── 카테고리 선택 ───────────────────────────────────────
      if (category) {
        try {
          for (const sel of ['.category_item', '.se-category-wrap button', '[class*="category"] button']) {
            const trigger = (await page.$(sel).catch(() => null)) ?? (await mainFrame.$(sel).catch(() => null));
            if (trigger) { await trigger.click(); await page.waitForTimeout(500); break; }
          }
          await page
            .locator(`li:has-text("${category}"), a:has-text("${category}")`)
            .first()
            .click({ timeout: 3000 });
          await page.waitForTimeout(300);
        } catch {}
      }

      // ── 태그 입력 ───────────────────────────────────────────
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
        } catch {}
      }

      await page.waitForTimeout(500);

      // ── 최종 발행 ───────────────────────────────────────────
      let published = false;
      for (const sel of ['.btn_submit', '.confirm_btn', 'button[data-type="submit"]', '.btn_publish_confirm']) {
        try {
          const btn = (await page.$(sel).catch(() => null)) ?? (await mainFrame.$(sel).catch(() => null));
          if (btn) { await btn.click(); published = true; break; }
        } catch {}
      }
      if (!published) {
        try {
          await page.locator('button:has-text("발행"):not(:has-text("발행하기"))').first().click({ timeout: 3000 });
          published = true;
        } catch {}
      }
      if (!published) await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Control+Enter');
    }

    await page.waitForTimeout(4000);

    const publishedUrl = await page
      .evaluate(() => {
        const a = document.querySelector('a[href*="/postview"], a[href*="logNo="]');
        return a?.href ?? null;
      })
      .catch(() => null);

    return res.json({
      success: true,
      url: publishedUrl || `https://blog.naver.com/${blogId}`,
      message: '네이버 블로그에 발행되었습니다.',
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[publish-naver] error:', message);
    return res.status(500).json({ error: message });
  } finally {
    if (browser) setTimeout(() => browser.close().catch(() => {}), 3000);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Publish server running on port ${PORT}`);
});
