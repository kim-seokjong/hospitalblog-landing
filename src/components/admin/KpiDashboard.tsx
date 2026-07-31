'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import type { DashboardData, PlanType } from '@/types/admin';
import RegionProgress from './RegionProgress';

interface KpiDashboardProps {
  data: DashboardData;
}

const PLAN_LABEL: Record<PlanType, string> = {
  free: '무료',
  basic: '베이직', // 레거시
  standard: '스탠다드',
  standard_care: '스탠다드 케어',
  pro: '프로', // 레거시
  growth8_standard: '올인원 그로스',
  growth_care: '올인원 케어',
  pro12_pro: '올인원 프로', // 레거시
};

const PLAN_COLOR: Record<PlanType, string> = {
  free: '#4b5563',
  basic: '#6ee7b7', // emerald-300
  standard: '#10b981', // emerald-500
  standard_care: '#0d9488', // teal-600
  pro: '#047857', // emerald-700 (레거시)
  growth8_standard: '#f59e0b', // amber-500
  growth_care: '#ea580c', // orange-600
  pro12_pro: '#e11d48', // rose-600 (레거시)
};

function formatKRW(n: number): string {
  return n.toLocaleString('ko-KR');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function ChangeBadge({ value, suffix = 'MoM' }: { value: number; suffix?: string }) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className="text-xs text-[#5b6573]">유지</span>;
  }
  const positive = value > 0;
  const color = positive ? 'text-emerald-600' : 'text-rose-600';
  const arrow = positive ? '↑' : '↓';
  return (
    <span className={`text-xs ${color}`}>
      {arrow} {positive ? '+' : ''}
      {value.toFixed(1)}% {suffix}
    </span>
  );
}

export default function KpiDashboard({ data }: KpiDashboardProps) {
  const [range, setRange] = useState<6 | 12>(12);

  const { metric, monthlyMRR, planDist, specialtyCounts, regionTargets, recentPayments } =
    data;

  const slicedMRR = useMemo(() => {
    const series = monthlyMRR.map((m) => ({
      month: m.month,
      mrr: Math.round(m.mrr / 10000), // 만원 단위
    }));
    return range === 6 ? series.slice(-6) : series;
  }, [monthlyMRR, range]);

  const pieData = useMemo(
    () =>
      planDist.map((p) => ({
        name: PLAN_LABEL[p.plan],
        value: p.count,
        plan: p.plan,
      })),
    [planDist]
  );

  const sortedSpecialty = useMemo(() => {
    return [...specialtyCounts].sort((a, b) => b.count - a.count).slice(0, 10);
  }, [specialtyCounts]);

  const maxSpecialtyCount = sortedSpecialty[0]?.count ?? 0;

  return (
    <div className="space-y-6">
      {/* 상단 5 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-[#b4bfce] rounded-xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-xs text-[#5b6573] mb-2">MRR</p>
          <p className="text-2xl font-bold text-[#202020]">
            {formatKRW(Math.round(metric.mrr / 10000))}
            <span className="text-base font-normal text-[#5b6573] ml-1">만원</span>
          </p>
          <div className="mt-2">
            <ChangeBadge value={metric.mrrChangeMoM} />
          </div>
        </div>

        <div className="bg-white border border-[#b4bfce] rounded-xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-xs text-[#5b6573] mb-2">구독 클리닉</p>
          <p className="text-2xl font-bold text-[#202020]">
            {metric.activeSubs}
            <span className="text-base font-normal text-[#5b6573] ml-1">개</span>
          </p>
          <p className="mt-2 text-xs text-emerald-600">
            ↑ +{metric.newSubsThisMonth} 이번달
          </p>
        </div>

        <div className="bg-white border border-[#b4bfce] rounded-xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-xs text-[#5b6573] mb-2">목표 달성률</p>
          <p className="text-2xl font-bold text-[#202020]">
            {metric.goalRate.toFixed(1)}
            <span className="text-base font-normal text-[#5b6573] ml-1">%</span>
          </p>
          <p className="mt-2 text-xs text-[#5b6573]">253개 목표</p>
        </div>

        <div className="bg-white border border-[#b4bfce] rounded-xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-xs text-[#5b6573] mb-2">해지율 (MoM)</p>
          <p className="text-2xl font-bold text-[#202020]">
            {metric.churnRate}
            <span className="text-base font-normal text-[#5b6573] ml-1">%</span>
          </p>
          {/* TODO: 해지율 추적 미구현 — 현재 근사치 0 */}
          <p className="mt-2 text-xs text-[#5b6573]">유지</p>
        </div>

        <div className="bg-white border border-[#b4bfce] rounded-xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-xs text-[#5b6573] mb-2">ARPU</p>
          <p className="text-2xl font-bold text-[#202020]">
            {formatKRW(metric.arpu)}
            <span className="text-base font-normal text-[#5b6573] ml-1">원</span>
          </p>
          <div className="mt-2">
            <ChangeBadge value={metric.arpuChangeMoM} />
          </div>
        </div>
      </div>

      {/* 차트 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MRR 추이 LineChart */}
        <div className="bg-white border border-[#b4bfce] rounded-xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#202020]">
              MRR 추이 (만원)
            </h3>
            <div className="flex gap-1">
              <button
                onClick={() => setRange(6)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  range === 6
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#eef2f6] text-[#4a4f55] hover:bg-[#b4bfce]'
                }`}
              >
                6개월
              </button>
              <button
                onClick={() => setRange(12)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  range === 12
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#eef2f6] text-[#4a4f55] hover:bg-[#b4bfce]'
                }`}
              >
                12개월
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={slicedMRR}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                stroke="#6b7280"
                fontSize={11}
                tick={{ fill: '#6b7280' }}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={11}
                tick={{ fill: '#6b7280' }}
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
                formatter={(value) => [`${formatKRW(Number(value))}만원`, 'MRR']}
              />
              <Line
                type="monotone"
                dataKey="mrr"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 플랜별 도넛 PieChart */}
        <div className="bg-white border border-[#b4bfce] rounded-xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <h3 className="text-sm font-semibold text-[#202020] mb-4">
            플랜별 분포
          </h3>
          {pieData.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-[#5b6573]">
              데이터 없음
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={PLAN_COLOR[entry.plan]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #b4bfce',
                    borderRadius: 6,
                    color: '#202020',
                    fontSize: 12,
                  }}
                  formatter={(value) => [`${Number(value)}개`, '구독']}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: '#6b7280' }}
                  formatter={(v) => <span className="text-[#4a4f55]">{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 진료과별 BarChart (가로형) */}
        <div className="bg-white border border-[#b4bfce] rounded-xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <h3 className="text-sm font-semibold text-[#202020] mb-4">
            진료과별 활성 구독
          </h3>
          {sortedSpecialty.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-[#5b6573]">
              데이터 없음
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, sortedSpecialty.length * 28)}>
              <BarChart
                data={sortedSpecialty}
                layout="vertical"
                margin={{ left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  stroke="#6b7280"
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                />
                <YAxis
                  dataKey="specialty"
                  type="category"
                  stroke="#6b7280"
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #b4bfce',
                    borderRadius: 6,
                    color: '#202020',
                    fontSize: 12,
                  }}
                  formatter={(value) => [`${Number(value)}개`, '구독']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {sortedSpecialty.map((s, i) => {
                    const intensity =
                      maxSpecialtyCount > 0 ? s.count / maxSpecialtyCount : 0;
                    // 짙은(emerald-600) → 옅은(emerald-900) 그라데이션
                    const opacity = 0.4 + intensity * 0.6;
                    return (
                      <Cell
                        key={i}
                        fill="#10b981"
                        fillOpacity={opacity}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 지역별 진척률 */}
        <RegionProgress targets={regionTargets} />
      </div>

      {/* 최근 결제 테이블 */}
      <div className="bg-white border border-[#b4bfce] rounded-xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <div className="p-4 border-b border-[#b4bfce]">
          <h3 className="text-sm font-semibold text-[#202020]">최근 결제 (최대 10건)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-[#eef2f6] text-xs text-[#5b6573] uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">플랜</th>
                <th className="px-4 py-3 text-left font-medium">이메일</th>
                <th className="px-4 py-3 text-right font-medium">금액</th>
                <th className="px-4 py-3 text-left font-medium">결제일시</th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[#5b6573] text-sm"
                  >
                    결제 내역 없음
                  </td>
                </tr>
              ) : (
                recentPayments.map((p, i) => (
                  <tr
                    key={i}
                    className="border-t border-[#b4bfce] hover:bg-[#eef2f6]"
                  >
                    <td className="px-4 py-3 text-[#202020]">
                      {PLAN_LABEL[(p.plan ?? 'free') as PlanType] ?? p.plan}
                    </td>
                    <td className="px-4 py-3 text-[#4a4f55]">
                      {p.email ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-[#202020]">
                      {formatKRW(p.amount)}원
                    </td>
                    <td className="px-4 py-3 text-[#5b6573]">
                      {formatDateTime(p.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
