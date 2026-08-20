import Link from 'next/link';

// 제목 접미사는 루트 layout 의 title.template('%s | 닥터포스트')이 붙인다 — 직접 붙이면 중복된다.
export const metadata = {
  title: '개인정보처리방침',
  description: '닥터포스트 개인정보처리방침',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#eaeef4] text-[#4a4f55]">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* 헤더 */}
        <div className="mb-12">
          <Link href="/" className="text-sm text-[#ff4628] hover:text-[#e63a1c] transition-colors mb-6 inline-block">
            ← 홈으로
          </Link>
          <h1 className="text-3xl font-bold text-[#202020] mb-3">개인정보처리방침</h1>
          <p className="text-sm text-[#5b6573]">시행일: 2026년 5월 2일 &nbsp;|&nbsp; 최종 수정: 2026년 6월 22일</p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed">

          <p>
            닥터포스트(이하 "서비스")를 운영하는 광고진정성(이하 "회사")는 이용자의 개인정보를 중요하게 여기며,
            「개인정보 보호법」 및 관련 법령을 준수합니다. 본 방침은 회사가 수집하는 개인정보의 항목,
            수집 목적, 보유 기간, 제3자 제공 여부 및 이용자의 권리에 대해 설명합니다.
          </p>

          {/* 1 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
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
                  <li>결제수단 정보(카드 번호 끝 4자리, 카드사명) — PG사(한국결제네트웍스(KPN)) 및 결제 연동 대행사(포트원, PortOne)가 직접 처리하며 회사는 카드 정보를 저장하지 않습니다</li>
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
              <div>
                <p className="font-medium text-[#202020] mb-2">콘텐츠 생성 시 (선택 입력)</p>
                <ul className="list-disc list-inside space-y-1 text-[#4a4f55] ml-2">
                  <li>병원 로고, 병원 사진(외관·내부·장비·의료진·기타), AI 가상 진행자 설정값 및 생성된 가상 진행자 이미지</li>
                  <li>영상 진행자는 실존 인물이 아닌 <strong>AI 가상 진행자</strong>로 생성됩니다(실제 원장님 얼굴 미사용). 의료진·환자가 식별되는 사진은 이용자의 동의가 있는 경우에만 수집·이용합니다.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
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
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              3. 개인정보 보유 및 이용 기간
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">항목</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">보유 기간</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['회원 정보', '회원 탈퇴 후 즉시 삭제 (단, 아래 법정 보존의무 기록은 해당 기간 동안 분리 보관)'],
                    ['계약 또는 청약철회 등에 관한 기록', '5년 (전자상거래법 시행령 제6조)'],
                    ['대금결제 및 재화 등의 공급에 관한 기록', '5년 (전자상거래법 시행령 제6조)'],
                    ['소비자 불만 또는 분쟁처리에 관한 기록', '3년 (전자상거래법 시행령 제6조)'],
                    ['표시·광고에 관한 기록', '6개월 (전자상거래법 시행령 제6조)'],
                    ['접속 로그', '3개월'],
                    ['업로드 이미지·영상 자산', '회원 탈퇴 또는 이용자 삭제 시 즉시 삭제'],
                  ].map(([item, period]) => (
                    <tr key={item} className="border-b border-[#b4bfce]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{item}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
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
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              5. 개인정보 처리 위탁
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">수탁업체</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">위탁 업무</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Supabase Inc.', '회원 인증 및 데이터베이스 운영'],
                    ['Anthropic / OpenAI', 'AI 콘텐츠 생성 처리 (입력 데이터 임시 처리)'],
                    ['fal.ai', 'AI 이미지·영상 및 AI 가상 진행자 립싱크 영상 생성 처리 (입력 데이터 임시 처리)'],
                    ['한국결제네트웍스(KPN)', '신용/체크카드 결제 처리'],
                    ['포트원(PortOne)', '결제 연동 대행(빌링키 발급·결제 게이트웨이)'],
                    ['Vercel Inc.', '서비스 호스팅 및 배포'],
                    ['Meta Platforms', '광고 성과 측정 (Meta Pixel/CAPI)'],
                  ].map(([company, task]) => (
                    <tr key={company} className="border-b border-[#b4bfce]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{company}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{task}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-[#eef2f6] border border-[#b4bfce] rounded-xl p-5 text-[#4a4f55]">
              <p className="font-medium text-[#202020] mb-2">개인정보의 국외 이전 고지 (개인정보 보호법 제28조의8)</p>
              <ul className="list-disc list-inside space-y-1 text-[#4a4f55] ml-1">
                <li><span className="text-[#202020]">이전받는 자:</span> Anthropic, OpenAI, fal.ai, Supabase, Vercel 등</li>
                <li><span className="text-[#202020]">이전되는 국가:</span> 미국 등</li>
                <li><span className="text-[#202020]">이전 일시 및 방법:</span> 서비스 이용 시 정보통신망을 통한 전송</li>
                <li><span className="text-[#202020]">이전 항목:</span> 이용자가 입력·업로드한 콘텐츠 데이터 및 이미지·영상</li>
                <li><span className="text-[#202020]">이전 목적:</span> AI 콘텐츠 생성 및 호스팅</li>
                <li><span className="text-[#202020]">보유·이용 기간:</span> 처리 완료 후 즉시 파기 또는 위탁계약 종료 시까지</li>
              </ul>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
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
              권리 행사는 <a href="mailto:terro6936@naver.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">terro6936@naver.com</a> 으로 이메일 문의하시면 처리해 드립니다.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              7. 쿠키 사용
            </h2>
            <p className="text-[#4a4f55]">
서비스는 로그인 세션 유지를 위해 쿠키를 사용합니다. 브라우저 설정에서 쿠키를 거부할 수 있으나,
              이 경우 로그인 등 일부 서비스 이용이 제한될 수 있습니다.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              8. 개인정보 보호책임자
            </h2>
            <div className="bg-[#eef2f6] border border-[#b4bfce] rounded-xl p-5 space-y-2 text-[#4a4f55]">
              <p><span className="text-[#202020]">회사명:</span> 광고진정성</p>
              <p><span className="text-[#202020]">서비스명:</span> 닥터포스트</p>
              <p><span className="text-[#202020]">개인정보 보호책임자:</span> 김석종</p>
              <p><span className="text-[#202020]">이메일:</span>{' '}
                <a href="mailto:terro6936@naver.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">
                  terro6936@naver.com
                </a>
              </p>
            </div>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              9. 방침 변경 시 공지
            </h2>
            <p className="text-[#4a4f55]">
본 개인정보처리방침이 변경되는 경우, 변경 사항을 서비스 내 공지사항 또는 이메일을 통해
              시행일 7일 전에 안내합니다.
            </p>
          </section>

          {/* 사업자 정보 */}
          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              사업자 정보
            </h2>
            <div className="bg-[#eef2f6] border border-[#b4bfce] rounded-xl p-5 space-y-2 text-[#4a4f55]">
              <p><span className="text-[#202020]">상호:</span> 광고진정성</p>
              <p><span className="text-[#202020]">대표자:</span> 김석종</p>
              <p><span className="text-[#202020]">사업자등록번호:</span> 570-60-00560</p>
              <p><span className="text-[#202020]">주소:</span> 대구광역시 수성구 청호로422 2층</p>
              <p><span className="text-[#202020]">전화:</span> 010-2558-1115</p>
              <p><span className="text-[#202020]">이메일:</span>{' '}
                <a href="mailto:terro6936@naver.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">
                  terro6936@naver.com
                </a>
              </p>
              <p><span className="text-[#202020]">통신판매업 신고번호:</span> 제2026-대구수성구-0497호</p>
            </div>
          </section>

          <p className="text-xs text-[#5b6573] pt-6 border-t border-[#b4bfce]">
            본 방침은 2026년 5월 2일부터 적용됩니다. (최종 수정: 2026년 6월 22일)
          </p>
        </div>
      </div>
    </main>
  );
}
