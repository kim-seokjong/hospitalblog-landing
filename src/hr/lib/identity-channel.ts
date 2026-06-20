// 본인인증 전용 포트원 채널 키 헬퍼.
//
// 결제 채널 키 패턴(src/payment/lib/channels.ts 의 getChannelKey)과 동일하게
// 환경변수에서 채널 키를 읽는다. 본인인증은 결제 수단과 무관한 별도 채널이므로
// 결제 모듈을 오염시키지 않기 위해 hr 모듈에 독립 헬퍼로 둔다.
//
// 필요 env (NEXT_PUBLIC_ 접두사 = 클라이언트 노출 허용, 채널 키는 공개값):
//   NEXT_PUBLIC_PORTONE_CHANNEL_KEY_IDENTITY
//
// ※ 이 채널 키는 포트원 관리자 콘솔에서 "본인인증" 채널(예: 다날 휴대폰 본인인증)을
//    계약/연동한 뒤 발급되는 채널 키여야 한다.

export const IDENTITY_CHANNEL_KEY_ENV = 'NEXT_PUBLIC_PORTONE_CHANNEL_KEY_IDENTITY'

/**
 * 본인인증 채널 키를 반환한다. 미설정 시 한국어 에러를 던진다.
 * 클라이언트에서 호출되므로 NEXT_PUBLIC_ 변수만 참조한다.
 */
export function getIdentityChannelKey(): string {
  const key = process.env[IDENTITY_CHANNEL_KEY_ENV]
  if (!key) throw new Error(`${IDENTITY_CHANNEL_KEY_ENV} 환경변수가 설정되지 않았습니다`)
  return key
}
