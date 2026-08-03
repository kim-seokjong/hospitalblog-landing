/**
 * 케어 플랜 계정 위임 정보 암호화 — AES-256-GCM.
 *
 * 고객이 위임한 채널 계정 비밀번호를 DB(care_onboarding)에 저장하기 전 암호화한다.
 * 키는 환경변수 CARE_CREDENTIALS_KEY (base64 인코딩 32바이트). Supabase 키와 분리해
 * DB 유출 단독으로는 복호화가 불가능하게 한다.
 *
 * 서버 전용 모듈 — 클라이언트 번들에 포함하지 말 것 (node:crypto).
 * 저장 포맷: base64(iv 12B) + '.' + base64(authTag 16B) + '.' + base64(ciphertext)
 *
 * ★ 키 순환 (2026-08-03 추가, 마이그 060).
 *   예전엔 암호문에 키 버전이 없어 `CARE_CREDENTIALS_KEY` 를 바꾸는 순간 기존
 *   자격증명 전량이 복호화 불가가 됐다. 키 유출처럼 **즉시** 갈아야 하는 상황에서
 *   "먼저 재암호화 스크립트를 돌리세요" 는 답이 아니다.
 *
 *   이제 어느 키로 잠갔는지를 `care_onboarding.key_version` 에 남긴다.
 *     · v1 = `CARE_CREDENTIALS_KEY`  (기존 행은 전부 v1)
 *     · vN = `CARE_CREDENTIALS_KEY_V{N}` (N ≥ 2)
 *   암호화는 **설정된 것 중 가장 높은 버전**으로, 복호화는 **행에 적힌 버전**으로 한다.
 *   따라서 새 키를 추가하고 구키를 남겨 두면 무중단으로 갈아탈 수 있고, 남은 구키
 *   암호문을 다 옮긴 뒤 구키를 지우면 순환이 끝난다.
 *
 *   ⚠️ key_version 컬럼이 아직 없는 환경(마이그 미적용)에서는 호출부가 버전을 안 넘기고,
 *      그러면 v1 로 동작한다 — 기존과 완전히 같다.
 *   Preview/Production 은 반드시 같은 키 세트를 써야 한다(같은 DB를 읽으므로).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32

/** 기본(최초) 키 버전 — 기존에 저장된 모든 암호문이 이 버전이다. */
export const LEGACY_KEY_VERSION = 1
/** 키 버전 상한 — 오타로 터무니없는 버전이 들어오는 것을 막는다. */
const MAX_KEY_VERSION = 99

function envNameFor(version: number): string {
  return version === LEGACY_KEY_VERSION
    ? 'CARE_CREDENTIALS_KEY'
    : `CARE_CREDENTIALS_KEY_V${version}`
}

function loadKey(
  env: NodeJS.ProcessEnv = process.env,
  version: number = LEGACY_KEY_VERSION,
): Buffer {
  const name = envNameFor(version)
  const raw = env[name]
  if (!raw) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다`)
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${name} 는 base64 인코딩된 32바이트여야 합니다`)
  }
  return key
}

/**
 * 지금 새로 암호화할 때 쓸 키 버전 — 설정된 것 중 **가장 높은** 버전.
 *
 * 구키를 지우지 않고 새 키를 추가하는 것만으로 순환이 시작되게 하려는 것이다.
 */
export function currentKeyVersion(env: NodeJS.ProcessEnv = process.env): number {
  let best = 0
  for (let v = MAX_KEY_VERSION; v >= LEGACY_KEY_VERSION; v -= 1) {
    if (env[envNameFor(v)]) {
      best = v
      break
    }
  }
  return best || LEGACY_KEY_VERSION
}

/** 환경변수 키 존재·형식 검사 (라우트에서 사전 확인용) */
export function isCredentialKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    loadKey(env, currentKeyVersion(env))
    return true
  } catch {
    return false
  }
}

export interface EncryptedCredential {
  readonly value: string
  readonly keyVersion: number
}

/**
 * 암호화 + 사용한 키 버전을 함께 돌려준다.
 *
 * 호출부는 `keyVersion` 을 `care_onboarding.key_version` 에 같이 저장해야 한다.
 * (컬럼이 아직 없으면 저장을 생략해도 되며, 그 경우 v1 로 읽힌다.)
 */
export function encryptCredentialVersioned(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedCredential {
  const keyVersion = currentKeyVersion(env)
  return { value: encryptCredential(plaintext, env, keyVersion), keyVersion }
}

export function encryptCredential(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
  version: number = currentKeyVersion(env),
): string {
  if (!plaintext) throw new Error('암호화할 값이 비어 있습니다')
  const key = loadKey(env, version)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`
}

export function decryptCredential(
  stored: string,
  env: NodeJS.ProcessEnv = process.env,
  version: number = LEGACY_KEY_VERSION,
): string {
  const key = loadKey(env, version)
  const parts = stored.split('.')
  if (parts.length !== 3) throw new Error('저장된 암호문 형식이 올바르지 않습니다')
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  if (iv.length !== IV_LENGTH) throw new Error('저장된 암호문 형식이 올바르지 않습니다')
  // GCM 은 짧은 인증 태그도 허용할 수 있어 태그 길이를 규정대로 강제한다(인증 강도 약화 방지)
  if (tag.length !== TAG_LENGTH) throw new Error('저장된 암호문 형식이 올바르지 않습니다')
  if (data.length === 0) throw new Error('저장된 암호문 형식이 올바르지 않습니다')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  return plaintext.toString('utf8')
}
