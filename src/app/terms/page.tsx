import Link from 'next/link';

export const metadata = {
  title: '이용약관 | 닥터포스트',
  description: '닥터포스트 이용약관',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#eaeef4] text-[#4a4f55]">
      <div className="max-w-3xl mx-auto px-6 py-16">

        <div className="mb-12">
          <Link href="/" className="text-sm text-[#ff4628] hover:text-[#e63a1c] transition-colors mb-6 inline-block">
            ← 홈으로
          </Link>
          <h1 className="text-3xl font-bold text-[#202020] mb-3">이용약관</h1>
          <p className="text-sm text-[#5b6573]">시행일: 2026년 5월 8일 &nbsp;|&nbsp; 최종 수정: 2026년 5월 8일</p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed">

          <p>
            닥터포스트(이하 "서비스")는 병원 마케팅 블로그 콘텐츠 자동 생성 SaaS입니다.
            본 약관은 서비스 이용에 관한 조건과 절차, 이용자와 운영자의 권리·의무·책임에 대해 규정합니다.
            서비스 이용 시 본 약관에 동의한 것으로 간주됩니다.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제1조 (목적 및 적용 범위)
            </h2>
            <p className="text-[#4a4f55]">
              본 약관은 닥터포스트가 제공하는 병원 블로그 콘텐츠 자동 생성 서비스의 이용과 관련하여
              회사와 이용자 사이의 권리, 의무 및 책임 사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제2조 (이용자 자격)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>본 서비스는 병원·의원·한의원 등 의료기관 관계자(원장, 부원장, 간호사, 원무, 마케터 등)를 대상으로 합니다.</li>
              <li>만 19세 이상인 자만 이용할 수 있습니다.</li>
              <li>허위 정보로 가입한 경우 서비스 이용이 제한될 수 있습니다.</li>
              <li>1인 1계정 원칙을 준수해야 합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제3조 (서비스 내용)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>키워드 기반 블로그 제목 및 본문 자동 생성 (AI 활용)</li>
              <li>의료광고법 금지어 자동 필터링 및 교체</li>
              <li>AI 이미지 생성 (실사·카드뉴스 스타일)</li>
              <li>네이버 블로그 수동 발행 도우미 (복사·다운로드 지원)</li>
              <li>SEO 분석, 키워드 트렌드, 독창성 검사</li>
              <li>사용량 현황 조회</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제4조 (요금제 및 사용량)
            </h2>
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#eef2f6]">
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">플랜</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">요금</th>
                    <th className="text-left px-4 py-3 text-[#202020] font-medium border border-[#b4bfce]">월 사용 한도</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['베이직', '99,000원/월', '월 10건'],
                    ['스탠다드', '199,000원/월', '월 20건'],
                    ['프로', '399,000원/월', '무제한'],
                  ].map(([plan, price, limit]) => (
                    <tr key={plan} className="border-b border-[#b4bfce]">
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{plan}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{price}</td>
                      <td className="px-4 py-3 text-[#4a4f55] border border-[#b4bfce]">{limit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>사용량은 콘텐츠 본문 생성 1회를 1건으로 계산합니다.</li>
              <li>월 사용량은 매월 결제일 기준으로 초기화됩니다.</li>
              <li>요금제 변경은 즉시 적용되며, 상위 플랜 전환 시 남은 사용량은 새 플랜 한도로 대체됩니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제5조 (자동갱신 결제)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>본 서비스는 매월 동일한 날짜에 자동 청구되는 <strong className="text-[#202020]">자동갱신 구독 방식</strong>으로만 운영됩니다.</li>
              <li>최초 결제 시 등록한 카드(빌링키)로 매월 결제일에 자동으로 요금이 청구됩니다.</li>
              <li>다음 결제일 7일 전 등록된 이메일로 사전 안내를 발송합니다(방통위 「전자상거래법」 준수).</li>
              <li>결제일에 카드 한도 초과·유효기간 만료 등으로 결제가 실패할 경우, 3일 후 1회 재시도 후에도 실패 시 구독이 자동 해지될 수 있습니다.</li>
              <li>이용자는 마이페이지(<code className="text-[#ff4628]">/app/subscription</code>)에서 언제든지 1클릭으로 해지할 수 있습니다.</li>
              <li>해지하더라도 마지막 결제일로부터 1개월(이미 결제한 기간) 동안은 서비스를 계속 이용할 수 있습니다.</li>
              <li>해지 후 다음 결제일이 도래하면 더 이상 청구되지 않습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제6조 (청약철회 및 환불)
            </h2>
            <p className="text-[#4a4f55] mb-3">
              「전자상거래 등에서의 소비자보호에 관한 법률」에 따른 청약철회권 및 환불 정책을 준수합니다.
            </p>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>최초 결제일로부터 <strong className="text-[#202020]">7일 이내, 콘텐츠 생성을 1건도 사용하지 않은 경우</strong> 100% 환불됩니다.</li>
              <li>1건 이상 콘텐츠를 생성한 경우 디지털 콘텐츠 사용으로 간주되어 환불이 제한될 수 있습니다(동법 제17조 제2항 제5호).</li>
              <li>자동갱신 결제 후에도 마지막 결제일 기준 7일 이내 사용분이 없다면 동일 기준으로 환불 가능합니다.</li>
              <li>구체적인 환불 절차와 기준은{' '}
                <Link href="/refund" className="text-[#ff4628] underline hover:text-[#e63a1c]">환불정책</Link>{' '}
                페이지를 따릅니다.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제7조 (이용 제한 및 금지 행위)
            </h2>
            <p className="text-[#4a4f55] mb-3">다음 행위는 금지되며, 위반 시 서비스 이용이 즉시 제한될 수 있습니다.</p>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>의료광고법·의료법 등 관련 법령을 위반하는 콘텐츠 생성 및 게시</li>
              <li>타인의 계정을 도용하거나 허위 정보로 가입</li>
              <li>서비스 API를 무단으로 자동화하거나 과부하를 유발하는 행위</li>
              <li>생성된 콘텐츠를 제3자에게 재판매하는 행위</li>
              <li>서비스 시스템을 역공학하거나 비정상적인 방법으로 접근하는 행위</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제8조 (콘텐츠 책임)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>AI가 생성한 콘텐츠는 참고용이며, 최종 게시 전 이용자가 직접 검토·확인해야 합니다.</li>
              <li>생성된 콘텐츠의 의료광고법 적합성, 사실 정확성, 법적 적법성에 대한 책임은 이용자에게 있습니다.</li>
              <li>회사는 AI 생성 콘텐츠로 인한 법적 분쟁, 행정 처분 등에 대해 책임을 지지 않습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제9조 (지적재산권)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>서비스의 소프트웨어, UI/UX 디자인, 알고리즘 등의 지적재산권은 회사에 귀속됩니다.</li>
              <li>이용자가 입력한 키워드·병원 정보 및 생성된 콘텐츠의 저작권은 이용자에게 귀속됩니다.</li>
              <li>회사는 서비스 개선을 위해 익명화된 통계 데이터를 활용할 수 있습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제10조 (서비스 중단 및 변경)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>회사는 시스템 점검, 장애, 천재지변 등의 사유로 서비스를 일시 중단할 수 있습니다.</li>
              <li>서비스 내용, 요금제, 기능은 회사의 판단에 따라 변경될 수 있으며, 변경 7일 전 공지합니다.</li>
              <li>단, 이용자에게 불리한 변경은 30일 이전에 공지합니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제11조 (면책조항)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>회사는 AI 생성 콘텐츠의 정확성, 완전성, 법적 적합성을 보증하지 않습니다.</li>
              <li>이용자가 생성한 콘텐츠를 블로그 등 외부 채널에 게시함으로써 발생하는 문제에 대해 회사는 책임을 지지 않습니다.</li>
              <li>회사의 귀책 사유 없이 발생한 손해(이용자 과실, 해킹, 불가항력 등)에 대해서는 책임을 지지 않습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[#202020] mb-4 pb-2 border-b border-[#b4bfce]">
              제12조 (분쟁 해결 및 준거법)
            </h2>
            <ul className="list-disc list-inside space-y-2 text-[#4a4f55] ml-2">
              <li>서비스 이용과 관련한 분쟁은 먼저 이메일(<a href="mailto:terro6936@gmail.com" className="text-[#ff4628] hover:text-[#e63a1c] underline">terro6936@gmail.com</a>)로 협의를 시도합니다.</li>
              <li>협의가 이루어지지 않는 경우 대한민국 법률을 준거법으로 하며, 관할법원은 민사소송법에 따릅니다.</li>
            </ul>
          </section>

          <p className="text-xs text-[#5b6573] pt-6 border-t border-[#b4bfce]">
            본 약관은 2026년 5월 8일부터 적용됩니다.
          </p>
        </div>
      </div>
    </main>
  );
}
