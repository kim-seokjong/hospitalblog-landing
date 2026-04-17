import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용약관 | HospitalBlog",
  description: "HospitalBlog 서비스 이용약관",
};

export default function TermsPage() {
  return (
    <div style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 h-[60px]"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "rgba(10,12,16,0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Link href="/" className="flex items-center gap-2 text-sm font-medium no-underline" style={{ color: "var(--text)" }}>
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm"
            style={{
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.4)",
            }}
          >
            🏥
          </div>
          HospitalBlog
        </Link>
      </header>

      <div className="max-w-[780px] mx-auto px-6 py-12 pb-20">
        {/* 문서 헤더 */}
        <div className="mb-12 pb-8" style={{ borderBottom: "1px solid var(--border)" }}>
          <h1 className="text-3xl font-bold mb-2" style={{ letterSpacing: "-0.03em" }}>서비스 이용약관</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>시행일: 2026년 5월 1일 &nbsp;·&nbsp; 최종 수정: 2026년 5월 1일</p>
        </div>

        {/* 목차 */}
        <div className="p-6 rounded-xl mb-12" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-medium mb-4 tracking-widest" style={{ color: "var(--muted)" }}>목차</p>
          {[
            "제1조 목적", "제2조 용어의 정의", "제3조 약관의 효력 및 변경",
            "제4조 회원가입", "제5조 병원 인증", "제6조 서비스 이용",
            "제7조 요금제 및 결제", "제8조 환불 정책", "제9조 금지 행위",
            "제10조 이용 제한 및 계정 정지", "제11조 네이버 계정 정보 보관",
            "제12조 의료광고법 준수", "제13조 지식재산권", "제14조 개인정보 처리",
            "제15조 책임 제한", "제16조 서비스 변경 및 종료",
            "제17조 계약 해지", "제18조 분쟁 해결",
          ].map((item, i) => (
            <a
              key={i}
              href={`#a${i + 1}`}
              className="block text-sm py-1 transition-colors hover:text-white"
              style={{ color: "var(--muted)" }}
            >
              {item}
            </a>
          ))}
        </div>

        {/* 조항들 */}
        {[
          {
            id: "a1",
            title: "제1조 (목적)",
            content: (
              <p>이 약관은 광고, 진정성(이하 "회사")이 운영하는 병원 블로그 자동화 서비스 HospitalBlog(www.hospitalblog.kr, 이하 "서비스")의 이용과 관련하여 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
            ),
          },
          {
            id: "a2",
            title: "제2조 (용어의 정의)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li><strong>"서비스"</strong>란 회사가 제공하는 병원 블로그 자동화 SaaS 서비스 및 관련 부가 서비스를 말합니다.</li>
                <li><strong>"회원"</strong>이란 본 약관에 동의하고 회원가입을 완료한 병원 사업자를 말합니다.</li>
                <li><strong>"계정"</strong>이란 회원이 서비스를 이용하기 위해 설정한 이메일 및 비밀번호의 조합을 말합니다.</li>
                <li><strong>"콘텐츠"</strong>란 서비스를 통해 생성된 블로그 본문, 제목, 이미지 등 일체의 결과물을 말합니다.</li>
                <li><strong>"구독 플랜"</strong>이란 회원이 선택한 월정액 요금제(베이직, 스탠다드, 프로)를 말합니다.</li>
                <li><strong>"외부 계정 정보"</strong>란 회원이 자동발행 기능 이용을 위해 서비스에 등록한 네이버 블로그 계정의 아이디 및 비밀번호를 말합니다.</li>
              </ol>
            ),
          },
          {
            id: "a3",
            title: "제3조 (약관의 효력 및 변경)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>본 약관은 서비스 화면에 게시하거나 기타 방법으로 회원에게 공지함으로써 효력이 발생합니다.</li>
                <li>회사는 필요한 경우 약관을 변경할 수 있으며, 변경 시 최소 7일 전에 공지합니다. 변경 내용이 회원에게 불리한 경우 30일 전에 공지합니다.</li>
                <li>회원이 변경된 약관에 동의하지 않는 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다.</li>
              </ol>
            ),
          },
          {
            id: "a4",
            title: "제4조 (회원가입)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회원가입은 서비스 가입 신청 양식에 따라 정보를 입력하고 본 약관에 동의함으로써 완료됩니다.</li>
                <li>회사는 다음 각 호에 해당하는 경우 가입을 거부하거나 사후에 이용계약을 해지할 수 있습니다.
                  <ul className="list-disc pl-5 mt-1.5 space-y-1">
                    <li>타인의 명의를 도용한 경우</li>
                    <li>허위 정보를 기재한 경우</li>
                    <li>병원·의료기관 사업자가 아닌 경우</li>
                    <li>이전에 서비스 이용 제한을 받은 경우</li>
                  </ul>
                </li>
              </ol>
            ),
          },
          {
            id: "a5",
            title: "제5조 (병원 인증)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회원은 병원 인증을 위해 사업자등록증을 제출해야 하며, 회사는 이를 안전하게 보관합니다.</li>
                <li>허위 사업자등록증 제출 시 서비스 이용이 즉시 중단될 수 있으며, 관련 법적 책임은 회원에게 있습니다.</li>
              </ol>
            ),
          },
          {
            id: "a6",
            title: "제6조 (서비스 이용)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>서비스는 연중무휴 24시간 제공을 원칙으로 합니다.</li>
                <li>회사는 시스템 점검, 장애, 천재지변 등의 사유로 서비스를 일시 중단할 수 있습니다.</li>
                <li>서비스를 통해 생성된 블로그 콘텐츠의 게시 및 관리에 대한 최종 책임은 회원에게 있습니다.</li>
              </ol>
            ),
          },
          {
            id: "a7",
            title: "제7조 (요금제 및 결제)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>서비스는 다음과 같은 구독 플랜을 제공합니다. 각 플랜의 상세 기능 및 금액은 서비스 내 요금 안내 페이지에서 확인할 수 있습니다.
                  <ul className="list-disc pl-5 mt-1.5 space-y-1">
                    <li><strong>베이직</strong>: 기본 블로그 자동생성 기능 제공</li>
                    <li><strong>스탠다드</strong>: 베이직 + 이미지 생성, SEO 분석 포함</li>
                    <li><strong>프로</strong>: 스탠다드 + 네이버 자동발행, 무제한 생성</li>
                  </ul>
                </li>
                <li>구독 결제는 매월 자동 갱신되며, 회원이 직접 해지하기 전까지 매월 동일 금액이 청구됩니다.</li>
                <li>결제 실패 시 회사는 재청구를 시도하며, 일정 기간 내 결제가 이루어지지 않을 경우 서비스 이용이 일시 중단될 수 있습니다.</li>
                <li>요금은 부가세 포함 금액으로 표시되며, 결제 수단은 신용카드 등 회사가 지정한 방법으로 제한됩니다.</li>
                <li>요금은 사전 공지 후 변경될 수 있으며, 기존 구독 회원에게는 변경 30일 전에 이메일로 안내합니다.</li>
              </ol>
            ),
          },
          {
            id: "a8",
            title: "제8조 (환불 정책)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>구독 플랜 결제 후 7일 이내에 콘텐츠를 생성하지 않은 경우 전액 환불이 가능합니다.</li>
                <li>콘텐츠를 1건 이상 생성한 경우 이용 건수를 제외한 잔여 금액을 일할 계산하여 환불합니다.</li>
                <li>건당 과금 상품은 콘텐츠 생성 전까지만 환불 가능합니다.</li>
                <li>환불은 결제 수단으로 3~5 영업일 내 처리됩니다.</li>
              </ol>
            ),
          },
          {
            id: "a9",
            title: "제9조 (금지 행위)",
            content: (
              <>
                <p className="mb-2">회원은 다음 행위를 해서는 안 됩니다.</p>
                <ol className="list-decimal pl-6 space-y-1.5">
                  <li>타인의 계정 도용 또는 허위 정보 입력</li>
                  <li>서비스를 이용한 스팸, 허위정보 유포</li>
                  <li>의료법에 위반되는 과장·허위 광고 콘텐츠 게시</li>
                  <li>생성된 콘텐츠를 무단으로 제3자에게 판매하거나 재배포하는 행위</li>
                  <li>서비스의 정상적인 운영을 방해하는 행위</li>
                  <li>네이버 이용약관에 위반되는 방식으로 블로그를 운영하는 행위</li>
                  <li>타인의 네이버 계정 정보를 도용하여 서비스에 등록하는 행위</li>
                  <li>기타 관련 법령을 위반하는 행위</li>
                </ol>
              </>
            ),
          },
          {
            id: "a10",
            title: "제10조 (이용 제한 및 계정 정지)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회사는 회원이 제9조의 금지 행위를 한 경우 다음 각 호의 조치를 취할 수 있습니다.
                  <ul className="list-disc pl-5 mt-1.5 space-y-1">
                    <li><strong>1단계 경고</strong>: 이메일을 통한 서면 경고</li>
                    <li><strong>2단계 일시 정지</strong>: 7일 이내의 서비스 이용 중단</li>
                    <li><strong>3단계 영구 정지</strong>: 이용계약 강제 해지 및 재가입 제한</li>
                  </ul>
                </li>
                <li>위반 행위의 중대성에 따라 회사는 경고 없이 즉시 이용을 정지하거나 계약을 해지할 수 있습니다.</li>
                <li>이용 제한 조치에 이의가 있는 회원은 조치일로부터 14일 이내에 contact@hospitalblog.kr 로 이의를 신청할 수 있으며, 회사는 7일 이내에 답변합니다.</li>
                <li>이용 제한으로 인한 손해에 대해 회사는 책임을 지지 않습니다.</li>
              </ol>
            ),
          },
          {
            id: "a11",
            title: "제11조 (네이버 계정 정보 보관)",
            content: (
              <>
                <div
                  className="rounded-r-xl p-4 mb-4 text-sm leading-relaxed"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderLeft: "3px solid #f59e0b",
                    color: "var(--muted)",
                  }}
                >
                  본 조항은 서비스의 핵심 기능인 네이버 블로그 자동발행을 위해 회원의 외부 계정 정보를 수집·보관하는 것에 관한 내용입니다. 반드시 내용을 확인하고 동의하여 주시기 바랍니다.
                </div>
                <ol className="list-decimal pl-6 space-y-1.5">
                  <li>회원이 네이버 자동발행 기능을 이용하려면 네이버 아이디 및 비밀번호(이하 "외부 계정 정보")를 서비스에 등록해야 합니다.</li>
                  <li>회사는 등록된 외부 계정 정보를 AES-256-GCM 방식으로 암호화하여 서버에 안전하게 보관하며, 자동발행 기능 실행 이외의 목적으로는 사용하지 않습니다.</li>
                  <li>회사 직원은 외부 계정 정보의 원문에 접근할 수 없으며, 암호화된 형태로만 저장됩니다.</li>
                  <li>회원은 언제든지 서비스 내 설정 메뉴에서 외부 계정 정보를 삭제할 수 있으며, 삭제 즉시 서버에서 완전히 파기됩니다.</li>
                  <li>외부 계정 정보의 도용 또는 유출로 인한 피해를 방지하기 위해 회원은 네이버 계정의 이중인증(2FA) 설정을 권장합니다.</li>
                  <li>네이버 계정 정보 유출로 인한 피해가 회사의 보안 관리 소홀에 기인하는 경우 회사가 책임을 지며, 회원 본인의 부주의에 의한 경우 회사는 책임을 지지 않습니다.</li>
                </ol>
              </>
            ),
          },
          {
            id: "a12",
            title: "제12조 (의료광고법 준수)",
            content: (
              <div
                className="rounded-r-xl p-4 text-sm leading-relaxed"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--accent)",
                  color: "var(--muted)",
                }}
              >
                본 서비스는 의료법 제56조(의료광고의 금지 등)에 따른 자동 필터링 기능을 제공합니다.<br />
                단, 생성된 콘텐츠의 최종 의료광고 심의 및 법적 책임은 회원(병원)에게 있습니다.<br />
                의료광고 심의가 필요한 경우 대한의사협회 등 관련 심의기관을 통해 별도로 확인하시기 바랍니다.
              </div>
            ),
          },
          {
            id: "a13",
            title: "제13조 (지식재산권)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>서비스의 소프트웨어, UI/UX, 알고리즘에 관한 지식재산권은 회사에 귀속됩니다.</li>
                <li>서비스를 통해 생성된 콘텐츠의 저작권은 해당 콘텐츠를 생성한 회원에게 귀속됩니다. 단, 회사는 서비스 개선 목적으로 생성된 콘텐츠를 익명 처리하여 활용할 수 있습니다.</li>
              </ol>
            ),
          },
          {
            id: "a14",
            title: "제14조 (개인정보 처리)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회사는 서비스 제공을 위해 필요한 최소한의 개인정보를 수집·이용합니다.</li>
                <li>개인정보의 수집 항목, 이용 목적, 보유 기간 등 세부 사항은 서비스 내{" "}
                  <Link href="/privacy" style={{ color: "var(--accent)" }}>개인정보처리방침</Link>에 따릅니다.
                </li>
                <li>회사는 관련 법령에 따라 회원의 개인정보를 안전하게 관리하며, 법령에서 정한 경우 외에는 제3자에게 제공하지 않습니다.</li>
              </ol>
            ),
          },
          {
            id: "a15",
            title: "제15조 (책임 제한)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회사는 네이버 정책 변경으로 인한 자동화 기능 제한 및 SEO 효과 변화에 대해 책임을 지지 않습니다.</li>
                <li>회사는 AI가 생성한 콘텐츠의 의료적 정확성 또는 광고 효과에 대해 보장하지 않습니다.</li>
                <li>회원이 게시한 콘텐츠로 인해 발생하는 의료광고법 위반 등 법적 책임은 회원 본인에게 있습니다.</li>
                <li>회사는 천재지변, 전쟁, 재난 등 불가항력적 사유로 인한 서비스 중단에 대해 책임을 지지 않습니다.</li>
                <li>서비스는 Claude AI(Anthropic), Pexels, fal.ai 등 제3자 API를 활용합니다. 해당 외부 서비스의 장애, 정책 변경, 서비스 중단으로 인한 기능 제한에 대해 회사는 책임을 지지 않습니다.</li>
                <li>회사의 손해배상 책임은 해당 월 결제 금액을 초과하지 않습니다.</li>
              </ol>
            ),
          },
          {
            id: "a16",
            title: "제16조 (서비스 변경 및 종료)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회사는 서비스의 기능, 요금제, 정책 등을 변경할 수 있으며, 중요한 변경 사항은 최소 30일 전에 공지합니다.</li>
                <li>회사가 서비스를 종료하는 경우 최소 60일 전에 서비스 내 공지 및 이메일을 통해 안내합니다.</li>
                <li>서비스 종료 시 잔여 구독 기간에 대한 요금은 일할 계산하여 환불합니다.</li>
                <li>서비스 종료 통보 후 회원은 생성된 콘텐츠를 종료일 전까지 직접 백업해야 하며, 종료 이후 데이터 복구는 불가합니다.</li>
              </ol>
            ),
          },
          {
            id: "a17",
            title: "제17조 (계약 해지)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>회원은 언제든지 서비스 내 설정 메뉴를 통해 탈퇴할 수 있습니다.</li>
                <li>탈퇴 후에도 해당 월 결제 기간까지 서비스를 이용할 수 있습니다.</li>
                <li>탈퇴 시 회원의 개인정보 및 생성 콘텐츠는 관계 법령에 따라 다음 기간 보관 후 파기됩니다.
                  <ul className="list-disc pl-5 mt-1.5 space-y-1">
                    <li>계약·청약철회 기록: 5년 (전자상거래법)</li>
                    <li>대금결제 및 재화 공급 기록: 5년 (전자상거래법)</li>
                    <li>소비자 불만·분쟁 처리 기록: 3년 (전자상거래법)</li>
                    <li>네이버 계정 정보(외부 계정 정보): 탈퇴 즉시 파기</li>
                  </ul>
                </li>
              </ol>
            ),
          },
          {
            id: "a18",
            title: "제18조 (분쟁 해결)",
            content: (
              <ol className="list-decimal pl-6 space-y-1.5">
                <li>본 약관과 관련된 분쟁에 대해 회사와 회원은 상호 협의를 통해 해결하는 것을 원칙으로 합니다.</li>
                <li>협의가 이루어지지 않는 경우 회사의 소재지를 관할하는 법원(대구지방법원)을 관할 법원으로 합니다.</li>
                <li>본 약관에 관한 준거법은 대한민국 법으로 합니다.</li>
              </ol>
            ),
          },
        ].map(({ id, title, content }) => (
          <div key={id} id={id} className="mb-12">
            <h2
              className="text-base font-bold mb-4 pb-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              {title}
            </h2>
            <div className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {content}
            </div>
          </div>
        ))}

        {/* 부칙 */}
        <div className="mb-12">
          <h2 className="text-base font-bold mb-4 pb-2" style={{ borderBottom: "1px solid var(--border)" }}>부칙</h2>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>본 약관은 2026년 5월 1일부터 시행합니다.</p>
          <div
            className="rounded-r-xl p-4 text-sm leading-relaxed"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent)",
              color: "var(--muted)",
            }}
          >
            <strong style={{ color: "var(--text)" }}>회사 정보</strong><br />
            상호: 광고, 진정성 &nbsp;·&nbsp; 대표자: 김석종<br />
            주소: 대구광역시 수성구 청호로422 2층<br />
            사업자등록번호: 570-60-00560 &nbsp;·&nbsp; 통신판매업 신고번호: 신청 예정<br />
            이메일: contact@hospitalblog.kr &nbsp;·&nbsp; 전화: 010-2558-1115
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <footer
        className="px-6 py-8 text-center text-xs"
        style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}
      >
        <p>© 2026 광고, 진정성 &nbsp;·&nbsp;
          <Link href="/terms" className="hover:text-white transition-colors mx-2">이용약관</Link> ·
          <Link href="/privacy" className="hover:text-white transition-colors mx-2">개인정보처리방침</Link>
        </p>
      </footer>
    </div>
  );
}
