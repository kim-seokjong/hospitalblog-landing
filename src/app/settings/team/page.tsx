'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

type MemberRole = 'admin' | 'member';
type MemberStatus = 'pending' | 'active';

interface TeamMember {
  id: string;
  owner_id: string;
  member_email: string;
  role: MemberRole;
  status: MemberStatus;
  joined_at: string | null;
  created_at: string;
}

interface TeamData {
  members: TeamMember[];
  plan: string;
  limit: number;
}

type AlertType = 'success' | 'error';

interface AlertMsg {
  type: AlertType;
  text: string;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  admin: '관리자',
  member: '멤버',
};

const PLAN_LIMIT_INFO = [
  { plan: '베이직', limit: '최대 2명' },
  { plan: '스탠다드', limit: '최대 5명' },
  { plan: '프로', limit: '무제한' },
];

const PAID_PLANS = ['basic', 'standard', 'pro'];

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function TeamSettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<TeamMember[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const [planLimit, setPlanLimit] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<AlertMsg | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [inviting, setInviting] = useState(false);

  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

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

  const showAlert = useCallback((type: AlertType, text: string) => {
    setAlert({ type, text });
    setTimeout(() => setAlert(null), 4000);
  }, []);

  const fetchTeamData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/team');
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? '팀 데이터 조회 실패');
      }
      const json = await res.json() as TeamData;
      setMembers(json.members ?? []);
      setCurrentPlan(json.plan ?? 'free');
      setPlanLimit(json.limit ?? 0);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPendingInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/team/invites');
      if (!res.ok) return;
      const json = await res.json() as { invites: TeamMember[] };
      setPendingInvites(json.invites ?? []);
    } catch {
      setPendingInvites([]);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void fetchTeamData();
      void fetchPendingInvites();
    }
  }, [user, fetchTeamData, fetchPendingInvites]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json() as { error?: string; member?: TeamMember };
      if (!res.ok) throw new Error(json.error ?? '초대 실패');
      setInviteEmail('');
      setInviteRole('member');
      showAlert('success', '초대가 발송되었습니다. 상대방이 로그인 후 수락하면 팀에 합류합니다.');
      await fetchTeamData();
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : '초대 실패');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: MemberRole) => {
    setUpdatingRoleId(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '역할 변경 실패');
      setMembers(prev =>
        prev.map(m => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      showAlert('success', '역할이 변경되었습니다');
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : '역할 변경 실패');
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleDelete = async (memberId: string) => {
    setDeletingId(memberId);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/team/${memberId}`, { method: 'DELETE' });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '멤버 제거 실패');
      setMembers(prev => prev.filter(m => m.id !== memberId));
      showAlert('success', '멤버가 제거되었습니다');
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : '멤버 제거 실패');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    setAcceptingId(inviteId);
    try {
      const res = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '초대 수락 실패');
      setPendingInvites(prev => prev.filter(inv => inv.id !== inviteId));
      showAlert('success', '초대를 수락했습니다');
    } catch (e) {
      showAlert('error', e instanceof Error ? e.message : '초대 수락 실패');
    } finally {
      setAcceptingId(null);
    }
  };

  if (!authChecked || loading) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center">
        <div className="text-[#8a93a0] text-sm">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-[#202020] font-semibold text-base mb-2">로그인이 필요합니다</div>
          <div className="text-[#8a93a0] text-sm mb-6">팀 설정은 로그인 후 이용할 수 있습니다.</div>
          <a
            href="/"
            className="px-6 py-2.5 bg-[#ff4628] text-white rounded-lg text-sm font-semibold hover:bg-[#e63a1c] transition-colors"
          >
            앱으로 이동해서 로그인
          </a>
        </div>
      </div>
    );
  }

  const isPaidPlan = PAID_PLANS.includes(currentPlan);

  return (
    <div className="min-h-screen bg-[#eef2f6] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#202020]">팀 관리</h1>
            <p className="text-[#8a93a0] text-sm mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/settings/profile"
              className="text-sm text-[#8a93a0] hover:text-[#202020] transition-colors"
            >
              프로필
            </a>
            <a href="/" className="text-sm text-[#8a93a0] hover:text-[#202020] transition-colors">
              ← 앱으로
            </a>
          </div>
        </div>

        {/* 알림 메시지 */}
        {alert && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
              alert.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-600'
            }`}
          >
            {alert.text}
          </div>
        )}

        <div className="space-y-4">
          {/* 섹션 1 - 내가 초대한 멤버 목록 */}
          <Section title={`초대한 멤버 (${members.length}명)`}>
            {members.length === 0 ? (
              <p className="text-sm text-[#8a93a0] py-2">아직 초대한 멤버가 없습니다.</p>
            ) : (
              <div className="space-y-1">
                {members.map(member => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    onRoleChange={handleRoleChange}
                    onDeleteRequest={id => setConfirmDeleteId(id)}
                    onDeleteConfirm={handleDelete}
                    confirmDeleteId={confirmDeleteId}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    updatingRoleId={updatingRoleId}
                    deletingId={deletingId}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* 섹션 2 - 멤버 초대 */}
          <Section title="멤버 초대">
            {/* 플랜별 최대 멤버 수 안내 */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {PLAN_LIMIT_INFO.map(({ plan, limit }) => (
                <div
                  key={plan}
                  className="bg-[#eef2f6] border border-[#dbe2ea] rounded-lg px-3 py-2 text-center"
                >
                  <div className="text-xs font-semibold text-[#4a4f55] mb-0.5">{plan}</div>
                  <div className="text-xs text-[#8a93a0]">{limit}</div>
                </div>
              ))}
            </div>

            {!isPaidPlan ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                <p className="text-sm text-yellow-700 font-medium mb-1">
                  팀 기능은 베이직 이상 플랜에서 사용 가능합니다
                </p>
                <a
                  href="/pricing"
                  className="text-xs text-yellow-700 underline hover:text-yellow-600 transition-colors"
                >
                  플랜 업그레이드하기 →
                </a>
              </div>
            ) : (
              <>
                <p className="text-xs text-[#ff4628] mb-3 bg-[#ffece7] border border-[#ff4628]/30 rounded-lg px-3 py-2">
                  초대 후 상대방이 닥터포스트에 로그인하여 초대를 수락하면 팀에 합류합니다.
                  {planLimit !== Infinity && planLimit > 0 && (
                    <span className="block mt-0.5 text-[#e63a1c]">
                      현재 플랜: {members.length}/{planLimit}명 사용 중
                    </span>
                  )}
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void handleInvite();
                    }}
                    placeholder="초대할 이메일 주소"
                    className="flex-1 bg-white border border-[#dbe2ea] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#b8c8d7] focus:outline-none focus:border-[#ff4628] transition-colors"
                  />
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as MemberRole)}
                    className="sm:w-28 bg-white border border-[#dbe2ea] rounded-lg px-3 py-2.5 text-[#202020] text-sm focus:outline-none focus:border-[#ff4628] transition-colors appearance-none"
                  >
                    <option value="member" className="bg-white">멤버</option>
                    <option value="admin" className="bg-white">관리자</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleInvite()}
                    disabled={inviting || !inviteEmail.trim()}
                    className="sm:w-28 px-4 py-2.5 bg-[#ff4628] text-white rounded-lg text-sm font-semibold hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {inviting ? '초대 중...' : '초대하기'}
                  </button>
                </div>
              </>
            )}
          </Section>

          {/* 섹션 3 - 내게 온 초대 */}
          <Section title="받은 초대">
            {pendingInvites.length === 0 ? (
              <p className="text-sm text-[#8a93a0] py-2">받은 초대가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {pendingInvites.map(invite => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-[#dbe2ea] last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[#202020] font-medium truncate">
                        초대 받은 역할: {ROLE_LABELS[invite.role]}
                      </div>
                      <div className="text-xs text-[#8a93a0] mt-0.5">
                        초대일: {formatDate(invite.created_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAcceptInvite(invite.id)}
                      disabled={acceptingId === invite.id}
                      className="flex-shrink-0 px-3 py-1.5 bg-[#ff4628] text-white rounded-lg text-xs font-semibold hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {acceptingId === invite.id ? '수락 중...' : '수락'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

interface MemberRowProps {
  member: TeamMember;
  onRoleChange: (id: string, role: MemberRole) => Promise<void>;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => Promise<void>;
  confirmDeleteId: string | null;
  onCancelDelete: () => void;
  updatingRoleId: string | null;
  deletingId: string | null;
}

function MemberRow({
  member,
  onRoleChange,
  onDeleteRequest,
  onDeleteConfirm,
  confirmDeleteId,
  onCancelDelete,
  updatingRoleId,
  deletingId,
}: MemberRowProps) {
  const isConfirming = confirmDeleteId === member.id;
  const isDeleting = deletingId === member.id;
  const isUpdatingRole = updatingRoleId === member.id;

  return (
    <div className="py-3 border-b border-[#dbe2ea] last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-[#202020] font-medium break-all">{member.member_email}</span>
            <RoleBadge role={member.role} />
            <StatusBadge status={member.status} />
          </div>
          <div className="text-xs text-[#8a93a0] mt-1">
            {member.status === 'active'
              ? `가입일: ${formatDate(member.joined_at)}`
              : `초대일: ${formatDate(member.created_at)}`}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {member.status === 'active' && (
            <select
              value={member.role}
              disabled={isUpdatingRole}
              onChange={e => void onRoleChange(member.id, e.target.value as MemberRole)}
              className="bg-white border border-[#dbe2ea] rounded-lg px-2 py-1 text-xs text-[#4a4f55] focus:outline-none focus:border-[#ff4628] transition-colors appearance-none disabled:opacity-50"
            >
              <option value="member" className="bg-white">멤버</option>
              <option value="admin" className="bg-white">관리자</option>
            </select>
          )}

          {isConfirming ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-[#8a93a0] hidden sm:inline">정말 제거?</span>
              <button
                type="button"
                onClick={() => void onDeleteConfirm(member.id)}
                disabled={isDeleting}
                className="px-2 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-500 disabled:opacity-50 transition-colors"
              >
                {isDeleting ? '...' : '확인'}
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                className="px-2 py-1 bg-[#eef2f6] text-[#4a4f55] rounded text-xs hover:bg-[#dbe2ea] transition-colors"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onDeleteRequest(member.id)}
              disabled={isDeleting}
              className="px-2.5 py-1 bg-white border border-[#dbe2ea] text-[#8a93a0] rounded-lg text-xs hover:border-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              제거
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const styles: Record<MemberRole, string> = {
    admin: 'bg-purple-50 border border-purple-200 text-purple-700',
    member: 'bg-[#eef2f6] border border-[#dbe2ea] text-[#8a93a0]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function StatusBadge({ status }: { status: MemberStatus }) {
  const styles: Record<MemberStatus, string> = {
    active: 'bg-green-50 border border-green-200 text-green-700',
    pending: 'bg-yellow-50 border border-yellow-200 text-yellow-700',
  };
  const labels: Record<MemberStatus, string> = {
    active: '활성',
    pending: '대기중',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#dbe2ea] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h2 className="text-sm font-semibold text-[#4a4f55] mb-4 pb-3 border-b border-[#dbe2ea]">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
