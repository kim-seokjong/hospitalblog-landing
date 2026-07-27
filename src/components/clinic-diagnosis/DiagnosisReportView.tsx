import type {
  ComplianceExcerptWhere,
  DiagnosisReport,
  Finding,
  FindingDetail,
  FindingGroup,
} from '@/content/lib/clinic-diagnosis/types';
import type { ChannelSection } from '@/content/lib/clinic-diagnosis/findings';
import {
  FINDING_GROUP_LABEL,
  channelBadges,
  channelStatusText,
  findingGroupOf,
  groupFindingsByChannel,
  normalizeStoredFindings,
} from '@/content/lib/clinic-diagnosis/findings';
import { riskOf } from '@/content/lib/clinic-diagnosis/compliance-scan';
import { summarizeQuestions } from '@/content/lib/clinic-diagnosis/citation-questions';
import { buildConversionCta, doctorpostLine } from '@/content/lib/clinic-diagnosis/conversion';
import DiagnosisEmailCapture from './DiagnosisEmailCapture';
import DiagnosisCta from './DiagnosisCta';

/**
 * 진단 결과 화면 (서버·클라이언트 공용 프레젠테이션).
 * /clinic-check 결과와 공유 리포트(/clinic-check/r/[token])가 같은 컴포넌트를 쓴다.
 *
 * ★ 화면의 1차 그룹은 **채널**이다 (의료광고법 / AI 검색 / 네이버 블로그 / 홈페이지).
 *
 *   심각도로만 나누던 판에서는 같은 채널 항목이 세 덩어리에 흩어졌다. 실제 결과에서
 *   AI 항목이 "챙기면 좋을 것"에 하나, "잘하고 있는 것"에 둘로 갈라져 있어서
 *   **"그래서 AI는 되는 건가 안 되는 건가"를 알 수 없었다**(대표 지적 2026-07-27).
 *
 *   ⚠️ 심각도를 버린 것이 아니다. 버리면 "뭐부터 손대나"를 잃는다. 그래서
 *     · 채널 순서   = 문제가 심한 채널이 위 (groupFindingsByChannel)
 *     · 채널 안 순서 = 나쁜 항목부터 (기존 FINDING_WEIGHT.rank 그대로)
 *     · 항목마다    = "지금 고쳐야 할 것 / 챙기면 좋을 것 / 잘하고 있는 것" 배지
 *   (덩어리 문구는 FINDING_GROUP_LABEL 한 곳에서만 정한다 — 여기서 새로 짓지 않는다)
 *
 * 화면 규칙:
 *  · 항목마다 "지금 상태 / 왜 문제인가 / 그래서 뭘 해야 하나" 3단을 그대로 보여준다.
 *  · 점수 하나로 뭉개지 않는다 — 상단 요약은 채널 4칸으로 어디가 약한지만 보여준다.
 *  · 미확인 항목을 숨기지 않는다. 확인 못 한 것도 결과의 일부다.
 *    (해당 채널 안에 접어 둔다 — 따로 빼면 채널이 다시 흩어진다)
 *  · 기술 용어는 접어두기(details) 안으로. 기본 화면에는 원장이 아는 말만 남긴다.
 *  · 결과에 나온 주소는 반드시 눌러서 열린다(target=_blank + noopener).
 *  · 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *  · 모바일 우선(터치 타깃 44px).
 */

/** 검출 표현이 어디에 있었는지 — 원장이 글을 열지 않고도 위치를 알 수 있게. */
const EXCERPT_WHERE_LABEL: Readonly<Record<ComplianceExcerptWhere, string>> = {
  title: '제목',
  lead: '글 앞부분',
  body: '본문',
};

/**
 * 분류별 색 — 이름은 FINDING_GROUP_LABEL 에서만 가져온다(여기서 새로 짓지 않는다).
 * 빨강은 "지금 고쳐야 할 것" 하나에만 쓴다. 흔해지면 정작 급한 게 묻힌다.
 */
const GROUP_STYLE: Readonly<Record<FindingGroup, { badge: string; border: string; mark: string }>> = {
  bad: { badge: 'bg-[#fff2ee] text-[#c3341a] border-[#ffd0c4]', border: 'border-[#ffd0c4]', mark: '!' },
  improve: { badge: 'bg-[#fff8ec] text-[#b45309] border-[#f5d9ac]', border: 'border-[#f5d9ac]', mark: '↑' },
  good: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', border: 'border-emerald-200', mark: '✓' },
  unknown: { badge: 'bg-[#eef2f6] text-[#5b6573] border-[#dbe2ea]', border: 'border-[#dbe2ea]', mark: '?' },
};

/**
 * 접어둔 세부 항목 — 기본 화면에는 안 보인다.
 *
 * ★ 이름 있는 group(group/detail) 을 쓴다. 채널 접어두기 안에 이 접어두기가 들어가는데,
 *   이름 없는 group 이면 바깥이 열렸을 때 안쪽 화살표까지 같이 돌아간다.
 */
function DetailList({ details }: { details: readonly FindingDetail[] }) {
  return (
    <details className="mt-2.5 group/detail">
      <summary className="text-[12px] font-bold text-[#5b6573] cursor-pointer list-none min-h-[44px] flex items-center gap-1.5">
        <span className="inline-block transition-transform group-open/detail:rotate-90" aria-hidden="true">
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
  /**
   * 심각도는 채널 밑으로 내려왔지만 사라지지 않았다 — 항목마다 배지로 남는다.
   * 배지 문구는 대표가 정한 덩어리 이름 그대로다(줄여 쓰지 않는다).
   */
  const group = findingGroupOf(finding);
  const tone = GROUP_STYLE[group];
  /**
   * "닥터포스트가 이걸 한다" 한 줄.
   * 우리가 실제로 대신하는 항목에만 붙는다(conversion.ts 의 3중 게이트).
   * 홈페이지 SSL·robots 처럼 우리가 안 하는 항목에는 아무것도 붙지 않는다 —
   * 전부 우리 제품으로 귀결되면 진단이 광고로 읽히고, 그 순간 신뢰가 끝난다.
   */
  const ourLine = doctorpostLine(finding);
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
            {/*
              채널 이름은 이미 섹션 제목에 있다 — 여기 다시 붙이면 같은 말이 두 번이다.
              대신 심각도(덩어리 이름)를 꼬리표로 남긴다. "뭐부터 손대나"가 여기서 나온다.
            */}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone.badge}`}>
              {FINDING_GROUP_LABEL[group].title}
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

          {/*
            ④ 이 중 우리가 대신하는 부분 — 한 줄. 위의 "무엇을 하면 되나"는 그대로 두고
            (원장이 직접 할 수 있는 길을 지운 적이 없다) 옆에 덧붙이기만 한다.
          */}
          {ourLine && (
            <p className="text-[12px] text-[#5b6573] leading-relaxed mt-1.5 pl-2.5 border-l-2 border-[#ffd0c4]">
              {ourLine}
            </p>
          )}

          {finding.details && finding.details.length > 0 && <DetailList details={finding.details} />}
        </div>
      </div>
    </li>
  );
}

/**
 * 채널 한 덩어리 — 이 화면의 뼈대.
 *
 * · 손대야 할 항목(지금 고쳐야 할 것 · 챙기면 좋을 것)은 펼쳐 둔다.
 * · 나머지(잘하고 있는 것 · 확인하지 못한 것)는 같은 채널 안에 접어 둔다.
 *   따로 빼면 "AI는 되는 건가"가 다시 세 곳으로 흩어진다.
 * · 손댈 게 없는 채널은 접지 않는다 — 비어 보이면 진단이 안 돈 줄 안다.
 */
function ChannelBlock({ section }: { section: ChannelSection }) {
  if (section.findings.length === 0) return null;

  const entries = section.findings.map((finding) => ({ finding, group: findingGroupOf(finding) }));
  const problems = entries.filter((e) => e.group === 'bad' || e.group === 'improve');
  const rest = entries.filter((e) => e.group === 'good' || e.group === 'unknown');
  const badges = channelBadges(section);
  const accent =
    section.worst === 'bad'
      ? 'text-[#c3341a]'
      : section.worst === 'improve'
        ? 'text-[#b45309]'
        : section.worst === 'good'
          ? 'text-emerald-700'
          : 'text-[#5b6573]';

  const list = (items: readonly { finding: Finding }[]) => (
    <ul className="space-y-3 mt-3">
      {items.map((e) => (
        <FindingCard key={e.finding.id} finding={e.finding} />
      ))}
    </ul>
  );

  const restSummary = rest
    .reduce<FindingGroup[]>((acc, e) => (acc.includes(e.group) ? acc : [...acc, e.group]), [])
    .map((group) => `${FINDING_GROUP_LABEL[group].title} ${section.counts[group]}`)
    .join(' · ');

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className={`text-[17px] sm:text-xl font-black ${accent}`}>{section.label}</h3>
        {badges.map((badge) => (
          <span
            key={badge.group}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${GROUP_STYLE[badge.group].badge}`}
          >
            {badge.text}
          </span>
        ))}
      </div>

      {problems.length > 0 && list(problems)}

      {rest.length > 0 &&
        (problems.length > 0 ? (
          <details className="mt-3 group/tail">
            <summary className="text-[12.5px] font-bold text-[#5b6573] cursor-pointer list-none min-h-[44px] flex items-center gap-1.5">
              <span className="inline-block transition-transform group-open/tail:rotate-90" aria-hidden="true">
                ▸
              </span>
              {restSummary} 보기
            </summary>
            {list(rest)}
          </details>
        ) : (
          list(rest)
        ))}
    </section>
  );
}

interface DiagnosisReportViewProps {
  readonly report: DiagnosisReport;
  /**
   * 공유 리포트 토큰. 있으면 "결과를 메일로 보내드릴까요" 를 띄운다.
   * 없을 수 있는 경우: 공유 링크 발급이 실패했거나(그레이스풀) 옛 화면에서 넘어온 호출.
   * 그때는 메일 입력만 빠지고 나머지 결과는 그대로 나온다.
   */
  readonly shareToken?: string | null;
  /**
   * 메일 링크로 열린 공유 화면인가 (`/clinic-check/r/[token]`).
   *
   * ★ 이 화면에는 블로그 후보 선택기(BlogGuessPicker)도 상세 진단 폼도 없다.
   *   둘 다 진단 페이지(ClinicCheckClient)에서만 렌더된다. 그런데 문구는
   *   "아래에서 바꿔 주세요"라고 말하고 있었다 — 오판을 고칠 길이 없는 안내문이다.
   *   그래서 화면 종류를 컴포넌트가 알고 문구를 갈라 쓴다.
   */
  readonly shared?: boolean;
}

/** 공유 화면에서 "여기서는 못 고친다"를 대신할 목적지. */
const DIAGNOSIS_PAGE = '/clinic-check';

export default function DiagnosisReportView({ report, shareToken, shared = false }: DiagnosisReportViewProps) {
  /**
   * 저장된 옛 리포트 보정 — 등급·중복 카드를 오늘 기준과 맞춘다(findings.ts).
   * 오늘 만들어진 리포트는 그대로 통과한다.
   */
  const findings = normalizeStoredFindings(report);
  /** 채널별 묶음 — 문제가 심한 채널이 위로 온다(정렬 근거는 findings.ts). */
  const channels = groupFindingsByChannel(findings);
  const clinic = report.clinic;
  /** 결과 맨 아래 전환 문구 — 원장이 방금 본 자기 숫자로 만든다(값이 없으면 기본 문구). */
  const cta = buildConversionCta(report);
  const emailToken = typeof shareToken === 'string' && shareToken.length > 0 ? shareToken : null;
  /**
   * AI 질문 목록 — 질문 단위가 정본.
   * 이 기능 이전에 발급된 공유 리포트에는 questions 가 없으므로 probes 로 그때 만든다
   * (같은 함수를 쓰므로 판정과 화면이 어긋나지 않는다).
   */
  const aiQuestions =
    report.ai?.questions?.length ? report.ai.questions : summarizeQuestions(report.ai?.probes ?? []);
  /** 확신까지는 아닌 채로 1위 후보로 진행한 상태인가 (구 리포트에는 없는 종류 → false). */
  const blogAssumed = report.blog?.resolution?.kind === 'assumed';
  const blogClose = report.blog?.resolution?.kind === 'assumed' && report.blog.resolution.close;
  /** 저장된 옛 리포트는 배열이 통째로 없을 수 있다 — 길이 접근에서 죽지 않게 한다. */
  const complianceHits = report.compliance?.hits ?? [];
  const unchecked = report.unchecked ?? [];

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
                ? shared
                  ? '이 블로그를 병원 블로그로 보고 진단했습니다. 다른 블로그라면 진단 페이지에서 주소를 직접 넣어 다시 확인하실 수 있어요.'
                  : '이 블로그를 병원 블로그로 보고 진단했습니다. 아니면 아래에서 바꿔 주세요.'
                : '병원 이름과 맞는 블로그를 찾아 이 블로그로 진단했어요. 주소를 눌러 확인해 보세요.'}
            {blogClose && ' 비슷한 후보가 하나 더 있었어요.'}
            {/*
              수집 편수는 여기에만 적는다 — 예전에는 아래 "병원 블로그" 카드가 같은 말을
              한 번 더 했다(대표 지적: 중복). 카드를 없앴으니 그 사실은 이 자리로 옮긴다.
            */}
            {report.blog.postCount !== null && ` 최근 글 ${report.blog.postCount}편을 기준으로 봤어요.`}
          </p>
        </div>
      )}

      {/*
        요약 — **채널 4칸**. 어느 영역이 약한지가 한눈에 보여야 한다.
        예전 3칸(고쳐야/챙기면/잘함)은 "무엇이 몇 건"만 말할 뿐,
        "그래서 AI는 되는 건가"에 답하지 못했다. 모바일은 2×2.
        칸 순서는 아래 본문 채널 순서와 같다 — 눈이 위아래로 오가지 않게.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        {channels.map((section) => (
          <div
            key={section.axis}
            className={`rounded-2xl border p-3 sm:p-4 text-center ${GROUP_STYLE[section.worst].badge}`}
          >
            <p className="text-[13px] sm:text-[14px] font-black leading-tight">{section.label}</p>
            <p className="text-[11px] font-bold mt-1.5 leading-snug">{channelStatusText(section)}</p>
          </div>
        ))}
      </div>

      {/*
        결과를 메일로 — **상단**. 요약 숫자를 본 직후가 가장 응답이 좋은 자리이고,
        결과를 끝까지 안 읽고 닫는 원장도 여기서는 주소를 남길 수 있다.
      */}
      {emailToken && (
        <div className="mt-4">
          <DiagnosisEmailCapture shareToken={emailToken} placement="top" />
        </div>
      )}

      {/*
        본문 — 채널 순서대로. 급한 채널이 위에 있으므로 스크롤 없이 무엇부터 볼지 보인다.
        각 채널 안에서는 나쁜 항목부터 나온다(기존 중요도 표 그대로).
      */}
      {channels.map((section) => (
        <ChannelBlock key={section.axis} section={section} />
      ))}

      {unchecked.length > 0 && (
        <p className="text-[12px] text-[#5b6573] mt-4 bg-[#f7f9fb] border border-[#dbe2ea] rounded-xl px-3.5 py-2.5 leading-relaxed">
          <b className="font-bold">확인하지 못한 항목</b> · {unchecked.join(' · ')} —{' '}
          {shared ? (
            <>
              <a href={DIAGNOSIS_PAGE} className="font-bold text-[#ff4628] underline underline-offset-2">
                진단 페이지
              </a>
              에서 주소를 직접 넣어 주시면 채워 드릴게요.
            </>
          ) : (
            '아래 상세 진단에서 주소를 직접 넣어 주시면 채워 드릴게요.'
          )}
        </p>
      )}

      {/*
        검출 문구 원문.
        ★ 위험(의료법이 명시적으로 금지한 유형)과 주의(문맥에 따라 갈리는 표현)를 색으로 나눈다.
          전부 같은 무게로 늘어놓으면 "후기"(경험담)와 "최신"이 같은 것으로 보인다.
        ⚠️ 위험이어도 "위반입니다"라고 쓰지 않는다 — "명시적으로 금지한 유형"까지가 한계다.
      */}
      {complianceHits.length > 0 && (
        <section className="mt-8">
          <h3 className="text-[13px] font-extrabold text-[#5b6573] tracking-[1px] mb-2.5">확인해 보시면 좋을 표현</h3>
          <ul className="space-y-2">
            {complianceHits.map((hit, i) => {
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
                  {/*
                    ★ 걸린 문장 자체 — 이 목록에서 가장 중요한 부분이다.
                      단어와 글 제목만 보여주면 원장은 "제목엔 후기가 없는데 왜 위험이냐"고 묻게 되고,
                      글을 열어보는 순간 오탐이면 진단 전체를 못 믿게 된다.
                    · 예전에 발급된 리포트에는 excerpt 가 없다 → 그때는 제목만 보여주던 대로 둔다.
                  */}
                  {hit.excerpt && (
                    <p className="mt-1.5 rounded-lg bg-white/70 border border-[#dbe2ea] px-3 py-2 text-[12.5px] leading-relaxed text-[#2f3640] break-keep">
                      <span className="text-[10px] font-bold text-[#5b6573] bg-[#eef2f6] rounded px-1.5 py-0.5 mr-1.5 align-middle whitespace-nowrap">
                        {EXCERPT_WHERE_LABEL[hit.excerpt.where]}
                      </span>
                      {hit.excerpt.clippedBefore && '… '}
                      {hit.excerpt.before}
                      <mark className={`rounded px-1 font-bold ${danger ? 'bg-[#ffd9cf] text-[#a3220a]' : 'bg-[#fdeec2] text-[#7a5a00]'}`}>
                        {hit.excerpt.match}
                      </mark>
                      {hit.excerpt.after}
                      {hit.excerpt.clippedAfter && ' …'}
                    </p>
                  )}
                  <p className={`text-[12px] mt-1.5 leading-relaxed ${danger ? 'text-[#7a2f1c]' : 'text-[#4a4f55]'}`}>
                    {hit.note}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-[#8a93a0] mt-2.5 leading-relaxed">
            표현이 실제로 쓰인 문장을 그대로 붙여 두었으니 직접 읽고 판단해 보세요. “위험”은 의료법이 광고에서 명시적으로
            금지한 유형(환자 후기·치료 전후 비교·효과 보장·다른 병원과의 비교)에 해당할 수 있는 표현이고, 나머지는 심의에서
            자주 지적되는 표현이에요. 후기·경험담은 묻거나 부정하는 문장, 남들의 후기를 가리키는 문장이면 “위험”에서 뺐고,
            효과 보장·전후 비교는 그런 문장 안에 있어도 그대로 두었습니다. 둘 다
            기계적으로 찾아 표시한 것이며 <b className="font-bold">저희가 위반 여부를 판단한 것은 아닙니다.</b> 최종 판단은
            심의기관과 담당 변호사의 몫입니다.
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
      {report.ai?.checked && aiQuestions.length > 0 && (
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

      {/* 결과를 메일로 — **하단**. 다 읽고 나서 남기는 자리. */}
      {emailToken && (
        <div className="mt-8">
          <DiagnosisEmailCapture shareToken={emailToken} placement="bottom" />
        </div>
      )}

      {/* 결과 맨 아래 전환 — 바로 가입·무료 2편으로 (제품 소개로 우회하지 않는다) */}
      <DiagnosisCta headline={cta.headline} sub={cta.sub} hospitalName={clinic.name} />

      <p className="text-[11px] text-[#8a93a0] text-center leading-relaxed mt-7">
        본 진단은 행정안전부 공표 정보와 네이버 공개 API, 그리고 공개된 블로그 글·홈페이지를 각각 한 번씩 열어 만든 특정 시점의 참고 자료예요.
        매출·방문자 수치는 추정하지 않고, 확인하지 못한 항목은 비워 둡니다. 검색 순위는 API 기준이라 실제 검색 화면과 다를 수 있어요.
      </p>
    </div>
  );
}
