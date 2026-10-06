import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyReturningUserFreeBenefitPolicy,
  hashIdentity,
  hashIdentityV2,
  identityHashes,
} from '../free-benefit.ts'

const SECRET = 'a'.repeat(64)

test('v2 해시는 비밀키에 따라 달라진다 — 키 없이 사전 대입 불가', () => {
  const a = hashIdentityV2('phone:01012345678', SECRET)
  const b = hashIdentityV2('phone:01012345678', 'b'.repeat(64))
  assert.notEqual(a, b)
  assert.equal(a, hashIdentityV2('phone:01012345678', SECRET))
  assert.notEqual(a, hashIdentity('01012345678'))
})

test('v2 해시: 키가 없으면 조용히 넘어가지 않고 실패한다', () => {
  assert.throws(() => hashIdentityV2('phone:01012345678', ''))
})

test('identityHashes: 전화·이메일 정규화, 종류 접두로 서로 섞이지 않는다', () => {
  const ids = identityHashes(' A@X.com ', '010-1234-5678', SECRET)
  assert.ok(ids)
  assert.deepEqual(ids.v2.map((x) => x.kind), ['phone', 'email'])
  assert.equal(ids.v2[1].h, hashIdentityV2('email:a@x.com', SECRET))
  assert.equal(ids.v1.phone, hashIdentity('01012345678'))
  assert.equal(identityHashes(null, '12', SECRET), null)
})

interface Call { fn: string; args: unknown }

function mockAdmin(rpcResult: { data: unknown; error: unknown }, legacyRows: unknown[] = []) {
  const calls: Call[] = []
  const admin = {
    rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return rpcResult },
    from: (table: string) => ({
      select: () => ({ or: () => ({ limit: async () => { calls.push({ fn: `select:${table}`, args: null }); return { data: legacyRows, error: null } } }) }),
      update: (v: unknown) => ({ eq: async () => { calls.push({ fn: `update:${table}`, args: v }); return { error: null } } }),
      insert: async (v: unknown) => { calls.push({ fn: `insert:${table}`, args: v }); return { error: null } },
    }),
  }
  return { admin: admin as never, calls }
}

test('정책: RPC 가 있으면 판정·기록을 RPC 한 번으로 끝낸다', async () => {
  process.env.ENCRYPTION_KEY = SECRET
  const { admin, calls } = mockAdmin({ data: true, error: null })
  const r = await applyReturningUserFreeBenefitPolicy(admin, 'u1', 'a@x.com', '01012345678')
  assert.deepEqual(r, { returning: true, via: 'claim' })
  assert.equal(calls.length, 1)
  const args = calls[0].args as { p_user_id: string; p_hashes: unknown[]; p_legacy: string[] }
  assert.equal(args.p_user_id, 'u1')
  assert.equal(args.p_hashes.length, 2)
  assert.equal(args.p_legacy.length, 2)
})

test('정책: 064 미적용(함수 없음)이면 040 경로로 내려간다', async () => {
  process.env.ENCRYPTION_KEY = SECRET
  const { admin, calls } = mockAdmin({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
  const r = await applyReturningUserFreeBenefitPolicy(admin, 'u1', 'a@x.com', '01012345678')
  assert.deepEqual(r, { returning: false, via: 'legacy' })
  assert.ok(calls.some((c) => c.fn === 'insert:free_benefit_grants'))
})

test('정책: 다른 RPC 오류는 레거시로 숨기지 않고 던진다', async () => {
  process.env.ENCRYPTION_KEY = SECRET
  const { admin } = mockAdmin({ data: null, error: { code: '57014', message: 'timeout' } })
  await assert.rejects(applyReturningUserFreeBenefitPolicy(admin, 'u1', 'a@x.com', '01012345678'))
})

test('정책: 식별 신호가 없으면 아무것도 하지 않는다', async () => {
  const { admin, calls } = mockAdmin({ data: true, error: null })
  const r = await applyReturningUserFreeBenefitPolicy(admin, 'u1', null, null)
  assert.deepEqual(r, { returning: false, via: 'none' })
  assert.equal(calls.length, 0)
})

test('v2 전화번호: +82 표기와 010 표기를 같은 신원으로 본다', () => {
  const a = identityHashes(null, '+82 10-1234-5678', SECRET)
  const b = identityHashes(null, '010-1234-5678', SECRET)
  assert.equal(a?.v2[0].h, b?.v2[0].h)
})

test('v2 해시: 64자리 hex 가 아닌 키는 거부한다', () => {
  assert.throws(() => hashIdentityV2('phone:01012345678', 'short-key'))
})
