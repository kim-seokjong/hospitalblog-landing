'use client';

import type { BlogGuess } from '@/content/lib/clinic-diagnosis/types';

/**
 * 블로그 후보 선택 UI.
 *
 * 쓰임이 둘이다.
 *  ① 이름 신호가 아예 없어 특정하지 못한 경우 → "이 중에 병원 블로그가 있나요?" (선택 필요)
 *  ② 1위 후보로 이미 진단을 진행한 경우(assumed) → "다른 블로그였나요?" (교체용, 흐름을 막지 않음)
 *
 * ★ 사용자는 이미 병원을 한 번 골랐다. 두 번째 선택을 **강요하지 않는다** —
 *   ②에서는 진단 결과가 이미 화면에 있고, 이 목록은 바꾸고 싶을 때만 쓰는 것이다.
 *
 * **판단 근거를 그대로 보여준다** — 블로거명·검색 점유 편수·제목 언급 횟수·지역/진료과 언급.
 * 원장이 "왜 이걸 후보로 봤는지"를 직접 검증할 수 있어야 오탐이 신뢰 손상으로
 * 이어지지 않는다.
 */

interface Props {
  readonly guesses: readonly BlogGuess[];
  readonly onPick: (blogId: string) => void;
  readonly busy: boolean;
  /** 이미 이 블로그로 진단한 상태면 그 ID — 목록에서 표시하고 다시 고르지 않게 한다. */
  readonly currentBlogId?: string | null;
}

export default function BlogGuessPicker({ guesses, onPick, busy, currentBlogId }: Props) {
  const others = guesses.filter((g) => g.blogId !== currentBlogId);
  if (guesses.length === 0 || (currentBlogId && others.length === 0)) return null;

  return (
    <section className="mt-4 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl p-4 sm:p-5">
      <h3 className="text-[14px] font-extrabold">{currentBlogId ? '다른 블로그였나요?' : '이 중에 병원 블로그가 있나요?'}</h3>
      <p className="text-[12px] text-[#5b6573] mt-1.5 mb-3 leading-relaxed">
        {currentBlogId
          ? '위 결과는 지금 표시된 블로그를 기준으로 만든 거예요. 다른 블로그가 맞다면 고르시면 그 블로그로 다시 진단해 드려요.'
          : '고르시면 그 블로그로 다시 진단해 드려요. 목록에 없으면 아래 상세 진단에서 주소를 직접 넣어 주세요.'}
      </p>
      <ul className="space-y-2">
        {others.map((guess) => (
          <li key={guess.blogId}>
            <button
              type="button"
              onClick={() => onPick(guess.blogId)}
              disabled={busy}
              className="w-full text-left bg-white border border-[#dbe2ea] hover:border-[#ff4628] rounded-xl px-4 py-3.5 min-h-[44px] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-extrabold truncate">{guess.bloggerName || guess.blogId}</p>
                  <p className="text-[12px] text-[#4a4f55] mt-0.5 truncate">blog.naver.com/{guess.blogId}</p>
                  <p className="text-[11px] text-[#8a93a0] mt-1">
                    검색결과 {guess.hits}편 차지
                    {guess.titleMentions > 0 && ` · 제목에 병원명 ${guess.titleMentions}회`}
                    {guess.nameInBloggerName && ' · 블로그 이름이 병원명과 일치'}
                    {(guess.regionMentions ?? 0) > 0 && ` · 지역 언급 ${guess.regionMentions}회`}
                  </p>
                </div>
                <span className="flex-shrink-0 text-[12px] font-bold text-[#ff4628] mt-0.5">
                  {busy ? '진단 중…' : '이거예요 →'}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
