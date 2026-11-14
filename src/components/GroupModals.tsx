import React, { useEffect, useState } from 'react';
import { Check, Flag, ImagePlus, LogOut, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { apiFetch, uploadMediaFile } from '../services/api';
import type { PublicPeer, UserProfile } from '../types/rikzen';

interface CreateGroupModalProps {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [friends, setFriends] = useState<PublicPeer[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch('/api/friends')
      .then((d) => setFriends(d.friends || []))
      .catch(() => {});
  }, []);

  const toggleFriend = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      let avatarUrl: string | null = null;
      if (avatarFile) {
        const up = await uploadMediaFile(avatarFile, avatarFile.name);
        avatarUrl = up.fileUrl;
      }
      const res = await apiFetch<{ conversationId: string }>('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          avatarUrl,
          memberIds: selectedIds,
        }),
      });
      onCreated(res.conversationId);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-6 text-white shadow-2xl"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <h3 className="font-display text-lg font-semibold">Create New Group</h3>
          <button type="button" onClick={onClose} className="text-[#9898A6] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="mt-4 space-y-3 overflow-y-auto pr-1">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
          />
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Group description (optional)"
            className="w-full rounded-xl border border-white/10 bg-[#09090B] p-3 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
          />
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/20 p-3 text-xs text-[#9898A6] hover:border-[#D4AF37]">
            <ImagePlus size={16} className="text-[#D4AF37]" />
            <span>{avatarFile ? avatarFile.name : 'Upload group photo (optional)'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
          </label>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9898A6] mb-2">
              Add Friends ({selectedIds.length} selected)
            </p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {friends.length === 0 ? (
                <p className="text-xs text-[#9898A6]">Connect with friends first to add them to groups.</p>
              ) : (
                friends.map((f) => {
                  const selected = selectedIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFriend(f.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-sm ${
                        selected ? 'border-[#D4AF37] bg-[#D4AF37]/15' : 'border-white/10 bg-[#09090B]'
                      }`}
                    >
                      <span>{f.fullName}</span>
                      {selected && <Check size={16} className="text-[#D4AF37]" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="mt-5 min-h-[46px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B]"
        >
          {creating ? 'Creating...' : 'Create Group'}
        </button>
      </form>
    </div>
  );
};

interface GroupManageModalProps {
  groupId: string;
  me: UserProfile;
  onClose: () => void;
  onUpdated: () => void;
}

export const GroupManageModal: React.FC<GroupManageModalProps> = ({ groupId, me, onClose, onUpdated }) => {
  const [group, setGroup] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [friends, setFriends] = useState<PublicPeer[]>([]);
  const [onlyAdminsMsg, setOnlyAdminsMsg] = useState(false);

  const load = async () => {
    const [gRes, fRes] = await Promise.all([apiFetch(`/api/groups/${groupId}`), apiFetch('/api/friends')]);
    setGroup(gRes.group);
    setMembers(gRes.members || []);
    setOnlyAdminsMsg(Boolean(gRes.group?.only_admins_message));
    setFriends(fRes.friends || []);
  };

  useEffect(() => {
    load().catch(() => {});
  }, [groupId]);

  if (!group) return null;
  const myMember = members.find((m) => m.id === me.id);
  const isAdmin = myMember && ['owner', 'admin'].includes(myMember.role);

  const togglePermission = async () => {
    const next = !onlyAdminsMsg;
    await apiFetch(`/api/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ onlyAdminsMessage: next }),
    });
    setOnlyAdminsMsg(next);
    onUpdated();
  };

  const addMember = async (userId: string) => {
    await apiFetch(`/api/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    await load();
    onUpdated();
  };

  const toggleAdminRole = async (userId: string, currentRole: string) => {
    const nextRole = currentRole === 'admin' ? 'member' : 'admin';
    await apiFetch(`/api/groups/${groupId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: nextRole }),
    });
    await load();
  };

  const removeOrLeave = async (userId: string) => {
    await apiFetch(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
    if (userId === me.id) {
      onUpdated();
      onClose();
    } else {
      await load();
      onUpdated();
    }
  };

  const reportGroup = async () => {
    await apiFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ targetType: 'group', targetId: groupId, reason: 'Abusive group reported by member' }),
    });
    onClose();
  };

  const nonMembers = friends.filter((f) => !members.some((m) => m.id === f.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <h3 className="font-display text-lg font-bold">{group.name}</h3>
            <p className="text-xs text-[#9898A6]">{group.description || 'Group Settings & Members'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9898A6] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1">
          {isAdmin && (
            <div className="flex items-center justify-between rounded-xl border border-[#D4AF37]/25 bg-[#09090B] p-3.5">
              <div>
                <p className="text-sm font-medium">Only Admins Can Send Messages</p>
                <p className="text-xs text-[#9898A6]">Restrict posting to group administrators</p>
              </div>
              <button
                type="button"
                onClick={togglePermission}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${
                  onlyAdminsMsg ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-white/10 text-white'
                }`}
              >
                {onlyAdminsMsg ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9898A6] mb-2">
              Members ({members.length})
            </p>
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#09090B] p-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {m.full_name} {m.id === me.id ? '(You)' : ''}
                    </p>
                    <p className="text-[11px] text-[#D4AF37] capitalize">{m.role}</p>
                  </div>
                  {isAdmin && m.role !== 'owner' && m.id !== me.id && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleAdminRole(m.id, m.role)}
                        className="flex h-9 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs hover:bg-white/10"
                      >
                        <Shield size={13} />
                        <span>{m.role === 'admin' ? 'Demote' : 'Make Admin'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOrLeave(m.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/15"
                        title="Remove member"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isAdmin && nonMembers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#9898A6] mb-2">
                Add Friends to Group
              </p>
              <div className="space-y-1.5">
                {nonMembers.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-[#09090B] p-2.5"
                  >
                    <span className="text-sm">{f.fullName}</span>
                    <button
                      type="button"
                      onClick={() => addMember(f.id)}
                      className="flex h-8 items-center gap-1 rounded-lg bg-[#D4AF37] px-2.5 text-xs font-semibold text-[#09090B]"
                    >
                      <UserPlus size={13} />
                      <span>Add</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => removeOrLeave(me.id)}
              className="flex flex-1 min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-300"
            >
              <LogOut size={14} />
              <span>Leave Group</span>
            </button>
            <button
              type="button"
              onClick={reportGroup}
              className="flex flex-1 min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-[#9898A6] hover:text-white"
            >
              <Flag size={14} />
              <span>Report Group</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
