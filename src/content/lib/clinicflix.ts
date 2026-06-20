// ClinicFlix 생성 서비스(Python FastAPI) 서버사이드 클라이언트.
// 블로그 1편 → 멀티채널(쇼츠·카드뉴스·스토리·쓰레드·피드) "생성"만 담당한다(자동 발행 아님).
//
// ⚠️ 서버 전용. 절대 클라이언트 번들에 포함하지 말 것 (CLINICFLIX_SERVICE_URL 은 NEXT_PUBLIC_ 아님).

export const CLINICFLIX_CHANNELS = ['shorts', 'cardnews', 'threads', 'feed', 'story'] as const
export type ClinicflixChannel = (typeof CLINICFLIX_CHANNELS)[number]

export type ClinicflixJobStatus =
  | 'planning'
  | 'planned'
  | 'rendering'
  | 'review'
  | 'failed'

export interface ClinicflixBrand {
  hospital_name: string
  logo_url?: string | null
  brand_color?: string
  doctor_photo_url?: string | null
  doctor_video_url?: string | null
  photos?: string[]
}

export interface ClinicflixConvertRequest {
  conversion_id: string
  blog_text: string
  brand: ClinicflixBrand
  channels?: string[]
  concept?: string
  mode?: string
  options?: { video_engine?: string }
  callback_url?: string
}

export interface ClinicflixConvertResponse {
  job_id: string
  status: ClinicflixJobStatus
  tier?: string
}

export interface ClinicflixJobPlan {
  channels?: string[]
  shorts?: unknown
  cardnews?: unknown
  threads?: unknown
  feed?: unknown
  story?: unknown
}

export interface ClinicflixJobAssets {
  cardnews_image_urls?: string[]
  story_image_urls?: string[]
  shorts_video_path?: string | null
}

/**
 * 승인 시 함께 보내는 채널별 텍스트 수정안 (모두 선택적).
 * 인덱스 정렬: scenes[i]/slides[i]/frames[i] 는 원본 기획 순서에 매핑된다.
 * 비우거나 생략하면 원본을 유지한다.
 */
export interface ClinicflixPlanEdits {
  shorts?: { scenes?: { narration?: string; caption?: string }[] }
  cardnews?: { slides?: { headline?: string; body?: string }[]; caption?: string }
  threads?: { posts?: string[] }
  feed?: { caption?: string }
  story?: { frames?: { text?: string }[] }
}

export interface ClinicflixJob {
  job_id: string
  conversion_id: string
  status: ClinicflixJobStatus
  tier?: string
  error?: string | null
  cost_krw?: number | null
  plan?: ClinicflixJobPlan
  assets?: ClinicflixJobAssets
}

/** ClinicFlix 가 일시적으로 응답하지 않을 때 던지는 에러 (5xx / 네트워크). 한국어 메시지 동봉. */
export class ClinicflixUnavailableError extends Error {
  constructor(message = '멀티채널 생성 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.') {
    super(message)
    this.name = 'ClinicflixUnavailableError'
  }
}

function baseUrl(): string {
  let url = process.env.CLINICFLIX_SERVICE_URL?.trim()
  if (!url) {
    throw new ClinicflixUnavailableError(
      '멀티채널 생성 서비스가 설정되지 않았습니다. 관리자에게 문의해 주세요.',
    )
  }
  // 스킴 누락 방어: env 값에 http(s):// 가 없으면 https:// 를 자동 보정 (가장 흔한 설정 실수)
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return url.replace(/\/+$/, '')
}

// 콜드스타트/네트워크 지연 여유 (변환은 큐만 걸고 즉시 반환하지만, 깨어나는 데 시간이 걸릴 수 있음)
const DEFAULT_TIMEOUT_MS = 30_000

async function callClinicflix<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (e) {
    // 네트워크 단절 / 타임아웃 / Railway 다운 → 일관된 한국어 에러
    throw new ClinicflixUnavailableError()
  } finally {
    clearTimeout(timer)
  }

  if (res.status >= 500) {
    throw new ClinicflixUnavailableError()
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    const msg =
      (json && typeof json === 'object' && 'error' in json && typeof (json as { error: unknown }).error === 'string'
        ? (json as { error: string }).error
        : null) ?? `멀티채널 생성 요청이 거부되었습니다 (코드 ${res.status})`
    throw new Error(msg)
  }

  return json as T
}

export async function clinicflixConvert(
  body: ClinicflixConvertRequest,
): Promise<ClinicflixConvertResponse> {
  return callClinicflix<ClinicflixConvertResponse>('/convert', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function clinicflixGetJob(jobId: string): Promise<ClinicflixJob> {
  return callClinicflix<ClinicflixJob>(`/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
  })
}

export async function clinicflixApprove(
  jobId: string,
  edits?: ClinicflixPlanEdits,
): Promise<{ ok: boolean }> {
  // edits 가 없거나 빈 객체면 {} 를 보낸다(기존 동작 유지). 있으면 { edits } 로 전달.
  const hasEdits = edits != null && Object.keys(edits).length > 0
  await callClinicflix<unknown>(`/jobs/${encodeURIComponent(jobId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(hasEdits ? { edits } : {}),
  })
  return { ok: true }
}
