'use client';

import type { BlogGuess } from '@/content/lib/clinic-diagnosis/types';

/**
 * 블로그 후보 선택 UI.
 *
 * 자동 탐색이 "이 블로그가 그 병원 것"이라고 확신하지 못하면(같은 이름의 블로그가
 * 둘 이상, 실측: 플로르 성형외과 2개 / 연세바로치과 5개) 확정하지 않고 이 화면을 띄운다.
 *
 * **판단 근거를 그대로 보여준다** — 블로거명·검색 점유 편수·제목 언급 횟수.
 * 원장이 "왜 이걸 후보로 봤는지"를 직접 검증할 수 있어야 오탐이 신뢰 손상으로
 * 이어지지 않는다.
 */

interface Props {
  readonly guesses: readonly BlogGuess[];
  readonly onPick: (blogId: string) => void;
  readonly busy: boolean;
}

export default function BlogGuessPicker({ guesses, onPick, busy }: Props) {
  if (guesses.length === 0) return null;

  return (
    <section className="mt-4 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl p-4 sm:p-5">
      <h3 className="text-[14px] font-extrabold">이 중에 병원 블로그가 있나요?</h3>
      <p className="text-[12px] text-[#5b6573] mt-1.5 mb-3 leading-relaxed">
        고르시면 그 블로그로 다시 진단해 드려요. 목록에 없으면 아래 상세 진단에서 주소를 직접 넣어 주세요.
      </p>
      <ul className="space-y-2">
        {guesses.map((guess) => (
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
