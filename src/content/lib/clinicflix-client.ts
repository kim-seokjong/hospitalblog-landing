// ClinicFlix 멀티채널 변환 — 클라이언트 폴링 헬퍼 (브라우저 전용).
// 서버 프록시 라우트(/api/clinicflix/*)만 호출한다. ClinicFlix 를 직접 부르지 않는다.

export type ClinicflixJobStatus = 'planning' | 'planned' | 'rendering' | 'review' | 'failed'

export interface ClinicflixJobView {
  job_id: string
  conversion_id: string
  status: ClinicflixJobStatus
  tier: string | null
  error: string | null
  cost_krw: number | null
  plan: {
    channels?: string[]
    shorts?: unknown
    cardnews?: unknown
    threads?: unknown
    feed?: unknown
    story?: unknown
  } | null
  assets: {
    cardnews_image_urls?: string[]
    story_image_urls?: string[]
    shorts_video_path?: string | null
  } | null
}

export interface ConvertResult {
  job_id: string
  conversion_id: string
  status: ClinicflixJobStatus
}

/**
 * 승인 시 함께 보내는 채널별 텍스트 수정안 (모두 선택적).
 * 인덱스 정렬: scenes[i]/slides[i]/frames[i] 는 원본 기획 순서에 매핑된다.
 * 서버 전용 clinicflix.ts 의 ClinicflixPlanEdits 와 동일한 형태(브라우저 번들 분리 위해 재선언).
 */
export interface PlanEdits {
  shorts?: { scenes?: { narration?: string; caption?: string }[] }
  cardnews?: { slides?: { headline?: string; body?: string }[]; caption?: string }
  threads?: { posts?: string[] }
  feed?: { caption?: string }
  story?: { frames?: { text?: string }[] }
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    return data?.message || data?.error || `요청 실패 (코드 ${res.status})`
  } catch {
    return `요청 실패 (코드 ${res.status})`
  }
}

export class UpgradeRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpgradeRequiredError'
  }
}

/** 변환 시작. 블로그 전용 플랜이면 UpgradeRequiredError 를 던진다(403). */
export async function startConvert(blogText: string, channels?: string[]): Promise<ConvertResult> {
  const res = await fetch('/api/clinicflix/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blog_text: blogText, ...(channels ? { channels } : {}) }),
  })
  if (res.status === 403) {
    throw new UpgradeRequiredError(await parseError(res))
  }
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function fetchJob(jobId: string): Promise<ClinicflixJobView> {
  const res = await fetch(`/api/clinicflix/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

/** 승인하고 렌더 시작. edits 가 있으면 채널별 수정안을 함께 전달한다(없으면 기존처럼 {}). */
export async function approveJob(jobId: string, edits?: PlanEdits): Promise<void> {
  const hasEdits = edits != null && Object.keys(edits).length > 0
  const res = await fetch(`/api/clinicflix/jobs/${encodeURIComponent(jobId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hasEdits ? { edits } : {}),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
}

export interface PollOptions {
  intervalMs?: number
  maxAttempts?: number
  signal?: AbortSignal
}

/**
 * 지정한 목표 상태들 중 하나(또는 failed)에 도달할 때까지 폴링한다.
 * onTick 으로 매 폴링 결과를 통지한다.
 */
export async function pollUntil(
  jobId: string,
  targets: ClinicflixJobStatus[],
  onTick: (job: ClinicflixJobView) => void,
  opts: PollOptions = {},
): Promise<ClinicflixJobView> {
  const interval = opts.intervalMs ?? 3000
  const maxAttempts = opts.maxAttempts ?? 200 // ~10분
  let attempt = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) {
      throw new DOMException('취소되었습니다', 'AbortError')
    }
    const job = await fetchJob(jobId)
    onTick(job)
    if (job.status === 'failed' || targets.includes(job.status)) {
      return job
    }
    attempt += 1
    if (attempt >= maxAttempts) {
      throw new Error('시간이 초과되었습니다. 잠시 후 다시 확인해 주세요.')
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}
