import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron, cronSecretStatus } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { getAnthropicClient, MODEL } from '@/content/lib/anthropic';
import { evaluateDomains } from '@/payment/email/domain-health';
import {
  buildReport,
  summarizeGeneration,
  type DepResult,
  type DepsHealthReport,
} from '@/dev/lib/deps-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIMEOUT_MS = 12_000;

/**
 * GET /api/health/deps — 외부 의존성 카나리 (인증: Authorization: Bearer ${CRON_SECRET})
 *
 * ★ 왜 (2026-08-22). 마지막 생성이 7/31 이었다. **3주간 아무도 제품을 태우지 않았고
 *   그래서 깨져 있었어도 알 수 없었다.** 유료고객이 없는 동안에도 "작동한다"를
 *   사람 없이 매일 확인해야 한다.
 *
 * 재는 것:
 *   ① Anthropic — 운영과 **같은 모델**로 1토큰 생성. 키 유효성 + 잔액까지 함께 재진다.
 *      (models 목록 조회는 잔액 소진을 못 잡는다 — 그래서 실제 생성을 태운다.)
 *   ② PortOne — 토큰 발급. **결제 경로에서 사람 없이 잴 수 있는 유일한 지점**이다.
 *      실결제는 여기서 하지 않는다(돈이 나가는 일은 대표 영역).
 *   ③ Resend — 발송 도메인 verified 여부. 2026-07-27 에 미검증으로 전건 실패했었다.
 *   ④ 마지막 생성 시각 — 정보로만 낸다. **경보로 쓰지 않는다**(쓰는 사람이 없는 것은
 *      고장이 아니다. 매일 울리면 진짜 경고를 안 보게 된다).
 *
 * 비용: ①이 1토큰(약 $0.00002/일). 나머지는 0원.
 *
 * ⛔비밀값은 응답에 담지 않는다. 실패 사유도 상태코드·오류종류까지만 적는다.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized', cronSecret: cronSecretStatus() }, { status: 401 });
  }

  const [anthropic, portone, resend, generation] = await Promise.all([
    checkAnthropic(),
    checkPortOne(),
    checkResend(),
    readGenerationFreshness(),
  ]);

  const report: DepsHealthReport = buildReport([anthropic, portone, resend], generation, Date.now());

  const line = `[health/deps] healthy=${report.healthy} ${report.deps.map((d) => `${d.name}=${d.status}`).join(' ')}`;
  if (report.healthy) console.warn(line);
  else console.error(line);

  return NextResponse.json(report);
}

/** ① 운영과 같은 모델로 1토큰. 키·잔액·모델 가용성을 한 번에 잰다. */
async function checkAnthropic(): Promise<DepResult> {
  const name = '글 생성(Anthropic)';
  if (!process.env.ANTHROPIC_API_KEY) return { name, status: 'skipped', note: '키 미설정' };
  try {
    const res = await getAnthropicClient().messages.create(
      { model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: '.' }] },
      { timeout: TIMEOUT_MS },
    );
    return { name, status: 'ok', note: `${res.model} 응답` };
  } catch (e) {
    return { name, status: 'fail', note: `${MODEL} 호출 실패 — ${errorLabel(e)}` };
  }
}

/** ② 토큰 발급만. 결제는 하지 않는다. */
async function checkPortOne(): Promise<DepResult> {
  const name = '결제(PortOne)';
  const secret = (process.env.PORTONE_API_SECRET ?? '').trim();
  if (!secret) return { name, status: 'skipped', note: '시크릿 미설정' };
  try {
    const res = await fetch('https://api.portone.io/login/api-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiSecret: secret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { name, status: 'fail', note: `토큰 발급 HTTP ${res.status}` };
    const body = (await res.json()) as { accessToken?: unknown };
    if (typeof body.accessToken !== 'string' || !body.accessToken) {
      return { name, status: 'fail', note: '토큰 발급 응답에 accessToken 이 없습니다' };
    }
    return { name, status: 'ok', note: '토큰 발급 성공' };
  } catch (e) {
    return { name, status: 'fail', note: `토큰 발급 실패 — ${errorLabel(e)}` };
  }
}

/** ③ 도메인 판정은 기존 순수 함수를 그대로 쓴다(판정 기준이 갈리지 않게). */
async function checkResend(): Promise<DepResult> {
  const name = '메일(Resend)';
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) return { name, status: 'skipped', note: '키 미설정 — 메일이 한 통도 안 나갑니다' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 본문은 실패 시 읽지 않는다 — 키가 섞여 나올 여지를 만들지 않는다.
    if (!res.ok) return { name, status: 'fail', note: `도메인 조회 HTTP ${res.status}` };
    const verdict = evaluateDomains(await res.json());
    return { name, status: verdict.healthy ? 'ok' : 'fail', note: verdict.note };
  } catch (e) {
    return { name, status: 'fail', note: `도메인 조회 실패 — ${errorLabel(e)}` };
  }
}

/** ④ 정보용. 읽지 못해도 점검을 실패로 만들지 않는다. */
async function readGenerationFreshness() {
  const [usage, post] = await Promise.all([latestCreatedAt('usage_logs'), latestCreatedAt('saved_posts')]);
  return summarizeGeneration(usage, post, Date.now());
}

async function latestCreatedAt(table: 'usage_logs' | 'saved_posts'): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from(table)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const at = (data as { created_at?: unknown }).created_at;
    return typeof at === 'string' ? at : null;
  } catch {
    return null;
  }
}

/** 오류를 한 줄로. 비밀값이 섞일 수 있는 본문·스택은 쓰지 않는다. */
function errorLabel(e: unknown): string {
  if (e instanceof Error) {
    const status = (e as { status?: unknown }).status;
    return typeof status === 'number' ? `${e.name} HTTP ${status}` : e.name;
  }
  return '알 수 없는 오류';
}
