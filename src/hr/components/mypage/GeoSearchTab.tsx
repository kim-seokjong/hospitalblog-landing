'use client';

import { useEffect, useState } from 'react';
import type { GeoCheckItem, GeoTabResponse } from '@/app/api/mypage/geo/route';

type FetchState = 'loading' | 'ready' | 'error';

/**
 * DB에 이스케이프 저장된 발췌(&lt; 등)를 표시용 평문으로 복원.
 * React 텍스트 노드로만 렌더하므로 복원해도 태그는 실행되지 않는다(이중 방어).
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function citationBadge(item: GeoCheckItem): { text: string; className: string } {
  if (!item.cited) {
    return { text: '미인용', className: 'bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce]' };
  }
  if (item.citationType === 'blog_url') {
    return { text: '블로그 인용', className: 'bg-green-50 text-green-700 border border-green-200' };
  }
  return { text: '병원명 언급', className: 'bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/30' };
}

/** 인용 체크 결과 카드 1건 */
function CheckCard({ item }: { item: GeoCheckItem }) {
  const badge = citationBadge(item);
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
          {badge.text}
        </span>
        <span className="text-xs text-[#5b6573] flex-shrink-0">{formatDate(item.checkedAt)}</span>
      </div>
      <p className="text-sm font-semibold text-[#202020] leading-snug mb-2">
        <span aria-hidden className="text-[#5b6573] mr-1">Q.</span>
        {item.question}
      </p>
      {item.cited && item.evidence && (
        <p className="text-xs text-[#5b6573] leading-relaxed bg-[#eef2f6] rounded-lg px-3 py-2 break-all">
          <span className="font-semibold text-[#202020]">AI 답변 근거: </span>
          {decodeEntities(item.evidence)}
        </p>
      )}
      {!item.cited && (
        <p className="text-xs text-[#5b6573]">
          이번 샘플 답변에서는 우리 병원이 인용되지 않았습니다. GEO 준비도를 높이면 인용 가능성이 올라갑니다.
        </p>
      )}
    </div>
  );
}

/** 주간 인용률 추이 — 최근 8주 간단 막대 */
function WeeklyTrend({ weekly }: { weekly: GeoTabResponse['weekly'] }) {
  if (weekly.length === 0) return null;
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h3 className="text-sm font-semibold text-[#202020] mb-3">주간 인용률 추이 (최근 8주)</h3>
      <div className="flex items-end gap-2 sm:gap-3 h-24" role="img" aria-label="주간 인용률 막대 그래프">
        {weekly.map((w) => {
          const rate = w.total > 0 ? Math.round((w.cited / w.total) * 100) : 0;
          const height = Math.max(6, Math.round((rate / 100) * 72));
          return (
            <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[10px] text-[#5b6573]">{rate}%</span>
              <div
                className={`w-full max-w-[28px] rounded-t-md ${rate > 0 ? 'bg-[#ff4628]/70' : 'bg-[#b4bfce]'}`}
                style={{ height: `${height}px` }}
                title={`${w.weekStart} 주: ${w.cited}/${w.total}건 인용`}
              />
              <span className="text-[10px] text-[#5b6573] truncate w-full text-center">
                {w.weekStart.slice(5).replace('-', '/')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * AI 검색 유입 실측 섹션 — 인용(위)과 짝을 이루는 "실제 방문" 지표.
 *
 * ⚠️ 표현 원칙(의료광고법·과장광고 금지): 여기서 말할 수 있는 것은 "AI 서비스에서
 * 링크를 눌러 블로그로 들어온 방문 수" 라는 사실 하나뿐이다. 환자 수·문의·예약·
 * 매출과 연결하는 표현은 쓰지 않는다.
 */
function AiReferralSection({
  summary,
  siteEnabled,
}: {
  summary: GeoTabResponse['aiReferral'];
  siteEnabled: boolean;
}) {
  const maxDaily = summary.daily.reduce((max, d) => (d.visits > max ? d.visits : max), 0);

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-[#202020]">AI 검색에서 들어온 방문</h3>
        <span className="text-xs text-[#5b6573] flex-shrink-0">최근 {summary.windowDays}일</span>
      </div>
      <p className="text-xs text-[#5b6573] mb-4 leading-relaxed">
        ChatGPT·Perplexity 등 AI 서비스의 답변에서 링크를 눌러 병원 블로그로 들어온 방문 수입니다.
        위의 인용 추적이 &quot;언급됐는가&quot;라면, 이 숫자는 &quot;실제로 들어왔는가&quot;입니다.
      </p>

      {!siteEnabled ? (
        <div className="text-center py-6">
          <p className="text-sm text-[#202020] font-medium mb-1">병원 블로그가 아직 개설되지 않았습니다</p>
          <p className="text-xs text-[#5b6573]">
            내 정보에서 블로그 주소를 설정하면 그때부터 AI 검색 유입을 집계합니다.
          </p>
        </div>
      ) : summary.totalVisits === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-[#202020] font-medium mb-1">아직 집계된 방문이 없습니다</p>
          <p className="text-xs text-[#5b6573] leading-relaxed">
            AI 답변에 인용되고, 그 링크를 누른 방문이 생기면 여기에 표시됩니다.
            초기에는 0으로 시작하는 것이 일반적입니다.
          </p>
        </div>
      ) : (
        <>
          {/* 총 방문 수 */}
          <div className="flex items-baseline gap-1 mb-4">
            <span className="text-4xl font-bold text-[#202020]">
              {summary.totalVisits.toLocaleString('ko-KR')}
            </span>
            <span className="text-sm text-[#5b6573]">회 방문</span>
          </div>

          {/* 일자별 추이 */}
          {maxDaily > 0 && (
            <div
              className="flex items-end gap-[2px] h-16 mb-4"
              role="img"
              aria-label={`최근 ${summary.windowDays}일 일자별 AI 검색 유입 방문 수 그래프`}
            >
              {summary.daily.map((d) => (
                <div
                  key={d.date}
                  className={`flex-1 min-w-0 rounded-t-sm ${d.visits > 0 ? 'bg-[#ff4628]/70' : 'bg-[#eef2f6]'}`}
                  style={{ height: `${Math.max(3, Math.round((d.visits / maxDaily) * 60))}px` }}
                  title={`${d.date}: ${d.visits}회`}
                />
              ))}
            </div>
          )}

          {/* 출처별 */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-[#202020] mb-2">유입 출처</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.bySource.map((s) => (
                <span
                  key={s.source}
                  className="text-xs px-2.5 py-1 rounded-full bg-[#eef2f6] text-[#3d4551] border border-[#b4bfce]"
                >
                  {s.label} <span className="font-semibold text-[#202020]">{s.visits}</span>
                </span>
              ))}
            </div>
          </div>

          {/* 글별 — 최소 집계치 미만은 개별 표시하지 않고 묶어서 보여준다 */}
          {(summary.topPosts.length > 0 || summary.hiddenPostCount > 0) && (
            <div className="border-t border-[#eef2f6] pt-3 mb-3">
              <p className="text-xs font-semibold text-[#202020] mb-2">방문이 많은 글</p>
              {summary.topPosts.length > 0 ? (
                <ul className="space-y-1.5">
                  {summary.topPosts.map((p) => (
                    <li key={p.postId} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-[#3d4551] leading-relaxed break-keep line-clamp-1">
                        {p.title || '(제목 없음)'}
                      </span>
                      <span className="text-xs font-semibold text-[#202020] flex-shrink-0">
                        {p.visits}회
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[#5b6573] leading-relaxed">
                  아직 글별로 나눠 보여줄 만큼 쌓이지 않았습니다.
                </p>
              )}
              {summary.hiddenPostCount > 0 && (
                <p className="text-xs text-[#5b6573] mt-2">
                  그 외 {summary.hiddenPostCount}편 합계 {summary.hiddenPostVisits}회
                </p>
              )}
            </div>
          )}

          {summary.homeVisits > 0 && (
            <p className="text-xs text-[#5b6573] mb-3">
              블로그 홈으로 들어온 방문 {summary.homeVisits}회
            </p>
          )}
        </>
      )}

      <p className="text-[11px] text-[#5b6573] leading-relaxed border-t border-[#eef2f6] pt-3">
        ※ 브라우저나 AI 서비스가 유입 경로를 전달하지 않으면 집계되지 않아, 실제보다 적게
        나올 수 있습니다. 집계는 병원 블로그({'{'}주소{'}'}.hospitalblog.kr)에서만 이뤄지며,
        방문자의 IP·기기 정보·방문 시각 등 개인을 식별할 수 있는 값은{' '}
        <strong className="font-semibold">데이터베이스에 저장하지 않습니다</strong>. 날짜별
        방문 수만 남습니다. 방문 수가 적은 글은 개별로 표시하지 않고 묶어서 보여줍니다.
      </p>
    </div>
  );
}

/** GEO 준비도 점수 섹션 — 라이브 질의 비활성 환경에서도 단독 성립 */
function ReadinessSection({
  readiness,
  checkedPostCount,
}: {
  readiness: GeoTabResponse['readiness'];
  checkedPostCount: number;
}) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-[#202020]">GEO 준비도 점수</h3>
        {readiness && (
          <span className="text-xs text-[#5b6573] flex-shrink-0">최근 발행글 {checkedPostCount}편 기준</span>
        )}
      </div>
      <p className="text-xs text-[#5b6573] mb-4">
        발행한 글이 AI가 발췌하기 좋은 구조(핵심 요약·FAQ·질문형 제목·소제목)를 갖췄는지 검사합니다.
      </p>

      {!readiness ? (
        <div className="text-center py-6">
          <p className="text-sm text-[#202020] font-medium mb-1">아직 발행된 글이 없습니다</p>
          <p className="text-xs text-[#5b6573]">
            구글 GEO 모드로 글을 생성·발행하면 핵심 요약과 FAQ가 자동 포함되어 준비도가 높게 시작됩니다.
          </p>
        </div>
      ) : (
        <>
          {/* 종합 점수 */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold text-[#202020]">{readiness.score}</span>
              <span className="text-sm text-[#5b6573]">/ 100</span>
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                readiness.grade === '우수'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : readiness.grade === '보통'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-[#ffece7] text-[#ff4628] border border-[#ff4628]/30'
              }`}
            >
              {readiness.grade}
            </span>
          </div>

          {/* 항목별 충족률 */}
          <div className="space-y-2.5 mb-4">
            {readiness.checks.map((check) => {
              const ratio = check.total > 0 ? check.passed / check.total : 0;
              return (
                <div key={check.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#202020]">{check.label}</span>
                    <span className="text-[#5b6573]">
                      {check.passed}/{check.total}편
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#eef2f6] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${ratio >= 0.8 ? 'bg-green-500' : ratio >= 0.4 ? 'bg-amber-400' : 'bg-[#ff4628]/70'}`}
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 개선 팁 */}
          {readiness.tips.length > 0 && (
            <div className="border-t border-[#eef2f6] pt-3">
              <p className="text-xs font-semibold text-[#202020] mb-1.5">개선 팁</p>
              <ul className="space-y-1">
                {readiness.tips.map((tip, i) => (
                  <li key={i} className="text-xs text-[#5b6573] leading-relaxed flex gap-1.5">
                    <span aria-hidden className="text-[#ff4628] flex-shrink-0">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 마이페이지 "AI 검색" 탭 — AI 검색 인용 추적 + GEO 준비도 */
export default function GeoSearchTab() {
  const [state, setState] = useState<FetchState>('loading');
  const [data, setData] = useState<GeoTabResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mypage/geo')
      .then(async (res) => {
        if (!res.ok) throw new Error('불러오기 실패');
        return (await res.json()) as GeoTabResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="bg-white border border-[#b4bfce] rounded-2xl p-8 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <p className="text-sm text-[#5b6573]">AI 검색 인용 데이터를 불러오는 중...</p>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="bg-white border border-[#b4bfce] rounded-2xl p-8 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <p className="text-sm text-[#202020] font-medium mb-1">데이터를 불러오지 못했습니다</p>
        <p className="text-xs text-[#5b6573]">잠시 후 새로고침해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 안내 — AI 검색 시대 선점 */}
      <div className="rounded-xl border border-[#ff4628]/30 bg-[#ffece7] px-4 py-3.5">
        <p className="text-sm font-semibold text-[#202020] flex items-center gap-1.5">
          <span aria-hidden>🔍</span> AI 검색 시대, 우리 병원이 먼저 인용되게
        </p>
        <p className="text-xs text-[#5b6573] leading-relaxed mt-1.5">
          이제 환자들은 ChatGPT 같은 AI에게 &quot;○○지역 △△과 어디가 좋아?&quot;라고 묻습니다.
          닥터포스트가 환자 입장의 질문을 매주 AI에게 직접 물어보고, 우리 병원·블로그가 답변에
          인용되는지 추적합니다. 인용률을 높이는 준비(GEO)를 먼저 시작한 병원이 AI 검색 시대를 선점합니다.
        </p>
        <p className="text-[11px] text-[#5b6573] mt-2">
          ※ 주 1회 샘플링 결과로, 실제 사용자별 AI 답변·노출과 다를 수 있습니다.
        </p>
      </div>

      {/* AI 검색 유입 실측 — 인용 여부가 아니라 실제 방문. 0이어도 항상 표시한다. */}
      <AiReferralSection summary={data.aiReferral} siteEnabled={data.clinicSiteEnabled} />

      {/* GEO 준비도 점수 — 항상 표시 (라이브 질의 비활성 환경에서도 단독 성립) */}
      <ReadinessSection readiness={data.readiness} checkedPostCount={data.checkedPostCount} />

      {/* 주간 추이 */}
      <WeeklyTrend weekly={data.weekly} />

      {/* 최근 체크 결과 */}
      <div>
        <h3 className="text-sm font-semibold text-[#202020] mb-2 px-1">최근 AI 검색 체크 결과</h3>
        {!data.liveEnabled ? (
          <div className="bg-white border border-[#b4bfce] rounded-2xl p-6 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
            <p className="text-sm text-[#202020] font-medium mb-1">AI 검색 라이브 체크 준비 중</p>
            <p className="text-xs text-[#5b6573]">
              현재는 GEO 준비도 점수만 제공됩니다. 라이브 인용 체크가 열리면 이곳에 결과가 표시됩니다.
            </p>
          </div>
        ) : data.latest.length === 0 ? (
          <div className="bg-white border border-[#b4bfce] rounded-2xl p-6 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
            <p className="text-sm text-[#202020] font-medium mb-1">첫 체크를 기다리고 있습니다</p>
            <p className="text-xs text-[#5b6573]">
              매주 월요일 오전, 내 정보의 지역·진료과·키워드로 만든 질문을 AI에게 물어보고 결과를 기록합니다.
              내 정보를 채울수록 질문이 정교해집니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.latest.map((item) => (
              <CheckCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
