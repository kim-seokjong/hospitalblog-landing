/**
 * 메일 발송 파이프라인 — "보낸다 → 실패하면 알린다"의 **단일 통로**.
 *
 * ★ 왜 분리했나 (2026-07-27).
 *   실패 경로가 여러 갈래(키 미설정 / Resend 오류 / 예외)면 그중 하나가 알림을 빠뜨려도
 *   아무도 모른다. 실제로 그런 식으로 "메일이 안 나가는 걸 아무도 모르는" 사고가 났다.
 *   그래서 실패 출구를 **한 곳**으로 모으고, 그 한 곳에서만 알림을 건다.
 *   또 Resend SDK 의존을 client.ts 에 남겨 두어 이 파일은 목으로 검증할 수 있다.
 *
 * 계약: 알림이 실패하거나 예외를 던져도 **발송 결과는 그대로 반환한다.**
 *
 * 외부 의존 없는 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

import type { EmailFeature } from './failure-alert.ts';

export interface SendEmailParams {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /**
   * 어떤 기능의 메일인지(실패 알림에 표시). 선택 인자라 기존 호출부는 그대로 동작한다.
   * 미전달 시 알림에 '미지정'으로 찍히므로 새 호출부는 반드시 넘길 것.
   */
  readonly feature?: EmailFeature;
}

export interface SendEmailResult {
  readonly success: boolean;
  readonly id?: string;
  readonly error?: string;
}

export interface SendPipelineDeps {
  /** 실제 발송 시도. 이 함수는 throw 하지 않는 것이 계약이지만, 던져도 여기서 흡수한다. */
  readonly attempt: (params: SendEmailParams) => Promise<SendEmailResult>;
  /** 실패 알림. 실패해도 무시된다. */
  readonly notify: (input: { feature?: EmailFeature; error: string }) => Promise<unknown>;
}

export async function runSendPipeline(
  params: SendEmailParams,
  deps: SendPipelineDeps,
): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    result = await deps.attempt(params);
  } catch (e) {
    result = { success: false, error: e instanceof Error ? e.message : '이메일 발송 중 오류' };
  }

  if (!result.success) {
    try {
      await deps.notify({ feature: params.feature, error: result.error ?? '알 수 없는 발송 실패' });
    } catch (e) {
      // 알림 때문에 발송 결과가 바뀌면 안 된다.
      console.error('[email] 실패 알림 처리 중 오류(무시):', e instanceof Error ? e.message : e);
    }
  }

  return result;
}
