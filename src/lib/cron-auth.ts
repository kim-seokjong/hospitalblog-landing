import type { NextRequest } from 'next/server'

// Vercel Cron 자동 헤더: Authorization: Bearer ${CRON_SECRET}
// 수동 호출 시에도 동일 헤더 요구
export function isAuthorizedCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}
