// 공통 이메일 레이아웃 (인라인 스타일 — 메일 클라이언트 호환성)

interface LayoutParams {
  preheader: string
  bodyHtml: string
}

const BRAND_COLOR = '#3b82f6'
const TEXT_COLOR = '#1f2937'
const MUTED_COLOR = '#6b7280'
const BORDER_COLOR = '#e5e7eb'

export function renderLayout({ preheader, bodyHtml }: LayoutParams): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>닥터포스트</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:${TEXT_COLOR};line-height:1.6;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:32px 40px 24px 40px;border-bottom:1px solid ${BORDER_COLOR};">
              <div style="font-size:22px;font-weight:700;color:${BRAND_COLOR};letter-spacing:-0.5px;">닥터포스트</div>
              <div style="font-size:13px;color:${MUTED_COLOR};margin-top:4px;">병원 블로그 자동화 SaaS</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid ${BORDER_COLOR};font-size:12px;color:${MUTED_COLOR};">
              <p style="margin:0 0 8px 0;">본 메일은 닥터포스트 구독 서비스 이용에 따른 자동 안내입니다.</p>
              <p style="margin:0 0 8px 0;">문의: <a href="mailto:support@hospitalblog.kr" style="color:${BRAND_COLOR};text-decoration:none;">support@hospitalblog.kr</a> · 카카오톡 채널 <a href="https://pf.kakao.com/_xefMRX" style="color:${BRAND_COLOR};text-decoration:none;">광고진정성</a></p>
              <p style="margin:0;">구독 관리: <a href="https://hospitalblog.kr/subscription" style="color:${BRAND_COLOR};text-decoration:none;">hospitalblog.kr/subscription</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function button(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 24px;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>`
}

export function infoBox(html: string): string {
  return `<div style="background-color:#f9fafb;border:1px solid ${BORDER_COLOR};border-radius:8px;padding:16px 20px;margin:16px 0;font-size:14px;">${html}</div>`
}

export function warnBox(html: string): string {
  return `<div style="background-color:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px 20px;margin:16px 0;font-size:14px;color:#78350f;">${html}</div>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function formatKoreanDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}년 ${m}월 ${day}일`
}

export function formatPrice(amount: number): string {
  return amount.toLocaleString('ko-KR') + '원'
}
