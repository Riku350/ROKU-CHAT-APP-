import React, { useEffect, useState } from 'react';
import { Ban, CheckCircle, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { apiFetch } from '../services/api';

interface AdminDashboardProps {
  onClose: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'users' | 'reports' | 'groups' | 'channels' | 'settings'>('users');
  const [search, setSearch] = useState('');
  const [settingKey, setSettingKey] = useState('maintenance_banner');
  const [settingValue, setSettingValue] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch('/api/admin/overview');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Administrator access denied.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleSuspend = async (userId: string, currentlySuspended: boolean) => {
    await apiFetch(`/api/admin/users/${userId}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended: !currentlySuspended }),
    });
    await load();
  };

  const resolveReport = async (reportId: string, status: string) => {
    await apiFetch(`/api/admin/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const deleteGroup = async (groupId: string) => {
    await apiFetch(`/api/admin/groups/${groupId}`, { method: 'DELETE' });
    await load();
  };

  const deleteChannel = async (channelId: string) => {
    await apiFetch(`/api/admin/channels/${channelId}`, { method: 'DELETE' });
    await load();
  };

  const saveAppSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ key: settingKey, value: settingValue }),
    });
    setSettingValue('');
    await load();
  };

  const filteredUsers = (data?.users || []).filter(
    (u: any) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.rikzen_id.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#D4AF37]/30 bg-[#111115] text-[#F5F5F7] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={20} className="text-[#D4AF37]" />
            <div>
              <h2 className="font-display text-lg font-bold">RIKZEN Administration Console</h2>
              <p className="text-xs text-[#9898A6]">Server-verified owner moderation & analytics</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-white/10"
            aria-label="Close Admin Console"
          >
            <X size={20} />
          </button>
        </div>

        {error ? (
          <div className="p-8 text-center text-sm text-red-400">{error}</div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-[#9898A6]">Loading admin telemetry...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Analytics Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Total Users', value: data.stats.totalUsers },
                { label: 'Active Online', value: data.stats.activeUsers },
                { label: 'Messages', value: data.stats.totalMessages },
                { label: 'Groups', value: data.stats.totalGroups },
                { label: 'Channels', value: data.stats.totalChannels },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/10 bg-[#09090B] p-4">
                  <p className="text-xs text-[#9898A6]">{stat.label}</p>
                  <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#F5E6B3]">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['users', 'reports', 'groups', 'channels', 'settings'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`min-h-[40px] rounded-xl px-4 text-xs font-semibold capitalize ${
                    tab === t ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-white/5 text-[#9898A6] hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'users' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898A6]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter users by name, RIKZEN ID, or email..."
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] pl-10 pr-4 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <div className="divide-y divide-white/8 rounded-2xl border border-white/10 bg-[#09090B]">
                  {filteredUsers.map((u: any) => (
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                      <div>
                        <p className="text-sm font-semibold">
                          {u.full_name} {u.is_suspended ? '(Suspended)' : ''}
                        </p>
                        <p className="text-xs text-[#9898A6]">
                          <span className="font-mono-id text-[#D4AF37]">{u.rikzen_id}</span> · {u.email}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSuspend(u.id, Boolean(u.is_suspended))}
                        className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                          u.is_suspended
                            ? 'bg-emerald-600/20 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        <Ban size={14} />
                        <span>{u.is_suspended ? 'Reinstate' : 'Suspend'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'reports' && (
              <div className="space-y-3">
                {(data.reports || []).length === 0 ? (
                  <p className="text-sm text-[#9898A6]">No abuse reports filed.</p>
                ) : (
                  data.reports.map((r: any) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#09090B] p-4">
                      <div>
                        <p className="text-sm font-semibold">
                          {r.target_type.toUpperCase()} · {r.status}
                        </p>
                        <p className="mt-1 text-xs text-[#F5F5F7]">{r.reason}</p>
                        <p className="mt-1 text-[11px] text-[#9898A6]">
                          Reported by {r.reporter_name} ({r.reporter_rikzen_id})
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => resolveReport(r.id, 'resolved')}
                          className="flex min-h-[36px] items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white"
                        >
                          <CheckCircle size={13} />
                          <span>Resolve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveReport(r.id, 'dismissed')}
                          className="min-h-[36px] rounded-lg border border-white/15 px-3 text-xs"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'groups' && (
              <div className="space-y-2">
                {(data.groups || []).map((g: any) => (
                  <div key={g.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#09090B] p-3.5">
                    <div>
                      <p className="text-sm font-semibold">{g.name}</p>
                      <p className="text-xs text-[#9898A6]">{g.description || 'No description'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteGroup(g.id)}
                      className="flex min-h-[36px] items-center gap-1 rounded-lg bg-red-500/15 px-3 text-xs text-red-400"
                    >
                      <Trash2 size={14} />
                      <span>Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'channels' && (
              <div className="space-y-2">
                {(data.channels || []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#09090B] p-3.5">
                    <div>
                      <p className="text-sm font-semibold">{c.name}</p>
                      <p className="text-xs text-[#9898A6]">{c.description || 'No description'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteChannel(c.id)}
                      className="flex min-h-[36px] items-center gap-1 rounded-lg bg-red-500/15 px-3 text-xs text-red-400"
                    >
                      <Trash2 size={14} />
                      <span>Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'settings' && (
              <div className="space-y-4">
                <form onSubmit={saveAppSetting} className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={settingKey}
                    onChange={(e) => setSettingKey(e.target.value)}
                    placeholder="Setting key"
                    className="h-11 flex-1 rounded-xl border border-white/10 bg-[#09090B] px-3 text-sm"
                  />
                  <input
                    type="text"
                    value={settingValue}
                    onChange={(e) => setSettingValue(e.target.value)}
                    placeholder="Setting value"
                    className="h-11 flex-1 rounded-xl border border-white/10 bg-[#09090B] px-3 text-sm"
                  />
                  <button type="submit" className="min-h-[44px] rounded-xl bg-[#D4AF37] px-5 text-xs font-semibold text-[#09090B]">
                    Save Setting
                  </button>
                </form>
                <div className="space-y-2">
                  {(data.settings || []).map((s: any) => (
                    <div key={s.key} className="flex justify-between rounded-xl border border-white/10 bg-[#09090B] p-3 text-xs">
                      <span className="font-mono-id text-[#D4AF37]">{s.key}</span>
                      <span>{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
