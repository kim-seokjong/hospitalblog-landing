import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.');
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY는 64자리 hex 문자열(32바이트)이어야 합니다.');
  return buf;
}

export interface EncryptedData {
  enc: string;   // base64 암호화 데이터
  iv: string;    // base64 초기화 벡터
  tag: string;   // base64 인증 태그
}

export function encrypt(plaintext: string): EncryptedData {
  const iv = randomBytes(12); // GCM 권장 12바이트
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(data: EncryptedData): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(data.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return decipher.update(Buffer.from(data.enc, 'base64'), undefined, 'utf8') + decipher.final('utf8');
}
