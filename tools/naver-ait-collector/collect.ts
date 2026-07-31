/**
 * 네이버 AI 탭(AI 브리핑) 인용 수집기 — 로컬 PC 전용.
 *
 * 왜 로컬인가: 네이버 AI 탭은 공개 API가 없고 브라우저 렌더링이 필요하다.
 * Vercel/Railway 데이터센터 IP는 봇 차단 리스크가 있어 주간 cron(서버)에 넣지 않고,
 * 이 스크립트를 Windows 작업 스케줄러(매주 월 10:30, StartWhenAvailable)로 돌린다.
 * 결과는 기존 geo_citations 테이블에 engine='naver' 로 기록되어
 * 마이페이지 AI 검색 탭이 그대로 읽는다.
 *
 * 실행: node --experimental-strip-types tools/naver-ait-collector/collect.ts
 * 스모크: node --experimental-strip-types tools/naver-ait-collector/collect.ts --smoke
 *
 * ⚠️ 명령줄 인자에 한글을 넘기지 않는다(cp949 파손 실측). 질의어는 전부 코드/DB에서 온다.
 * ⚠️ LLM 호출 0 — 이 수집기의 비용은 0원이 전제다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildGeoQuestions,
  detectCitation,
  mondayOfWeek,
  sanitizeExcerpt,
} from '../../src/content/lib/geo-tracking.ts';
import { extractNaverBlogId } from '../../src/content/lib/rank-tracking.ts';
import { PAID_PLAN_IDS } from '../../src/payment/lib/plans.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const ENGINE_ID = 'naver';
/** 전자책 빌드와 같은 로컬 크로미움 — playwright 풀설치 없이 재사용. env 로 교체 가능 */
function chromePath(): string {
  return (
    process.env.NAVER_CHROME_PATH ||
    'C:/Users/PC/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'
  );
}
const AIT_URL = (query: string) =>
  `https://search.naver.com/search.naver?ssc=tab.ait.all&query=${encodeURIComponent(query)}`;
const NORMAL_SEARCH_URL = (query: string) =>
  `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
/** 헤드리스 기본 UA 는 HeadlessChrome 을 노출한다 → 일반 크롬 UA 로 교체 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * 실행 상한 3종 — main() 에서 .env.local 병합 **후** 확정한다.
 * (모듈 초기화 시점에 process.env 만 읽으면 .env.local 의 NAVER_* 설정이 무시된다 — Codex 지적)
 * QUESTIONS_PER_USER: cron(최대 5)보다 보수적으로. 트래픽을 늘리기 전에 차단 여부부터 본다.
 * MAX_QUERIES: 한 실행의 질의 총량 상한 — 네이버 입장에서 과도한 트래픽이 되지 않게.
 */
let QUESTIONS_PER_USER = 3;
let MAX_USERS = 100;
let MAX_QUERIES = 150;
/** 유료 회원 페이지 조회 단위 — MAX_USERS 를 채울 때까지 페이지를 넘긴다 */
const PROFILE_PAGE_SIZE = 200;
/** 중복 확인 .in() 청크 크기 */
const DUP_CHECK_CHUNK = 500;
/** 답변 완료(ait_pv=answerEnd) 대기 상한 — 실측 30~40초 걸리는 질의가 있어 여유를 둔다 */
const ANSWER_TIMEOUT_MS = 60_000;
/** 질의 사이 대기 — 사람 브라우징 속도 수준으로 */
const SLEEP_MIN_MS = 8_000;
const SLEEP_MAX_MS = 12_000;
/** 인용 판정에 쓰는 텍스트·출처 상한 (cron 의 상한과 같은 취지) */
const MAX_MATCH_TEXT_CHARS = 20_000;
const MAX_SOURCES = 10;
const RAW_EXCERPT_LENGTH = 300;

/**
 * 출처에서 제외하는 네이버 서비스 호스트 — 검색 UI 자체의 링크들.
 * ⚠️ blog.naver.com·m.blog.naver.com 은 제외하면 안 된다(고객 블로그 인용이 핵심 신호).
 */
const EXCLUDED_HOSTS = new Set([
  'www.naver.com',
  'naver.com',
  'search.naver.com',
  'search.shopping.naver.com',
  'shopping.naver.com',
  'dict.naver.com',
  'map.naver.com',
  'help.naver.com',
  'policy.naver.com',
  'nid.naver.com',
  'ads.naver.com',
]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const LOG_DIR = path.join(SCRIPT_DIR, 'logs');

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

let logStream: fs.WriteStream | null = null;

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  logStream?.write(`${line}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSleepMs(): number {
  return SLEEP_MIN_MS + Math.floor(Math.random() * (SLEEP_MAX_MS - SLEEP_MIN_MS));
}

/** .env.local 을 직접 파싱 — dotenv 의존 없이 (KEY=VALUE, # 주석, 따옴표 허용). 없으면 빈 객체 */
function loadEnvLocal(): Record<string, string> {
  const envPath = path.join(REPO_ROOT, '.env.local');
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 네이버 AI 탭 질의
// ---------------------------------------------------------------------------

interface AitAnswer {
  ok: boolean;
  /** 렌더된 본문 텍스트 (answerEnd 도달분) */
  text: string;
  sources: Array<{ url: string; title: string }>;
  failReason: string | null;
}

interface BrowserPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number; referer?: string },
  ): Promise<unknown>;
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
}

/** 사람 브라우저에 가까운 컨텍스트로 페이지 생성 (UA·언어·화면) */
async function openPage(browser: {
  newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<unknown> }>;
}): Promise<BrowserPage> {
  const ctx = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  });
  return (await ctx.newPage()) as unknown as BrowserPage;
}

/**
 * AI 탭에 질의하고 답변 텍스트 + 외부 출처 링크를 수집한다.
 *
 * ⚠️ AI 탭에 직접 진입하면 "잘못된 접근입니다"로 차단된다(실측 — 리퍼러 검사).
 * 통합검색을 먼저 열어 쿠키를 받고, 리퍼러를 달아 AI 탭으로 이동해야 한다.
 * 완료 신호 = URL 에 ait_pv=answerEnd 가 붙는 것(실측). 상한 내 미도달이면 실패로
 * 처리한다 — 미완성 답변으로 cited:false 를 기록하면 표본이 오염되기 때문이다.
 */
async function queryAitTab(page: BrowserPage, question: string): Promise<AitAnswer> {
  try {
    const normalUrl = NORMAL_SEARCH_URL(question);
    await page.goto(normalUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1_500);
    await page.goto(AIT_URL(question), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
      referer: normalUrl,
    });
  } catch (e) {
    return { ok: false, text: '', sources: [], failReason: `페이지 로드 실패: ${errMsg(e)}` };
  }

  // 차단 문구 조기 감지 — 이 경우 answerEnd 를 기다릴 필요가 없다
  try {
    const blocked = await page.evaluate(() =>
      (document.body.innerText || '').includes('잘못된 접근입니다'),
    );
    if (blocked) {
      return { ok: false, text: '', sources: [], failReason: '접근 차단(잘못된 접근입니다)' };
    }
  } catch {
    // 감지 실패는 무시하고 answerEnd 대기로 진행
  }

  // answerEnd 폴링 — 스트리밍 완료까지 대기
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  let answered = false;
  while (Date.now() < deadline) {
    if (page.url().includes('ait_pv=answerEnd')) {
      answered = true;
      break;
    }
    await page.waitForTimeout(1_000);
  }
  if (!answered) {
    return {
      ok: false,
      text: '',
      sources: [],
      failReason: `answerEnd 미도달 (${ANSWER_TIMEOUT_MS}ms) — 답변 미생성 또는 차단 의심`,
    };
  }

  try {
    // ⚠️ 판정 범위 = AI 답변 대화 컨테이너 내부만.
    // body 전체를 쓰면 답변 밖 추천·연관 영역의 병원명/블로그 링크가 인용으로 오탐된다(Codex 지적).
    // 'fds-ai-tab-conversation-item' 은 해시 클래스가 아닌 의미 클래스라 상대적으로 안정적이다(DOM 실측).
    // 컨테이너를 못 찾으면(마크업 개편) 실패로 처리한다 — 오염된 표본을 남기는 것보다 낫다.
    const extracted = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('[class*="fds-ai-tab-conversation-item"]'),
      );
      if (items.length === 0) return null;
      const text = items
        .map((el) => (el as unknown as { innerText?: string }).innerText || el.textContent || '')
        .join('\n');
      const anchors = items.flatMap((el) =>
        Array.from(el.querySelectorAll('a[href]')),
      ) as unknown as Array<{ href: string; textContent: string | null }>;
      const links = anchors
        .map((a) => ({ url: a.href, title: (a.textContent || '').trim().slice(0, 100) }))
        .filter((l) => l.url.startsWith('http'));
      return { text, links };
    });
    if (!extracted) {
      return {
        ok: false,
        text: '',
        sources: [],
        failReason: '답변 컨테이너(fds-ai-tab-conversation-item) 미발견 — 마크업 변경 의심',
      };
    }

    const seen = new Set<string>();
    const sources: Array<{ url: string; title: string }> = [];
    for (const link of extracted.links) {
      let host = '';
      try {
        host = new URL(link.url).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (EXCLUDED_HOSTS.has(host)) continue;
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      sources.push(link);
      if (sources.length >= MAX_SOURCES) break;
    }

    // 질문 에코까지 포함해 앞부분을 잘라낸다 — 질문 문자열 "뒤"부터가 실제 답변이다.
    // 질문을 남겨두면 hospital_keywords 에 병원명이 들어 있는 프로필에서 질문 자체가
    // 병원명 매칭돼 cited:true 오탐이 난다(Codex 지적).
    const qIdx = extracted.text.indexOf(question);
    const answerText =
      qIdx >= 0 ? extracted.text.slice(qIdx + question.length) : extracted.text;

    return { ok: true, text: answerText.slice(0, MAX_MATCH_TEXT_CHARS), sources, failReason: null };
  } catch (e) {
    return { ok: false, text: '', sources: [], failReason: `본문 추출 실패: ${errMsg(e)}` };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  hospital_name: string | null;
  region: string | null;
  specialty: string | null;
  hospital_keywords: string[] | null;
  naver_blog_url: string | null;
}

interface CitationInsertRow {
  user_id: string;
  question: string;
  engine: string;
  cited: boolean;
  citation_type: string;
  evidence: string | null;
  raw: { sources: Array<{ url: string; title: string }>; excerpt: string };
}

async function runSmoke(): Promise<number> {
  log('스모크 모드 — "의료광고심의" 1건 질의, DB 기록 없음');
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await openPage(browser);
    const answer = await queryAitTab(page, '의료광고심의');
    log(`ok=${answer.ok} 이유=${answer.failReason ?? '-'}`);
    log(`본문 길이=${answer.text.length}자, 출처 ${answer.sources.length}건`);
    for (const s of answer.sources) log(`  출처: ${s.url} (${s.title})`);
    return answer.ok && answer.sources.length > 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  logStream = fs.createWriteStream(path.join(LOG_DIR, `${today}.log`), { flags: 'a' });

  // .env.local 을 process.env 에 병합(실제 환경변수가 우선) — --smoke 도 NAVER_CHROME_PATH 를
  // 읽을 수 있어야 하므로 스모크 분기보다 먼저 한다
  const env = loadEnvLocal();
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v;
  }

  if (process.argv.includes('--smoke')) return runSmoke();

  QUESTIONS_PER_USER = envInt('NAVER_QUESTIONS_PER_USER', 3, 1, 5);
  MAX_USERS = envInt('NAVER_MAX_USERS', 100, 1, 500);
  MAX_QUERIES = envInt('NAVER_MAX_QUERIES', 150, 1, 1000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    log('환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return 1;
  }
  const admin: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  const weekStart = mondayOfWeek(new Date().toISOString());
  if (!weekStart) {
    log('주차 계산 실패');
    return 1;
  }
  log(`시작 — 주차 ${weekStart}, 회원상한 ${MAX_USERS}, 회원당 질의 ${QUESTIONS_PER_USER}, 총질의상한 ${MAX_QUERIES}`);

  // 1) 유료 회원 조회 — MAX_USERS 를 "가져온 수"가 아니라 "처리 대상 수"의 상한으로 쓴다.
  //    이미 완료된 회원을 제외하고 상한을 채울 때까지 페이지를 넘긴다
  //    (앞쪽 id 회원이 완료돼 있으면 뒤쪽 회원이 영영 처리되지 않던 문제 — Codex 지적).
  const plans: Array<{ profile: ProfileRow; questions: string[]; naverBlogId: string | null }> = [];
  let skippedNoMaterial = 0;
  let skippedAlreadyChecked = 0;
  let profilesFetched = 0;
  let eligibleOverflow = 0;
  const weekStartIso = `${weekStart}T00:00:00.000Z`;

  for (let offset = 0; ; offset += PROFILE_PAGE_SIZE) {
    const { data: profileData, error: profileErr } = await admin
      .from('profiles')
      .select('id, hospital_name, region, specialty, hospital_keywords, naver_blog_url')
      .in('plan', PAID_PLAN_IDS)
      .order('id', { ascending: true })
      .range(offset, offset + PROFILE_PAGE_SIZE - 1);
    if (profileErr) {
      log(`회원 조회 실패: ${profileErr.message}`);
      return 1;
    }
    const pageProfiles = (profileData ?? []) as ProfileRow[];
    profilesFetched += pageProfiles.length;
    if (pageProfiles.length === 0) break;

    // 이번 주 naver 중복 확인 — engine 필터 필수.
    // (월요일 서버 cron 의 openai 행과 섞이면 안 되고, 반대로 cron 쪽 중복 확인은
    //  engine 필터를 넣어 우리 행을 무시하도록 함께 수정했다)
    const alreadyChecked = new Set<string>();
    for (let i = 0; i < pageProfiles.length; i += DUP_CHECK_CHUNK) {
      const chunkIds = pageProfiles.slice(i, i + DUP_CHECK_CHUNK).map((p) => p.id);
      const { data: dupData, error: dupErr } = await admin
        .from('geo_citations')
        .select('user_id')
        .in('user_id', chunkIds)
        .eq('engine', ENGINE_ID)
        .gte('checked_at', weekStartIso)
        .limit(5_000);
      if (dupErr && dupErr.code !== '42P01') {
        log(`중복 확인 실패로 중단(이중 기록 방지): ${dupErr.message}`);
        return 1;
      }
      for (const r of (dupData ?? []) as Array<{ user_id: string | null }>) {
        if (r.user_id) alreadyChecked.add(r.user_id);
      }
    }

    // 질의 계획 (cron 과 동일한 재료 조건)
    for (const profile of pageProfiles) {
      if (alreadyChecked.has(profile.id)) {
        skippedAlreadyChecked++;
        continue;
      }
      const questions = buildGeoQuestions({
        region: profile.region,
        specialty: profile.specialty,
        hospitalKeywords: profile.hospital_keywords,
      }).slice(0, QUESTIONS_PER_USER);
      const naverBlogId = extractNaverBlogId(profile.naver_blog_url);
      if (questions.length === 0 || (!profile.hospital_name && !naverBlogId)) {
        skippedNoMaterial++;
        continue;
      }
      if (plans.length >= MAX_USERS) {
        eligibleOverflow++; // 조용한 누락 금지 — 상한 초과 인원을 집계해 보고한다
        continue;
      }
      plans.push({ profile, questions, naverBlogId });
    }

    if (pageProfiles.length < PROFILE_PAGE_SIZE) break;
  }

  log(
    `대상 ${plans.length}명 / 유료 ${profilesFetched}명 ` +
      `(이번주 완료 ${skippedAlreadyChecked} · 재료부족 ${skippedNoMaterial}` +
      (eligibleOverflow > 0 ? ` · ⚠️상한초과 미처리 ${eligibleOverflow}` : '') +
      `)`,
  );
  if (plans.length === 0) {
    log('처리할 회원이 없습니다 — 종료');
    return 0;
  }

  // 4) 브라우저 질의 (같은 질문은 캐시 재사용 — 회원끼리 지역·과가 겹치면 페이지 로드 절약)
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const answerCache = new Map<string, AitAnswer>();
  let pageLoads = 0;
  let queryBudgetExhausted = false;
  let usersSaved = 0;
  let usersDropped = 0;
  let rowsInserted = 0;
  let citedTotal = 0;

  try {
    const page = await openPage(browser);

    for (const plan of plans) {
      if (queryBudgetExhausted) break;

      const rows: CitationInsertRow[] = [];
      let complete = true;

      for (const question of plan.questions) {
        let answer = answerCache.get(question);
        if (!answer) {
          // 실패 시 1회 재시도 — 스트리밍 지연·일시 오류는 확률적이라 그대로 다시 시도한다
          for (let attempt = 0; attempt < 2; attempt++) {
            if (pageLoads >= MAX_QUERIES) {
              queryBudgetExhausted = true;
              break;
            }
            if (pageLoads > 0) await sleep(randomSleepMs());
            pageLoads++;
            answer = await queryAitTab(page, question);
            if (answer.ok) break;
            log(`질의 실패(시도 ${attempt + 1}/2) [${question}]: ${answer.failReason}`);
          }
          if (!answer) {
            complete = false;
            break;
          }
          // 성공 응답만 캐시한다 — 실패를 캐시하면 같은 질문을 가진 뒤 회원들이
          // 네이버가 회복한 뒤에도 재시도 없이 연쇄 누락된다(Codex 지적)
          if (answer.ok) answerCache.set(question, answer);
        }
        if (!answer.ok) {
          complete = false;
          continue;
        }

        const result = detectCitation(
          { text: answer.text, sourceUrls: answer.sources.map((s) => s.url) },
          { hospitalName: plan.profile.hospital_name, naverBlogId: plan.naverBlogId },
        );
        rows.push({
          user_id: plan.profile.id,
          question,
          engine: ENGINE_ID,
          cited: result.cited,
          citation_type: result.citationType,
          evidence: result.evidence,
          raw: {
            sources: answer.sources,
            excerpt: sanitizeExcerpt(answer.text, RAW_EXCERPT_LENGTH),
          },
        });
      }

      // 부분 표본은 저장하지 않는다 (cron 의 "회원 단위 전부 아니면 전무"와 동일)
      if (!complete || rows.length === 0) {
        usersDropped++;
        continue;
      }

      // ⚠️수용한 리스크: 스케줄러는 MultipleInstances=IgnoreNew 로 중복 실행이 막혀 있지만,
      // 자동 실행 중에 사람이 수동으로 겹쳐 돌리면 시작 시점 중복 확인을 둘 다 통과해
      // 같은 회원·질문·주차 행이 이중 삽입될 수 있다. 유니크 제약은 마이그레이션(수동 적용)
      // 사안이라 여기서는 걸지 않는다 — 수동 실행 전에 스케줄 실행 종료를 확인할 것.
      const { error: insErr } = await admin.from('geo_citations').insert(rows);
      if (insErr) {
        usersDropped++;
        log(`insert 실패 (user=${plan.profile.id}): ${insErr.message}`);
        continue;
      }
      usersSaved++;
      rowsInserted += rows.length;
      citedTotal += rows.filter((r) => r.cited).length; // 저장 성공분만 집계
    }
  } finally {
    await browser.close();
  }

  log(
    `완료 — 저장 ${usersSaved}명/${rowsInserted}행, 인용 ${citedTotal}건, ` +
      `누락 ${usersDropped}명, 페이지 로드 ${pageLoads}회` +
      (queryBudgetExhausted ? ` ⚠️총질의상한(${MAX_QUERIES}) 도달로 중단` : ''),
  );
  return usersDropped > 0 || queryBudgetExhausted ? 1 : 0;
}

main()
  .then((code) => {
    logStream?.end();
    process.exitCode = code;
  })
  .catch((e) => {
    log(`치명적 오류: ${errMsg(e)}`);
    logStream?.end();
    process.exitCode = 1;
  });
