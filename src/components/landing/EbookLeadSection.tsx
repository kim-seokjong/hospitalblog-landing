'use client'

/**
 * EbookLeadSection — 의료광고법 요약판 무료 다운로드 (리드마그넷).
 *
 * 병원명+이메일을 남기면 요약판 PDF 다운로드 링크 제공 → ebook_leads 에 인바운드 리드 적재.
 * 개인정보 수집 동의(필수) 체크 후에만 제출 가능. 과장·보장 표현 금지 (랜딩 공통 규칙).
 */

import { useState } from 'react'

export default function EbookLeadSection() {
  const [hospitalName, setHospitalName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')

  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!consent || status === 'loading') return
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/ebook-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalName, email, marketingConsent, website: '' }),
      })
      const data = (await res.json()) as { ok?: boolean; downloadUrl?: string; error?: string }
      if (!res.ok || !data.ok || !data.downloadUrl) {
        setStatus('error')
        setErrorMsg(data.error ?? '잠시 후 다시 시도해 주세요')
        return
      }
      setDownloadUrl(data.downloadUrl)
      setStatus('done')
    } catch {
      setStatus('error')
      setErrorMsg('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요')
    }
  }

  return (
    <section className="py-16 sm:py-[84px] bg-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center bg-[#fff7f5] border border-[#ffd9cf] rounded-3xl p-7 sm:p-12">
          {/* 왼쪽: 소개 */}
          <div>
            <h2 className="text-[26px] sm:text-[34px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
              병원 블로그,
              <br />
              이 표현 쓰면 <span className="text-[#ff4628]">처분받습니다</span>
            </h2>
            <p className="text-[#4a4f55] mt-4 text-[15px] sm:text-base leading-relaxed">
              보건복지부 공식 통계로 정리한 <b>의료광고법 핵심 요약판(무료 PDF)</b>을 보내드려요.
              즉시 아웃 5대 표현, 위험·주의·안전 등급표, 발행 전 3분 체크리스트가 담겨 있어요.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-[#4a4f55]">
              <li>· 대행사가 보낸 원고, 위험한 문장을 직접 골라낼 수 있어요</li>
              <li>· 적발 1위 유형(후기 가장 치료경험담)부터 점검해요</li>
              <li>· 데스크에 붙이는 발행 전 체크 8항목 포함</li>
            </ul>
          </div>

          {/* 오른쪽: 폼 */}
          <div>
            {status === 'done' ? (
              <div className="bg-white border border-[#dbe2ea] rounded-2xl p-7 text-center">
                <p className="text-lg font-extrabold text-[#202020]">준비됐어요! 🎉</p>
                <p className="text-sm text-[#4a4f55] mt-2">아래 버튼을 누르면 요약판 PDF가 열려요.</p>
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-5 px-7 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 transition-all"
                >
                  요약판 PDF 다운로드
                </a>
                <p className="text-xs text-[#8a93a0] mt-4">
                  전체판(45p)과 자동 검사가 궁금하시면 가입 시 글 2회 무료 생성으로 확인해 보세요.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-white border border-[#dbe2ea] rounded-2xl p-6 sm:p-7 space-y-3.5">
                <div>
                  <label className="block text-[13px] font-bold text-[#202020] mb-1.5">병원명</label>
                  <input
                    type="text"
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                    placeholder="예: 광화문정형외과의원"
                    className={inputClass}
                    style={{ colorScheme: 'light' }}
                    maxLength={40}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-[#202020] mb-1.5">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="자료 받으실 이메일"
                    className={inputClass}
                    style={{ colorScheme: 'light' }}
                    maxLength={120}
                    required
                  />
                </div>
                <label className="flex items-start gap-2 text-[13px] text-[#4a4f55] cursor-pointer">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" required />
                  <span>
                    (필수) 자료 제공을 위한 개인정보 수집·이용에 동의합니다.{' '}
                    <a href="/privacy" target="_blank" className="underline text-[#8a93a0]">개인정보처리방침</a>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[13px] text-[#4a4f55] cursor-pointer">
                  <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-0.5" />
                  <span>(선택) 병원 마케팅 소식·서비스 안내 수신에 동의합니다.</span>
                </label>
                {status === 'error' && <p className="text-[13px] text-[#e63a1c]">{errorMsg}</p>}
                <button
                  type="submit"
                  disabled={!consent || status === 'loading'}
                  className="w-full py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'loading' ? '준비 중…' : '무료 요약판 받기'}
                </button>
                <p className="text-[11.5px] text-[#8a93a0] leading-relaxed">
                  입력하신 정보는 자료 제공과 (동의 시) 서비스 안내에만 사용해요.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
