'use client';

import type { BlogCheckReport } from '@/content/lib/blog-check';
import type { TitleQualityStats } from '@/content/lib/blog-check-score';
import type { GoldenKeywordResult } from '@/content/lib/golden-keywords';

/**
 * 무료진단 상세분석 뷰 (로그인 회원 전용 데이터).
 * 컴플라이언스: 검출 문구는 인용·근거 표시만(자동치환 없음), 매출·방문자 추정 없음.
 */

export interface BlogCheckDetail {
  report: BlogCheckReport;
  golden: GoldenKeywordResult;
  geoDetail: {
    score: number;
    reason: string;
    blockedCrawlers: readonly string[];
    robotsExcerpt: string;
    explanation: string;
    solution: string;
  };
  compliancePosts: BlogCheckReport['compliancePosts'];
  quality: { stats: TitleQualityStats; comment: string; commentSource: 'llm' | 'rule' };
  voiceDna: { updated: boolean; sampleCount: number; message: string };
}

const COMP_BADGE: Record<string, string> = {
  낮음: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  중간: 'bg-amber-50 text-amber-600 border-amber-200',
  높음: 'bg-red-50 text-red-500 border-red-200',
};

const GRADE_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-50 text-red-600 border-red-200',
  HIGH: 'bg-red-50 text-red-500 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-600 border-amber-200',
  LOW: 'bg-[#eef2f6] text-[#5b6573] border-[#dbe2ea]',
};

function SectionCard({ icon, title, desc, children }: {
  icon: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">{icon}</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">{title}</h3>
      </div>
      {desc && <p className="text-[11px] text-[#73808f] mb-4">{desc}</p>}
      {children}
    </div>
  );
}

function num(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('ko-KR');
}

export default function BlogCheckDetailView({ detail }: { detail: BlogCheckDetail }) {
  const { report, golden, geoDetail, compliancePosts, quality, voiceDna } = detail;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* VOICE-DNA */}
      <div className="bg-[#fff7f5] border border-[#ffd9cf] rounded-2xl px-5 py-4 flex items-start gap-3">
        <span className="text-lg flex-shrink-0">🧬</span>
        <div>
          <p className="text-sm font-bold text-[#202020]">
            VOICE-DNA {voiceDna.updated ? '학습 완료' : '안내'}
          </p>
          <p className="text-[13px] text-[#4a4f55] mt-1 leading-relaxed">{voiceDna.message}</p>
        </div>
      </div>

      {/* 키워드 실측 전체 테이블 */}
      <SectionCard
        icon="🔑"
        title="타깃 키워드 실측 전체"
        desc="네이버 공개 지표 실측 — 월 검색량(검색광고) · 블로그 문서수 · 내 블로그 노출 순위(상위 100 기준)"
      >
        <div className="-mx-5 sm:mx-0 px-5 sm:px-0 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-[11px] text-[#73808f] border-b border-[#dbe2ea]">
                <th className="text-left font-semibold py-2 pr-2">키워드</th>
                <th className="text-right font-semibold py-2 px-2">월 검색량</th>
                <th className="text-right font-semibold py-2 px-2">블로그 문서수</th>
                <th className="text-right font-semibold py-2 pl-2">내 순위</th>
              </tr>
            </thead>
            <tbody>
              {report.keywords.map((m) => (
                <tr key={m.keyword} className="border-b border-[#eef2f6] last:border-0">
                  <td className="py-2.5 pr-2 font-semibold text-[#202020]">{m.keyword}</td>
                  <td className="py-2.5 px-2 text-right text-[#4a4f55]">{num(m.volume?.total ?? null)}</td>
                  <td className="py-2.5 px-2 text-right text-[#4a4f55]">{num(m.docCount)}</td>
                  <td className="py-2.5 pl-2 text-right">
                    {m.rank !== null ? (
                      <span className={`font-bold ${m.rank <= 10 ? 'text-emerald-600' : 'text-[#202020]'}`}>{m.rank}위</span>
                    ) : (
                      <span className="text-[#8a93a0]">100위 밖</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.serpAvailable && (
          <p className="text-[11px] text-[#8a93a0] mt-2">일부 실측 지표를 확인하지 못했어요(외부 API 상태에 따라 달라질 수 있어요).</p>
        )}
      </SectionCard>

      {/* 황금 키워드 제안 */}
      {golden.available && golden.items.length > 0 && (
        <SectionCard
          icon="⭐"
          title="황금 키워드 제안"
          desc="검색량은 충분한데 경쟁 문서수는 적은 키워드 — 다음 글 주제로 추천"
        >
          <ul className="space-y-1.5">
            {golden.items.slice(0, 8).map((item, i) => (
              <li key={item.keyword} className="flex items-center gap-3 bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px]">
                <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 w-5 text-right">{i + 1}</span>
                <span className="flex-1 min-w-0 text-sm font-semibold text-[#202020] truncate">{item.keyword}</span>
                {item.competition && COMP_BADGE[item.competition] && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${COMP_BADGE[item.competition]}`}>
                    경쟁 {item.competition}
                  </span>
                )}
                <span className="text-[11px] text-[#5b6573] flex-shrink-0 text-right">
                  <span className="block font-bold text-[#202020]">월 {item.volume.total.toLocaleString('ko-KR')}회</span>
                  {item.docCount !== null && (
                    <span className="block text-[10px]">문서 {item.docCount.toLocaleString('ko-KR')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* GEO 상세 */}
      <SectionCard
        icon="🤖"
        title={`AI 검색(GEO) 상세 — ${geoDetail.score}/100`}
        desc="AI 검색(ChatGPT·Perplexity 등)에 내 글이 인용될 수 있는지"
      >
        <p className="text-[13px] text-[#4a4f55] leading-relaxed">{geoDetail.explanation}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {geoDetail.blockedCrawlers.map((bot) => (
            <span key={bot} className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
              🚫 {bot}
            </span>
          ))}
        </div>
        <pre className="mt-3 bg-[#202020] text-[#b9bdc2] text-[11px] leading-relaxed rounded-xl p-4 overflow-x-auto">
          {`# blog.naver.com robots.txt 발췌 (2026-07 조사 시점)\n\n${geoDetail.robotsExcerpt}`}
        </pre>
        <div className="mt-3 bg-[#fff7f5] border border-[#ffd9cf] rounded-xl px-4 py-3">
          <p className="text-[13px] text-[#4a4f55] leading-relaxed">
            <b className="text-[#202020]">해법:</b> {geoDetail.solution}
          </p>
        </div>
      </SectionCard>

      {/* 컴플라이언스 상세 */}
      <SectionCard
        icon="🛡️"
        title={`의료광고법 위험 신호 상세 — ${report.compliance.count}건`}
        desc="검출·표시만 합니다(자동 치환 없음). 교육·정보성 서술은 예외일 수 있으니 검수 참고용으로 확인하세요."
      >
        {compliancePosts.length === 0 ? (
          <p className="text-sm text-emerald-600 font-semibold">최근 글에서 위험 표현이 검출되지 않았어요. 👍</p>
        ) : (
          <ul className="space-y-3">
            {compliancePosts.slice(0, 10).map((post) => (
              <li key={post.link || post.title} className="border border-[#dbe2ea] rounded-xl p-4">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${GRADE_BADGE[post.grade] ?? GRADE_BADGE.LOW}`}>
                    {post.grade}
                  </span>
                  {post.link ? (
                    <a href={post.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#202020] hover:text-[#ff4628] break-all">
                      {post.title}
                    </a>
                  ) : (
                    <span className="text-sm font-semibold text-[#202020]">{post.title}</span>
                  )}
                </div>
                {post.violations.slice(0, 5).map((v, i) => (
                  <div key={`${v.word}-${i}`} className="mt-2 bg-[#fafbfc] border border-[#eef2f6] rounded-lg px-3 py-2">
                    <p className="text-[12px] text-[#202020]">
                      <b className="text-[#e63a1c]">“{v.word}”</b>
                      <span className="text-[#8a93a0]"> — {v.rule}</span>
                    </p>
                    {v.excerpt && <p className="text-[11px] text-[#5b6573] mt-1">…{v.excerpt}…</p>}
                  </div>
                ))}
                {post.warnings.slice(0, 3).map((w, i) => (
                  <p key={i} className="mt-1.5 text-[11px] text-amber-700">⚠ {w}</p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 글 품질 진단 */}
      <SectionCard
        icon="✍️"
        title="글 품질 진단 — 제목 반복도"
        desc={`제목 ${report.totalPosts}개 교차 비교 · 사실상 중복 ${quality.stats.duplicatePairs}쌍 · 최대 유사도 ${Math.round(quality.stats.maxSimilarity * 100)}%`}
      >
        <p className="text-[13px] text-[#4a4f55] leading-relaxed">{quality.comment}</p>
        {quality.stats.samples.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {quality.stats.samples.map((s, i) => (
              <li key={i} className="text-[11px] text-[#5b6573] bg-[#eef2f6] rounded-lg px-3 py-2">
                “{s.a}” ↔ “{s.b}” <span className="text-[#8a93a0]">(유사도 {Math.round(s.similarity * 100)}%)</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
