import type { JsonLdData } from './schemas'

interface JsonLdProps {
  data: JsonLdData
}

/**
 * JSON-LD 구조화 데이터 script 태그.
 * XSS 방지: JSON.stringify 후 `<` 를 유니코드 이스케이프하여 </script> 주입 차단.
 */
export default function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
