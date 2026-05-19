import { Resend } from 'resend'

const FROM_ADDRESS = '닥터포스트 <noreply@hospitalblog.kr>'
const REPLY_TO = 'terro6936@naver.com'

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

interface SendEmailResult {
  success: boolean
  id?: string
  error?: string
}

let cachedClient: Resend | null = null

function getClient(): Resend | null {
  if (cachedClient) return cachedClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  cachedClient = new Resend(apiKey)
  return cachedClient
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<SendEmailResult> {
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
