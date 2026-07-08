// 기존 회원 → free_benefit_grants 원장 백필
//
// 목적: 이미 무료 크레딧(2회)을 받은 모든 기존 회원의 전화/이메일 해시를 원장에 심어,
//       이들이 계정을 지우고 재가입해도 무료혜택에서 제외되도록 한다.
//
// 사용법 (앱 폴더에서):
//   node scripts/backfill_free_benefit_grants.mjs           # 미리보기(dry-run, 기본)
//   node scripts/backfill_free_benefit_grants.mjs --apply   # 실제 적용
//
// ⚠️ 해시 알고리즘은 src/payment/lib/free-benefit.ts 와 반드시 동일해야 한다.
//    (SALT / normalizePhone / normalizeEmail / hashIdentity)

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ── free-benefit.ts 와 동일한 정규화/해시 (동기화 필수) ──────────────
const SALT = 'dp-free-benefit-v1'
const normalizePhone = (phone) => {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  return digits.length >= 9 ? digits : null
}
const normalizeEmail = (email) => {
  if (!email) return null
  const e = String(email).trim().toLowerCase()
  return e.includes('@') ? e : null
}
const hashIdentity = (value) => createHash('sha256').update(`${SALT}:${value}`).digest('hex')
// ────────────────────────────────────────────────────────────────────

const apply = process.argv.includes('--apply')

// .env.local 로드
const envPath = path.resolve(process.cwd(), '.env.local')
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// 1) 전체 프로필 로드(페이지네이션)
const profiles = []
const PAGE = 1000
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,phone')
    .range(from, from + PAGE - 1)
  if (error) { console.error('profiles 조회 오류', error); process.exit(1) }
  profiles.push(...(data || []))
  if (!data || data.length < PAGE) break
}
console.log(`프로필 총 ${profiles.length}건 로드`)

// 2) 이미 원장에 있는 해시 수집(멱등)
const existingPhone = new Set()
const existingEmail = new Set()
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from('free_benefit_grants')
    .select('phone_hash,email_hash')
    .range(from, from + PAGE - 1)
  if (error) { console.error('free_benefit_grants 조회 오류(테이블 마이그레이션부터 적용하세요)', error); process.exit(1) }
  for (const r of data || []) {
    if (r.phone_hash) existingPhone.add(r.phone_hash)
    if (r.email_hash) existingEmail.add(r.email_hash)
  }
  if (!data || data.length < PAGE) break
}
console.log(`원장 기존: 전화 ${existingPhone.size} · 이메일 ${existingEmail.size}`)

// 3) 삽입 대상 산출(이번 실행 내 중복도 제거)
const rows = []
const seenPhone = new Set()
const seenEmail = new Set()
let skipNoSignal = 0
for (const p of profiles) {
  const ph = normalizePhone(p.phone)
  const em = normalizeEmail(p.email)
  const phoneHash = ph ? hashIdentity(ph) : null
  const emailHash = em ? hashIdentity(em) : null
  if (!phoneHash && !emailHash) { skipNoSignal++; continue }

  const phoneNew = phoneHash && !existingPhone.has(phoneHash) && !seenPhone.has(phoneHash)
  const emailNew = emailHash && !existingEmail.has(emailHash) && !seenEmail.has(emailHash)
  if (!phoneNew && !emailNew) continue // 이미 원장에 신원 존재

  if (phoneHash) seenPhone.add(phoneHash)
  if (emailHash) seenEmail.add(emailHash)
  rows.push({ phone_hash: phoneHash, email_hash: emailHash, first_user_id: p.id })
}

console.log(`\n삽입 대상: ${rows.length}건 (식별신호 없음 스킵 ${skipNoSignal}건)`)
if (!apply) {
  console.log('\n[dry-run] 실제 삽입하려면 --apply 를 붙여 다시 실행하세요.')
  process.exit(0)
}

// 4) 배치 삽입
let inserted = 0
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500)
  const { error } = await supabase.from('free_benefit_grants').insert(batch)
  if (error) { console.error('삽입 오류', error); process.exit(1) }
  inserted += batch.length
  console.log(`  ...${inserted}/${rows.length}`)
}
console.log(`\n완료: ${inserted}건 원장 기록`)
