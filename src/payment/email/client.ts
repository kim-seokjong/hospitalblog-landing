import { Resend } from 'resend'
import { notifyEmailFailure } from './failure-alert.ts'
import { runSendPipeline, type SendEmailParams, type SendEmailResult } from './send-pipeline.ts'

const FROM_ADDRESS = '닥터포스트 <noreply@hospitalblog.kr>'
const REPLY_TO = 'terro6936@naver.com'

export type { SendEmailParams, SendEmailResult }

let cachedClient: Resend | null = null

function getClient(): Resend | null {
  if (cachedClient) return cachedClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  cachedClient = new Resend(apiKey)
  return cachedClient
}

/** Resend 호출 그 자체. 성공/실패 판정만 하고 알림은 파이프라인이 맡는다. */
async function attemptSend({ to, subject, html }: SendEmailParams): Promise<SendEmailResult> {
  const client = getClient()
  if (!client) {
    return { success: false, error: 'RESEND_API_KEY 미설정' }
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      replyTo: REPLY_TO,
    })

    if (error) {
      return { success: false, error: error.message ?? '이메일 발송 실패' }
    }

    return { success: true, id: data?.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '이메일 발송 중 오류'
    return { success: false, error: msg }
  }
}

/**
 * 메일 발송. **7개 기능(진단·결제·재시도·해지·사전고지·월간리포트·체험리포트)이 전부
 * 이 문을 지난다** — 그래서 실패 알림도 여기 한 곳에만 건다.
 *
 * ★ 2026-07-27, Resend 도메인이 미검증(failed)으로 방치돼 전 경로 발송이 실패하는 동안
 *   아무도 몰랐다. 흔적은 진단 메일의 DB send_error 하나뿐이었고 나머지는 console.error
 *   한 줄이었는데 Vercel 로그는 아무도 보지 않는다. 다시는 조용히 넘어가지 않는다.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  return runSendPipeline(params, {
    attempt: attemptSend,
    notify: (input) => notifyEmailFailure(input),
  })
}
