import type { DiagnosisReport, Finding, FindingDetail, FindingTone } from '@/content/lib/clinic-diagnosis/types';
import { FINDING_GROUP_LABEL, groupFindings } from '@/content/lib/clinic-diagnosis/findings';
import { riskOf } from '@/content/lib/clinic-diagnosis/compliance-scan';
import { summarizeQuestions } from '@/content/lib/clinic-diagnosis/citation-questions';

/**
 * 진단 결과 화면 (서버·클라이언트 공용 프레젠테이션).
 * /clinic-check 결과와 공유 리포트(/clinic-check/r/[token])가 같은 컴포넌트를 쓴다.
 *
 * ★ 화면은 축(블로그/홈페이지/AI/의료광고법)이 아니라 **원장이 할 판단**으로 나눈다.
 *   축별로 나열하면 뭐가 중요한지 보이지 않는다. 위에서부터
 *     ① 지금 고쳐야 할 것 ② 챙기면 좋을 것 ③ 잘하고 있는 것 ④ 확인하지 못한 것
 *   순서이고, 축 이름은 각 항목의 작은 꼬리표로만 남는다.
 *   (덩어리 문구는 FINDING_GROUP_LABEL 한 곳에서만 정한다)
 *
 * 화면 규칙:
 *  · 항목마다 "지금 상태 / 왜 문제인가 / 그래서 뭘 해야 하나" 3단을 그대로 보여준다.
 *  · 점수 하나로 뭉개지 않는다 — 좋음·주의·미확인을 따로 센다.
 *  · 미확인 항목을 숨기지 않는다. 확인 못 한 것도 결과의 일부다.
 *  · 기술 용어는 접어두기(details) 안으로. 기본 화면에는 원장이 아는 말만 남긴다.
 *  · 결과에 나온 주소는 반드시 눌러서 열린다(target=_blank + noopener).
 *  · 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *  · 모바일 우선(터치 타깃 44px).
 */

const AXIS_LABEL: Readonly<Record<Finding['axis'], string>> = {
  blog: '네이버 블로그',
  site: '홈페이지',
  ai: 'AI 검색',
  compliance: '의료광고법',
};

const TONE_STYLE: Readonly<Record<FindingTone, { badge: string; text: string; mark: string; border: string }>> = {
  good: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: '잘하고 있어요', mark: '✓', border: 'border-emerald-200' },
  warn: { badge: 'bg-[#fff2ee] text-[#c3341a] border-[#ffd0c4]', text: '살펴봐야 해요', mark: '!', border: 'border-[#ffd0c4]' },
  unknown: { badge: 'bg-[#eef2f6] text-[#5b6573] border-[#dbe2ea]', text: '확인하지 못했어요', mark: '?', border: 'border-[#dbe2ea]' },
};

/** 접어둔 세부 항목 — 기본 화면에는 안 보인다. */
function DetailList({ details }: { details: readonly FindingDetail[] }) {
  return (
    <details className="mt-2.5 group">
      <summary className="text-[12px] font-bold text-[#5b6573] cursor-pointer list-none min-h-[44px] flex items-center gap-1.5">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">
          ▸
        </span>
        어떤 항목인지 자세히 보기
      </summary>
      <ul className="mt-1.5 space-y-1.5 border-t border-[#eef2f6] pt-2.5">
        {details.map((detail) => (
          <li key={detail.label} className="flex items-start gap-2">
            <span
              className={`flex-shrink-0 text-[12px] font-black mt-0.5 ${
                detail.ok === true ? 'text-emerald-600' : detail.ok === false ? 'text-[#c3341a]' : 'text-[#8a93a0]'
              }`}
              aria-hidden="true"
            >
              {detail.ok === true ? '✓' : detail.ok === false ? '✕' : '?'}
            </span>
            <span className="min-w-0">
              <span className="text-[12.5px] font-bold text-[#202020]">{detail.label}</span>
              <span className="text-[11px] text-[#8a93a0] ml-1.5">
                {detail.ok === true ? '갖춰짐' : detail.ok === false ? '빠짐' : '확인 못 함'}
              </span>
              <span className="block text-[11.5px] text-[#5b6573] leading-relaxed">{detail.hint}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const tone = TONE_STYLE[finding.tone];
  return (
    <li className={`bg-white border ${tone.border} rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-14px_rgba(32,32,32,0.18)]`}>
      <div className="flex items-start gap-2.5">
        <span
          className={`flex-shrink-0 w-6 h-6 rounded-full border grid place-items-center text-[12px] font-black ${tone.badge}`}
          aria-hidden="true"
        >
          {tone.mark}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[15px] font-extrabold">{finding.label}</h4>
            {/* 축 이름은 섹션 제목이 아니라 작은 꼬리표로만 남긴다 */}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#dbe2ea] bg-[#f7f9fb] text-[#5b6573]">
              {AXIS_LABEL[finding.axis]}
            </span>
          </div>

          {/* ① 지금 상태 */}
          <p className="text-[13px] sm:text-sm text-[#202020] leading-relaxed mt-2">{finding.state}</p>

          {/* 눌러서 열어볼 수 있는 주소 */}
          {finding.link && (
            <p className="mt-2">
              <a
                href={finding.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] font-bold text-[#ff4628] underline underline-offset-2 break-all min-h-[44px] py-2"
              >
                {finding.link.label}
                <span aria-hidden="true">↗</span>
              </a>
              {finding.link.insecure && (
                <span className="block text-[11px] text-[#8a93a0] leading-relaxed">
                  보안 연결(https)이 안 돼서 일반 주소(http)로 연결했어요.
                </span>
              )}
            </p>
          )}

          {/* ② 왜 문제인가 */}
          {finding.why && (
            <p className="text-[12.5px] sm:text-[13px] text-[#7a2f1c] leading-relaxed mt-2 bg-[#fff7f5] border border-[#ffe0d6] rounded-xl px-3 py-2">
              <b className="font-bold">왜 문제인가</b> · {finding.why}
            </p>
          )}

          {/* ③ 그래서 뭘 해야 하나 */}
          <p className="text-[12.5px] sm:text-[13px] text-[#3c4653] leading-relaxed mt-2">
            <b className="font-bold text-[#202020]">무엇을 하면 되나</b> · {finding.action}
          </p>

          {finding.details && finding.details.length > 0 && <DetailList details={finding.details} />}
        </div>
      </div>
    </li>
  );
}

interface GroupSectionProps {
  readonly title: string;
  readonly subtitle: string;
  readonly findings: readonly Finding[];
  readonly accent: string;
  /** 기본으로 접어 둘지 (잘된 점처럼 짧게 보여도 되는 덩어리). */
  readonly collapsed?: boolean;
}

function GroupSection({ title, subtitle, findings, accent, collapsed }: GroupSectionProps) {
  if (findings.length === 0) return null;

  const heading = (
    <>
      <h3 className={`text-[17px] sm:text-xl font-black ${accent}`}>
        {title} <span className="text-[13px] font-bold">{findings.length}</span>
      </h3>
      <p className="text-[12px] text-[#5b6573] mt-0.5">{subtitle}</p>
    </>
  );

  const list = (
    <ul className="space-y-3 mt-3">
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </ul>
  );

  if (collapsed) {
    return (
      <section className="mt-8">
        <details>
          <summary className="cursor-pointer list-none min-h-[44px]">{heading}</summary>
          {list}
        </details>
      </section>
    );
  }

  return (
    <section className="mt-8">
      {heading}
      {list}
    </section>
  );
}

export default function DiagnosisReportView({ report }: { report: DiagnosisReport }) {
  const groups = groupFindings(report.findings);
  const clinic = report.clinic;
  /**
   * 위에 볼 게 있을 때만 "잘된 점"을 접는다.
   * 전부 잘하고 있는 병원에서 화면이 텅 비어 보이면 진단이 안 돌았다고 오해한다.
   */
  const hasIssues = groups.bad.length + groups.improve.length > 0;
  /**
   * AI 질문 목록 — 질문 단위가 정본.
   * 이 기능 이전에 발급된 공유 리포트에는 questions 가 없으므로 probes 로 그때 만든다
   * (같은 함수를 쓰므로 판정과 화면이 어긋나지 않는다).
   */
  const aiQuestions =
    report.ai.questions?.length ? report.ai.questions : summarizeQuestions(report.ai.probes ?? []);
  /** 확신까지는 아닌 채로 1위 후보로 진행한 상태인가 (구 리포트에는 없는 종류 → false). */
  const blogAssumed = report.blog.resolution?.kind === 'assumed';
  const blogClose = report.blog.resolution?.kind === 'assumed' && report.blog.resolution.close;

  return (
    <div className="bg-white text-[#202020]">
      {/* 병원 확인 — 진단 대상을 먼저 못박는다 (엉뚱한 병원 진단 방지) */}
      <div className="bg-[#eef2f6] border border-[#dbe2ea] rounded-2xl p-4 sm:p-5">
        <p className="text-[11px] font-extrabold text-[#ff4628] tracking-[1.5px]">진단 대상</p>
        <h2 className="text-lg sm:text-2xl font-black mt-1.5 leading-tight">{clinic.name}</h2>
        <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
          {clinic.roadAddress || clinic.lotAddress}
          {clinic.specialty && ` · ${clinic.specialty}`}
          {clinic.phone && ` · ${clinic.phone}`}
        </p>
        <p className="text-[11px] text-[#8a93a0] mt-2">
          행정안전부 공표 정보 기준 · {new Date(report.runAt).toLocaleString('ko-KR')} 진단
        </p>
      </div>

      {/*
        진단에 쓴 블로그 — **결과 맨 위에 눈에 띄게**.
        블로그 자동 특정은 남의 블로그를 짚을 위험이 늘 있다. 그래서 흐름은 끊지 않되
        어느 블로그로 진단했는지 먼저 보여주고, 주소를 눌러 확인·교체할 수 있게 한다.
      */}
      {report.blog.blogId && (
        <div
          className={`mt-3 rounded-2xl border p-4 ${
            blogAssumed ? 'bg-[#fffaf3] border-[#f5d9ac]' : 'bg-[#f7f9fb] border-[#dbe2ea]'
          }`}
        >
          <p className="text-[11px] font-extrabold tracking-[1.5px] text-[#5b6573]">진단한 블로그</p>
          <a
            href={`https://blog.naver.com/${report.blog.blogId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[14px] sm:text-[15px] font-extrabold text-[#ff4628] underline underline-offset-2 break-all min-h-[44px] py-2"
          >
            blog.naver.com/{report.blog.blogId}
            <span aria-hidden="true">↗</span>
          </a>
          <p className="text-[12.5px] text-[#4a4f55] leading-relaxed">
            {report.blog.source === 'manual'
              ? '직접 넣어 주신 주소로 진단했어요.'
              : blogAssumed
                ? '이 블로그를 병원 블로그로 보고 진단했습니다. 아니면 아래에서 바꿔 주세요.'
                : '병원 이름과 맞는 블로그를 찾아 이 블로그로 진단했어요. 주소를 눌러 확인해 보세요.'}
            {blogClose && ' 비슷한 후보가 하나 더 있었어요.'}
          </p>
        </div>
      )}

      {/* 요약 — 점수 하나로 뭉개지 않는다 */}
      <div className="grid grid-cols-3 gap-2.5 mt-4">
        {(
          [
            { key: 'bad', tone: 'warn' as const, count: groups.bad.length, label: FINDING_GROUP_LABEL.bad.title },
            { key: 'improve', tone: 'warn' as const, count: groups.improve.length, label: FINDING_GROUP_LABEL.improve.title },
            { key: 'good', tone: 'good' as const, count: groups.good.length, label: FINDING_GROUP_LABEL.good.title },
          ]
        ).map((item) => (
          <div key={item.key} className={`rounded-2xl border p-3 sm:p-4 text-center ${TONE_STYLE[item.tone].badge}`}>
            <p className="text-2xl sm:text-3xl font-black leading-none">{item.count}</p>
            <p className="text-[11px] font-bold mt-1.5 leading-snug">{item.label}</p>
          </div>
        ))}
      </div>

      {/* ① 지금 고쳐야 할 것 — 가장 위, 가장 크게 */}
      <GroupSection
        title={FINDING_GROUP_LABEL.bad.title}
        subtitle={FINDING_GROUP_LABEL.bad.subtitle}
        findings={groups.bad}
        accent="text-[#c3341a]"
      />

      {/* ② 챙기면 좋을 것 */}
      <GroupSection
        title={FINDING_GROUP_LABEL.improve.title}
        subtitle={FINDING_GROUP_LABEL.improve.subtitle}
        findings={groups.improve}
        accent="text-[#b45309]"
      />

      {/* ③ 잘하고 있는 것 — 짧게, 접어 둔다 */}
      <GroupSection
        title={FINDING_GROUP_LABEL.good.title}
        subtitle={hasIssues ? '이미 잘 되고 있어요. 눌러서 확인해 보세요.' : FINDING_GROUP_LABEL.good.subtitle}
        findings={groups.good}
        accent="text-emerald-700"
        collapsed={hasIssues}
      />

      {/* ④ 확인하지 못한 것 — 숨기지 않는다 */}
      <GroupSection
        title={FINDING_GROUP_LABEL.unknown.title}
        subtitle={FINDING_GROUP_LABEL.unknown.subtitle}
        findings={groups.unknown}
        accent="text-[#5b6573]"
        collapsed
      />

      {report.unchecked.length > 0 && (
        <p className="text-[12px] text-[#5b6573] mt-4 bg-[#f7f9fb] border border-[#dbe2ea] rounded-xl px-3.5 py-2.5 leading-relaxed">
          <b className="font-bold">확인하지 못한 항목</b> · {report.unchecked.join(' · ')} — 아래 상세 진단에서 주소를
          직접 넣어 주시면 채워 드릴게요.
        </p>
      )}

      {/*
        검출 문구 원문.
        ★ 위험(의료법이 명시적으로 금지한 유형)과 주의(문맥에 따라 갈리는 표현)를 색으로 나눈다.
          전부 같은 무게로 늘어놓으면 "후기"(경험담)와 "최신"이 같은 것으로 보인다.
        ⚠️ 위험이어도 "위반입니다"라고 쓰지 않는다 — "명시적으로 금지한 유형"까지가 한계다.
      */}
      {report.compliance.hits.length > 0 && (
        <section className="mt-8">
          <h3 className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] mb-2.5">확인해 보시면 좋을 표현</h3>
          <ul className="space-y-2">
            {report.compliance.hits.map((hit, i) => {
              const danger = riskOf(hit) === 'prohibited';
              return (
                <li
                  key={`${hit.postLink}-${i}`}
                  className={`rounded-xl px-4 py-3 border ${
                    danger ? 'bg-[#fff2ee] border-[#f0a494] border-l-4 border-l-[#d92d0b]' : 'bg-white border-[#dbe2ea]'
                  }`}
                >
                  <p className="text-[13px] font-bold flex flex-wrap items-center gap-x-2 gap-y-1">
                    {danger && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#d92d0b] text-white tracking-[0.5px] whitespace-nowrap">
                        위험
                      </span>
                    )}
                    <span className={danger ? 'text-[#a3220a]' : 'text-[#c3341a]'}>“{hit.phrase}”</span>
                    {danger && hit.riskLabel && (
                      <span className="text-[11px] font-bold text-[#a3220a]">{hit.riskLabel}</span>
                    )}
                    <span className="text-[11px] font-normal text-[#8a93a0]">{hit.postTitle}</span>
                  </p>
                  <p className={`text-[12px] mt-1 leading-relaxed ${danger ? 'text-[#7a2f1c]' : 'text-[#4a4f55]'}`}>
                    {hit.note}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-[#8a93a0] mt-2.5 leading-relaxed">
            “위험”은 의료법이 광고에서 명시적으로 금지한 유형(환자 후기·치료 전후 비교·효과 보장·다른 병원과의 비교)에
            해당할 수 있는 표현을 표시한 것이고, 나머지는 심의에서 자주 지적되는 표현이에요. 둘 다 기계적으로 찾아 표시한
            것이며 위반 여부를 판단한 결과가 아닙니다. 최종 판단은 심의기관과 담당 변호사의 몫입니다.
          </p>
        </section>
      )}

      {/*
        AI 인용 근거 — 어디서 물었고 무엇이 근거였는지 그대로 (접어 둔다).

        ★ 목록의 단위는 **질문**이다. 같은 질문을 AI 여러 곳에 돌린 결과는 한 줄로 묶고,
          엔진에 따라 갈렸으면 "AI 2곳 중 1곳에서 등장"처럼 그 사실을 그대로 적는다.
          엔진 호출을 한 줄씩 늘어놓으면 질문 3개가 6줄이 되어 실제보다 많이 물어본 것처럼
          보이고, 판정(질문 단위)과 화면(호출 단위)이 어긋난다.
        · 예전에 발급된 공유 리포트에는 questions 가 없으므로 probes 로 폴백한다.
      */}
      {report.ai.checked && aiQuestions.length > 0 && (
        <section className="mt-8">
          <details>
            <summary className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] cursor-pointer list-none min-h-[44px] flex items-center">
              ▸ AI에 실제로 물어본 질문 {aiQuestions.length}개 보기
            </summary>
            <ul className="space-y-2 mt-2.5">
              {aiQuestions.map((q, i) => (
                <li key={`${q.kind}-${i}`} className="bg-white border border-[#dbe2ea] rounded-xl px-4 py-3">
                  <p className="text-[13px] font-bold">
                    “{q.question}”
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#dbe2ea] bg-[#f7f9fb] text-[#5b6573] ml-2 whitespace-nowrap">
                      {q.kind === 'named' ? '이름 넣고 물음' : '이름 없이 물음'}
                    </span>
                  </p>
                  <p className={`text-[12px] mt-1 ${q.mentioned ? 'text-[#4a4f55]' : 'text-[#c3341a] font-bold'}`}>
                    {q.mentioned
                      ? q.engineTotal > 1 && q.engineMentioned < q.engineTotal
                        ? `AI ${q.engineTotal}곳 중 ${q.engineMentioned}곳에서만 병원 이름 등장`
                        : '병원 이름 등장'
                      : q.engineTotal > 1
                        ? `AI ${q.engineTotal}곳 모두에서 병원 이름 없음`
                        : '병원 이름 없음'}
                    {q.path === 'owned' && ' · 근거: 병원이 만든 글'}
                    {q.path === 'directory' && ` · 근거: 외부 목록(${q.thirdPartyHosts.join(', ') || '출처 미상'})`}
                    {q.path === 'name_only' && ' · 출처 표시 없음'}
                  </p>
                  {q.evidence && (
                    <p className="text-[11.5px] text-[#5b6573] mt-1.5 bg-[#f7f9fb] rounded-lg px-3 py-2 leading-relaxed">
                      {q.evidence}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <p className="text-[11px] text-[#8a93a0] text-center leading-relaxed mt-7">
        본 진단은 행정안전부 공표 정보와 네이버 공개 API, 그리고 공개된 블로그 글·홈페이지를 각각 한 번씩 열어 만든 특정 시점의 참고 자료예요.
        매출·방문자 수치는 추정하지 않고, 확인하지 못한 항목은 비워 둡니다. 검색 순위는 API 기준이라 실제 검색 화면과 다를 수 있어요.
      </p>
    </div>
  );
}
