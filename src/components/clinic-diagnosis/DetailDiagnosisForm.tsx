'use client';

import { useState } from 'react';
import type { ClinicCandidate } from '@/content/lib/clinic-diagnosis/types';

/**
 * 4단계 — 상세 진단 입력.
 *
 * 자동 탐색이 실패했거나(블로그 특정 불가·홈페이지 주소 없음) 더 정확히 보고 싶을 때,
 * 블로그 주소·홈페이지 주소·글 본문을 **직접 받아** 다시 진단한다.
 *
 * 본문 붙여넣기를 두는 이유: 네이버 검색 API 가 주는 description 은 짧고,
 * 블로그 본문을 긁어오는 것은 하지 않기 때문이다(크롤링 금지). 정밀한 의료광고법
 * 점검이 필요하면 원장이 직접 붙여넣는 것이 유일하게 정직한 경로다.
 */

export interface DetailInput {
  readonly blogId: string;
  readonly siteUrl: string;
  readonly body: string;
}

interface Props {
  readonly clinic: ClinicCandidate | null;
  readonly busy: boolean;
  readonly onSubmit: (detail: DetailInput) => void;
}

const inputClass =
  'w-full px-4 py-3.5 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]';

export default function DetailDiagnosisForm({ clinic, busy, onSubmit }: Props) {
  const [blogId, setBlogId] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [body, setBody] = useState('');

  const nothingFilled = blogId.trim() === '' && siteUrl.trim() === '' && body.trim() === '';

  return (
    <section className="mt-8 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl p-5 sm:p-6">
      <h2 className="text-lg font-extrabold">상세 진단 — 직접 넣어 정확도 올리기</h2>
      <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
        자동으로 못 찾은 항목이 있으면 여기에 넣어 주세요. 넣은 항목만 다시 진단하고, 비워 두신 항목은 그대로 둡니다.
      </p>

      {!clinic && (
        <p className="text-[12px] text-[#c3341a] mt-3">
          먼저 위에서 병원을 선택해 주세요. 어느 병원인지 확정되어야 진단할 수 있어요.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clinic || nothingFilled) return;
          onSubmit({ blogId: blogId.trim(), siteUrl: siteUrl.trim(), body: body.trim() });
        }}
        className="mt-4 space-y-3"
      >
        <div>
          <label htmlFor="dx-blog" className="block text-[12px] font-bold text-[#3c4653] mb-1.5">
            네이버 블로그 주소
          </label>
          <input
            id="dx-blog"
            type="text"
            value={blogId}
            onChange={(e) => setBlogId(e.target.value)}
            placeholder="blog.naver.com/myclinic"
            className={inputClass}
            style={{ colorScheme: 'light' }}
            maxLength={300}
          />
        </div>

        <div>
          <label htmlFor="dx-site" className="block text-[12px] font-bold text-[#3c4653] mb-1.5">
            홈페이지 주소
          </label>
          <input
            id="dx-site"
            type="text"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="www.myclinic.co.kr"
            className={inputClass}
            style={{ colorScheme: 'light' }}
            maxLength={300}
          />
        </div>

        <div>
          <label htmlFor="dx-body" className="block text-[12px] font-bold text-[#3c4653] mb-1.5">
            글 본문 붙여넣기 (의료광고법 표현 정밀 점검)
          </label>
          <textarea
            id="dx-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="점검하고 싶은 글 본문을 그대로 붙여넣어 주세요. 50자 이상부터 점검합니다."
            rows={6}
            className={`${inputClass} resize-y leading-relaxed`}
            style={{ colorScheme: 'light' }}
            maxLength={20000}
          />
          <p className="text-[11px] text-[#8a93a0] mt-1.5 leading-relaxed">
            블로그 글을 저희가 직접 긁어오지 않아요. 본문 전체를 보려면 이렇게 직접 넣어 주셔야 합니다.
            붙여넣은 내용은 진단에만 쓰이고 따로 보관하지 않아요.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy || !clinic || nothingFilled}
          className="w-full px-6 py-3.5 min-h-[44px] bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '진단 중…' : '이 정보로 다시 진단하기'}
        </button>
      </form>
    </section>
  );
}
