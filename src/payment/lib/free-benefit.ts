import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 재가입 무료혜택 악용 방지.
 *
 * 가입 시 무료 크레딧 2회(profiles.free_credits, migration 033)는 계정당 평생 1회여야 한다.
 * 계정을 지우고 새 이메일로 재가입하면 매번 크레딧을 다시 받는 악용을 막기 위해,
 * 한 번이라도 무료혜택을 받은 "신원"(전화번호/이메일 해시)을 원장(free_benefit_grants)에
 * 기록하고, 재가입 시 걸리면 free_credits 를 0 으로 회수한다.
 *
 * ⚠️ 아래 정규화·해시 알고리즘은 scripts/backfill_free_benefit_grants.mjs 와 반드시 동일해야
 *    기존 회원 백필과 실시간 가입의 해시가 일치한다. 한쪽만 바꾸지 말 것.
 */

// 해시 솔트(레인보우 테이블 방어). 비밀등급은 아니지만 원문 전화번호 역산을 막는다.
// 값을 바꾸면 기존 원장 해시와 어긋나므로 절대 변경 금지(변경 시 재백필 필요).
const SALT = 'dp-free-benefit-v1'

/** 전화번호 → 숫자만. 9자리 미만이면 신뢰 불가로 null. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits : null
}

/** 이메일 → trim + 소문자. '@' 없으면 null. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const e = String(email).trim().toLowerCase()
  return e.includes('@') ? e : null
}

/** 정규화된 값 → SHA-256 hex 해시. */
export function hashIdentity(value: string): string {
  return createHash('sha256').update(`${SALT}:${value}`).digest('hex')
}

export interface FreeBenefitPolicyResult {
  /** 이미 무료혜택을 받은 신원으로 판정되어 크레딧을 회수했는지 */
  returning: boolean
  phoneHash: string | null
  emailHash: string | null
}

/**
 * 가입 성공 직후 호출.
 * - 전화/이메일 해시가 원장에 하나라도 있으면 재가입으로 보고 free_credits = 0 회수.
 * - 신규 신원이면 원장에 기록(다음 재가입부터 제외 대상).
 *
 * best-effort 로 설계 — 호출부에서 예외를 삼켜 가입 흐름을 막지 않는다.
 * (원장 테이블 미적용 환경에서는 예외가 나고, 기존 동작인 "크레딧 2 부여"로 graceful 하게 유지된다.)
 */
export async function applyReturningUserFreeBenefitPolicy(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  phone: string | null | undefined,
): Promise<FreeBenefitPolicyResult> {
  const normPhone = normalizePhone(phone)
  const normEmail = normalizeEmail(email)
  const phoneHash = normPhone ? hashIdentity(normPhone) : null
  const emailHash = normEmail ? hashIdentity(normEmail) : null

  // 식별 신호가 하나도 없으면 정책 적용 불가 — 신규로 간주(크레딧 유지).
  if (!phoneHash && !emailHash) {
    return { returning: false, phoneHash, emailHash }
  }

  const orFilters: string[] = []
  if (phoneHash) orFilters.push(`phone_hash.eq.${phoneHash}`)
  if (emailHash) orFilters.push(`email_hash.eq.${emailHash}`)

  const { data: existing, error: selErr } = await admin
    .from('free_benefit_grants')
    .select('id')
    .or(orFilters.join(','))
    .limit(1)

  if (selErr) throw selErr

  const returning = !!existing && existing.length > 0

  if (returning) {
    // 무료 크레딧 회수(기본 2 → 0). 이미 일부 소진했더라도 0 으로 확정.
    const { error: updErr } = await admin
      .from('profiles')
      .update({ free_credits: 0, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (updErr) throw updErr
  } else {
    // 신규 신원 — 원장에 기록.
    const { error: insErr } = await admin
      .from('free_benefit_grants')
      .insert({ phone_hash: phoneHash, email_hash: emailHash, first_user_id: userId })
    if (insErr) throw insErr
  }

  return { returning, phoneHash, emailHash }
}
