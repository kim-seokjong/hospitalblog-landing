export default function Loading() {
  return (
    <main className="min-h-screen bg-[#eef2f6] text-[#202020] p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 헤더 스켈레톤 */}
        <div className="space-y-2">
          <div className="h-7 w-72 bg-[#dbe2ea] rounded animate-pulse" />
          <div className="h-4 w-96 bg-[#dbe2ea] rounded animate-pulse" />
        </div>

        {/* 5 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-[#dbe2ea] rounded-xl p-5 space-y-3 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
            >
              <div className="h-3 w-20 bg-[#dbe2ea] rounded animate-pulse" />
              <div className="h-8 w-28 bg-[#dbe2ea] rounded animate-pulse" />
              <div className="h-3 w-16 bg-[#dbe2ea] rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* 2x2 차트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-[#dbe2ea] rounded-xl p-6 h-80 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
            >
              <div className="h-4 w-32 bg-[#dbe2ea] rounded animate-pulse mb-4" />
              <div className="h-56 w-full bg-[#dbe2ea]/60 rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* 회원 테이블 */}
        <div className="bg-white border border-[#dbe2ea] rounded-xl p-6 h-96 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <div className="h-4 w-32 bg-[#dbe2ea] rounded animate-pulse mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-full bg-[#dbe2ea]/40 rounded animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
