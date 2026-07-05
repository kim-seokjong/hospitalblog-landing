'use client';

import type { AuditPostResult, BlogAuditResults, ComplianceGrade } from '@/types';

/**
 * 블로그 소급 진단 결과 뷰 — 요약 + 글별 카드.
 * 마이페이지 "블로그 진단" 탭과 admin 시연 패널이 공유한다.
 *
 * 문구 원칙: "위반입니다" 단정 금지 → "위반 소지 / 심의 필요" 톤.
 */

const GRADE_BADGE: Record<ComplianceGrade, { text: string; className: string }> = {
  CRITICAL: { text: 'CRITICAL', className: 'bg-red-50 text-red-700 border border-red-300' },
  HIGH: { text: 'HIGH', className: 'bg-orange-50 text-orange-700 border border-orange-300' },
  MEDIUM: { text: 'MEDIUM', className: 'bg-yellow-50 text-yellow-700 border border-yellow-300' },
  LOW: { text: 'LOW', className: 'bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce]' },
  PASS: { text: '통과', className: 'bg-green-50 text-green-700 border border-green-200' },
};

function gradeBadge(grade: string): { text: string; className: string } {
  return GRADE_BADGE[grade as ComplianceGrade] ?? GRADE_BADGE.LOW;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function AuditPostCard({ post }: { post: AuditPostResult }) {
  const badge = gradeBadge(post.grade);
  const findings = post.aiFindings ?? [];

  return (
    <div className="bg-white border border-[#b4bfce] rounded-xl p-4 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
            {badge.text}
          </span>
          {post.aiReviewed && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#ffece7] text-[#ff4628] font-medium flex-shrink-0">
              AI 심의 완료
            </span>
          )}
        </div>
      </div>

      <h4 className="font-semibold text-[#202020] text-sm leading-snug mb-1 break-words">
        {post.title}
      </h4>
      {post.link && (
        <a
          href={post.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#5b6573] hover:text-[#ff4628] underline underline-offset-2 break-all"
        >
          원문 보기 ↗
        </a>
      )}

      {/* A층 — 위험 표현 발췌 + 근거 조항 */}
      {post.violations.length > 0 && (
        <div className="mt-3 space-y-2">
          {post.violations.map((v, i) => (
            <div key={`${v.word}-${i}`} className="rounded-lg bg-[#eef2f6] border border-[#b4bfce] px-3 py-2">
              <p className="text-xs font-semibold text-[#202020] mb-0.5">
                &ldquo;{v.word}&rdquo; <span className="font-normal text-[#5b6573]">— 위반 소지</span>
              </p>
              {v.excerpt && (
                <p className="text-xs text-[#5b6573] leading-relaxed break-words mb-0.5">{v.excerpt}</p>
              )}
              <p className="text-xs text-[#73808f]">근거: {v.rule}</p>
            </div>
          ))}
        </div>
      )}

      {/* A층 경고 */}
      {post.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {post.warnings.map((w, i) => (
            <li key={i} className="text-xs text-yellow-700 leading-relaxed">⚠ {w}</li>
          ))}
        </ul>
      )}

      {/* B층 — AI 심의 코멘트 */}
      {findings.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[#eef2f6] pt-2.5">
          {findings.map((f, i) => (
            <p key={`${f.category}-${i}`} className="text-xs text-[#5b6573] leading-relaxed break-words">
              <span className="font-semibold text-[#202020]">[AI 심의 · {f.severity}] {f.category}:</span>{' '}
              {f.reason || '심의 필요'}
              {f.snippet ? ` — “${f.snippet}”` : ''} <span className="text-[#ff4628]">(위반 소지 · 심의 필요)</span>
            </p>
          ))}
        </div>
      )}

      {post.violations.length === 0 && post.warnings.length === 0 && findings.length === 0 && (
        <p className="mt-2 text-xs text-green-700">자동 검사에서 위반 소지 표현이 검출되지 않았습니다.</p>
      )}
    </div>
  );
}

interface BlogAuditResultViewProps {
  audit: BlogAuditResults;
  /** "닥터포스트로 안전하게 다시 쓰기" CTA 표시 여부(마이페이지 탭에서만 표시). */
  showRewriteCta?: boolean;
}

export default function BlogAuditResultView({ audit, showRewriteCta = false }: BlogAuditResultViewProps) {
  return (
    <div>
      {/* 상단 요약 */}
      <div className="bg-white border border-[#b4bfce] rounded-xl p-4 sm:p-5 mb-4 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#202020]">
              전체 {audit.totalPosts}편 중{' '}
              <span className={audit.riskyPosts > 0 ? 'text-[#ff4628]' : 'text-green-700'}>
                위반 소지 {audit.riskyPosts}편
              </span>
            </p>
            <p className="text-xs text-[#5b6573] mt-1">
              blog.naver.com/{audit.blogId} · {formatDateTime(audit.runAt)} 진단 · {audit.engine}
            </p>
          </div>
          {showRewriteCta && audit.riskyPosts > 0 && (
            <a
              href="/app"
              className="inline-block text-center px-4 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0"
            >
              닥터포스트로 안전하게 다시 쓰기
            </a>
          )}
        </div>
      </div>

      {/* 글별 카드 (위험점수 내림차순) */}
      <div className="grid grid-cols-1 gap-3">
        {audit.posts.map((post, i) => (
          <AuditPostCard key={`${post.link || post.title}-${i}`} post={post} />
        ))}
      </div>

      {/* 면책 고지 */}
      <p className="mt-4 text-xs text-[#8a93a0] leading-relaxed">
        본 진단은 닥터포스트 자동 검사 결과로, 법률 자문이나 의료광고 사전심의를 대체하지 않습니다.
        표시된 항목은 &ldquo;위반&rdquo;의 단정이 아닌 &ldquo;위반 소지·심의 필요&rdquo; 판정이며,
        최종 판단은 의료광고 심의기관 및 법률 전문가의 검토를 권장합니다.
      </p>
    </div>
  );
}
