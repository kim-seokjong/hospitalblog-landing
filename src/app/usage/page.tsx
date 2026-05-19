'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

type RangeType = 'today' | 'yesterday' | 'week';

interface FeatureStat {
  feature: string;
  count: number;
  input_tokens: number;
  output_tokens: number;
  image_count: number;
  cost_usd: number;
}

interface DailyStat {
  date: string;
  cost: number;
}

interface UsageData {
  range: string;
  fromDate: string;
  toDate: string;
  summary: {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalImages: number;
    totalCalls: number;
  };
  features: FeatureStat[];
  daily: DailyStat[];
}

const FEATURE_LABELS: Record<string, string> = {
  'generate-titles': '제목 생성',
  'generate-content': '본문 생성',
  'generate-tags': '태그 생성',
  'generate-images': '이미지 생성',
  'generate-cardnews-slides': '카드뉴스 슬라이드',
  'check-originality': '독창성 검사',
};


function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function fmtKRW(usd: number): string {
  const krw = usd * 1380;
  return krw >= 1 ? `₩${Math.round(krw).toLocaleString()}` : `₩${krw.toFixed(1)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function UsagePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [range, setRange] = useState<RangeType>('today');
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: d }) => {
      setUser(d.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const fetchUsage = useCallback(async (r: RangeType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/usage?range=${r}`);
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? '서버 오류');
      }
      const json = await res.json() as UsageData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void fetchUsage(range);
    }
  }, [range, fetchUsage, user]);

  const rangeLabel: Record<RangeType, string> = {
    today: '오늘',
    yesterday: '어제',
    week: '최근 7일',
  };

  // 인증 확인 중
  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>로딩 중...</div>
      </div>
    );
  }

  // 로그인 안 된 경우
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>로그인이 필요합니다</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>사용량 대시보드는 로그인 후 이용할 수 있습니다.</div>
          <a href="/" style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
            앱으로 이동해서 로그인
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 16px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            일별 사용량
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{user.email}</span>
            <a href="/payment/history" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>결제내역</a>
            <a href="/settings/profile" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>프로필</a>
            <a href="/" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>← 앱으로 돌아가기</a>
          </div>
        </div>

        {/* 범위 탭 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['today', 'yesterday', 'week'] as RangeType[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontWeight: range === r ? 700 : 400,
                fontSize: 14,
                background: range === r ? '#2563eb' : '#e2e8f0',
                color: range === r ? '#fff' : '#475569',
                transition: 'all 0.15s',
              }}
            >
              {rangeLabel[r]}
            </button>
          ))}
          <button
            onClick={() => void fetchUsage(range)}
            style={{
              marginLeft: 'auto',
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              color: '#475569',
            }}
          >
            새로고침
          </button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>불러오는 중...</div>
        )}

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 16, color: '#dc2626', marginBottom: 24 }}>
            오류: {error}
            <br />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              Supabase에 usage_logs 테이블이 없으면 아래 SQL을 실행해주세요.
            </span>
          </div>
        )}

        {!loading && data && (
          <>
            {/* 요약 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              <SummaryCard label="총 비용 (USD)" value={`$${fmt(data.summary.totalCost, 4)}`} sub={fmtKRW(data.summary.totalCost)} color="#2563eb" />
              <SummaryCard label="총 호출" value={`${data.summary.totalCalls}회`} color="#0891b2" />
              <SummaryCard label="입력 토큰" value={fmtTokens(data.summary.totalInputTokens)} color="#7c3aed" />
              <SummaryCard label="출력 토큰" value={fmtTokens(data.summary.totalOutputTokens)} color="#db2777" />
              {data.summary.totalImages > 0 && (
                <SummaryCard label="생성 이미지" value={`${data.summary.totalImages}장`} sub={`$${fmt(data.summary.totalImages * 0.04, 2)}`} color="#ea580c" />
              )}
            </div>

            {/* 기능별 테이블 */}
            {data.features.length > 0 ? (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontSize: 14, color: '#334155' }}>
                  기능별 사용 현황
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={th}>기능</th>
                      <th style={th}>횟수</th>
                      <th style={th}>입력 토큰</th>
                      <th style={th}>출력 토큰</th>
                      <th style={th}>이미지</th>
                      <th style={th}>비용 (USD)</th>
                      <th style={th}>비용 (KRW)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.features
                      .sort((a, b) => b.cost_usd - a.cost_usd)
                      .map((f, i) => (
                        <tr key={f.feature} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          <td style={td}>{FEATURE_LABELS[f.feature] ?? f.feature}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{f.count}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(f.input_tokens)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(f.output_tokens)}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{f.image_count > 0 ? `${f.image_count}장` : '-'}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#2563eb', fontWeight: 600 }}>${fmt(f.cost_usd, 4)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#475569' }}>{fmtKRW(f.cost_usd)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                      <td style={td}>합계</td>
                      <td style={{ ...td, textAlign: 'center' }}>{data.summary.totalCalls}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(data.summary.totalInputTokens)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(data.summary.totalOutputTokens)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{data.summary.totalImages > 0 ? `${data.summary.totalImages}장` : '-'}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#2563eb' }}>${fmt(data.summary.totalCost, 4)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtKRW(data.summary.totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '48px 0', textAlign: 'center', color: '#94a3b8', marginBottom: 24 }}>
                {rangeLabel[range]} 사용 기록이 없습니다.
              </div>
            )}

            {/* 일별 비용 (week 범위) */}
            {range === 'week' && data.daily.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontSize: 14, color: '#334155' }}>
                  일별 비용
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.daily.map(d => {
                    const maxCost = Math.max(...data.daily.map(x => x.cost));
                    const pct = maxCost > 0 ? (d.cost / maxCost) * 100 : 0;
                    return (
                      <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ width: 80, fontSize: 12, color: '#64748b', flexShrink: 0 }}>{d.date}</span>
                        <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 16, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, background: '#2563eb', height: '100%', borderRadius: 4, minWidth: d.cost > 0 ? 4 : 0 }} />
                        </div>
                        <span style={{ width: 80, fontSize: 12, color: '#2563eb', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
                          ${fmt(d.cost, 4)}
                        </span>
                        <span style={{ width: 60, fontSize: 11, color: '#64748b', textAlign: 'right', flexShrink: 0 }}>
                          {fmtKRW(d.cost)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SQL 안내 */}
            <details style={{ marginTop: 24, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
              <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                Supabase 테이블 생성 SQL (처음 설정 시)
              </summary>
              <pre style={{ margin: 0, padding: '0 16px 16px', fontSize: 11, color: '#475569', overflowX: 'auto', background: 'transparent' }}>
{`CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  api_provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 날짜 범위 조회 인덱스
CREATE INDEX IF NOT EXISTS usage_logs_created_at_idx ON usage_logs(created_at);

-- RLS: service_role만 삽입/조회 허용 (관리자 전용)
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON usage_logs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');`}
              </pre>
            </details>

            <p style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
              환율 기준: $1 = ₩1,380 · Claude Sonnet 4.6: 입력 $3/MTok, 출력 $15/MTok · fal.ai Flux.1 Pro: $0.04/장
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '16px 20px' }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#475569',
  fontSize: 12,
  borderBottom: '1px solid #e2e8f0',
};

const td: React.CSSProperties = {
  padding: '10px 16px',
  color: '#334155',
  borderBottom: '1px solid #f1f5f9',
};

