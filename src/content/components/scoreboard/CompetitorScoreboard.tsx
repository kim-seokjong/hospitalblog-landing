'use client';

import type { PublishFrequencyResult } from '@/content/lib/scoreboard/publish-frequency';
import PublishFrequencyCard from '@/content/components/scoreboard/PublishFrequencyCard';
import VideoCompareCard from '@/content/components/scoreboard/VideoCompareCard';
import PlaceCompareCard from '@/content/components/scoreboard/PlaceCompareCard';
import SocialCompareCard from '@/content/components/scoreboard/SocialCompareCard';
import KeywordVolumeCard from '@/content/components/scoreboard/KeywordVolumeCard';

/**
 * 경쟁 병원 종합 비교 영역 (/monitor 하단).
 *
 * 4개 섹션이 각각 독립 로딩·독립 실패한다 — 하나가 죽어도 나머지는 표시.
 * 컴플라이언스: 타 병원 비방·평가 표현 금지, 공개된 사실 수치만 표시.
 * 매출·방문자수 추정치는 절대 표시하지 않는다.
 */

interface Props {
  specialty: string;
  region: string;
  hospitalName: string;
  publishFrequency: PublishFrequencyResult | null;
  runId: number; // 분석 실행마다 증가 — 유튜브/플레이스 재조회 트리거
}

export default function CompetitorScoreboard({
  specialty,
  region,
  hospitalName,
  publishFrequency,
  runId,
}: Props) {
  return (
    <section aria-label="경쟁 병원 종합 비교">
      <div className="flex items-center gap-2 mb-4 mt-2">
        <h2 className="text-base sm:text-lg font-extrabold text-[#202020]">경쟁 병원 종합 비교</h2>
        <span className="text-[10px] font-semibold text-[#5b6573] bg-[#eef2f6] border border-[#b4bfce] px-2 py-0.5 rounded-full">
          공개 수치 기준
        </span>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4 leading-relaxed">
        공개된 사실 수치만 표시하며, 병원 간 우열 평가가 아닙니다. 일부 지표는 외부 사정에 따라 일시적으로 확인이 어려울 수 있습니다.
      </p>

      {/* 모바일: 세로 스택 / 데스크톱: 2열 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        <PublishFrequencyCard data={publishFrequency} />
        <VideoCompareCard query={`${region} ${specialty}`} runId={runId} />
        <PlaceCompareCard
          specialty={specialty}
          region={region}
          hospitalName={hospitalName}
          runId={runId}
        />
        <KeywordVolumeCard specialty={specialty} region={region} runId={runId} />
        <SocialCompareCard />
      </div>
    </section>
  );
}
