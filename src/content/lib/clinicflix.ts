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

/** 사진 보관함 1건 (외관/내부/장비/의료진/기타). 서비스 brand.photos[] 로 전달. */
export interface ClinicflixBrandPhoto {
  category: string
  url: string
  consent: boolean
  note?: string | null
  width?: number
  height?: number
}

export interface ClinicflixBrand {
  hospital_name: string
  logo_url?: string | null
  brand_color?: string
  fixed_hashtags?: string[]
  voice_gender?: string
  threads_tone?: string
  cardnews_style?: number
  doctor_photo_url?: string | null
  doctor_video_url?: string | null
  // AI 가상 진행자: 병원당 저장된 동일 인물 이미지 URL(들). 영상 진행자 컷에 재사용 → 얼굴 일관성.
  virtual_presenter_urls?: string[]
  photos?: ClinicflixBrandPhoto[]
}

/** 가상 진행자 후보 이미지 생성 요청 (프리셋 + 자유설명). */
export interface ClinicflixPresenterRequest {
  gender?: string
  age?: string | null
  vibe?: string | null
  attire?: string | null
  extra?: string | null
  count?: number
}

export interface ClinicflixPresenterResponse {
  presenter_urls: string[]
  prompt: string
}

export interface ClinicflixConvertRequest {
  conversion_id: string
  blog_text: string
  brand: ClinicflixBrand
  channels?: string[]
  concept?: string
  mode?: string
  // 키워드 진입(#2): 블로그 없이 키워드만으로 생성할 때 서비스(ConvertIn.keyword)로 전달.
  // mode==='keyword' 일 때만 서비스가 사용한다.
  keyword?: string
  options?: { video_engine?: string }
  callback_url?: string
  // 쇼츠 제작법: 'v1'(컷 기반) | 'v2'(사건→궁금증 시퀀스+네이티브 대사, 2026-07-04 기본)
  recipe?: 'v1' | 'v2'
  // 병원 전속 AI 캐릭터 (선택): 프리셋 id — 미전송 시 서비스 기존 동작 완전 불변(하위 호환).
  // face_url = /character-face 로 1회 생성·고정한 전용 얼굴(있으면 진행자 ref2v 레퍼런스로 재사용).
  // 프리셋 목록 단일 소스 = clinicflix_pipeline/clinicflix/characters.py
  character?: { preset_id: string; face_url?: string }
  // 시리즈 연속성: 같은 병원의 최근 에피소드 주제(최대 3). 캐릭터 선택 시에만 전송.
  series_context?: string[]
}

export interface ClinicflixConvertResponse {
  job_id: string
  status: ClinicflixJobStatus
  tier?: string
}

export interface ClinicflixJobPlan {
  channels?: string[]
  shorts?: unknown
  // v2 제작법 시퀀스 대본 (recipe='v2'면 shorts 대신 채워짐)
  shorts_v2?: unknown
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
  // v2: sequences[i].dialogue 는 그 시퀀스의 대사들을 순서대로 담은 평탄 배열
  shorts_v2?: { sequences?: { caption?: string; narration?: string; dialogue?: string[] }[] }
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
// 이미지 동기 생성 엔드포인트(/character-face 등)는 생성 완료까지 응답을 기다린다 — 여유 상향
const IMAGE_SYNC_TIMEOUT_MS = 55_000

async function callClinicflix<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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

/** 가상 진행자 후보 이미지 생성 (서비스 /presenter). 확정·영구저장은 호출부(API 라우트) 책임. */
export async function clinicflixGeneratePresenter(
  body: ClinicflixPresenterRequest,
): Promise<ClinicflixPresenterResponse> {
  return callClinicflix<ClinicflixPresenterResponse>(
    '/presenter',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    IMAGE_SYNC_TIMEOUT_MS,
  )
}

export interface ClinicflixCharacterFaceResponse {
  preset_id: string
  face_url: string
  cost_krw?: number
}

/**
 * 전속 캐릭터 전용 얼굴 1장 생성 (서비스 /character-face). 병원당 1회 — 이후 모든
 * 영상의 진행자 레퍼런스로 고정된다. 영구저장(profiles jsonb)은 호출부(API 라우트) 책임.
 */
export async function clinicflixCharacterFace(
  presetId: string,
): Promise<ClinicflixCharacterFaceResponse> {
  return callClinicflix<ClinicflixCharacterFaceResponse>(
    '/character-face',
    {
      method: 'POST',
      body: JSON.stringify({ preset_id: presetId }),
    },
    IMAGE_SYNC_TIMEOUT_MS,
  )
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
