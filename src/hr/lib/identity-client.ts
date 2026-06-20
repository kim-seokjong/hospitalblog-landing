// PortOne V2 본인인증(Identity Verification) 서버 조회 클라이언트
//
// 결제 모듈(src/payment/lib/portone-client.ts)과 동일한 인증 패턴을 재사용한다:
//   - Base URL: https://api.portone.io
//   - 인증 헤더: `Authorization: PortOne ${PORTONE_API_SECRET}`  (V2 API Secret, 동일 시크릿)
//
// 문서 출처(2026-06 확인):
//   - 백엔드 조회: https://developers.portone.io/opi/ko/extra/identity-verification/readme-v2
//   - REST 스키마: https://developers.portone.io/api/rest-v2/identityVerification
//
// GET /identity-verifications/{identityVerificationId}
//   응답 status: 'READY' | 'VERIFIED' | 'FAILED'
//   status === 'VERIFIED' 일 때만 verifiedCustomer 가 채워진다.

const PORTONE_API_BASE = 'https://api.portone.io'

function getSecret(): string {
  // 결제 모듈과 동일한 V2 API Secret 을 재사용한다(별도 시크릿 불필요).
  const secret = process.env.PORTONE_API_SECRET
  if (!secret) throw new Error('PORTONE_API_SECRET 환경변수가 설정되지 않았습니다')
  return secret
}

export type IdentityVerificationStatus = 'READY' | 'VERIFIED' | 'FAILED'

// 본인인증 완료 고객 정보. 인증 제공사(다날/KCP/이니시스)에 따라 일부 필드는 없을 수 있다.
export interface VerifiedCustomer {
  ci?: string // 연계 정보(Connecting Information) — 서비스 간 고유 식별자
  di?: string // 중복 가입 확인 정보(Duplication Information) — 동일 서비스 내 중복가입 식별
  name?: string
  phoneNumber?: string // 숫자만(예: 01012345678)
  birthDate?: string // YYYY-MM-DD
  gender?: string
  operator?: string
  isForeigner?: boolean
}

export interface IdentityVerification {
  id?: string
  status: IdentityVerificationStatus
  verifiedCustomer?: VerifiedCustomer
}

/**
 * 포트원에서 본인인증 결과를 조회한다(서버가 신뢰의 원천).
 * 클라이언트가 보낸 이름/연락처는 신뢰하지 않고 반드시 이 함수로 재조회한다.
 */
export async function getIdentityVerification(
  identityVerificationId: string,
): Promise<IdentityVerification> {
  const res = await fetch(
    `${PORTONE_API_BASE}/identity-verifications/${encodeURIComponent(identityVerificationId)}`,
    {
      headers: {
        Authorization: `PortOne ${getSecret()}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`포트원 본인인증 조회 실패 [${res.status}]: ${body}`)
  }
  return res.json() as Promise<IdentityVerification>
}
