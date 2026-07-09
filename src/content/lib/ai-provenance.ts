/**
 * AI 생성 이미지의 "기계 판독 가능한 출처(provenance) 메타데이터" 정의.
 *
 * 대표 결정(2026-07-09): 다운로드 PNG에 박던 "AI 이미지" 시각 라벨을 제거하고,
 * 대신 AI기본법 표시의무를 "기계 판독 방법"으로 충족한다.
 * 여기서는 PNG 텍스트 청크(tEXt/iTXt)에 넣을 엔트리와 XMP 패킷을 생성한다.
 *
 * TODO(C2PA): 서명된 C2PA 매니페스트(Content Credentials)까지 삽입하려면
 * 외부 서명 인프라(인증서/서명 키·c2pa 라이브러리)가 필요하다 — 이번 범위 밖.
 * 현재는 서명 없는 PNG 텍스트 청크 + XMP(DigitalSourceType)로 견고하게 표시한다.
 */

import type { PngTextEntry } from './png-metadata';

export const AI_PROVENANCE = {
  generatedBy: '닥터포스트',
  tool: 'hospitalblog.kr',
  model: 'gpt-image-2',
  note: 'AI-generated image; disclosed per AI Basic Act (KR)',
} as const;

/** IPTC DigitalSourceType — 순수 생성형 AI 미디어를 뜻하는 표준 코드. */
const IPTC_DIGITAL_SOURCE_TYPE =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

interface Provenance {
  readonly generatedBy: string;
  readonly tool: string;
  readonly model: string;
  readonly createdAt: string;
  readonly note: string;
}

/** XML 특수문자를 이스케이프한다(제어 상수뿐이지만 방어적으로 처리). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** DigitalSourceType 을 담은 최소 XMP 패킷을 생성한다. */
function buildXmp(p: Provenance): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmp:CreatorTool="${escapeXml(`${p.generatedBy} (${p.tool})`)}"
    xmp:CreateDate="${escapeXml(p.createdAt)}"
    Iptc4xmpExt:DigitalSourceType="${IPTC_DIGITAL_SOURCE_TYPE}">
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${escapeXml(p.note)}</rdf:li>
    </rdf:Alt>
   </dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * AI 출처 표시를 위한 PNG 텍스트 엔트리 목록을 만든다.
 * @param createdAt ISO 8601 생성 시각(기본: 현재 시각)
 */
export function buildProvenanceEntries(createdAt: string = new Date().toISOString()): PngTextEntry[] {
  const provenance: Provenance = {
    generatedBy: AI_PROVENANCE.generatedBy,
    tool: AI_PROVENANCE.tool,
    model: AI_PROVENANCE.model,
    createdAt,
    note: AI_PROVENANCE.note,
  };

  return [
    { keyword: 'Generator', text: '닥터포스트 (hospitalblog.kr) — AI 생성 이미지' },
    { keyword: 'AI-Generated', text: 'true' },
    { keyword: 'Model', text: AI_PROVENANCE.model },
    { keyword: 'Provenance', text: JSON.stringify(provenance) },
    // PNG 스펙 표준 XMP 키워드
    { keyword: 'XML:com.adobe.xmp', text: buildXmp(provenance) },
  ];
}
