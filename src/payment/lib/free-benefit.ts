import { createHash, createHmac } from 'node:crypto'
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

/**
 * [v1·레거시] 정규화된 값 → SHA-256(고정 솔트) hex. 2026-10-06 이전 원장(free_benefit_grants)
 * 조회 전용이다 — 솔트가 소스에 있어 전화번호 후보 공간(약 10^8)을 역산당할 수 있으므로
 * ⛔새 기록에는 쓰지 않는다. 새 기록은 hashIdentityV2.
 */
export function hashIdentity(value: string): string {
  return createHash('sha256').update(`${SALT}:${value}`).digest('hex')
}

/**
 * [v2] 서버 비밀키 기반 HMAC-SHA256. DB 가 유출돼도 키 없이는 전화번호를 사전 대입할 수 없다.
 *
 * 키 = SHA-256("dp-free-benefit-v2:" + ENCRYPTION_KEY). 새 환경변수를 만들지 않고 이미 운영에 있는
 * ENCRYPTION_KEY 에서 파생한다(용도별 분리를 위해 원본을 그대로 쓰지 않는다).
 * ⚠️ENCRYPTION_KEY 를 바꾸면 v2 원장과 어긋난다 — 그 키는 이미 암호화 데이터 때문에 교체 금지다.
 */
export function hashIdentityV2(value: string, secret: string | undefined = process.env.ENCRYPTION_KEY): string {
  // crypto.ts 와 같은 형식(64자리 hex)만 받는다 — 잘못된 값으로 영구 원장을 만들지 않게.
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('ENCRYPTION_KEY 가 없거나 64자리 hex 가 아닙니다 — 무료혜택 신원 해시를 만들 수 없습니다')
  }
  const key = createHash('sha256').update(`dp-free-benefit-v2:${secret}`).digest()
  return createHmac('sha256', key).update(value).digest('hex')
}

export interface FreeBenefitPolicyResult {
  /** 이미 무료혜택을 받은 신원으로 판정되어 크레딧을 회수했는지 */
  returning: boolean
  /** 어느 경로로 판정했는지 — 'claim'=원자적 RPC(마이그 064), 'legacy'=064 적용 전 경로 */
  via: 'claim' | 'legacy' | 'none'
}

interface IdentityHashes {
  /** v2 해시 + 종류 — 새 원장(free_benefit_identities)에 원자적으로 기록한다. */
  readonly v2: ReadonlyArray<{ h: string; kind: 'phone' | 'email' }>
  /** v1 해시 — 옛 원장(free_benefit_grants)과 대조만 한다. */
  readonly v1: { readonly phone: string | null; readonly email: string | null }
}

/** v2 전용 전화번호 정규화 — +82 10… 과 010… 을 같은 사람으로 본다(v1 은 원장 호환 때문에 그대로 둔다). */
export function canonicalPhone(phone: string | null | undefined): string | null {
  const d = normalizePhone(phone)
  if (!d) return null
  return d.startsWith('82') && d.length >= 11 ? `0${d.slice(2)}` : d
}

export function identityHashes(
  email: string | null | undefined,
  phone: string | null | undefined,
  secret: string | undefined = process.env.ENCRYPTION_KEY,
): IdentityHashes | null {
  const normPhone = normalizePhone(phone)
  const normEmail = normalizeEmail(email)
  if (!normPhone && !normEmail) return null
  const v2: Array<{ h: string; kind: 'phone' | 'email' }> = []
  const canon = canonicalPhone(phone)
  if (canon) v2.push({ h: hashIdentityV2(`phone:${canon}`, secret), kind: 'phone' })
  if (normEmail) v2.push({ h: hashIdentityV2(`email:${normEmail}`, secret), kind: 'email' })
  return {
    v2,
    v1: {
      phone: normPhone ? hashIdentity(normPhone) : null,
      email: normEmail ? hashIdentity(normEmail) : null,
    },
  }
}

/** PostgREST 가 함수를 못 찾았을 때(마이그 064 미적용). 이때만 레거시 경로로 내려간다. */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message ?? '')
}

/**
 * 가입 성공 직후 호출.
 * - 전화/이메일 중 하나라도 무료혜택을 받은 적 있으면 재가입으로 보고 free_credits = 0 회수.
 * - 신규 신원이면 원장에 기록(다음 재가입부터 제외 대상).
 *
 * ★판정과 기록은 DB 함수 claim_free_benefit 안에서 한 번에 한다(마이그 064).
 *   해시가 기본키라, 같은 전화번호로 거의 동시에 가입해도 둘 중 하나만 「신규」가 된다.
 *   (이전 구현은 조회 → 삽입이 따로라 동시 가입이 둘 다 신규로 통과했다.)
 *
 * best-effort 로 설계 — 호출부에서 예외를 삼켜 가입 흐름을 막지 않는다.
 */
export async function applyReturningUserFreeBenefitPolicy(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  phone: string | null | undefined,
): Promise<FreeBenefitPolicyResult> {
  const ids = identityHashes(email, phone)
  // 식별 신호가 하나도 없으면 정책 적용 불가 — 신규로 간주(크레딧 유지).
  if (!ids) return { returning: false, via: 'none' }

  const { data, error } = await admin.rpc('claim_free_benefit', {
    p_user_id: userId,
    p_hashes: ids.v2,
    p_legacy: [ids.v1.phone, ids.v1.email].filter((h): h is string => Boolean(h)),
  })
  if (!error) return { returning: data === true, via: 'claim' }
  if (!isMissingFunction(error)) throw error

  return { returning: await legacyPolicy(admin, userId, ids.v1), via: 'legacy' }
}

/** 마이그 064 적용 전 경로(조회 → 삽입이 분리돼 동시 가입에 약하다). 064 적용 후에는 타지 않는다. */
async function legacyPolicy(
  admin: SupabaseClient,
  userId: string,
  v1: IdentityHashes['v1'],
): Promise<boolean> {
  const orFilters: string[] = []
  if (v1.phone) orFilters.push(`phone_hash.eq.${v1.phone}`)
  if (v1.email) orFilters.push(`email_hash.eq.${v1.email}`)

  const { data: existing, error: selErr } = await admin
    .from('free_benefit_grants')
    .select('id')
    .or(orFilters.join(','))
    .limit(1)
  if (selErr) throw selErr

  const returning = !!existing && existing.length > 0
  if (returning) {
    const { error: updErr } = await admin
      .from('profiles')
      .update({ free_credits: 0, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (updErr) throw updErr
  } else {
    const { error: insErr } = await admin
      .from('free_benefit_grants')
      .insert({ phone_hash: v1.phone, email_hash: v1.email, first_user_id: userId })
    if (insErr) throw insErr
  }
  return returning
}
