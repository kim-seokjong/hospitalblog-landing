// 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증한다.
//
// 회원가입 가입자 확인 번호 판정 — 2026-10-12.
//   /api/auth/register 는 로그인 없이 호출된다. 남의 userId 로 프로필을 쓰거나 롤백 삭제하는 것을 막으려고
//   가입 화면(AuthModal)이 signUp 때 메타데이터에 SHA-256(번호)를 넣고, 원본 번호는 /register 요청에만 싣는다.
//   ⚠️원본을 메타데이터에 두면 안 된다 — 미확인 계정에 같은 이메일로 signUp 하면 Supabase 가 기존 메타데이터를 돌려준다.
//   해시 없는 옛 화면 가입을 받아 주던 legacy 허용은 2026-10-19 마감 후 2026-10-20 에 코드에서 걷어냈다.
import { createHash, timingSafeEqual } from 'node:crypto'

export type NonceVerdict = 'ok' | 'mismatch'

const HEX64 = /^[0-9a-f]{64}$/

export function checkRegistrationNonce(storedHash: unknown, given: unknown): NonceVerdict {
  if (typeof storedHash !== 'string' || !HEX64.test(storedHash)) return 'mismatch'
  if (typeof given !== 'string' || !HEX64.test(given)) return 'mismatch'
  const givenHash = createHash('sha256').update(given, 'utf8').digest('hex')
  return timingSafeEqual(Buffer.from(storedHash, 'utf8'), Buffer.from(givenHash, 'utf8')) ? 'ok' : 'mismatch'
}
