import type { NextRequest } from 'next/server'

// Vercel Cron 자동 헤더: Authorization: Bearer ${CRON_SECRET}
// 수동 호출 시에도 동일 헤더 요구
export function isAuthorizedCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}

/**
 * CRON_SECRET 설정 여부 진단.
 *
 * ★ 미설정이면 isAuthorizedCron 이 항상 false 라, Vercel Cron 이 매일 401 을 받고
 *   조용히 실패한다 — 아무 로그도 남지 않아 "돌고 있는 줄 알았는데 두 달간 안 돌았다"가 된다.
 *   호출부는 이 값이 'missing' 이면 서버 로그에 눈에 띄게 남기고, cron 응답 본문에도 실어
 *   수동 점검 시 즉시 보이게 한다.
 *
 * 값 자체는 절대 반환하지 않는다(로그·응답 노출 금지).
 */
export function cronSecretStatus(): 'ok' | 'missing' {
  const secret = process.env.CRON_SECRET
  return secret && secret.trim() !== '' ? 'ok' : 'missing'
}
