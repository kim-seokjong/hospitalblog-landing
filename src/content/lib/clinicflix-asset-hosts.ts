// ClinicFlix 결과물(영상/이미지) 서버 fetch 허용 호스트 판정 — SSRF 방지 공용 헬퍼.
// `.up.railway.app` 와일드카드는 남의 Railway 앱까지 통과시키므로 사용하지 않는다.
// Railway 는 CLINICFLIX_SERVICE_URL env 에 설정된 그 호스트만 허용한다(미설정 시 Railway 불허).

const ALLOWED_HOST_SUFFIXES = ['.fal.media', '.supabase.co'] as const
const ALLOWED_EXACT_HOSTS = ['fal.media'] as const

/** CLINICFLIX_SERVICE_URL env 에서 호스트명을 파싱한다. 미설정/파싱 실패 시 null. */
function clinicflixServiceHost(): string | null {
  const raw = process.env.CLINICFLIX_SERVICE_URL?.trim()
  if (!raw) return null
  try {
    // clinicflix.ts baseUrl() 과 동일한 스킴 누락 방어
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withScheme).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** https 이면서 신뢰 호스트(fal.media CDN / Supabase Storage / ClinicFlix 서비스 호스트)인 URL 만 true. */
export function isAllowedClinicflixAssetUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false

  const hostname = parsed.hostname.toLowerCase()
  if (ALLOWED_EXACT_HOSTS.some((h) => hostname === h)) return true
  if (ALLOWED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) return true

  const serviceHost = clinicflixServiceHost()
  return serviceHost !== null && hostname === serviceHost
}
