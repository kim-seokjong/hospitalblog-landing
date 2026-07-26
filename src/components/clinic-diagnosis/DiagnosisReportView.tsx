import type { DiagnosisReport, Finding, FindingTone } from '@/content/lib/clinic-diagnosis/types';
import { summarizeFindings } from '@/content/lib/clinic-diagnosis/findings';

/**
 * 진단 결과 화면 (서버·클라이언트 공용 프레젠테이션).
 * /clinic-check 결과와 공유 리포트(/clinic-check/r/[token])가 같은 컴포넌트를 쓴다.
 *
 * 화면 규칙:
 *  · 항목마다 "지금 상태 / 왜 문제인가 / 그래서 뭘 해야 하나" 3단을 그대로 보여준다.
 *  · 점수 하나로 뭉개지 않는다 — 좋음·주의·미확인을 따로 센다.
 *  · 미확인 항목을 숨기지 않는다. 확인 못 한 것도 결과의 일부다.
 *  · 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *  · 모바일 우선(터치 타깃 44px, 1열 → sm 이상 2열).
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
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone.badge}`}>{tone.text}</span>
          </div>

          {/* ① 지금 상태 */}
          <p className="text-[13px] sm:text-sm text-[#202020] leading-relaxed mt-2">{finding.state}</p>

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
        </div>
      </div>
    </li>
  );
}

function AxisSection({ axis, findings }: { axis: Finding['axis']; findings: readonly Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] mb-2.5">{AXIS_LABEL[axis]}</h3>
      <ul className="space-y-3">
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
      </ul>
    </section>
  );
}

export default function DiagnosisReportView({ report }: { report: DiagnosisReport }) {
  const summary = summarizeFindings(report.findings);
  const clinic = report.clinic;
  const axes: readonly Finding['axis'][] = ['blog', 'site', 'ai', 'compliance'];

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

      {/* 요약 — 점수 하나로 뭉개지 않는다 */}
      <div className="grid grid-cols-3 gap-2.5 mt-4">
        {(
          [
            { tone: 'good' as const, count: summary.good, label: '잘하고 있는 항목' },
            { tone: 'warn' as const, count: summary.warn, label: '살펴볼 항목' },
            { tone: 'unknown' as const, count: summary.unknown, label: '확인 못 한 항목' },
          ]
        ).map((item) => (
          <div key={item.tone} className={`rounded-2xl border p-3 sm:p-4 text-center ${TONE_STYLE[item.tone].badge}`}>
            <p className="text-2xl sm:text-3xl font-black leading-none">{item.count}</p>
            <p className="text-[11px] font-bold mt-1.5 leading-snug">{item.label}</p>
          </div>
        ))}
      </div>

      {report.unchecked.length > 0 && (
        <p className="text-[12px] text-[#5b6573] mt-3 bg-[#f7f9fb] border border-[#dbe2ea] rounded-xl px-3.5 py-2.5 leading-relaxed">
          <b className="font-bold">확인하지 못한 항목</b> · {report.unchecked.join(' · ')} — 추정으로 채우지 않고 그대로
          비워 뒀어요. 아래 상세 진단에서 주소를 직접 넣어 주시면 채워 드릴게요.
        </p>
      )}

      {axes.map((axis) => (
        <AxisSection key={axis} axis={axis} findings={report.findings.filter((f) => f.axis === axis)} />
      ))}

      {/* 검출 문구 원문 — 겁주지 않는 톤으로 */}
      {report.compliance.hits.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] mb-2.5">확인해 보시면 좋을 표현</h3>
          <ul className="space-y-2">
            {report.compliance.hits.map((hit, i) => (
              <li key={`${hit.postLink}-${i}`} className="bg-white border border-[#dbe2ea] rounded-xl px-4 py-3">
                <p className="text-[13px] font-bold">
                  <span className="text-[#c3341a]">“{hit.phrase}”</span>
                  <span className="text-[11px] font-normal text-[#8a93a0] ml-2">{hit.postTitle}</span>
                </p>
                <p className="text-[12px] text-[#4a4f55] mt-1 leading-relaxed">{hit.note}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[#8a93a0] mt-2.5 leading-relaxed">
            이 목록은 심의에서 자주 지적되는 표현을 기계적으로 찾아 표시한 것이며, 위반 여부를 판단한 결과가 아니에요.
            최종 판단은 심의기관과 담당 변호사의 몫입니다.
          </p>
        </section>
      )}

      {/* AI 인용 근거 — 어디서 물었고 무엇이 근거였는지 그대로 */}
      {report.ai.checked && report.ai.probes.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] mb-2.5">AI에 실제로 물어본 질문</h3>
          <ul className="space-y-2">
            {report.ai.probes.map((probe, i) => (
              <li key={`${probe.engine}-${i}`} className="bg-white border border-[#dbe2ea] rounded-xl px-4 py-3">
                <p className="text-[13px] font-bold">“{probe.question}”</p>
                <p className="text-[12px] text-[#4a4f55] mt-1">
                  {probe.mentioned ? '병원 이름 등장' : '병원 이름 없음'}
                  {probe.path === 'owned' && ' · 근거: 병원이 만든 글'}
                  {probe.path === 'directory' && ` · 근거: 외부 목록(${probe.thirdPartyHosts.join(', ') || '출처 미상'})`}
                  {probe.path === 'name_only' && ' · 출처 표시 없음'}
                </p>
                {probe.evidence && (
                  <p className="text-[11.5px] text-[#5b6573] mt-1.5 bg-[#f7f9fb] rounded-lg px-3 py-2 leading-relaxed">
                    {probe.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-[#8a93a0] text-center leading-relaxed mt-7">
        본 진단은 행정안전부 공표 정보와 네이버 공개 API, 홈페이지 1회 조회로 만든 특정 시점의 참고 자료예요.
        매출·방문자 수치는 추정하지 않고, 확인하지 못한 항목은 비워 둡니다. 검색 순위는 API 기준이라 실제 검색 화면과 다를 수 있어요.
      </p>
    </div>
  );
}
