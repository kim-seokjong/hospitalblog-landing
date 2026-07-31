import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  decryptCredential,
  encryptCredential,
  isCredentialKeyConfigured,
} from '../care-credentials.ts'

const KEY = randomBytes(32).toString('base64')
const env = { CARE_CREDENTIALS_KEY: KEY } as NodeJS.ProcessEnv

test('암호화·복호화 라운드트립', () => {
  const secret = '병원비번!@# 한글도 OK 1234'
  const stored = encryptCredential(secret, env)
  assert.notEqual(stored, secret)
  assert.equal(decryptCredential(stored, env), secret)
})

test('같은 평문도 매번 다른 암호문 (IV 무작위)', () => {
  const a = encryptCredential('samepw', env)
  const b = encryptCredential('samepw', env)
  assert.notEqual(a, b)
  assert.equal(decryptCredential(a, env), 'samepw')
  assert.equal(decryptCredential(b, env), 'samepw')
})

test('다른 키로는 복호화가 실패한다', () => {
  const stored = encryptCredential('secret', env)
  const otherEnv = { CARE_CREDENTIALS_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv
  assert.throws(() => decryptCredential(stored, otherEnv))
})

test('암호문 변조는 인증 태그에서 걸린다', () => {
  const stored = encryptCredential('secret', env)
  const parts = stored.split('.')
  const data = Buffer.from(parts[2], 'base64')
  data[0] = data[0] ^ 0xff
  const tampered = `${parts[0]}.${parts[1]}.${data.toString('base64')}`
  assert.throws(() => decryptCredential(tampered, env))
})

test('키 미설정·형식 오류를 감지한다', () => {
  assert.equal(isCredentialKeyConfigured({} as NodeJS.ProcessEnv), false)
  assert.equal(
    isCredentialKeyConfigured({ CARE_CREDENTIALS_KEY: 'short' } as NodeJS.ProcessEnv),
    false,
  )
  assert.equal(isCredentialKeyConfigured(env), true)
  assert.throws(() => encryptCredential('x', {} as NodeJS.ProcessEnv))
})

test('빈 평문은 거부한다', () => {
  assert.throws(() => encryptCredential('', env))
})

test('잘못된 저장 포맷은 거부한다', () => {
  assert.throws(() => decryptCredential('not-a-valid-format', env))
  assert.throws(() => decryptCredential('a.b', env))
})

test('규정보다 짧은 인증 태그는 거부한다 (인증 강도 약화 방지)', () => {
  const stored = encryptCredential('secret', env)
  const parts = stored.split('.')
  const shortTag = Buffer.from(parts[1], 'base64').subarray(0, 8).toString('base64')
  assert.throws(() => decryptCredential(`${parts[0]}.${shortTag}.${parts[2]}`, env))
})

test('빈 암호문 본문은 거부한다', () => {
  const stored = encryptCredential('secret', env)
  const parts = stored.split('.')
  assert.throws(() => decryptCredential(`${parts[0]}.${parts[1]}.`, env))
})
