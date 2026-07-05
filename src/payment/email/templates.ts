// 6종 이메일 템플릿 (HTML 문자열)
// - billing-notify: 결제 7일 전 사전고지 (방통위 의무)
// - payment-success: 자동결제 성공
// - payment-failed: 1차 실패 (Dunning 1단계)
// - payment-retry-failed: 재시도도 실패 (Dunning 2단계, 해지 예고)
// - subscription-cancelled: 자동 해지 통지
// - monthly-report: 월간 성과 리포트 도착 안내 (구독 해지 방어)

import {
  renderLayout,
  button,
  infoBox,
  warnBox,
  escapeHtml,
  formatKoreanDate,
  formatPrice,
} from './layout'

const SUBSCRIPTION_URL = 'https://www.hospitalblog.kr/subscription'

interface BillingNotifyParams {
  planName: string
  amount: number
  nextBillingAt: string
  cardLast4?: string | null
}

export function billingNotifyEmail(params: BillingNotifyParams): { subject: string; html: string } {
  const subject = `[닥터포스트] ${formatKoreanDate(params.nextBillingAt)} 자동결제 예정 안내`
  const cardLine = params.cardLast4
    ? `<p style="margin:0 0 8px 0;">결제카드: 카드 번호 끝자리 <strong>${escapeHtml(params.cardLast4)}</strong></p>`
    : ''
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;">자동결제 예정 안내</h1>
    <p style="margin:0 0 16px 0;">안녕하세요, 닥터포스트입니다.</p>
    <p style="margin:0 0 16px 0;">고객님의 <strong>${escapeHtml(params.planName)} 플랜</strong> 자동결제 예정일이 <strong>7일 앞</strong>으로 다가왔습니다.</p>
    ${infoBox(`
      <p style="margin:0 0 8px 0;">결제 예정일: <strong>${formatKoreanDate(params.nextBillingAt)}</strong></p>
      <p style="margin:0 0 8px 0;">결제 예정 금액: <strong>${formatPrice(params.amount)}</strong></p>
      ${cardLine}
    `)}
    <p style="margin:0 0 16px 0;">자동결제를 원하지 않으시면 결제 예정일 전까지 구독을 해지하실 수 있습니다. 해지 시 추가 청구 없이 즉시 적용되며, 이미 결제된 기간은 만료일까지 정상 이용 가능합니다.</p>
    <div style="text-align:center;margin:24px 0;">${button(SUBSCRIPTION_URL, '구독 관리하기')}</div>
    ${warnBox(`
      <p style="margin:0;"><strong>법적 안내:</strong> 본 안내는 「전자상거래법」 제13조 및 방송통신위원회 자동결제 가이드라인에 따라 결제 7일 전 발송되는 의무 고지입니다.</p>
    `)}
  `
  return { subject, html: renderLayout({ preheader: '자동결제가 7일 후 진행됩니다.', bodyHtml: body }) }
}

interface PaymentSuccessParams {
  planName: string
  amount: number
  paidAt: string
  expiresAt: string
}

export function paymentSuccessEmail(params: PaymentSuccessParams): { subject: string; html: string } {
  const subject = `[닥터포스트] ${formatPrice(params.amount)} 결제가 완료되었습니다`
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;">결제가 완료되었습니다</h1>
    <p style="margin:0 0 16px 0;">${escapeHtml(params.planName)} 플랜 자동결제가 정상 처리되었습니다. 이용해 주셔서 감사합니다.</p>
    ${infoBox(`
      <p style="margin:0 0 8px 0;">결제 일시: <strong>${formatKoreanDate(params.paidAt)}</strong></p>
      <p style="margin:0 0 8px 0;">결제 금액: <strong>${formatPrice(params.amount)}</strong></p>
      <p style="margin:0;">이용 기간: ~ <strong>${formatKoreanDate(params.expiresAt)}</strong>까지</p>
    `)}
    <div style="text-align:center;margin:24px 0;">${button(SUBSCRIPTION_URL, '구독 관리하기')}</div>
    <p style="margin:0;font-size:13px;color:#6b7280;">결제 내역은 마이페이지에서 확인하실 수 있습니다.</p>
  `
  return { subject, html: renderLayout({ preheader: '자동결제가 완료되었습니다.', bodyHtml: body }) }
}

interface PaymentFailedParams {
  planName: string
  amount: number
  reason?: string
  retryDate: string
}

export function paymentFailedEmail(params: PaymentFailedParams): { subject: string; html: string } {
  const subject = `[닥터포스트] 결제 실패 안내 — 3일 후 재시도됩니다`
  const reasonLine = params.reason
    ? `<p style="margin:0 0 8px 0;">실패 사유: ${escapeHtml(params.reason)}</p>`
    : ''
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;color:#b45309;">자동결제에 실패했습니다</h1>
    <p style="margin:0 0 16px 0;">${escapeHtml(params.planName)} 플랜의 자동결제가 정상 처리되지 못했습니다.</p>
    ${infoBox(`
      <p style="margin:0 0 8px 0;">결제 시도 금액: <strong>${formatPrice(params.amount)}</strong></p>
      ${reasonLine}
      <p style="margin:0;">재시도 예정일: <strong>${formatKoreanDate(params.retryDate)}</strong></p>
    `)}
    <p style="margin:0 0 16px 0;">카드 한도 부족, 정지, 만료 등이 원인일 수 있습니다. 카드 정보를 갱신하시거나 잔액을 확인해 주세요.</p>
    <div style="text-align:center;margin:24px 0;">${button(SUBSCRIPTION_URL, '카드 정보 변경하기')}</div>
    ${warnBox(`
      <p style="margin:0;"><strong>안내:</strong> ${formatKoreanDate(params.retryDate)}에 자동 재시도되며, 재시도도 실패할 경우 추가 안내 후 구독이 자동 해지됩니다.</p>
    `)}
  `
  return { subject, html: renderLayout({ preheader: '결제 실패. 3일 후 자동 재시도됩니다.', bodyHtml: body }) }
}

interface PaymentRetryFailedParams {
  planName: string
  amount: number
  reason?: string
  cancelDate: string
}

export function paymentRetryFailedEmail(params: PaymentRetryFailedParams): { subject: string; html: string } {
  const subject = `[닥터포스트] 재시도 결제도 실패 — 4일 후 구독 자동 해지`
  const reasonLine = params.reason
    ? `<p style="margin:0 0 8px 0;">실패 사유: ${escapeHtml(params.reason)}</p>`
    : ''
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;color:#b91c1c;">재시도 결제도 실패했습니다</h1>
    <p style="margin:0 0 16px 0;">${escapeHtml(params.planName)} 플랜의 자동결제 재시도도 정상 처리되지 못했습니다.</p>
    ${infoBox(`
      <p style="margin:0 0 8px 0;">결제 시도 금액: <strong>${formatPrice(params.amount)}</strong></p>
      ${reasonLine}
    `)}
    ${warnBox(`
      <p style="margin:0 0 8px 0;"><strong>중요:</strong> <strong>${formatKoreanDate(params.cancelDate)}</strong>까지 결제 수단이 갱신되지 않으면 구독이 <strong>자동 해지</strong>됩니다.</p>
      <p style="margin:0;">자동 해지 시에도 이미 결제된 기간은 만료일까지 정상 이용 가능합니다.</p>
    `)}
    <div style="text-align:center;margin:24px 0;">${button(SUBSCRIPTION_URL, '카드 정보 변경하기')}</div>
  `
  return { subject, html: renderLayout({ preheader: '재시도 결제도 실패. 4일 후 자동 해지됩니다.', bodyHtml: body }) }
}

interface SubscriptionCancelledParams {
  planName: string
  reason: 'PAYMENT_FAILED' | 'USER_REQUEST'
}

export function subscriptionCancelledEmail(params: SubscriptionCancelledParams): { subject: string; html: string } {
  const reasonText = params.reason === 'PAYMENT_FAILED'
    ? '연속 결제 실패로 인해 구독이 자동 해지되었습니다.'
    : '요청하신 대로 구독이 해지되었습니다.'
  const subject = `[닥터포스트] 구독이 해지되었습니다`
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;">구독이 해지되었습니다</h1>
    <p style="margin:0 0 16px 0;">${escapeHtml(params.planName)} 플랜 ${reasonText}</p>
    <p style="margin:0 0 16px 0;">언제든 다시 가입하실 수 있으며, 새로운 결제 수단으로 즉시 이용 재개가 가능합니다.</p>
    <div style="text-align:center;margin:24px 0;">${button('https://www.hospitalblog.kr/pricing', '플랜 다시 보기')}</div>
    <p style="margin:0;font-size:13px;color:#6b7280;">이용해 주셔서 감사합니다. 더 좋은 서비스로 다시 만나뵙겠습니다.</p>
  `
  return { subject, html: renderLayout({ preheader: '구독이 해지되었습니다.', bodyHtml: body }) }
}

interface MonthlyReportParams {
  /** '2026년 6월' 형태 표기 */
  periodText: string
  /** 'YYYY-MM' — 리포트 페이지 링크에 사용 */
  period: string
  hospitalName: string | null
  generated: number
  published: number
  complianceChecked: number
  top10Count: number
}

export function monthlyReportEmail(params: MonthlyReportParams): { subject: string; html: string } {
  const subject = `[닥터포스트] ${params.periodText} 성과 리포트가 도착했어요`
  const greeting = params.hospitalName
    ? `${escapeHtml(params.hospitalName)} 원장님, 지난달에도 닥터포스트가 함께했습니다.`
    : '지난달에도 닥터포스트가 함께했습니다.'
  const top10Line = params.top10Count > 0
    ? `<p style="margin:0;">검색 상위 10위 진입: <strong>${params.top10Count}건</strong></p>`
    : ''
  const reportUrl = `https://www.hospitalblog.kr/app/monthly-report/${params.period}`
  const body = `
    <h1 style="font-size:20px;font-weight:700;margin:0 0 16px 0;">${escapeHtml(params.periodText)} 성과 리포트</h1>
    <p style="margin:0 0 16px 0;">${greeting}</p>
    ${infoBox(`
      <p style="margin:0 0 8px 0;">AI 글 생성: <strong>${params.generated}회</strong></p>
      <p style="margin:0 0 8px 0;">발행한 글: <strong>${params.published}건</strong></p>
      <p style="margin:0 ${top10Line ? '0 8px 0' : ''};">의료광고법 자동 검사: <strong>${params.complianceChecked}건</strong></p>
      ${top10Line}
    `)}
    <p style="margin:0 0 16px 0;">순위 변동과 다음 달 추천 액션은 리포트 전문에서 확인하실 수 있습니다. PDF 저장도 가능합니다.</p>
    <div style="text-align:center;margin:24px 0;">${button(reportUrl, '월간 리포트 보기')}</div>
    <p style="margin:0;font-size:13px;color:#6b7280;">검색 순위는 네이버 블로그 검색 관련도 기준 추정치이며, 실제 성과를 보장하지 않습니다.</p>
  `
  return {
    subject,
    html: renderLayout({ preheader: `${params.periodText} 닥터포스트 성과 요약이 도착했습니다.`, bodyHtml: body }),
  }
}
