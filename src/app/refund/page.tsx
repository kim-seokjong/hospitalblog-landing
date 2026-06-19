import Link from 'next/link';

export const metadata = {
  title: '환불·해지정책 | 닥터포스트',
  description: '닥터포스트 환불·해지 및 결제 취소 정책',
};

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-[#eaeef4] text-[#4a4f55]">
      <div className="max-w-3xl mx-auto px-6 py-16">

        <div className="mb-12">
          <Link href="/" className="text-sm text-[#ff4628] hover:text-[#e63a1c] transition-colors mb-6 inline-block">
            ← 홈으로
          </Link>
          <h1 className="text-3xl font-bold text-[#202020] mb-3">환불·해지정책</h1>
          <p className="text-sm text-[#5b6573]">시행일: 2026년 5월 8일 &nbsp;|&nbsp; 최종 수정: 2026년 5월 8일</p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed">

          <div className="bg-[#ffece7] border border-[#ff4628]/30 rounded-xl px-5 py-4 text-[#ff4628] text-sm">
            닥터포스트는 「전자상거래 등에서의 소비자보호에 관한 법률」 및 관련 법령을 준수하여 환불·해지 정책을 운영합니다.
            결제 관련 문의는 <a href="mailto:terro6936@gmail.com" className="underline hover:text-[#e63a1c]">terro6936@gmail.com</a>으로 연락해 주세요.
          </div>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              1. 결제 방식
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>본 서비스는 <strong className="text-[#202020]">월 자동갱신 구독</strong> 방식으로만 운영됩니다.</li>
              <li>최초 결제 시 등록한 카드로 매월 동일한 날짜에 자동 청구됩니다.</li>
              <li>지원 결제수단: 신용카드·체크카드 (한국결제네트웍스, KPN)</li>
              <li>결제 금액은 부가세(VAT) 포함 가격입니다.</li>
              <li>다음 결제 7일 전 등록된 이메일로 사전 안내를 발송합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              2. 구독 해지 절차
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>로그인 후 <strong className="text-[#202020]">마이페이지</strong> (<code className="text-[#ff4628]">/app/subscription</code>) 진입</li>
              <li><strong className="text-[#202020]">"구독 해지"</strong> 버튼 클릭 → 확인</li>
              <li>해지 즉시 다음 결제일부터 자동 청구가 중단됩니다.</li>
              <li>이미 결제한 기간(다음 결제일 전까지)은 그대로 서비스 이용 가능합니다.</li>
            </ol>
            <p className="text-[#5b6573] text-xs mt-3">
              ※ 해지는 1클릭으로 즉시 처리됩니다. 별도 이메일 요청이나 통화 절차가 필요하지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              3. 환불 기준
            </h2>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">시점</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">환불 여부</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['결제 후 7일 이내 & 콘텐츠 생성 0건', '전액 환불', '청약철회권 (전자상거래법 제17조)'],
                    ['결제 후 7일 이내 & 콘텐츠 생성 1건 이상', '환불 불가', '디지털 콘텐츠 사용 (동법 제17조 제2항 제5호)'],
                    ['결제 후 8일 이후', '환불 불가', '구독 해지로 다음 결제 중단만 가능'],
                    ['서비스 장애로 이용 불가 (회사 귀책)', '장애 기간 비례 환불 또는 사용량 보상', '회사 판단 후 개별 안내'],
                  ].map(([timing, refund, note]) => (
                    <tr key={timing} className="border-b border-[#b4bfce]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{timing}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{refund}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[#5b6573] text-xs">
              ※ 자동갱신 결제분에도 동일한 7일 청약철회 기준이 적용됩니다(매 결제일 기준).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              4. 환불 신청 방법
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-[#4a4f55] ml-2">
              <li>
                <strong className="text-[#202020]">이메일 접수:</strong>{' '}
                <a href="mailto:terro6936@gmail.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">
                  terro6936@gmail.com
                </a>으로 아래 정보와 함께 환불 요청
              </li>
              <li>
                <strong className="text-[#202020]">필수 기재 정보:</strong> 가입 이메일, 결제일, 결제 금액, 환불 사유
              </li>
              <li>
                <strong className="text-[#202020]">처리 기간:</strong> 접수 후 영업일 기준 3일 이내 검토 및 안내
              </li>
              <li>
                <strong className="text-[#202020]">환불 수단:</strong> 결제한 카드로 원상복구 (카드사 정책에 따라 3~5 영업일 소요)
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              5. 결제 실패 시 처리
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>카드 한도 초과·유효기간 만료 등으로 자동결제가 실패하면 등록된 이메일로 즉시 안내합니다.</li>
              <li>3일 후 1회 자동 재시도가 진행됩니다.</li>
              <li>재시도도 실패하면 구독이 자동 해지되며 서비스 이용이 중단됩니다.</li>
              <li>카드 변경은 마이페이지에서 재구독 신청으로 처리할 수 있습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              6. 환불 불가 사유
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>결제 후 서비스(콘텐츠 생성)를 1건 이상 사용한 경우</li>
              <li>결제일로부터 8일 이상 경과한 경우 (해지로 다음 결제 중단만 가능)</li>
              <li>이용약관 위반으로 서비스 이용이 제한된 경우</li>
              <li>허위 정보 제공 또는 부정 이용이 확인된 경우</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              7. 서비스 장애 시 보상
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>회사 귀책 사유로 인해 연속 4시간 이상 서비스 이용이 불가한 경우, 해당 기간에 대한 사용량 보상 또는 비례 환불을 제공합니다.</li>
              <li>보상 방식(환불/사용량 추가)은 회사가 판단하여 개별 안내합니다.</li>
              <li>서비스 점검 공지 후 발생한 일시적 중단은 보상 대상에서 제외됩니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              8. 문의처
            </h2>
            <div className="bg-[#eef2f6] border border-[#b4bfce] rounded-xl p-5 space-y-2 text-[#4a4f55]">
              <p><span className="text-[#202020]">서비스명:</span> 닥터포스트</p>
              <p>
                <span className="text-[#202020]">이메일:</span>{' '}
                <a href="mailto:terro6936@gmail.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">
                  terro6936@gmail.com
                </a>
              </p>
              <p className="text-xs text-[#5b6573]">평일 09:00 ~ 18:00 (주말·공휴일 제외)</p>
            </div>
          </section>

          <p className="text-xs text-[#5b6573] pt-6 border-t border-[#b4bfce]">
            본 환불·해지정책은 2026년 5월 8일부터 적용됩니다.
          </p>
        </div>
      </div>
    </main>
  );
}
