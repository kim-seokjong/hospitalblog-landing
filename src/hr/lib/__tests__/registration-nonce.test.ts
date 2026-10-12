import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { checkRegistrationNonce, LEGACY_NONCE_ACCEPT_UNTIL_MS } from '../registration-nonce.ts'

const NONCE = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'
const HASH = createHash('sha256').update(NONCE, 'utf8').digest('hex')
const BEFORE = LEGACY_NONCE_ACCEPT_UNTIL_MS - 1
const AFTER = LEGACY_NONCE_ACCEPT_UNTIL_MS + 1

test('해시와 원본 번호가 맞으면 ok', () => {
  assert.equal(checkRegistrationNonce(HASH, NONCE, BEFORE), 'ok')
  assert.equal(checkRegistrationNonce(HASH, NONCE, AFTER), 'ok')
})

test('번호가 다르거나 없거나 형식이 틀리면 mismatch', () => {
  assert.equal(checkRegistrationNonce(HASH, 'b'.repeat(64), BEFORE), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, undefined, BEFORE), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, NONCE.toUpperCase(), BEFORE), 'mismatch')
  assert.equal(checkRegistrationNonce(HASH, HASH, BEFORE), 'mismatch', '해시를 그대로 보내도 통과하면 안 된다(노출된 해시 재사용)')
})

test('메타데이터 값이 이상하면 mismatch', () => {
  assert.equal(checkRegistrationNonce('not-hex', NONCE, BEFORE), 'mismatch')
  assert.equal(checkRegistrationNonce(12345, NONCE, BEFORE), 'mismatch')
  assert.equal(checkRegistrationNonce('', NONCE, BEFORE), 'mismatch')
})

test('해시 없는 옛 계정은 마감 전에만 legacy, 마감 뒤에는 mismatch', () => {
  assert.equal(checkRegistrationNonce(undefined, undefined, BEFORE), 'legacy')
  assert.equal(checkRegistrationNonce(null, NONCE, BEFORE), 'legacy')
  assert.equal(checkRegistrationNonce(undefined, undefined, AFTER), 'mismatch')
})
