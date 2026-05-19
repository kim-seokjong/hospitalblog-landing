'use client';

interface NaverPreviewProps {
  title: string;
  body: string;
  keyword: string;
}

export default function NaverPreview({ title, body, keyword }: NaverPreviewProps) {
  // 제목에서 키워드 하이라이트
  const highlightKeyword = (text: string) => {
    if (!keyword) return text;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase()
        ? <mark key={i} className="bg-transparent text-blue-700 font-bold not-italic">{part}</mark>
        : part
    );
  };

  // 본문에서 첫 문장 추출 (이미지 플레이스홀더·마크다운 제거)
  const snippet = body
    ? body
        .split('\n')
        .map(l => l.replace(/^#+\s*/, '').replace(/\[이미지\s*\d+:[^\]]*\]/g, '').trim())
        .find(l => l.length > 20) ?? `${title}에 대해 알아보겠습니다.`
    : `${title}에 대해 알아보겠습니다. 전문의와 상담 후 결정하시기 바랍니다.`;

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-gray-700 to-gray-800 p-5">
        <h3 className="text-white font-bold text-base">네이버 검색 미리보기</h3>
        <p className="text-gray-400 text-xs mt-0.5">실제 검색 결과 화면 시뮬레이션</p>
      </div>

      <div className="p-5">
        {/* 검색창 시뮬레이션 */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-green-600 font-black text-lg">N</span>
          <span className="text-gray-600 text-sm">{keyword}</span>
          <svg className="ml-auto text-green-600 w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </div>

        {/* 검색 결과 카드 */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* 블로그 뷰 헤더 */}
          <div className="bg-green-50 border-b border-green-100 px-4 py-2 flex items-center gap-2">
            <span className="text-green-700 text-xs font-bold">VIEW</span>
            <span className="text-gray-400 text-xs">블로그</span>
          </div>

          {/* 결과 아이템 */}
          <div className="p-4 hover:bg-gray-50 transition-colors cursor-pointer">
            <div className="flex items-start gap-3">
              {/* 썸네일 자리 */}
              <div className="w-20 h-16 bg-gradient-to-br from-blue-100 to-indigo-200 rounded-lg flex-shrink-0 flex items-center justify-center">
                <span className="text-2xl">🏥</span>
              </div>

              <div className="flex-1 min-w-0">
                {/* 제목 */}
                <h3 className="text-blue-700 font-semibold text-sm mb-1 leading-snug line-clamp-2 hover:underline">
                  {highlightKeyword(title)}
                </h3>

                {/* 스니펫 */}
                <p className="text-gray-500 text-xs leading-relaxed line-clamp-2">
                  {highlightKeyword(snippet)}
                </p>

                {/* 출처 */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-green-600 text-xs">N</span>
                  <span className="text-gray-400 text-xs">병원 블로그</span>
                  <span className="text-gray-300 text-xs">·</span>
                  <span className="text-gray-400 text-xs">방금 전</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 제목 분석 */}
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-bold text-gray-600">제목 분석</h4>
          <div className="grid grid-cols-3 gap-2">
            {[
              {
                label: '길이',
                value: `${title.length}자`,
                ok: title.length >= 25 && title.length <= 35,
                hint: '25~35자 권장'
              },
              {
                label: '키워드',
                value: title.toLowerCase().includes(keyword.toLowerCase()) ? '포함 ✓' : '미포함 ✗',
                ok: title.toLowerCase().includes(keyword.toLowerCase()),
                hint: '키워드 포함 필수'
              },
              {
                label: '앞배치',
                value: (() => { const idx = title.toLowerCase().indexOf(keyword.toLowerCase()); return idx !== -1 && idx < 10 ? '최적 ✓' : '개선 필요'; })(),
                ok: (() => { const idx = title.toLowerCase().indexOf(keyword.toLowerCase()); return idx !== -1 && idx < 10; })(),
                hint: '앞 10자 내 배치'
              },
            ].map(({ label, value, ok, hint }) => (
              <div key={label} className={`rounded-lg p-2 text-center ${ok ? 'bg-green-50' : 'bg-amber-50'}`}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-xs font-bold mt-0.5 ${ok ? 'text-green-700' : 'text-amber-600'}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
