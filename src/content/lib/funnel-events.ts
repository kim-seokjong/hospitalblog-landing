/**
 * 자체 퍼널 이벤트 — 순수 로직 모듈 (외부 의존 없음, node:test 로 직접 검증 가능).
 *
 * 획득 퍼널(방문→가입→활성화→유료) 병목을 우리가 직접 소유·쿼리하기 위한 계측.
 * Meta 픽셀(광고 최적화용)과 **병행**한다 — 중복이 아니라 목적이 다르다.
 *
 * 이 모듈은 검증만 담당한다(순수 함수):
 *  - 이벤트명 화이트리스트 (남용·오염 방지 — 임의 이벤트 적재 차단)
 *  - anon_id 형식 검증/생성 (쿠키 기반 익명 식별자)
 *  - meta(jsonb) 크기·형태 새니타이즈 (거대 payload·중첩 폭탄 방어)
 *  - 인메모리 레이트리밋 판정 (공개 엔드포인트 남용 방어, blog-check-limits 패턴)
 *
 * DB 적재(service role insert)와 쿠키 I/O 는 호출부(라우트)가 담당한다.
 */

/**
 * 적재를 허용하는 퍼널 이벤트 종류 (화이트리스트 — 이 외 이벤트는 거부).
 * **배열 순서 = 퍼널 단계 순서** (/admin 퍼널 카드가 이 순서대로 표시한다).
 *
 * diagnosis_* 4종은 랜딩 첫 화면을 "병원명 무료진단"으로 교체(2026-07-27)하면서 추가했다.
 * 그 전에는 landing_view 만 쌓여 방문자가 어디서 이탈하는지 알 수 없었다:
 *   진단 입력 시작 → 제출 → 진단 실행 도달 → 결과 도달 을 각각 끊어 봐야
 *   "입력조차 안 한다 / 이동에서 샌다 / 진단이 실패한다" 를 구분할 수 있다.
 *
 * ⚠️ funnel_events.event 는 자유 텍스트 컬럼이라 DB 제약 변경은 필요 없다
 *    (마이그 046 의 테이블 코멘트에 적힌 이벤트 목록은 설명용이며 강제력이 없다).
 */
export const FUNNEL_EVENTS = [
  'landing_view',
  'diagnosis_input_start',
  'diagnosis_submit',
  'diagnosis_run',
  'diagnosis_report_view',
  // 결과 화면의 전환 동선 (2026-07-27). **1순위 지표는 이메일 확보율**이라
  // 분모(diagnosis_report_view)와 분자(diagnosis_email_submitted)를 붙여서 본다.
  // diagnosis_email_submitted 는 서버가 발송·적재에 성공했을 때만 기록한다(위조 불가).
  'diagnosis_email_submitted',
  'diagnosis_cta_click',
  // 요금제 페이지 도달 (2026-07-29 추가). 랜딩~가입 사이가 통째로 비어 있어서
  // "요금을 보러 가지도 않는다"와 "요금을 보고 나간다"를 구분할 수 없었다.
  // 가입 시작 **직전** 단계로 둔다 — /admin 퍼널 카드가 이 순서대로 표시한다.
  'pricing_view',
  'signup_start',
  'signup_complete',
  'first_post_generated',
  'payment_success',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/**
 * 공개 엔드포인트(/api/funnel-event)에서 허용하는 이벤트 = **저신뢰 의도 이벤트만**.
 *
 * signup_complete·first_post_generated·payment_success 같은 "서버 확정 전환 이벤트"는
 * 익명 클라이언트가 위조하면 지표가 오염되므로 공개 엔드포인트에서 받지 않는다.
 * 이 전환 이벤트들은 각각 서버 라우트(register·generate-content·billing confirm)에서
 * service-role 로만 기록한다(recordFunnelEvent). 여기(공개)는 방문/진단/가입시도 의도만 받는다.
 *
 * diagnosis_* 는 비회원이 브라우저에서 일으키는 저신뢰 의도 이벤트이므로 공개 허용이다
 * (위조되어도 "진단 퍼널이 부풀 뿐" 가입·결제 전환 지표를 오염시키지 않는다).
 */
export const PUBLIC_FUNNEL_EVENTS = [
  'landing_view',
  'diagnosis_input_start',
  'diagnosis_submit',
  'diagnosis_run',
  'diagnosis_report_view',
  // 결과 하단 전환 버튼 클릭 = 의도 이벤트 → 공개 허용.
  // diagnosis_email_submitted 는 여기 없다: 실제 발송·적재 성공을 서버만 알 수 있고,
  // 이메일 확보율이 이 개편의 핵심 지표라 위조된 분자를 받아서는 안 된다.
  'diagnosis_cta_click',
  // 요금제 페이지 도달 = 비회원이 브라우저에서 일으키는 **저신뢰 의도 이벤트**라
  // landing_view 와 같은 등급으로 공개 허용한다. 위조되어도 요금 조회 수가 부풀 뿐
  // 가입·결제 전환 지표(서버 전용 이벤트)는 오염되지 않는다.
  'pricing_view',
  'signup_start',
] as const;

export type PublicFunnelEvent = (typeof PUBLIC_FUNNEL_EVENTS)[number];

/** 이벤트명이 전체 화이트리스트에 속하는지 (서버 기록용, 타입 가드). */
export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

/** 이벤트명이 공개 엔드포인트 허용 목록에 속하는지 (타입 가드). */
export function isPublicFunnelEvent(value: unknown): value is PublicFunnelEvent {
  return typeof value === 'string' && (PUBLIC_FUNNEL_EVENTS as readonly string[]).includes(value);
}

/**
 * ⚠️ **anon_id 고유 수 = 방문자 수가 아니다.** 쿠키를 저장하지 않는 클라이언트(크롤러·
 * 메일 링크스캐너)는 매 요청마다 새 anon_id 를 받아간다. 실제로 2026-07-29 이전
 * funnel_events 는 이 때문에 오염돼 있다 — 7일 고유 anon_id 49개 중 사람은 사실상 1명,
 * 42개는 이벤트 1건짜리였다. **7월 방문자·유입 수치를 그대로 믿지 마라.**
 * 2026-07-29부터 라우트가 봇 UA 를 앞단에서 거른다(src/content/lib/bot-user-agent.ts).
 * 과거 데이터 소급 정리는 하지 않았다.
 */

/** anon_id 쿠키 이름 — 브라우저·서버 공통 상수. */
export const ANON_ID_COOKIE = 'dp_anon_id';
/** anon_id 쿠키 수명 (초) — 1년. */
export const ANON_ID_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/**
 * anon_id 형식 검증 — 32자리 소문자 hex (crypto.randomUUID 파생 또는 자체 생성).
 * 위조/오염된 쿠키 값을 그대로 DB에 적재하지 않도록 엄격 검증한다.
 */
export function isValidAnonId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/**
 * 이 요청에 쓸 anon_id 를 정한다 — **클라 제공값 > 쿠키 > 새로 발급**.
 *
 * ★ 왜 클라가 우선인가 (2026-08-04, 교차검증으로 순서를 뒤집음).
 *   처음엔 쿠키를 우선했다. httpOnly 라 위조가 어려워 더 믿을 만하다고 봤기 때문이다.
 *   그런데 그러면 **기존 방문자의 쿠키와 새로 생긴 localStorage 가 영구히 어긋난다** —
 *   평소엔 쿠키로 기록되다가 쿠키가 지워지는 순간 localStorage 값이 살아나 같은 사람이
 *   다른 방문자로 바뀐다. 클라를 우선하면 쿠키가 항상 클라 값을 따라가 **한 번 수렴한 뒤
 *   다시는 갈리지 않는다.** 배포 직후 기존 방문자 한 번만 ID 가 바뀌는데, 이건 익명
 *   지표 식별자라 감수할 만하다.
 *
 * ⚠️ 위조 가능성은 안다. 다만 이 값으로 할 수 있는 일은 **방문자 지표를 섞는 것뿐**이고,
 *    그건 쿠키를 지우는 것만으로도 이미 가능했다. 전환 확정 이벤트·인증·DB 권한은
 *    이 값과 무관하며, 레이트리밋도 IP·전체 기준이라 영향받지 않는다.
 */
export function resolveAnonId(
  cookieValue: unknown,
  providedValue: unknown,
  generate: () => string,
): { anonId: string; source: 'client' | 'cookie' | 'generated' } {
  if (isValidAnonId(providedValue)) return { anonId: providedValue, source: 'client' };
  if (isValidAnonId(cookieValue)) return { anonId: cookieValue, source: 'cookie' };
  return { anonId: generate(), source: 'generated' };
}

/** 브라우저 저장소 최소 인터페이스 — 테스트에서 갈아끼우기 위해 좁게 잡는다. */
export interface AnonIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 로컬에 보관하는 익명 식별자 키 — 서버 쿠키(dp_anon_id)와 같은 사람을 가리킨다. */
export const ANON_ID_STORAGE_KEY = 'dp_anon_id';

/**
 * 브라우저의 anon_id 를 **요청을 보내기 전에** 확정한다 (순수 — 저장소·난수는 주입).
 *
 * ★ 왜 필요한가 (2026-08-04 실측).
 *   서버 쿠키만으로 발급하면 **한 사람이 둘로 세어진다.** `/clinic-check` 는 마운트 시
 *   `landing_view` 를 쏘고, 콜드메일 링크의 `?name=` 이 있으면 같은 틱에 자동 조회가
 *   시작돼 `diagnosis_run` 도 쏜다. 두 요청이 동시에 나가 둘 다 쿠키를 못 받은 상태라
 *   서버가 각각 새 ID 를 줬다(실측 0.0006초 차이). 여기서 먼저 정하면 한 사람으로 묶인다.
 *
 * ⚠️ **절대 던지지 않는다.** 시크릿 모드·저장소 차단에서 접근 자체가 예외를 낸다.
 *    그때는 undefined 를 돌려주고 서버가 기존대로 발급한다 — 예전 동작으로 떨어질 뿐이다.
 *
 * ⚠️ **남은 한계(알고 감수한 것)**: `getItem → 생성 → setItem` 은 원자적이지 않다.
 *    저장소가 빈 상태에서 **서로 다른 탭이 정확히 동시에** 첫 이벤트를 쏘면 각자 다른
 *    ID 를 만들 수 있다. 막으려면 탭 간 동기화(Web Locks·BroadcastChannel)가 필요한데,
 *    익명 지표 식별자에 그만한 복잡도를 넣지 않는다. 원래 사고였던 **한 탭에서 같은 틱에
 *    나가는 두 요청**은 localStorage 가 동기 API 라 이 함수만으로 해결된다.
 */
export function readOrCreateAnonId(
  storage: AnonIdStorage | null | undefined,
  randomHex: () => string,
): string | undefined {
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(ANON_ID_STORAGE_KEY);
    if (isValidAnonId(stored)) return stored;
    const generated = randomHex();
    if (!isValidAnonId(generated)) return undefined;
    storage.setItem(ANON_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    // 저장은 실패해도 이번 요청엔 쓸 수 있게 값을 만들어 보려 하지 않는다 —
    // 매 요청 새 값이면 지금 고치려는 그 문제(한 사람이 여럿)가 그대로 재현된다.
    return undefined;
  }
}

/**
 * 32자리 hex anon_id 생성. randomFn 은 [0,1) 난수 공급자(주입 가능 — 테스트용).
 * 기본은 Math.random (익명 식별자라 암호학적 강도 불필요).
 */
export function generateAnonId(randomFn: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(randomFn() * 16).toString(16);
  }
  return out;
}

/** meta 문자열 값 최대 길이. */
export const MAX_META_STRING = 200;
/** value(결제 금액 등) 수치 상한 — 비정상 거대값 드롭. */
export const MAX_META_NUMBER = 100_000_000;

export type MetaValue = string | number | boolean | null;
export type SanitizedMeta = Record<string, MetaValue> | null;

type MetaValidator = (raw: unknown) => MetaValue | undefined;

// ── 값 형식 검증기 — 자유 문자열을 최소화해 값 자리에 PII 를 실어 보내는 것까지 차단 ──

/** 경로: 쿼리스트링·해시 제거(PII 가능 영역) 후 경로 문자만 허용. */
const PATH_RE = /^\/[A-Za-z0-9\-._~/%]*$/;
function pathMeta(raw: unknown): MetaValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const path = raw.split(/[?#]/)[0].slice(0, MAX_META_STRING);
  return PATH_RE.test(path) ? path : undefined;
}

/** 소문자 토큰(enum성 값): plan·source·target_site — 임의 자유 문자열 거부. */
const TOKEN_RE = /^[a-z0-9_-]{1,32}$/;
function tokenMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'string' && TOKEN_RE.test(raw) ? raw : undefined;
}

/** 리퍼러 호스트: 호스트명 문자만 (경로·쿼리 등 PII 가능 부분은 클라가 애초에 안 보냄). */
const HOST_RE = /^[A-Za-z0-9.-]{1,100}$/;
function hostMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'string' && HOST_RE.test(raw) ? raw.toLowerCase() : undefined;
}

/** 진료과(hospital_type): 한글·영숫자 짧은 분류값만 — 문장·연락처류 거부. */
const HOSPITAL_TYPE_RE = /^[가-힣A-Za-z0-9·()/ ]{1,30}$/;
function hospitalTypeMeta(raw: unknown): MetaValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return HOSPITAL_TYPE_RE.test(trimmed) ? trimmed : undefined;
}

/** boolean 검증기. */
function boolMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/** 금액 수치: 0 ~ 상한의 유한 숫자만. */
function amountMeta(raw: unknown): MetaValue | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_META_NUMBER
    ? raw
    : undefined;
}

/**
 * meta(jsonb) **이벤트별** 허용 키 화이트리스트 (PII 미저장 원칙 — 마이그 046 주석과 일치).
 *
 * 전역 키 목록이 아니라 이벤트별 맵인 이유: 공개 이벤트(landing_view 등)에 plan·value
 * 같은 전환 속성을 임의 주입해 분석을 오염시키는 것을 막고, 각 이벤트가 실제로 필요한
 * 최소 속성만 받게 한다. 값도 키별 형식 검증기(enum 토큰·경로·호스트·수치 범위)를
 * 통과해야 유지된다 — 값 자리에 자유 문자열(PII 가능)을 싣는 것까지 차단.
 */
const EVENT_META_VALIDATORS: Record<FunnelEvent, Record<string, MetaValidator>> = {
  landing_view: { path: pathMeta, source: tokenMeta, referrer_host: hostMeta },
  // 진단 퍼널 — 병원명은 PII 성 자유 문자열이라 **절대 meta 로 받지 않는다**.
  // 어느 화면에서 일어났는지(path)와 유입 출처(source)만 남긴다.
  diagnosis_input_start: { path: pathMeta, source: tokenMeta },
  diagnosis_submit: { path: pathMeta, source: tokenMeta },
  diagnosis_run: { path: pathMeta, source: tokenMeta },
  diagnosis_report_view: { path: pathMeta, source: tokenMeta },
  // 메일 실제 발송 여부(sent)까지 남긴다 — RESEND 미설정 환경에서는 리드만 저장되고
  // 대표가 수동 발송하므로, "확보했지만 안 나간 건"을 지표에서 구분할 수 있어야 한다.
  // 수신 주소는 당연히 meta 에 넣지 않는다(PII 는 리드 테이블에만).
  diagnosis_email_submitted: { path: pathMeta, source: tokenMeta, sent: boolMeta },
  diagnosis_cta_click: { path: pathMeta, source: tokenMeta },
  // landing_view 와 **동일한 3키**. referrer_host 까지 받는 이유: 요금 페이지는 랜딩·
  // 진단 결과·외부 검색 등 여러 경로로 도달하는데, 유입 출처를 모르면 "어디서 요금을
  // 보러 왔나"를 답할 수 없다. 병원명 같은 PII 는 여기서도 받지 않는다.
  pricing_view: { path: pathMeta, source: tokenMeta, referrer_host: hostMeta },
  signup_start: { path: pathMeta, source: tokenMeta, hospital_type: hospitalTypeMeta },
  signup_complete: { hospital_type: hospitalTypeMeta },
  first_post_generated: { free_credit: boolMeta, target_site: tokenMeta },
  payment_success: { plan: tokenMeta, value: amountMeta },
};

/** 이벤트별 허용 meta 키 목록 (읽기 전용 노출 — 호출부/테스트 참조용). */
export const EVENT_META_KEYS: Readonly<Record<FunnelEvent, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(EVENT_META_VALIDATORS).map(([event, validators]) => [
      event,
      Object.freeze(Object.keys(validators)),
    ]),
  ) as Record<FunnelEvent, readonly string[]>,
);

/**
 * meta(jsonb) 새니타이즈 — **이벤트별 허용 키 + 값 형식 검증** (PII 유입 차단).
 *  - 객체가 아니면 null
 *  - 해당 이벤트의 허용 키가 아니면 전부 드롭 (교차 이벤트 키 주입 차단)
 *  - 각 키는 정해진 형식 검증기를 통과해야 유지 (enum 토큰·경로·호스트·수치 범위)
 *  - 빈 맵은 null 로 정규화
 */
export function sanitizeMeta(input: unknown, event: FunnelEvent): SanitizedMeta {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;

  const out: Record<string, MetaValue> = {};
  const validators = EVENT_META_VALIDATORS[event] ?? {};
  for (const [key, validate] of Object.entries(validators)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = validate((input as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }

  return Object.keys(out).length === 0 ? null : out;
}

/**
 * 1회성 이벤트(first_post_generated 등) 기록 여부 판단 — 기존 동일 이벤트 조회 결과 기반.
 * priorCount = 기존 동일 이벤트 수(조회 실패 시 null).
 * null(확인 불가)이면 기록하지 않는다 — 중복 기록(전환율 부풀림)이 미기록보다 해롭다.
 */
export function shouldRecordOnceEvent(priorCount: number | null): boolean {
  return priorCount === 0;
}

/**
 * first_post_generated 전용 판단 — 이벤트 부재 + **레거시 산출물 부재**까지 요구.
 *
 * funnel_events 는 마이그 046부터 쌓이므로 "이벤트 없음 = 통산 첫 글"이 아니다:
 * 그 이전부터 글을 만들던 기존 계정(예: 체험 중 14글)은 이벤트가 없어서, 월 사용량
 * 리셋 후 newCount===1 시점에 허위 첫 글 이벤트가 기록된다. saved_posts 기존 행
 * 수(legacyPostCount)까지 0이어야 진짜 신규 계정의 첫 생성으로 본다.
 * 어느 쪽이든 확인 불가(null)면 기록하지 않는다 — 목적이 신규 계정 전환 측정이므로
 * 미기록이 허위 기록보다 낫다.
 */
export function shouldRecordFirstPostEvent(
  priorEventCount: number | null,
  legacyPostCount: number | null,
): boolean {
  return shouldRecordOnceEvent(priorEventCount) && shouldRecordOnceEvent(legacyPostCount);
}

export interface ValidatedFunnelEvent {
  event: FunnelEvent;
  meta: SanitizedMeta;
  /**
   * 클라이언트가 들고 온 anon_id — **형식이 맞을 때만** 채워진다.
   *
   * ★ 왜 필요한가 (2026-08-04 실측).
   *   anon_id 를 서버 쿠키로만 발급했더니 **한 사람이 둘로 세어졌다.** `/clinic-check` 는
   *   마운트 시 `landing_view` 를 쏘고, 콜드메일 링크의 `?name=` 이 있으면 같은 틱에
   *   자동 조회가 시작돼 `diagnosis_run` 도 쏜다. 두 요청이 **동시에** 나가므로 둘 다
   *   쿠키를 못 받은 상태고, 서버는 각각에 새 ID 를 발급한다.
   *   실측: 02:20:29.740406 / 02:20:29.741029 — 0.0006초 차이로 서로 다른 anon_id.
   *   이걸 스캐너 시그니처로 오독하기까지 했다(같은 초·다른 ID = 쿠키 미저장).
   *
   * ⚠️ 신뢰 등급은 여전히 best-effort 다. 클라가 임의 값을 보낼 수 있으므로 **형식만**
   *    검증하고, 쿠키가 있으면 쿠키를 우선한다(라우트 참조). 위조해 봐야 지표가
   *    섞일 뿐이고, 그건 쿠키를 지우는 것으로도 이미 가능한 일이다.
   */
  anonId?: string;
}

export type FunnelValidation =
  | { ok: true; value: ValidatedFunnelEvent }
  | { ok: false; reason: 'invalid_event' | 'invalid_body' };

/**
 * 요청 본문 검증 — 라우트가 파싱한 JSON 을 받아 이벤트명·meta 를 검증한다.
 * body 는 신뢰 불가 외부 입력이므로 unknown 으로 받아 안전하게 좁힌다.
 *
 * allowed 로 허용 이벤트 집합을 주입한다(기본 = 공개 엔드포인트용 저신뢰 이벤트만).
 * 서버 라우트가 전체 이벤트를 검증하려면 FUNNEL_EVENTS 를 넘긴다.
 */
export function validateFunnelBody(
  body: unknown,
  allowed: readonly string[] = PUBLIC_FUNNEL_EVENTS,
): FunnelValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'invalid_body' };
  }
  const { event, meta, anonId } = body as { event?: unknown; meta?: unknown; anonId?: unknown };
  if (typeof event !== 'string' || !allowed.includes(event) || !isFunnelEvent(event)) {
    return { ok: false, reason: 'invalid_event' };
  }
  return {
    ok: true,
    value: {
      event,
      meta: sanitizeMeta(meta, event),
      // 형식이 어긋나면 조용히 버린다 — 잘못된 값 때문에 이벤트를 통째로 거부하지 않는다.
      ...(isValidAnonId(anonId) ? { anonId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 레이트리밋 (공개 엔드포인트 남용 방어) — blog-check-limits 와 동일 철학:
// globalThis 인메모리 Map, KST 일 경계, best-effort. 이벤트는 대량 발생하므로
// IP당 상한을 넉넉히 두되(기본 300/일), 전체 상한(기본 20000/일)으로 폭주만 막는다.
//
// ⚠️ 한계(수용된 트레이드오프): 인메모리 카운터는 **서버리스 인스턴스 단위**로만
// 유효하다 — Vercel 이 인스턴스를 여러 개 띄우면 캡이 인스턴스별로 따로 적용되고,
// 콜드스타트 시 리셋된다. 남용 "완화" 목적의 best-effort 이며 정확한 전역 상한이
// 필요해지면 DB/KV 기반으로 교체한다(현 단계 과설계 금지).
// ---------------------------------------------------------------------------

/** IP당 일일 기본 캡. env: FUNNEL_IP_DAILY_LIMIT */
export const DEFAULT_FUNNEL_IP_DAILY_LIMIT = 300;
/** 전체 일일 기본 캡. env: FUNNEL_GLOBAL_DAILY_LIMIT */
export const DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT = 20000;

export interface FunnelLimits {
  ipDaily: number;
  globalDaily: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다 (비정상 값은 기본값, 절대 throw 안 함). */
export function readFunnelLimits(env: NodeJS.ProcessEnv = process.env): FunnelLimits {
  return {
    ipDaily: parsePositiveInt(env.FUNNEL_IP_DAILY_LIMIT, DEFAULT_FUNNEL_IP_DAILY_LIMIT),
    globalDaily: parsePositiveInt(env.FUNNEL_GLOBAL_DAILY_LIMIT, DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT),
  };
}

/** KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd). */
export function funnelKstDayKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type FunnelRateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'ip_limit' | 'global_limit' };

/**
 * 캡 검사 후 통과 시 카운터 소비 (검사·소비 원자). store 는 key→count Map.
 * 지난 날짜 키는 정리한다(무한 성장 방지).
 */
export function consumeFunnelQuota(
  store: Map<string, number>,
  input: { ip: string; now?: number; limits?: FunnelLimits },
): FunnelRateDecision {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? {
    ipDaily: DEFAULT_FUNNEL_IP_DAILY_LIMIT,
    globalDaily: DEFAULT_FUNNEL_GLOBAL_DAILY_LIMIT,
  };
  const day = funnelKstDayKey(now);
  const ipKey = `ip:${day}:${input.ip || 'unknown'}`;
  const globalKey = `global:${day}`;

  const prefixIp = `ip:${day}:`;
  for (const key of store.keys()) {
    if (key === globalKey || key.startsWith(prefixIp)) continue;
    store.delete(key);
  }

  const ipCount = store.get(ipKey) ?? 0;
  const globalCount = store.get(globalKey) ?? 0;

  if (globalCount >= limits.globalDaily) return { allowed: false, reason: 'global_limit' };
  if (ipCount >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };

  store.set(ipKey, ipCount + 1);
  store.set(globalKey, globalCount + 1);
  return { allowed: true };
}
