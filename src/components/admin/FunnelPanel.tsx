'use client';

/**
 * /admin 방문자·퍼널 카드 섹션 (읽기 전용).
 *
 * 데이터는 서버 컴포넌트(/admin page)가 service role 로 조회·집계해 props 로 내려준다 —
 * 이 컴포넌트는 표시만 담당한다(클라이언트에 키·원시 행 노출 없음).
 * 스타일은 KpiDashboard 카드·차트 팔레트를 그대로 따른다.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  FUNNEL_MEASUREMENT_START,
  type FunnelStats,
} from '@/content/lib/funnel-admin-stats';

interface FunnelPanelProps {
  stats: FunnelStats;
  /** false = funnel_events 조회 실패 (빈 상태와 구분해 안내) */
  ok: boolean;
  /** true = 조회 상한 도달로 일부만 집계됨 (과소 집계 가능 안내) */
  truncated: boolean;
}

const CARD =
  'bg-white border border-[#b4bfce] rounded-xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]';

function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

/**
 * 전 단계 수 대비 비율 (전 단계 0이면 '-').
 * ⚠️ 코호트 전환율이 아니다 — 각 단계는 독립 고유 집계(익명↔가입 주체 불연속)라
 * 기존 회원 결제 등으로 100%를 넘을 수 있다. 화면에서 '참고용'으로 명시한다.
 */
function stageRate(count: number, prev: number | null): string {
  if (prev === null) return '';
  if (prev <= 0) return '-';
  return `${((count / prev) * 100).toFixed(1)}%`;
}

export default function FunnelPanel({ stats, ok, truncated }: FunnelPanelProps) {
  const isEmpty = ok && stats.totalEvents === 0;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-[#202020]">방문자 · 퍼널</h2>
        <p className="text-xs text-[#5b6573]">
          자체 퍼널 계측 (funnel_events) · KST 기준 · 측정 시작 {FUNNEL_MEASUREMENT_START}
        </p>
      </div>

      {!ok && (
        <div className={`${CARD} p-6 text-sm text-rose-600`}>
          퍼널 데이터 조회에 실패했습니다. 잠시 후 새로고침해 주세요. (서버 로그 확인)
        </div>
      )}

      {ok && truncated && (
        <div className={`${CARD} p-4 text-xs text-amber-600`}>
          이벤트가 많아 최근 14일 중 일부(최대 3만 행)만 집계되었습니다 — 실제보다 적게
          표시될 수 있습니다.
        </div>
      )}

      {isEmpty && (
        <div className={`${CARD} p-8 text-center text-sm text-[#5b6573]`}>
          아직 수집된 방문·퍼널 데이터가 없습니다.
          <br />
          측정은 {FUNNEL_MEASUREMENT_START}부터 시작되어 그 이전 구간의 데이터는 존재하지
          않습니다.
        </div>
      )}

      {ok && !isEmpty && (
        <>
          {/* 오늘 방문 카드 2개 */}
          <div className="grid grid-cols-2 gap-4 md:max-w-md">
            <div className={`${CARD} p-5`}>
              <p className="text-xs text-[#5b6573] mb-2">오늘 방문자 (고유)</p>
              <p className="text-2xl font-bold text-[#202020]">
                {formatCount(stats.todayVisitors)}
                <span className="text-base font-normal text-[#5b6573] ml-1">명</span>
              </p>
            </div>
            <div className={`${CARD} p-5`}>
              <p className="text-xs text-[#5b6573] mb-2">오늘 방문 수</p>
              <p className="text-2xl font-bold text-[#202020]">
                {formatCount(stats.todayViews)}
                <span className="text-base font-normal text-[#5b6573] ml-1">회</span>
              </p>
            </div>
          </div>

          {/* 최근 14일 일별 방문자 추이 */}
          <div className={`${CARD} p-6`}>
            <h3 className="text-sm font-semibold text-[#202020] mb-4">
              최근 14일 일별 방문자 (고유)
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="label"
                  stroke="#6b7280"
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #b4bfce',
                    borderRadius: 6,
                    color: '#202020',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#5b6573' }}
                  formatter={(value, name) => [
                    `${formatCount(Number(value))}${name === 'visitors' ? '명' : '회'}`,
                    name === 'visitors' ? '방문자' : '방문 수',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="visitors"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: '#10b981', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 최근 7일 퍼널 단계 */}
          <div className={`${CARD} p-6`}>
            <h3 className="text-sm font-semibold text-[#202020] mb-1">최근 7일 퍼널</h3>
            <p className="text-xs text-[#5b6573] mb-4">
              단계별 고유 주체 기준 · 방문 → 진단(입력·제출·실행·결과) → 가입 시작 → 가입 완료
              → 첫 글 → 결제 · 비율은 단계별{' '}
              <span className="font-medium">독립 집계 참고용</span>
              (동일 사용자 추적 코호트 전환율 아님 — 100% 초과 가능)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {stats.weekly.map((stage, i) => {
                const prev = i > 0 ? stats.weekly[i - 1].count : null;
                const rate = stageRate(stage.count, prev);
                return (
                  <div
                    key={stage.stage}
                    className="rounded-lg border border-[#b4bfce] bg-[#eef2f6] p-4"
                  >
                    <p className="text-xs text-[#5b6573] mb-1">
                      {i + 1}. {stage.label}
                    </p>
                    <p className="text-xl font-bold text-[#202020]">
                      {formatCount(stage.count)}
                    </p>
                    {rate && (
                      <p className="mt-1 text-xs text-emerald-600">
                        전 단계 수 대비 {rate}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
