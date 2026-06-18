import Link from 'next/link';

export const metadata = {
  title: '개인정보처리방침 | 닥터포스트',
  description: '닥터포스트 개인정보처리방침',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-[#4a4f55]">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* 헤더 */}
        <div className="mb-12">
          <Link href="/" className="text-sm text-[#ff4628] hover:text-[#e63a1c] transition-colors mb-6 inline-block">
            ← 홈으로
          </Link>
          <h1 className="text-3xl font-bold text-[#202020] mb-3">개인정보처리방침</h1>
          <p className="text-sm text-[#8a93a0]">시행일: 2026년 5월 2일 &nbsp;|&nbsp; 최종 수정: 2026년 5월 2일</p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed">

          <p>
            닥터포스트(이하 "서비스")를 운영하는 닥터포스트(이하 "회사")는 이용자의 개인정보를 중요하게 여기며,
            「개인정보 보호법」 및 관련 법령을 준수합니다. 본 방침은 회사가 수집하는 개인정보의 항목,
            수집 목적, 보유 기간, 제3자 제공 여부 및 이용자의 권리에 대해 설명합니다.
          </p>

          {/* 1 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              1. 수집하는 개인정보 항목
            </h2>
            <div className="space-y-4">
              <div>
                <p className="font-medium text-[#202020] mb-2">회원가입 및 서비스 이용</p>
                <ul className="list-disc list-inside space-y-1 text-[#4a4f55] ml-2">
                  <li>이메일 주소, 비밀번호(암호화 저장)</li>
                  <li>성명, 연락처, 병원명, 병원 주소, 직책</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-[#202020] mb-2">결제 시</p>
                <ul className="list-disc list-inside space-y-1 text-[#4a4f55] ml-2">
                  <li>결제수단 정보(카드 번호 끝 4자리, 카드사명) — PG사(갤럭시아, 카카오페이)가 직접 처리하며 회사는 저장하지 않습니다</li>
                  <li>결제 내역, 영수증 URL</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-[#202020] mb-2">서비스 이용 과정에서 자동 수집</p>
                <ul className="list-disc list-inside space-y-1 text-[#4a4f55] ml-2">
                  <li>IP 주소, 접속 기기 정보, 브라우저 종류</li>
                  <li>서비스 이용 기록(생성 횟수, 접속 일시)</li>
                  <li>쿠키(세션 유지 목적)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              2. 개인정보 수집 및 이용 목적
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>회원 식별 및 서비스 제공</li>
              <li>요금제 관리 및 결제 처리</li>
              <li>콘텐츠 AI 생성 서비스 운영</li>
              <li>서비스 개선 및 신규 기능 개발</li>
              <li>고객 문의 대응 및 공지사항 전달</li>
              <li>부정 이용 방지 및 법적 의무 이행</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              3. 개인정보 보유 및 이용 기간
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#dbe2ea]">항목</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#dbe2ea]">보유 기간</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['회원 정보', '회원 탈퇴 후 즉시 삭제 (단, 법령에서 정한 기간 우선)'],
                    ['결제 내역', '5년 (전자상거래 등에서의 소비자보호에 관한 법률)'],
                    ['접속 로그', '3개월'],
                    ['분쟁 관련 기록', '분쟁 해결 후 1년'],
                  ].map(([item, period]) => (
                    <tr key={item} className="border-b border-[#dbe2ea]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#dbe2ea]">{item}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#dbe2ea]">{period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              4. 개인정보 제3자 제공
            </h2>
            <p className="text-[#4a4f55] mb-3">
              회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다.
              다만, 다음의 경우에는 예외로 합니다.
            </p>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>이용자가 사전에 동의한 경우</li>
              <li>법령의 규정에 의하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              5. 개인정보 처리 위탁
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#dbe2ea]">수탁업체</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#dbe2ea]">위탁 업무</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Supabase Inc.', '회원 인증 및 데이터베이스 운영'],
                    ['Anthropic / OpenAI', 'AI 콘텐츠 생성 처리 (입력 데이터 임시 처리)'],
                    ['갤럭시아머니트리', '신용/체크카드 결제 처리'],
                    ['카카오페이', '카카오페이 결제 처리'],
                    ['Vercel Inc.', '서비스 호스팅 및 배포'],
                    ['Meta Platforms', '광고 성과 측정 (Meta Pixel/CAPI)'],
                  ].map(([company, task]) => (
                    <tr key={company} className="border-b border-[#dbe2ea]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#dbe2ea]">{company}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#dbe2ea]">{task}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              6. 이용자의 권리
            </h2>
            <p className="text-[#4a4f55] mb-3">
              이용자는 언제든지 다음의 권리를 행사할 수 있습니다.
            </p>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>개인정보 열람 요청</li>
              <li>개인정보 정정·삭제 요청</li>
              <li>개인정보 처리 정지 요청</li>
              <li>회원 탈퇴(개인정보 삭제)</li>
            </ul>
            <p className="text-[#4a4f55] mt-3">
              권리 행사는 <a href="mailto:terro6936@gmail.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">terro6936@gmail.com</a> 으로 이메일 문의하시면 처리해 드립니다.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              7. 쿠키 사용
            </h2>
            <p className="text-[#4a4f55]">
서비스는 로그인 세션 유지를 위해 쿠키를 사용합니다. 브라우저 설정에서 쿠키를 거부할 수 있으나,
              이 경우 로그인 등 일부 서비스 이용이 제한될 수 있습니다.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              8. 개인정보 보호책임자
            </h2>
            <div className="bg-[#eef2f6] border border-[#dbe2ea] rounded-xl p-5 space-y-2 text-[#4a4f55]">
              <p><span className="text-[#202020]">서비스명:</span> 닥터포스트</p>
              <p><span className="text-[#202020]">이메일:</span>{' '}
                <a href="mailto:terro6936@gmail.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">
                  terro6936@gmail.com
                </a>
              </p>
            </div>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#dbe2ea]">
              9. 방침 변경 시 공지
            </h2>
            <p className="text-[#4a4f55]">
본 개인정보처리방침이 변경되는 경우, 변경 사항을 서비스 내 공지사항 또는 이메일을 통해
              시행일 7일 전에 안내합니다.
            </p>
          </section>

          <p className="text-xs text-[#8a93a0] pt-6 border-t border-[#dbe2ea]">
            본 방침은 2026년 5월 2일부터 적용됩니다.
          </p>
        </div>
      </div>
    </main>
  );
}
