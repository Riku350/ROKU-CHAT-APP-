import React, { useEffect, useState } from 'react';
import {
  Accessibility,
  Bell,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Database,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  Palette,
  Send,
  Shield,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, clearRikzenLocalCache } from '../services/api';
import type { PublicPeer, UserProfile } from '../types/rikzen';
import { AvatarCropperModal } from './AvatarCropperModal';
import { SpiderEmblem } from './SpiderEmblem';

interface SettingsDrawerProps {
  me: UserProfile;
  onProfileUpdated: (profile: UserProfile) => void;
  onLogout: () => void;
  onClose: () => void;
}

type SectionKey =
  | 'menu'
  | 'edit_profile'
  | 'account'
  | 'privacy'
  | 'security'
  | 'chats'
  | 'appearance'
  | 'notifications'
  | 'storage'
  | 'devices'
  | 'contacts'
  | 'broadcasts'
  | 'accessibility'
  | 'language'
  | 'help'
  | 'about';

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  me,
  onProfileUpdated,
  onLogout,
  onClose,
}) => {
  const [section, setSection] = useState<SectionKey>('menu');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit profile
  const [fullName, setFullName] = useState(me.fullName);
  const [bio, setBio] = useState(me.bio);
  const [phone, setPhone] = useState(me.phone || '');
  const [cropperOpen, setCropperOpen] = useState(false);

  // Account updates
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState(me.email);
  const [newPhone, setNewPhone] = useState(me.phone || '');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Devices, Contacts, Broadcasts
  const [devices, setDevices] = useState<any[]>([]);
  const [friends, setFriends] = useState<PublicPeer[]>([]);
  const [broadcastSelected, setBroadcastSelected] = useState<string[]>([]);
  const [broadcastText, setBroadcastText] = useState('');
  const [helpText, setHelpText] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (section === 'devices' || section === 'security') {
      apiFetch('/api/devices')
        .then((d) => setDevices(d.devices || []))
        .catch(() => {});
    }
    if (section === 'contacts' || section === 'broadcasts') {
      apiFetch('/api/friends')
        .then((d) => setFriends(d.friends || []))
        .catch(() => {});
    }
  }, [section]);

  const notifySaved = (msg: string) => {
    setError(null);
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  };

  const saveProfileInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/api/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, bio, phone: phone.trim() || null }),
      });
      onProfileUpdated({ ...me, ...res.profile });
      notifySaved('Profile updated.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateAvatar = async (url: string | null) => {
    const res = await apiFetch<{ profile: UserProfile }>('/api/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({ avatarUrl: url }),
    });
    onProfileUpdated({ ...me, ...res.profile });
    notifySaved('Profile picture updated.');
  };

  const patchSettings = async (patch: Record<string, any>) => {
    try {
      const res = await apiFetch('/api/profiles/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onProfileUpdated({
        ...me,
        privacySettings: res.privacySettings,
        appearanceSettings: res.appearanceSettings,
        notificationSettings: res.notificationSettings,
        storageSettings: res.storageSettings,
        accessibilitySettings: res.accessibilitySettings,
      });
      notifySaved('Settings saved.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      notifySaved('Password changed successfully.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail }),
      });
      onProfileUpdated({ ...me, email: res.email });
      notifySaved('Email updated.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/auth/change-phone', {
        method: 'POST',
        body: JSON.stringify({ newPhone }),
      });
      onProfileUpdated({ ...me, phone: res.phone, phoneVerified: Boolean(res.phone) });
      notifySaved('Phone number updated.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') {
      setError('Type DELETE to confirm account deletion.');
      return;
    }
    await apiFetch('/api/auth/account', { method: 'DELETE' });
    onLogout();
  };

  const revokeDevice = async (deviceId: string) => {
    await apiFetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    notifySaved('Device session removed.');
  };

  const sendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (broadcastSelected.length === 0 || !broadcastText.trim()) return;
    try {
      const res = await apiFetch('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify({ recipientIds: broadcastSelected, content: broadcastText.trim() }),
      });
      setBroadcastText('');
      setBroadcastSelected([]);
      notifySaved(`Broadcast delivered to ${res.sentCount} contacts.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const requestPushPermission = async () => {
    if (typeof Notification === 'undefined') {
      setError('Browser notifications are not supported on this device.');
      return;
    }
    const perm = await Notification.requestPermission();
    notifySaved(`Notification permission: ${perm}`);
  };

  const copyId = async () => {
    await navigator.clipboard.writeText(me.rikzenId).catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const menuItems: Array<{ id: SectionKey; label: string; sub: string; icon: React.ReactNode }> = [
    { id: 'account', label: 'Account', sub: 'Password, email, phone, delete account', icon: <KeyRound size={18} /> },
    { id: 'privacy', label: 'Privacy', sub: 'Last seen, photo, discovery, read receipts', icon: <Lock size={18} /> },
    { id: 'security', label: 'Security', sub: 'Active sessions & account protection', icon: <Shield size={18} /> },
    { id: 'chats', label: 'Chats', sub: 'Chat behavior & real-time cloud sync', icon: <MessageSquare size={18} /> },
    { id: 'appearance', label: 'Appearance', sub: 'Theme, wallpaper, accent color, font size', icon: <Palette size={18} /> },
    { id: 'notifications', label: 'Notifications', sub: 'Message, call, group & status alerts', icon: <Bell size={18} /> },
    { id: 'storage', label: 'Storage and Data', sub: 'Auto-download rules & local cache', icon: <Database size={18} /> },
    { id: 'devices', label: 'Linked Devices', sub: 'Manage signed-in browsers & phones', icon: <Laptop size={18} /> },
    { id: 'contacts', label: 'Lists and Contacts', sub: 'Connected friends & permanent ID', icon: <Users size={18} /> },
    { id: 'broadcasts', label: 'Broadcasts', sub: 'Message multiple friends at once', icon: <Megaphone size={18} /> },
    { id: 'accessibility', label: 'Accessibility', sub: 'Reduced motion & contrast options', icon: <Accessibility size={18} /> },
    { id: 'language', label: 'App Language', sub: `Current: ${me.accessibilitySettings?.appLanguage || 'en'}`, icon: <Globe size={18} /> },
    { id: 'help', label: 'Help and Feedback', sub: 'Send feedback or report an issue', icon: <HelpCircle size={18} /> },
    { id: 'about', label: 'About RIKZEN CHAT', sub: 'Brand identity & platform info', icon: <Info size={18} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-lg flex-col bg-white dark:bg-[#111115] text-slate-900 dark:text-[#F5F5F7] border-l border-black/10 dark:border-[#D4AF37]/20 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            {section !== 'menu' && (
              <button
                type="button"
                onClick={() => {
                  setSection('menu');
                  setError(null);
                  setFeedback(null);
                }}
                className="mr-1 min-h-[38px] rounded-lg px-2.5 text-xs font-semibold text-[#B8891F] dark:text-[#D4AF37] hover:bg-black/5 dark:hover:bg-white/5"
              >
                Back
              </button>
            )}
            <h2 className="font-display text-lg font-bold capitalize">
              {section === 'menu' ? 'Profile & Settings' : section.replace('_', ' ')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
            aria-label="Close settings"
          >
            <X size={20} />
          </button>
        </div>

        {(feedback || error) && (
          <div
            className={`mx-5 mt-3 rounded-xl border px-4 py-2.5 text-xs ${
              error
                ? 'border-red-500/30 bg-red-500/10 text-red-400'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
            }`}
          >
            {error || feedback}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {section === 'menu' && (
            <div className="space-y-5">
              {/* Profile Card */}
              <div className="rounded-2xl border border-black/8 dark:border-[#D4AF37]/20 bg-slate-50 dark:bg-[#09090B] p-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setCropperOpen(true)}
                    className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-[#D4AF37]"
                  >
                    {me.avatarUrl ? (
                      <img src={me.avatarUrl} alt={me.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#18181D] font-display text-xl font-bold text-[#D4AF37]">
                        {me.fullName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                      <Camera size={16} className="text-white" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-bold">{me.fullName}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">{me.bio}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="font-mono-id text-xs font-semibold text-[#B8891F] dark:text-[#D4AF37]">
                        {me.rikzenId}
                      </span>
                      <button type="button" onClick={copyId} className="text-slate-400 hover:text-[#D4AF37]" title="Copy ID">
                        {copiedId ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('edit_profile')}
                    className="min-h-[38px] rounded-lg border border-black/10 dark:border-white/15 px-3 text-xs font-medium hover:border-[#D4AF37]"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* 15 Settings Sections */}
              <div className="divide-y divide-black/6 dark:divide-white/8 rounded-2xl border border-black/8 dark:border-white/10">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:bg-black/3 dark:hover:bg-white/5"
                  >
                    <div className="flex items-center gap-3.5">
                      <span className="text-[#B8891F] dark:text-[#D4AF37]">{item.icon}</span>
                      <div>
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className="text-xs text-slate-500 dark:text-[#9898A6]">{item.sub}</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-400" />
                  </button>
                ))}
              </div>

              {/* 15. Logout */}
              <button
                type="button"
                onClick={onLogout}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-sm font-semibold text-red-500 hover:bg-red-500/20"
              >
                <LogOut size={16} />
                <span>Logout of RIKZEN CHAT</span>
              </button>
            </div>
          )}

          {section === 'edit_profile' && (
            <form onSubmit={saveProfileInfo} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 dark:text-[#9898A6] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-[#9898A6] mb-1">Bio</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] p-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-[#9898A6] mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3.5 text-sm"
                />
              </div>
              <button
                type="submit"
                className="min-h-[46px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B]"
              >
                Save Profile
              </button>
            </form>
          )}

          {section === 'account' && (
            <div className="space-y-6">
              <form onSubmit={handleChangePassword} className="space-y-3 rounded-2xl border border-black/8 dark:border-white/10 p-4">
                <p className="text-sm font-semibold">Change Password</p>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3 text-sm"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 characters)"
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3 text-sm"
                />
                <button type="submit" className="min-h-[42px] w-full rounded-xl bg-[#D4AF37] text-xs font-semibold text-[#09090B]">
                  Update Password
                </button>
              </form>

              <form onSubmit={handleChangeEmail} className="space-y-3 rounded-2xl border border-black/8 dark:border-white/10 p-4">
                <p className="text-sm font-semibold">Email Address</p>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3 text-sm"
                />
                <button type="submit" className="min-h-[42px] w-full rounded-xl border border-[#D4AF37]/40 text-xs font-semibold text-[#D4AF37]">
                  Update Email
                </button>
              </form>

              <form onSubmit={handleChangePhone} className="space-y-3 rounded-2xl border border-black/8 dark:border-white/10 p-4">
                <p className="text-sm font-semibold">Phone Number</p>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+1 555 0192"
                  className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] px-3 text-sm"
                />
                <button type="submit" className="min-h-[42px] w-full rounded-xl border border-[#D4AF37]/40 text-xs font-semibold text-[#D4AF37]">
                  Save Phone Number
                </button>
              </form>

              <div className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                <p className="text-sm font-semibold text-red-500">Delete Account Permanently</p>
                <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                  Type DELETE below to permanently erase your profile, friendships, and messages.
                </p>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="Type DELETE"
                  className="h-10 w-full rounded-xl border border-red-500/30 bg-transparent px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  className="min-h-[42px] w-full rounded-xl bg-red-600 text-xs font-semibold text-white"
                >
                  Delete My Account
                </button>
              </div>
            </div>
          )}

          {section === 'privacy' && (
            <div className="space-y-4">
              {[
                { key: 'lastSeen', label: 'Last Seen Visibility', options: ['everyone', 'friends', 'nobody'] },
                { key: 'onlineStatus', label: 'Online Status Visibility', options: ['everyone', 'friends', 'nobody'] },
                { key: 'profilePhoto', label: 'Profile Photo Visibility', options: ['everyone', 'friends', 'nobody'] },
                { key: 'bioVisibility', label: 'Bio Visibility', options: ['everyone', 'friends', 'nobody'] },
                { key: 'emailVisibility', label: 'Email Visibility', options: ['nobody', 'friends', 'everyone'] },
                { key: 'friendRequests', label: 'Who Can Send Friend Requests', options: ['everyone', 'nobody'] },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                  <span className="text-sm font-medium">{item.label}</span>
                  <select
                    value={(me.privacySettings as any)[item.key]}
                    onChange={(e) =>
                      patchSettings({
                        privacySettings: { [item.key]: e.target.value },
                      })
                    }
                    className="h-9 rounded-lg border border-black/10 dark:border-white/15 bg-slate-50 dark:bg-[#09090B] px-2.5 text-xs capitalize"
                  >
                    {item.options.map((o) => (
                      <option key={o} value={o}>
                        {o === 'friends' ? 'My contacts (Friends)' : o}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {[
                { key: 'readReceipts', label: 'Read Receipts (Blue Double Ticks)' },
                { key: 'discoverableByPhone', label: 'Find Me by Phone Number' },
                { key: 'discoverableByName', label: 'Find Me by Display Name' },
              ].map((toggle) => {
                const val = Boolean((me.privacySettings as any)[toggle.key]);
                return (
                  <div key={toggle.key} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                    <span className="text-sm font-medium">{toggle.label}</span>
                    <button
                      type="button"
                      onClick={() => patchSettings({ privacySettings: { [toggle.key]: !val } })}
                      className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold ${
                        val ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-black/10 dark:bg-white/10'
                      }`}
                    >
                      {val ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {section === 'security' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-black/8 dark:border-white/10 p-4 space-y-2">
                <p className="text-sm font-semibold">Session & Identity Protection</p>
                <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                  Your session uses HMAC-SHA256 signed HTTP-only cookies paired with tracked device IDs.
                  Active devices: {devices.length}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="min-h-[44px] w-full rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-400"
              >
                Secure Logout (Current Device)
              </button>
            </div>
          )}

          {section === 'chats' && (
            <div className="space-y-4 text-sm">
              <div className="rounded-2xl border border-black/8 dark:border-white/10 p-4 space-y-2">
                <p className="font-semibold">Real-Time Sync Active</p>
                <p className="text-xs text-slate-500 dark:text-[#9898A6] leading-relaxed">
                  Messages sync instantaneously over WebSockets with automatic local queuing if your connection drops, paired with Firebase cloud profile sync.
                </p>
              </div>
            </div>
          )}

          {section === 'appearance' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Theme Mode</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['dark', 'light', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patchSettings({ appearanceSettings: { theme: t } })}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold capitalize ${
                        me.appearanceSettings.theme === t
                          ? 'bg-[#D4AF37] text-[#09090B]'
                          : 'bg-black/5 dark:bg-white/5'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Chat Wallpaper</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'obsidian-web', label: 'Obsidian Web' },
                    { id: 'midnight', label: 'Pure Midnight' },
                    { id: 'emerald-silk', label: 'Emerald Silk' },
                    { id: 'champagne-mist', label: 'Champagne Mist' },
                  ].map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => patchSettings({ appearanceSettings: { wallpaper: w.id } })}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold ${
                        me.appearanceSettings.wallpaper === w.id
                          ? 'bg-[#D4AF37] text-[#09090B]'
                          : 'bg-black/5 dark:bg-white/5'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Accent Color</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['gold', 'emerald', 'ivory'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => patchSettings({ appearanceSettings: { accentColor: a } })}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold capitalize ${
                        me.appearanceSettings.accentColor === a
                          ? 'bg-[#D4AF37] text-[#09090B]'
                          : 'bg-black/5 dark:bg-white/5'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Font Size</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['small', 'medium', 'large'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => patchSettings({ appearanceSettings: { fontSize: f } })}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold capitalize ${
                        me.appearanceSettings.fontSize === f
                          ? 'bg-[#D4AF37] text-[#09090B]'
                          : 'bg-black/5 dark:bg-white/5'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'notifications' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={requestPushPermission}
                className="min-h-[44px] w-full rounded-xl bg-[#D4AF37] text-xs font-semibold text-[#09090B]"
              >
                Enable Browser Background Notifications
              </button>
              {[
                { key: 'messages', label: 'New Messages' },
                { key: 'friendRequests', label: 'Friend Requests' },
                { key: 'groups', label: 'Group Messages' },
                { key: 'calls', label: 'Incoming Calls' },
                { key: 'statuses', label: 'Status Updates' },
                { key: 'sound', label: 'Notification Sound' },
                { key: 'vibration', label: 'Vibration' },
              ].map((n) => {
                const val = Boolean((me.notificationSettings as any)[n.key]);
                return (
                  <div key={n.key} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                    <span className="text-sm font-medium">{n.label}</span>
                    <button
                      type="button"
                      onClick={() => patchSettings({ notificationSettings: { [n.key]: !val } })}
                      className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold ${
                        val ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-black/10 dark:bg-white/10'
                      }`}
                    >
                      {val ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {section === 'storage' && (
            <div className="space-y-4">
              {[
                { key: 'autoDownloadImages', label: 'Auto-Download Photos' },
                { key: 'autoDownloadVideo', label: 'Auto-Download Videos' },
                { key: 'autoDownloadDocs', label: 'Auto-Download Documents' },
              ].map((s) => {
                const val = Boolean((me.storageSettings as any)?.[s.key]);
                return (
                  <div key={s.key} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                    <span className="text-sm font-medium">{s.label}</span>
                    <button
                      type="button"
                      onClick={() => patchSettings({ storageSettings: { [s.key]: !val } })}
                      className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold ${
                        val ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-black/10 dark:bg-white/10'
                      }`}
                    >
                      {val ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  clearRikzenLocalCache();
                  notifySaved('Local message queue cache cleared.');
                }}
                className="min-h-[44px] w-full rounded-xl border border-black/10 dark:border-white/15 text-xs font-semibold"
              >
                Clear Local Cache
              </button>
            </div>
          )}

          {section === 'devices' && (
            <div className="space-y-3">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                  <div>
                    <p className="text-sm font-semibold">
                      {d.device_name} {d.isCurrent ? '(This Device)' : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                      {d.platform} · Active {new Date(d.last_active_at).toLocaleString()}
                    </p>
                  </div>
                  {!d.isCurrent && (
                    <button
                      type="button"
                      onClick={() => revokeDevice(d.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/15"
                      title="Remove device"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {section === 'contacts' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                Connected friends ({friends.length})
              </p>
              {friends.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3">
                  <div>
                    <p className="text-sm font-semibold">{f.fullName}</p>
                    <p className="font-mono-id text-xs text-[#D4AF37]">{f.rikzenId}</p>
                  </div>
                  <User size={16} className="text-slate-400" />
                </div>
              ))}
            </div>
          )}

          {section === 'broadcasts' && (
            <form onSubmit={sendBroadcast} className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                Select friends to deliver a private broadcast message directly to each selected chat.
              </p>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {friends.map((f) => {
                  const sel = broadcastSelected.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() =>
                        setBroadcastSelected((prev) =>
                          prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id]
                        )
                      }
                      className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-sm ${
                        sel ? 'border-[#D4AF37] bg-[#D4AF37]/15' : 'border-black/10 dark:border-white/10'
                      }`}
                    >
                      <span>{f.fullName}</span>
                      {sel && <Check size={15} className="text-[#D4AF37]" />}
                    </button>
                  );
                })}
              </div>
              <textarea
                rows={3}
                required
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="Write your broadcast message..."
                className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] p-3 text-sm"
              />
              <button
                type="submit"
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B]"
              >
                <Send size={15} />
                <span>Send Broadcast ({broadcastSelected.length})</span>
              </button>
            </form>
          )}

          {section === 'accessibility' && (
            <div className="space-y-3">
              {[
                { key: 'reducedMotion', label: 'Reduce Interface Animations' },
                { key: 'highContrast', label: 'High Contrast Borders' },
              ].map((a) => {
                const val = Boolean((me.accessibilitySettings as any)?.[a.key]);
                return (
                  <div key={a.key} className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 p-3.5">
                    <span className="text-sm font-medium">{a.label}</span>
                    <button
                      type="button"
                      onClick={() => patchSettings({ accessibilitySettings: { [a.key]: !val } })}
                      className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold ${
                        val ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-black/10 dark:bg-white/10'
                      }`}
                    >
                      {val ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {section === 'language' && (
            <div className="space-y-2">
              {[
                { code: 'en', name: 'English' },
                { code: 'es', name: 'Español' },
                { code: 'fr', name: 'Français' },
                { code: 'hi', name: 'हिन्दी' },
                { code: 'ar', name: 'العربية' },
                { code: 'de', name: 'Deutsch' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => patchSettings({ accessibilitySettings: { appLanguage: lang.code } })}
                  className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-sm font-medium ${
                    (me.accessibilitySettings?.appLanguage || 'en') === lang.code
                      ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                      : 'border-black/8 dark:border-white/10'
                  }`}
                >
                  <span>{lang.name}</span>
                  {(me.accessibilitySettings?.appLanguage || 'en') === lang.code && (
                    <Check size={16} className="text-[#D4AF37]" />
                  )}
                </button>
              ))}
            </div>
          )}

          {section === 'help' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!helpText.trim()) return;
                await apiFetch('/api/reports', {
                  method: 'POST',
                  body: JSON.stringify({ targetType: 'user', targetId: me.id, reason: `Feedback: ${helpText.trim()}` }),
                });
                setHelpText('');
                notifySaved('Feedback submitted to the RIKZEN team.');
              }}
              className="space-y-4"
            >
              <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                Submit product feedback or report an issue directly to administrators.
              </p>
              <textarea
                rows={4}
                required
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Describe your question or feedback..."
                className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] p-3 text-sm"
              />
              <button type="submit" className="min-h-[44px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B]">
                Submit Feedback
              </button>
            </form>
          )}

          {section === 'about' && (
            <div className="flex flex-col items-center py-6 text-center">
              <SpiderEmblem size={64} />
              <h3 className="mt-4 font-display text-xl font-bold tracking-[0.16em] text-[#D4AF37]">
                RIKZEN CHAT
              </h3>
              <p className="mt-1 text-xs tracking-[0.22em] text-slate-500 dark:text-[#9898A6]">
                CONNECT • CHAT • SHARE
              </p>
              <p className="mt-4 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-[#9898A6]">
                Original full-stack messaging platform featuring permanent RIKZEN IDs, real-time messaging, media sharing, groups, 24h statuses, communities, channels, and WebRTC calling.
              </p>
            </div>
          )}
        </div>
      </div>

      {cropperOpen && (
        <AvatarCropperModal
          currentAvatarUrl={me.avatarUrl}
          onSave={updateAvatar}
          onClose={() => setCropperOpen(false)}
        />
      )}
    </div>
  );
};
