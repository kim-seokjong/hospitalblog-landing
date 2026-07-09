/**
 * PNG 바이트에 텍스트 메타데이터 청크(tEXt/iTXt)를 삽입하는 순수 유틸.
 *
 * 브라우저에서 동작하며 외부 의존성 없음 — Uint8Array/DataView + 자체 CRC32만 사용.
 * 캔버스 `toDataURL('image/png')`은 텍스트 청크를 보존하지 않으므로,
 * 인코딩이 끝난 PNG 바이트를 직접 파싱해 IHDR 청크 뒤에 텍스트 청크를 끼워 넣는다.
 *
 * 순수 함수만 노출한다(DOM/base64 변환은 호출측 책임).
 */

/** PNG 파일 시그니처 (137 P N G \r \n 0x1A \n) */
export const PNG_SIGNATURE: readonly number[] = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngTextEntry {
  /** 1~79바이트 Latin-1 키워드 (PNG 스펙 제약) */
  readonly keyword: string;
  /** 값 — Latin-1이면 tEXt, 아니면 iTXt(UTF-8)로 저장 */
  readonly text: string;
}

// CRC32 (IEEE 802.3) 룩업 테이블 — PNG 청크 CRC는 type+data 바이트에 대해 계산.
const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** 주어진 바이트열의 CRC32(부호 없는 32비트)를 반환한다. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isLatin1(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xff) return false;
  }
  return true;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** [length][type][data][crc] 형식의 완결된 PNG 청크 바이트를 만든다. */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = latin1Bytes(type);
  if (typeBytes.length !== 4) throw new Error(`잘못된 청크 타입: ${type}`);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return chunk;
}

/** tEXt 청크: keyword \0 text (둘 다 Latin-1) */
function buildTEXt(keyword: string, text: string): Uint8Array {
  const kw = latin1Bytes(keyword);
  const tx = latin1Bytes(text);
  const data = new Uint8Array(kw.length + 1 + tx.length);
  data.set(kw, 0);
  data[kw.length] = 0;
  data.set(tx, kw.length + 1);
  return buildChunk('tEXt', data);
}

/** iTXt 청크: keyword \0 compFlag compMethod langTag \0 transKeyword \0 text(UTF-8) */
function buildITXt(keyword: string, text: string): Uint8Array {
  const kw = latin1Bytes(keyword);
  const tx = utf8Bytes(text);
  // 언어 태그 / 번역 키워드는 비워 둔다(각각 뒤에 널 종료).
  const data = new Uint8Array(kw.length + 1 + 1 + 1 + 1 + 1 + tx.length);
  let o = 0;
  data.set(kw, o);
  o += kw.length;
  data[o++] = 0; // keyword 널 종료
  data[o++] = 0; // 압축 플래그 (0 = 비압축)
  data[o++] = 0; // 압축 방식 (0)
  data[o++] = 0; // 언어 태그(빈 값) 널 종료
  data[o++] = 0; // 번역 키워드(빈 값) 널 종료
  data.set(tx, o);
  return buildChunk('iTXt', data);
}

/** 단일 텍스트 엔트리를 적절한 청크(tEXt/iTXt)로 직렬화한다. */
export function buildTextChunk(entry: PngTextEntry): Uint8Array {
  const kwBytes = latin1Bytes(entry.keyword);
  if (!isLatin1(entry.keyword) || kwBytes.length < 1 || kwBytes.length > 79) {
    throw new Error(`잘못된 PNG 텍스트 키워드: ${entry.keyword}`);
  }
  return isLatin1(entry.text)
    ? buildTEXt(entry.keyword, entry.text)
    : buildITXt(entry.keyword, entry.text);
}

/** 바이트열이 PNG 시그니처로 시작하는지 검사한다. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * PNG 바이트의 IHDR 청크 바로 뒤에 텍스트 청크들을 삽입한 새 Uint8Array를 반환한다.
 * 입력은 변경하지 않는다(불변). 유효하지 않은 PNG면 예외를 던진다.
 */
export function insertTextChunks(png: Uint8Array, entries: readonly PngTextEntry[]): Uint8Array {
  if (!isPng(png)) throw new Error('유효한 PNG 바이트가 아닙니다.');
  if (entries.length === 0) return png;

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // 첫 청크(IHDR)는 시그니처(8바이트) 뒤에 위치. 전체 크기 = length(4)+type(4)+data+crc(4).
  const ihdrDataLength = view.getUint32(8, false);
  const insertAt = 8 + 4 + 4 + ihdrDataLength + 4;
  if (insertAt > png.length) throw new Error('PNG IHDR 청크가 손상되었습니다.');

  const chunks = entries.map(buildTextChunk);
  const extraLength = chunks.reduce((sum, c) => sum + c.length, 0);

  const out = new Uint8Array(png.length + extraLength);
  out.set(png.subarray(0, insertAt), 0);
  let offset = insertAt;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(png.subarray(insertAt), offset);
  return out;
}
