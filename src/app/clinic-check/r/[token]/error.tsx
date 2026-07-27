'use client';

import Link from 'next/link';

/**
 * 공유 리포트 화면의 오류 경계.
 *
 * ★ 이 링크는 이미 메일·전화로 원장에게 나갔다. 저장된 옛 리포트가 지금 화면 기대와
 *   어긋나 렌더가 실패하면 그대로 500 이 되고, 링크를 받은 원장은 "죽은 링크"를 본다.
 *   그래서 무슨 일이 나든 안내 화면까지는 나가게 한다.
 *   (만료·없는 토큰은 여기가 아니라 404 로 떨어진다 — page.tsx 의 notFound)
 *
 * ⚠️ 인증 없는 공개 화면이라 오류 메시지 원문을 노출하지 않는다(내부 정보 유출 방지).
 *    추적은 digest 로 한다.
 * ⚠️ 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 */

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function SharedDiagnosisError({ error, reset }: ErrorProps) {
  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>
      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-14 sm:py-20">
        <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
        <h1 className="text-[22px] sm:text-[32px] font-black leading-tight mt-2 mb-5" style={{ letterSpacing: '-0.5px' }}>
          이 진단 결과를 불러오지 못했습니다
        </h1>
        <p className="text-[13.5px] sm:text-[15px] text-[#4a4f55] leading-relaxed">
          결과가 저장된 형식이 지금 화면과 맞지 않아 그대로 보여드릴 수 없었어요. 잠시 후 다시 시도하시거나, 병원 이름으로
          다시 진단하시면 최신 결과를 확인하실 수 있습니다.
        </p>
        {error.digest && <p className="text-[11px] text-[#8a93a0] mt-2">문의 시 참고 번호 · {error.digest}</p>}

        <div className="flex flex-col sm:flex-row gap-3 mt-7">
          <button
            type="button"
            onClick={reset}
            className="px-7 py-3.5 min-h-[44px] bg-[#202020] text-white font-bold rounded-xl"
          >
            다시 시도
          </button>
          <Link
            href="/clinic-check"
            className="px-7 py-3.5 min-h-[44px] bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl text-center"
          >
            병원 이름으로 다시 진단하기
          </Link>
        </div>
      </main>
    </div>
  );
}
