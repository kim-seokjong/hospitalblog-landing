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
    // v2 제작법 시퀀스 대본 (recipe='v2'면 shorts 대신 채워짐)
    shorts_v2?: unknown
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
  // v2: sequences[i].dialogue 는 그 시퀀스의 대사들을 순서대로 담은 평탄 배열
  shorts_v2?: { sequences?: { caption?: string; narration?: string; dialogue?: string[] }[] }
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

/**
 * 변환 시작. 블로그 전용 플랜이면 UpgradeRequiredError 를 던진다(403).
 * keyword: 키워드 진입(#2)일 때 함께 전달. blog_text 와 별개로 서비스 키워드 생성에 사용된다.
 * sourcePostId: 블로그 글 진입(#1)일 때 원본 saved_posts.id — 변환 이력에 원본 연결(마이그 038).
 */
export async function startConvert(
  blogText: string,
  channels?: string[],
  keyword?: string,
  sourcePostId?: string | null,
): Promise<ConvertResult> {
  const trimmedKeyword = keyword?.trim()
  const trimmedSourcePostId = sourcePostId?.trim()
  const res = await fetch('/api/clinicflix/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blog_text: blogText,
      ...(channels ? { channels } : {}),
      ...(trimmedKeyword ? { keyword: trimmedKeyword } : {}),
      ...(trimmedSourcePostId ? { source_post_id: trimmedSourcePostId } : {}),
    }),
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

/** 생성 완료 결과를 영구 보관함에 저장(서버가 Storage 복사). 실패해도 throw 하지 않는다(best-effort). */
export async function saveConversion(jobId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/clinicflix/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    })
    return res.ok
  } catch {
    return false
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
