'use client';

import { useMemo, useState } from 'react';
import { summarizeRoi, DEFAULT_INQUIRY_RATE, DEFAULT_BOOKING_RATE } from '@/content/lib/roi-estimate';

/**
 * 마케팅 ROI 추정 시뮬레이터 (원장 내부 계획용).
 * monitor 페이지 기획서 결과 하단에 통합된다.
 *
 * ⚠️ 공개 광고가 아니며, 모든 수치는 "추정"이다. 과장·보장 표현 금지·면책 고지 필수.
 */

interface RoiSimulatorProps {
  /** 분석에서 가져온 추천 키워드 검색량 합 (prefill). 없으면 0 → 사용자가 직접 입력. */
  initialMonthlyVolume?: number;
  /** 마케팅 비용 기본값(원). 미지정 시 스탠다드 플랜가(199,000). */
  initialCost?: number;
}

const DEFAULT_PATIENT_VALUE = 300000; // 평균 환자가치 기본값(원) — 사용자 조정 가능
const DEFAULT_COST = 199000; // 스탠다드 플랜가(₩199,000) 기본값
const MAX_VOLUME = 100_000_000;
const MAX_MONEY = 100_000_000_000;

function clampNumber(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > max ? max : value;
}

/** 천단위 콤마 정수 포맷 */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

/** 원화 포맷 */
function fmtKrw(n: number): string {
  return `${fmtInt(n)}원`;
}

function EstimateBadge() {
  return (
    <span className="text-[9px] font-bold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-1.5 py-0.5 rounded-full align-middle">
      추정
    </span>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  max: number;
  step?: number;
  hint?: string;
}

function NumberField({ label, value, onChange, suffix, max, step, hint }: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[#5b6573]">{label}</label>
      <div className="relative flex items-center">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={step ?? 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(clampNumber(Number(e.target.value), max))}
          className="w-full bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-2.5 pr-10 focus:outline-none focus:border-[#ff4628] transition-colors"
          style={{ colorScheme: 'light' }}
        />
        {suffix && (
          <span className="absolute right-3 text-xs text-[#73808f] pointer-events-none">{suffix}</span>
        )}
      </div>
      {hint && <span className="text-[10px] text-[#73808f]">{hint}</span>}
    </div>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  accent?: boolean;
  negative?: boolean;
}

function ResultCard({ label, value, accent, negative }: ResultCardProps) {
  return (
    <div
      className={`rounded-xl px-3 py-3 border ${
        accent ? 'bg-[#ffece7] border-[#ff4628]/30' : 'bg-[#eef2f6] border-[#b4bfce]'
      }`}
    >
      <p className="text-[11px] font-semibold text-[#5b6573] mb-1 flex items-center gap-1">
        {label} <EstimateBadge />
      </p>
      <p
        className={`text-base sm:text-lg font-extrabold tabular-nums break-all ${
          negative ? 'text-red-600' : accent ? 'text-[#ff4628]' : 'text-[#202020]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function RoiSimulator({ initialMonthlyVolume, initialCost }: RoiSimulatorProps) {
  const [volume, setVolume] = useState<number>(clampNumber(initialMonthlyVolume ?? 0, MAX_VOLUME));
  const [rank, setRank] = useState<number>(1);
  const [inquiryPct, setInquiryPct] = useState<number>(DEFAULT_INQUIRY_RATE * 100);
  const [bookingPct, setBookingPct] = useState<number>(DEFAULT_BOOKING_RATE * 100);
  const [patientValue, setPatientValue] = useState<number>(DEFAULT_PATIENT_VALUE);
  const [cost, setCost] = useState<number>(clampNumber(initialCost ?? DEFAULT_COST, MAX_MONEY));
  const [showBreakdown, setShowBreakdown] = useState(false);

  const summary = useMemo(
    () =>
      summarizeRoi({
        totalMonthlyVolume: volume,
        rank,
        inquiryRate: inquiryPct / 100,
        bookingRate: bookingPct / 100,
        patientValue,
        cost,
      }),
    [volume, rank, inquiryPct, bookingPct, patientValue, cost]
  );

  const profitNegative = summary.profit < 0;
  const roiNegative = summary.roiPct !== null && summary.roiPct < 0;

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">📈</span>
        </div>
        <h2 className="text-sm font-bold text-[#202020]">마케팅 ROI 추정 시뮬레이터</h2>
        <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] px-2 py-0.5 rounded-full border border-[#ff4628]/30">
          계획용 추정
        </span>
      </div>
      <p className="text-xs text-[#5b6573] mb-4">
        검색량·목표순위·전환율을 조정하면 추정 방문·매출·ROI 가 즉시 계산됩니다. 값을 자유롭게 바꿔보세요.
      </p>

      {/* 입력 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <NumberField
          label="합산 월 검색량"
          value={volume}
          onChange={setVolume}
          suffix="회"
          max={MAX_VOLUME}
          step={100}
          hint={initialMonthlyVolume ? '분석 키워드 검색량 합으로 채움 (수정 가능)' : '검색량 데이터가 없으면 직접 입력하세요'}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[#5b6573]">목표 검색순위</label>
          <select
            value={rank}
            onChange={(e) => setRank(Number(e.target.value))}
            className="bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] transition-colors appearance-none"
            style={{ colorScheme: 'light' }}
          >
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>{r}위</option>
            ))}
          </select>
          <span className="text-[10px] text-[#73808f]">상위 노출일수록 추정 클릭률이 높습니다</span>
        </div>

        <NumberField
          label="문의 전환율 (방문→문의)"
          value={inquiryPct}
          onChange={(v) => setInquiryPct(clampNumber(v, 100))}
          suffix="%"
          max={100}
          step={0.1}
          hint="보수적 기본값 2% (조정 가능)"
        />

        <NumberField
          label="예약 전환율 (문의→예약)"
          value={bookingPct}
          onChange={(v) => setBookingPct(clampNumber(v, 100))}
          suffix="%"
          max={100}
          step={1}
          hint="보수적 기본값 35% (조정 가능)"
        />

        <NumberField
          label="평균 환자가치"
          value={patientValue}
          onChange={setPatientValue}
          suffix="원"
          max={MAX_MONEY}
          step={10000}
          hint="환자 1명의 평균 매출 기여액"
        />

        <NumberField
          label="월 마케팅 비용"
          value={cost}
          onChange={setCost}
          suffix="원"
          max={MAX_MONEY}
          step={10000}
          hint="플랜가 기본값 (직접 수정 가능)"
        />
      </div>

      {/* 결과 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
        <ResultCard label="월 방문" value={`${fmtInt(summary.visits)}회`} />
        <ResultCard label="월 문의" value={`${fmtInt(summary.inquiries)}건`} />
        <ResultCard label="월 예약" value={`${fmtInt(summary.bookings)}건`} />
        <ResultCard label="월 매출" value={fmtKrw(summary.revenue)} accent />
        <ResultCard label="월 순이익" value={fmtKrw(summary.profit)} negative={profitNegative} />
        <ResultCard
          label="ROI"
          value={
            summary.roiPct === null || summary.roiMultiple === null
              ? '비용 입력 필요'
              : `${roiNegative ? '' : '+'}${fmtInt(summary.roiPct)}% · ${summary.roiMultiple.toFixed(1)}배`
          }
          accent={!roiNegative && summary.roiPct !== null}
          negative={roiNegative}
        />
      </div>

      {/* 산출 근거 펼치기 */}
      <button
        onClick={() => setShowBreakdown((v) => !v)}
        className="w-full text-left text-xs font-semibold text-[#4a4f55] bg-[#eef2f6] border border-[#b4bfce] rounded-xl px-4 py-2.5 hover:bg-[#e3e9ef] transition-colors flex items-center justify-between"
        aria-expanded={showBreakdown}
      >
        <span>🧮 산출 근거 보기</span>
        <span className="text-[#73808f]">{showBreakdown ? '▲' : '▼'}</span>
      </button>
      {showBreakdown && (
        <div className="mt-2 bg-[#eef2f6] border border-[#b4bfce] rounded-xl px-4 py-3 text-[11px] text-[#5b6573] leading-relaxed space-y-1">
          <p>
            ① 방문 = 검색량({fmtInt(summary.breakdown.totalMonthlyVolume)}) × CTR({(summary.breakdown.ctr * 100).toFixed(0)}%, {rank}위 추정) ={' '}
            <strong className="text-[#202020]">{fmtInt(summary.visits)}회</strong>
          </p>
          <p>
            ② 문의 = 방문({fmtInt(summary.visits)}) × 문의전환율({(summary.breakdown.inquiryRate * 100).toFixed(1)}%) ={' '}
            <strong className="text-[#202020]">{fmtInt(summary.inquiries)}건</strong>
          </p>
          <p>
            ③ 예약 = 문의({fmtInt(summary.inquiries)}) × 예약전환율({(summary.breakdown.bookingRate * 100).toFixed(0)}%) ={' '}
            <strong className="text-[#202020]">{fmtInt(summary.bookings)}건</strong>
          </p>
          <p>
            ④ 매출 = 예약({fmtInt(summary.bookings)}) × 환자가치({fmtKrw(summary.breakdown.patientValue)}) ={' '}
            <strong className="text-[#202020]">{fmtKrw(summary.revenue)}</strong>
          </p>
          <p>
            ⑤ 순이익 = 매출 − 비용({fmtKrw(summary.breakdown.cost)}) ={' '}
            <strong className="text-[#202020]">{fmtKrw(summary.profit)}</strong>
          </p>
          <p className="pt-1 text-[10px] text-[#73808f]">
            ※ CTR 곡선·전환율 기본값은 업계 추정치이며 정확값이 아닙니다. 실제 수치는 진료과목·지역·시술·시즌에 따라 달라집니다.
          </p>
        </div>
      )}

      {/* 면책 고지 (항상 노출) */}
      <p className="mt-4 text-[11px] text-[#73808f] bg-[#fffaf0] border border-[#f0e2c8] rounded-xl px-4 py-3 leading-relaxed">
        ⚠️ 본 수치는 마케팅 계획 수립용 추정이며, 실제 성과나 치료·내원 효과를 보장하지 않습니다. 환자 유치 성과는 보장될 수 없습니다.
      </p>
    </div>
  );
}
