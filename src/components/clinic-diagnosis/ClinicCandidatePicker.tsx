'use client';

import type { ClinicCandidate, ClinicLookupOutcome } from '@/content/lib/clinic-diagnosis/types';

/**
 * 병원 후보 선택 UI.
 *
 * 이름만으로는 병원을 특정할 수 없다(실측: "미소치과의원" 전국 다수).
 * 후보가 1건일 때만 자동 확정되고, 그 외에는 이 화면이 뜬다.
 * **주소를 크게 보여주는 것**이 핵심이다 — 원장이 자기 병원인지 한눈에 알아야 한다.
 *
 * AuthModal 의 lookupResults/applyCandidate 패턴과 동일한 구조.
 */

interface Props {
  readonly outcome: ClinicLookupOutcome;
  readonly onPick: (clinic: ClinicCandidate) => void;
  readonly onNeedRegion: () => void;
  readonly busyMngNo: string | null;
}

function CandidateRow({
  clinic,
  onPick,
  busy,
}: {
  clinic: ClinicCandidate;
  onPick: (c: ClinicCandidate) => void;
  busy: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(clinic)}
        disabled={busy || !clinic.active}
        className="w-full text-left bg-white border border-[#dbe2ea] hover:border-[#ff4628] rounded-xl px-4 py-3.5 min-h-[44px] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-extrabold truncate">{clinic.name}</p>
            <p className="text-[12px] text-[#4a4f55] mt-1 leading-relaxed break-keep">
              {clinic.roadAddress || clinic.lotAddress}
            </p>
            <p className="text-[11px] text-[#8a93a0] mt-1">
              {clinic.specialty || clinic.institutionType}
              {clinic.phone && ` · ${clinic.phone}`}
              {!clinic.active && ` · ${clinic.statusLabel}`}
            </p>
          </div>
          <span className="flex-shrink-0 text-[12px] font-bold text-[#ff4628] mt-0.5">
            {busy ? '진단 중…' : clinic.active ? '선택 →' : '폐업'}
          </span>
        </div>
      </button>
    </li>
  );
}

export default function ClinicCandidatePicker({ outcome, onPick, onNeedRegion, busyMngNo }: Props) {
  if (outcome.kind === 'resolved') return null;

  if (outcome.kind === 'not_found') {
    return (
      <div className="mt-6 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl px-4 py-4">
        <p className="text-[14px] font-bold">그 이름으로 등록된 병원을 찾지 못했어요.</p>
        <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
          간판 이름과 정식 등록 상호가 다른 경우가 많아요(예: 간판 “플로르”, 등록 “플로르 성형외과 의원”).
          지역을 함께 넣거나 정식 상호로 다시 검색해 주세요.
        </p>
      </div>
    );
  }

  if (outcome.kind === 'closed_only') {
    return (
      <div className="mt-6 bg-[#fff7f5] border border-[#ffd0c4] rounded-2xl px-4 py-4">
        <p className="text-[14px] font-bold text-[#c3341a]">같은 이름이 폐업으로 등록돼 있어요.</p>
        <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
          행정안전부 자료 기준입니다. 이전·재개원 등으로 상호가 바뀌었을 수 있으니 현재 등록 상호로 다시 검색해 주세요.
        </p>
        <ul className="space-y-2 mt-3">
          {outcome.candidates.map((c) => (
            <CandidateRow key={c.mngNo} clinic={c} onPick={onPick} busy={busyMngNo !== null} />
          ))}
        </ul>
      </div>
    );
  }

  if (outcome.kind === 'region_miss') {
    return (
      <div className="mt-6 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl px-4 py-4">
        <p className="text-[14px] font-bold">
          “{outcome.region}”에서는 그 이름의 병원을 찾지 못했어요.
        </p>
        <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
          대신 <b>다른 지역</b>에 같은 이름의 병원이 있어요. 아래는 입력하신 지역의 병원이 <b>아닙니다</b> — 주소를
          확인하시고 맞는 곳이 있으면 골라 주세요.
        </p>
        <ul className="space-y-2 mt-3">
          {outcome.candidates.map((c) => (
            <CandidateRow key={c.mngNo} clinic={c} onPick={onPick} busy={busyMngNo !== null} />
          ))}
        </ul>
      </div>
    );
  }

  if (outcome.kind === 'needs_region') {
    return (
      <div className="mt-6 bg-[#f7f9fb] border border-[#dbe2ea] rounded-2xl px-4 py-4">
        <p className="text-[14px] font-bold">같은 이름의 병원이 전국에 너무 많아요.</p>
        <p className="text-[12.5px] text-[#4a4f55] mt-1.5 leading-relaxed">
          이름만으로는 어느 병원인지 확정할 수 없어서 여기서 멈췄어요. 엉뚱한 병원을 진단해 드리지 않으려는 거예요.
          지역(시·구)을 함께 넣어 주세요.
        </p>
        <button
          type="button"
          onClick={onNeedRegion}
          className="mt-3 px-5 py-2.5 min-h-[44px] bg-[#202020] text-white text-[13px] font-bold rounded-xl"
        >
          지역 입력하기
        </button>
        {outcome.candidates.length > 0 && (
          <>
            <p className="text-[11px] text-[#8a93a0] mt-4 mb-2">일부 후보만 미리 보여드려요.</p>
            <ul className="space-y-2">
              {outcome.candidates.map((c) => (
                <CandidateRow key={c.mngNo} clinic={c} onPick={onPick} busy={busyMngNo !== null} />
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (outcome.kind === 'unavailable') {
    return (
      <div className="mt-6 bg-yellow-50 border border-yellow-500/30 rounded-2xl px-4 py-4">
        <p className="text-[13px] text-yellow-800 leading-relaxed">
          {outcome.reason === 'not_configured'
            ? '병원 조회 서비스가 아직 연결되지 않았어요. 아래 상세 진단에서 블로그·홈페이지 주소를 직접 넣어 주시면 진단해 드릴게요.'
            : '병원 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}
        </p>
      </div>
    );
  }

  // ambiguous
  return (
    <div className="mt-6">
      <p className="text-[14px] font-bold">
        같은 이름의 병원이 {outcome.candidates.length}곳 있어요. 어느 병원인가요?
      </p>
      <p className="text-[12px] text-[#8a93a0] mt-1 mb-3">주소를 보고 골라 주세요.</p>
      <ul className="space-y-2">
        {outcome.candidates.map((c) => (
          <CandidateRow key={c.mngNo} clinic={c} onPick={onPick} busy={busyMngNo !== null} />
        ))}
      </ul>
      {outcome.truncated && (
        <p className="text-[11px] text-[#8a93a0] mt-3">
          후보가 더 있을 수 있어요. 목록에 없으면 지역을 함께 넣어 다시 검색해 주세요.
        </p>
      )}
    </div>
  );
}
