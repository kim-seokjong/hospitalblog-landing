/**
 * 운영 알림 전송기 (텔레그램).
 *
 * ★ 왜 만들었나 (2026-07-27).
 *   Resend 에 hospitalblog.kr 이 **미검증(failed) 상태로 방치**돼 있었고, 그동안 모든
 *   메일 발송이 `The hospitalblog.kr domain is not verified.` 로 실패했다.
 *   그런데 그 사실을 **사람이 직접 메일을 보내보고 나서야** 알았다. 진단 메일만 DB
 *   send_error 에 흔적이 남았고 나머지 경로는 console.error 한 줄이 전부였는데,
 *   Vercel 로그는 아무도 보지 않는다.
 *
 *   전화 아웃바운드(vox-daily)는 이미 텔레그램으로 매일 보고가 온다. 같은 봇·같은
 *   채팅으로 보내면 **대표가 이미 보고 있는 화면**에 장애가 뜬다. 새 채널을 만들면
 *   그 채널을 아무도 안 보는 날이 다시 온다.
 *
 * 계약(중요):
 *   · 환경변수(TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID)가 없으면 조용히 skip 한다.
 *   · **절대 throw 하지 않는다.** 알림 때문에 본래 업무(메일 발송·크론)가 깨지면
 *     알림이 없느니만 못하다.
 *
 * 외부 의존 없는 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

/** 'skipped' = 설정 없음(정상), 'failed' = 보내려 했으나 실패(무시). */
export type TelegramSendResult = 'sent' | 'skipped' | 'failed';

/** 주입 가능한 전송 함수 — 테스트에서 실제 텔레그램을 쏘지 않기 위한 이음매. */
export type TelegramSender = (text: string) => Promise<TelegramSendResult>;

/** 텔레그램 단일 메시지 상한은 4096자. 여유를 두고 자른다. */
const MAX_TEXT = 3500;
const TIMEOUT_MS = 5000;

export function readTelegramConfig(env: EnvLike): TelegramConfig | null {
  const botToken = (env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * 텔레그램 전송. 실패·미설정·예외 전부 흡수하고 결과만 돌려준다.
 * 호출부는 이 반환값으로 흐름을 바꾸지 말 것(로그·테스트 확인용이다).
 */
export async function sendTelegram(
  text: string,
  env: EnvLike = process.env,
): Promise<TelegramSendResult> {
  const config = readTelegramConfig(env);
  if (!config) return 'skipped';

  const body = text.trim().slice(0, MAX_TEXT);
  if (!body) return 'skipped';

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: body,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 토큰이 틀리면 여기서 끝난다 — 알림의 알림은 만들지 않는다(무한 재귀).
      console.error(`[telegram] 전송 실패 HTTP ${res.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error('[telegram] 전송 예외:', e instanceof Error ? e.message : e);
    return 'failed';
  }
}
