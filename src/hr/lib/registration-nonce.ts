// 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증한다.
//
// 회원가입 가입자 확인 번호 판정 — 2026-10-12.
//   /api/auth/register 는 로그인 없이 호출된다. 남의 userId 로 프로필을 쓰거나 롤백 삭제하는 것을 막으려고
//   가입 화면(AuthModal)이 signUp 때 메타데이터에 SHA-256(번호)를 넣고, 원본 번호는 /register 요청에만 싣는다.
//   ⚠️원본을 메타데이터에 두면 안 된다 — 미확인 계정에 같은 이메일로 signUp 하면 Supabase 가 기존 메타데이터를 돌려준다.
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * 해시가 없는 계정(= 이 변경 배포 전 화면으로 가입한 계정)을 직전 규칙으로 받아 주는 마감 시각.
 * 이 시각이 지나면 해시 없는 계정도 'mismatch' 로 거부한다(주석이 아니라 코드로 끝낸다 — Codex 10/12 3라운드).
 */
export const LEGACY_NONCE_ACCEPT_UNTIL_MS = Date.parse('2026-10-19T00:00:00+09:00')

export type NonceVerdict = 'ok' | 'legacy' | 'mismatch'

const HEX64 = /^[0-9a-f]{64}$/

export function checkRegistrationNonce(
  storedHash: unknown,
  given: unknown,
  nowMs: number = Date.now(),
): NonceVerdict {
  if (storedHash == null) return nowMs < LEGACY_NONCE_ACCEPT_UNTIL_MS ? 'legacy' : 'mismatch'
  if (typeof storedHash !== 'string' || !HEX64.test(storedHash)) return 'mismatch'
  if (typeof given !== 'string' || !HEX64.test(given)) return 'mismatch'
  const givenHash = createHash('sha256').update(given, 'utf8').digest('hex')
  return timingSafeEqual(Buffer.from(storedHash, 'utf8'), Buffer.from(givenHash, 'utf8')) ? 'ok' : 'mismatch'
}
