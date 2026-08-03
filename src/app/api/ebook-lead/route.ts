import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/dev/lib/supabase/server'
import {
  consumeEbookLeadQuota,
  extractClientIp,
  publicLimitMessage,
} from '@/content/lib/public-endpoint-limits'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ebook-lead
 *
 * 랜딩 리드마그넷: 병원명+이메일을 남기면 의료광고법 요약판 PDF 다운로드 경로를 반환.
 * 미로그인 공개 엔드포인트(리드 수집이 목적) — PII 는 저장만 하고 반환하지 않는다.
 * 남용 완화: 일일 캡(IP·전체) + 필드 길이 제한 + 허니팟(website) + 형식 검증.
 * 쓰기는 service role 로만.
 *
 * ⚠️ 캡을 나중에 붙였다(2026-08-03 주간점검). 허니팟과 형식검증만으로는 **성의 있는
 *    봇**을 못 막는다. 리드 테이블이 가짜 주소로 차면 나중에 그 명부로 보낸 메일이
 *    발신 도메인 평판을 깎는다 — 7/27 에 도메인 하나 죽어서 전 발송이 멈춘 걸 겪었다.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DOWNLOAD_PATH = '/downloads/dp-medlaw-guide-lite-x7k2m.pdf'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      hospitalName?: string
      email?: string
      marketingConsent?: boolean
      website?: string // 허니팟 — 사람은 채우지 않는 숨김 필드
    } | null

    if (!body) {
      return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
    }
    // 허니팟이 채워져 있으면 봇으로 간주하고 조용히 성공 응답 (저장 안 함)
    if (body.website && body.website.trim().length > 0) {
      return NextResponse.json({ ok: true, downloadUrl: DOWNLOAD_PATH })
    }

    const hospitalName = (body.hospitalName ?? '').trim()
    const email = (body.email ?? '').trim().toLowerCase()

    if (hospitalName.length < 2 || hospitalName.length > 40) {
      return NextResponse.json({ error: '병원명을 2~40자로 입력해 주세요' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email) || email.length > 120) {
      return NextResponse.json({ error: '이메일 형식을 확인해 주세요' }, { status: 400 })
    }

    /**
     * 캡은 **형식 검증을 통과한 뒤에** 센다.
     *
     * 앞에서 세면 오타로 반려된 입력이 한도를 갉아먹어, 이메일을 두 번 잘못 친
     * 사람이 정작 제대로 낸 제출에서 막힌다. 소비해야 할 것은 "저장 시도" 다.
     */
    const quota = consumeEbookLeadQuota(extractClientIp(req.headers))
    if (!quota.allowed) {
      return NextResponse.json({ error: publicLimitMessage(quota.reason) }, { status: 429 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('ebook_leads').insert({
      hospital_name: hospitalName,
      email,
      source: 'landing',
      marketing_consent: body.marketingConsent === true,
    })
    if (error) {
      console.error('[ebook-lead] insert 실패:', error.message)
      return NextResponse.json({ error: '잠시 후 다시 시도해 주세요' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, downloadUrl: DOWNLOAD_PATH })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    console.error('[ebook-lead]', msg)
    return NextResponse.json({ error: '잠시 후 다시 시도해 주세요' }, { status: 500 })
  }
}
