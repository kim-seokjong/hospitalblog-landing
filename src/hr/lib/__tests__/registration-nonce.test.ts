import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { checkRegistrationNonce } from '../registration-nonce.ts'

const NONCE = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'
const HASH = createHash('sha256').update(NONCE, 'utf8').digest('hex')

test('해시와 원본 번호가 맞으면 ok', () => {
  assert.equal(checkRegistrationNonce(HASH, NONCE), 'ok')
})

test('번호가 다르거나 없거나 형식이 틀리면 mismatch', () => {
  assert.equal(checkRegistrationNonce(HASH, 'b'.repeat(64)), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, undefined), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, NONCE.toUpperCase()), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, HASH), 'mismatch', '해시를 그대로 보내도 통과하면 안 된다(노출된 해시 재사용)')
})

test('메타데이터 값이 이상하면 mismatch', () => {
  assert.equal(checkRegistrationNonce('not-hex', NONCE), 'mismatch')
  assert.equal(checkRegistrationNonce(12345, NONCE), 'mismatch')
  assert.equal(checkRegistrationNonce('', NONCE), 'mismatch')
})

test('해시 없는 옛 계정은 mismatch(legacy 허용은 2026-10-19 마감)', () => {
  assert.equal(checkRegistrationNonce(undefined, undefined), 'mismatch')
  assert.equal(checkRegistrationNonce(null, NONCE), 'mismatch')
})
