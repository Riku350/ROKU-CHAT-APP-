import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, ImagePlus, Plus, Send, Trash2, VolumeX, X } from 'lucide-react';
import { apiFetch, uploadMediaFile } from '../services/api';
import type { StatusItem, UserProfile } from '../types/rikzen';

interface UpdatesViewProps {
  me: UserProfile;
  onReplyInChat: (peerId: string, text: string) => Promise<void>;
}

const STATUS_COLORS = ['#141418', '#1F1A0E', '#0D2619', '#23121E', '#111B2B'];
const QUICK_PRESETS = ['Available ✅', 'Busy right now 🔕', 'At Work 💼', "Let's Chat ✨"];

function formatStatusErr(err: any): string {
  const raw = err?.message || 'Something went wrong. Please try again.';
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.error || raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

export const UpdatesView: React.FC<UpdatesViewProps> = ({ me, onReplyInChat }) => {
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'text' | 'image' | 'video'>('text');
  const [textContent, setTextContent] = useState('');
  const [caption, setCaption] = useState('');
  const [bgColor, setBgColor] = useState(STATUS_COLORS[0]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [showViewersList, setShowViewersList] = useState(false);

  const clearPreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setSelectedFile(null);
  };

  const openComposer = () => {
    setComposerErr(null);
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setComposerErr(null);
    clearPreview();
    setMediaType('text');
  };

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/statuses');
      setStatuses(data.statuses || []);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(formatStatusErr(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 3000);
  };

  const myStatuses = statuses.filter((s) => s.userId === me.id);
  const friendStatuses = statuses.filter((s) => s.userId !== me.id && !s.isMuted);
  const mutedStatuses = statuses.filter((s) => s.userId !== me.id && s.isMuted);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setComposerErr(null);
    setSelectedFile(file);
    setMediaType(file.type.startsWith('video') ? 'video' : 'image');
    setPreviewUrl(URL.createObjectURL(file));
    e.target.value = '';
  };

  const publishStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposerErr(null);

    if (mediaType === 'text' && !textContent.trim()) {
      setComposerErr('Please write a message or tap one of the quick status options.');
      return;
    }
    if (mediaType !== 'text' && !selectedFile) {
      setComposerErr('Please choose a photo or video first.');
      return;
    }

    setSubmitting(true);
    try {
      let mediaUrl: string | null = null;
      if (selectedFile) {
        const up = await uploadMediaFile(selectedFile, selectedFile.name);
        mediaUrl = up.fileUrl;
      }
      await apiFetch('/api/statuses', {
        method: 'POST',
        body: JSON.stringify({
          mediaType,
          content: textContent.trim(),
          mediaUrl,
          caption: caption.trim(),
          backgroundColor: bgColor,
        }),
      });
      setTextContent('');
      setCaption('');
      closeComposer();
      await loadStatuses();
      showToast('Status shared for 24 hours!');
    } catch (err: any) {
      setComposerErr(formatStatusErr(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openViewer = async (status: StatusItem) => {
    const idx = statuses.findIndex((s) => s.id === status.id);
    if (idx === -1) return;
    setViewerIndex(idx);
    setShowViewersList(false);
    if (status.userId !== me.id) {
      await apiFetch(`/api/statuses/${status.id}/view`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => {});
      loadStatuses();
    }
  };

  const activeStatus = viewerIndex !== null ? statuses[viewerIndex] : null;

  const reactToStatus = async (emoji: string) => {
    if (!activeStatus) return;
    try {
      await apiFetch(`/api/statuses/${activeStatus.id}/view`, {
        method: 'POST',
        body: JSON.stringify({ reaction: emoji }),
      });
      showToast(`Reacted ${emoji}`);
      loadStatuses();
    } catch (err: any) {
      setErrorMsg(formatStatusErr(err));
    }
  };

  const sendStatusReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStatus || !replyText.trim()) return;
    try {
      await onReplyInChat(
        activeStatus.userId,
        `Replied to your status: "${replyText.trim()}"`
      );
      setReplyText('');
      setViewerIndex(null);
    } catch (err: any) {
      setErrorMsg(formatStatusErr(err));
    }
  };

  const muteStatus = async (id: string) => {
    try {
      await apiFetch(`/api/statuses/${id}/mute`, { method: 'POST' });
      setViewerIndex(null);
      await loadStatuses();
    } catch (err: any) {
      setErrorMsg(formatStatusErr(err));
    }
  };

  const deleteStatus = async (id: string) => {
    try {
      await apiFetch(`/api/statuses/${id}`, { method: 'DELETE' });
      setViewerIndex(null);
      await loadStatuses();
      showToast('Status deleted.');
    } catch (err: any) {
      setErrorMsg(formatStatusErr(err));
    }
  };

  const hoursLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60)));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-[#0B0B0E] p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Updates</h2>
            <p className="text-xs text-slate-500 dark:text-[#9898A6] mt-0.5">
              Share quick text, photo, or video updates for 24 hours
            </p>
          </div>
          <button
            type="button"
            onClick={openComposer}
            className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B]"
          >
            <Plus size={16} />
            <span>Add Status</span>
          </button>
        </div>

        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-[#22C55E]/35 bg-[#22C55E]/10 px-4 py-2.5 text-xs font-medium text-[#22C55E]">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        {/* My Status */}
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-slate-50 dark:bg-[#141418] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => (myStatuses[0] ? openViewer(myStatuses[0]) : openComposer())}
                className={`relative h-14 w-14 shrink-0 rounded-full p-[2px] ${
                  myStatuses.length > 0
                    ? 'border-2 border-[#22C55E]'
                    : 'border border-dashed border-[#D4AF37]'
                }`}
                aria-label={myStatuses[0] ? 'View my status' : 'Add status'}
              >
                <div className="h-full w-full overflow-hidden rounded-full bg-[#09090B]">
                  {me.avatarUrl ? (
                    <img
                      src={me.avatarUrl}
                      alt={me.fullName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                      {me.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    openComposer();
                  }}
                  className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white dark:border-[#141418] bg-[#22C55E] text-[#09090B]"
                  title="Add new status"
                >
                  <Plus size={12} strokeWidth={3} />
                </span>
              </button>
              <div>
                <p className="font-semibold text-sm">My Status</p>
                <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                  {myStatuses.length > 0
                    ? `${myStatuses.length} active · ${hoursLeft(myStatuses[0].expiresAt)}h remaining`
                    : 'Tap + to share a quick update'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {myStatuses.length > 0 && (
                <button
                  type="button"
                  onClick={() => openViewer(myStatuses[0])}
                  className="min-h-[40px] rounded-xl border border-black/10 dark:border-white/15 px-3 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                >
                  View ({myStatuses[0].viewCount})
                </button>
              )}
              <button
                type="button"
                onClick={openComposer}
                className="min-h-[40px] rounded-xl bg-[#D4AF37]/15 px-3 text-xs font-semibold text-[#B8891F] dark:text-[#F5E6B3] hover:bg-[#D4AF37]/25"
              >
                + New
              </button>
            </div>
          </div>

          {myStatuses.length > 0 && (
            <div className="mt-3 grid gap-2 border-t border-black/8 dark:border-white/10 pt-3 sm:grid-cols-2">
              {myStatuses.map((st) => (
                <div
                  key={st.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-black/8 dark:border-white/10 bg-white dark:bg-[#0B0B0E] px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => openViewer(st)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-xs font-semibold">
                      {st.mediaType === 'text' ? st.content : st.caption || `${st.mediaType} update`}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-[#9898A6]">
                      {hoursLeft(st.expiresAt)}h left · {st.viewCount} views
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteStatus(st.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/15"
                    aria-label="Delete status"
                    title="Delete status"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Friends' Statuses */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#9898A6] mb-3">
            Recent Updates
          </h3>
          {loading ? (
            <p className="text-sm text-slate-500">Loading updates...</p>
          ) : friendStatuses.length === 0 ? (
            <div className="rounded-2xl border border-black/8 dark:border-white/10 p-6 text-center text-sm text-slate-500 dark:text-[#9898A6]">
              No recent updates from friends yet. Add your own status above!
            </div>
          ) : (
            <div className="divide-y divide-black/6 dark:divide-white/8 rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-[#141418]">
              {friendStatuses.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => openViewer(st)}
                  className="flex w-full items-center justify-between p-3.5 text-left transition hover:bg-black/3 dark:hover:bg-white/5"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`h-13 w-13 shrink-0 rounded-full p-[2px] border-2 ${
                        st.viewedByMe ? 'border-slate-500/40' : 'border-[#22C55E]'
                      }`}
                    >
                      <div className="h-full w-full overflow-hidden rounded-full bg-[#09090B]">
                        {st.authorAvatar ? (
                          <img
                            src={st.authorAvatar}
                            alt={st.authorName}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                            {st.authorName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-sm">{st.authorName}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">
                        {st.mediaType === 'text'
                          ? st.content.slice(0, 48)
                          : st.caption || `${st.mediaType} update`}{' '}
                        · {hoursLeft(st.expiresAt)}h left
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {mutedStatuses.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#9898A6] mb-2">
              Muted Updates ({mutedStatuses.length})
            </h3>
            <div className="space-y-2 opacity-65">
              {mutedStatuses.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => openViewer(st)}
                  className="flex w-full items-center justify-between rounded-xl border border-black/10 dark:border-white/10 p-3 text-left text-xs"
                >
                  <span>{st.authorName}</span>
                  <span>View</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Status Modal */}
      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={publishStatus}
            className="w-full max-w-md rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 sm:p-6 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-display text-lg font-semibold">Add Status Update</h3>
              <button
                type="button"
                onClick={closeComposer}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#9898A6] hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {composerErr && (
              <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2.5 text-xs text-red-200">
                {composerErr}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMediaType('text');
                  clearPreview();
                  setComposerErr(null);
                }}
                className={`flex-1 min-h-[42px] rounded-xl text-xs font-semibold ${
                  mediaType === 'text' ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-white/5 text-[#9898A6]'
                }`}
              >
                Text Status
              </button>
              <label
                className={`flex flex-1 min-h-[42px] cursor-pointer items-center justify-center gap-1.5 rounded-xl text-xs font-semibold ${
                  mediaType !== 'text'
                    ? 'bg-[#D4AF37] text-[#09090B]'
                    : 'bg-white/5 text-[#F5E6B3] hover:bg-white/10'
                }`}
              >
                <ImagePlus size={15} />
                <span>Photo / Video</span>
                <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFilePick} />
              </label>
            </div>

            {mediaType === 'text' ? (
              <div className="mt-4 space-y-3">
                <div
                  className="flex min-h-[160px] items-center justify-center rounded-2xl p-5"
                  style={{ backgroundColor: bgColor }}
                >
                  <textarea
                    rows={3}
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Type your status here..."
                    className="w-full resize-none bg-transparent text-center font-display text-xl font-semibold text-white placeholder-white/45 focus:outline-none"
                  />
                </div>

                {/* Easy 1-tap presets */}
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTextContent(preset)}
                      className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-[#F5E6B3] hover:border-[#D4AF37]/50 hover:bg-white/10"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-2.5 pt-1">
                  {STATUS_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBgColor(c)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        bgColor === c ? 'border-[#D4AF37] scale-110' : 'border-white/20'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {previewUrl && (
                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black max-h-60 flex justify-center">
                    {mediaType === 'video' ? (
                      <video src={previewUrl} controls className="max-h-60" />
                    ) : (
                      <img src={previewUrl} alt="Status preview" className="max-h-60 object-contain" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        clearPreview();
                        setMediaType('text');
                      }}
                      className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/75 text-white hover:bg-black"
                      aria-label="Remove media"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption (optional)..."
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 min-h-[46px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B] disabled:opacity-50"
            >
              {submitting ? 'Sharing...' : 'Share Status (24h)'}
            </button>
          </form>
        </div>
      )}

      {/* Fullscreen Status Viewer */}
      {activeStatus && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#060608] text-white">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden rounded-full border border-[#D4AF37]">
                {activeStatus.authorAvatar ? (
                  <img
                    src={activeStatus.authorAvatar}
                    alt={activeStatus.authorName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                    {activeStatus.authorName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-sm">{activeStatus.authorName}</p>
                <p className="text-[11px] text-[#9898A6]">
                  Expires in {hoursLeft(activeStatus.expiresAt)}h
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeStatus.userId === me.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowViewersList(!showViewersList)}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs"
                  >
                    <Eye size={14} />
                    <span>{activeStatus.viewCount}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteStatus(activeStatus.id)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/15"
                    aria-label="Delete status"
                  >
                    <Trash2 size={17} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => muteStatus(activeStatus.id)}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs text-[#9898A6] hover:text-white"
                >
                  <VolumeX size={14} />
                  <span>Mute</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewerIndex(null)}
                className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10"
                aria-label="Close viewer"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div
            className="relative flex flex-1 items-center justify-center p-6"
            style={{
              backgroundColor: activeStatus.mediaType === 'text' ? activeStatus.backgroundColor : '#060608',
            }}
          >
            {activeStatus.mediaType === 'text' && (
              <p className="max-w-xl text-center font-display text-2xl sm:text-3xl font-semibold leading-relaxed">
                {activeStatus.content}
              </p>
            )}
            {activeStatus.mediaType === 'image' && activeStatus.mediaUrl && (
              <img
                src={activeStatus.mediaUrl}
                alt={activeStatus.caption || 'Status image'}
                className="max-h-[70vh] max-w-full rounded-xl object-contain"
              />
            )}
            {activeStatus.mediaType === 'video' && activeStatus.mediaUrl && (
              <video
                src={activeStatus.mediaUrl}
                controls
                autoPlay
                className="max-h-[70vh] max-w-full rounded-xl"
              />
            )}
            {activeStatus.caption && (
              <div className="absolute bottom-6 rounded-xl bg-black/70 px-4 py-2 text-sm backdrop-blur-sm">
                {activeStatus.caption}
              </div>
            )}

            {/* Viewers Drawer for own status */}
            {showViewersList && activeStatus.userId === me.id && (
              <div className="absolute bottom-4 left-1/2 w-full max-w-md -translate-x-1/2 rounded-2xl border border-white/15 bg-[#111115] p-4 shadow-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-2">
                  Viewed By ({activeStatus.viewers.length})
                </p>
                {activeStatus.viewers.length === 0 ? (
                  <p className="text-xs text-[#9898A6]">No views yet.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {activeStatus.viewers.map((v) => (
                      <div key={v.viewer_id} className="flex items-center justify-between text-xs">
                        <span>{v.full_name}</span>
                        <span>{v.reaction || 'Viewed'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {activeStatus.userId !== me.id && (
            <div className="border-t border-white/10 bg-[#09090B] px-4 py-3">
              <div className="mx-auto flex max-w-xl flex-col gap-3">
                <div className="flex justify-center gap-3">
                  {['❤️', '🔥', '👏', '😂', '✨'].map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => reactToStatus(em)}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg hover:bg-white/20"
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <form onSubmit={sendStatusReply} className="flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply to status..."
                    className="h-11 flex-1 rounded-xl border border-white/15 bg-[#141418] px-4 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF37] text-[#09090B]"
                    aria-label="Send status reply"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
