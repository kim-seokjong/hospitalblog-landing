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
 * ⚠️ 운영 제약: 암호문에 키 버전이 없다 — CARE_CREDENTIALS_KEY 를 바꾸면 기존에
 * 저장된 자격증명은 전부 복호화 불가가 된다(고객 재제출 필요). 키를 교체할 일이
 * 생기면 먼저 기존 행을 복호화→새 키로 재암호화하는 일회성 스크립트를 돌릴 것.
 * Preview/Production 환경은 반드시 같은 키를 써야 한다(같은 DB를 읽으므로).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32

function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.CARE_CREDENTIALS_KEY
  if (!raw) {
    throw new Error('CARE_CREDENTIALS_KEY 환경변수가 설정되지 않았습니다')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error('CARE_CREDENTIALS_KEY 는 base64 인코딩된 32바이트여야 합니다')
  }
  return key
}

/** 환경변수 키 존재·형식 검사 (라우트에서 사전 확인용) */
export function isCredentialKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    loadKey(env)
    return true
  } catch {
    return false
  }
}

export function encryptCredential(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!plaintext) throw new Error('암호화할 값이 비어 있습니다')
  const key = loadKey(env)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`
}

export function decryptCredential(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = loadKey(env)
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
