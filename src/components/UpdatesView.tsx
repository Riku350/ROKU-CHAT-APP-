import React, { useEffect, useState } from 'react';
import { Eye, ImagePlus, Plus, Send, Trash2, VolumeX, X } from 'lucide-react';
import { apiFetch, uploadMediaFile } from '../services/api';
import type { StatusItem, UserProfile } from '../types/rikzen';

interface UpdatesViewProps {
  me: UserProfile;
  onReplyInChat: (peerId: string, text: string) => Promise<void>;
}

const STATUS_COLORS = ['#141418', '#1F1A0E', '#0D2619', '#23121E', '#111B2B'];

export const UpdatesView: React.FC<UpdatesViewProps> = ({ me, onReplyInChat }) => {
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
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

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/statuses');
      setStatuses(data.statuses || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  const myStatuses = statuses.filter((s) => s.userId === me.id);
  const friendStatuses = statuses.filter((s) => s.userId !== me.id && !s.isMuted);
  const mutedStatuses = statuses.filter((s) => s.userId !== me.id && s.isMuted);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setMediaType(file.type.startsWith('video') ? 'video' : 'image');
    setPreviewUrl(URL.createObjectURL(file));
  };

  const publishStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mediaType === 'text' && !textContent.trim()) return;
    if (mediaType !== 'text' && !selectedFile) return;

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
      setComposerOpen(false);
      setTextContent('');
      setCaption('');
      setSelectedFile(null);
      setPreviewUrl(null);
      setMediaType('text');
      await loadStatuses();
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
    await apiFetch(`/api/statuses/${activeStatus.id}/view`, {
      method: 'POST',
      body: JSON.stringify({ reaction: emoji }),
    });
    loadStatuses();
  };

  const sendStatusReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStatus || !replyText.trim()) return;
    await onReplyInChat(
      activeStatus.userId,
      `Replied to your status: "${replyText.trim()}"`
    );
    setReplyText('');
    setViewerIndex(null);
  };

  const muteStatus = async (id: string) => {
    await apiFetch(`/api/statuses/${id}/mute`, { method: 'POST' });
    setViewerIndex(null);
    loadStatuses();
  };

  const deleteStatus = async (id: string) => {
    await apiFetch(`/api/statuses/${id}`, { method: 'DELETE' });
    setViewerIndex(null);
    loadStatuses();
  };

  const hoursLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60)));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-[#0B0B0E] p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold">Updates</h2>
            <p className="text-xs text-slate-500 dark:text-[#9898A6] mt-0.5">
              Status updates automatically expire after 24 hours
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B]"
          >
            <Plus size={16} />
            <span>Add Status</span>
          </button>
        </div>

        {/* My Status */}
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-slate-50 dark:bg-[#141418] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => (myStatuses[0] ? openViewer(myStatuses[0]) : setComposerOpen(true))}
                className={`relative h-14 w-14 rounded-full p-[2px] ${
                  myStatuses.length > 0 ? 'border-2 border-[#22C55E]' : 'border border-dashed border-[#D4AF37]'
                }`}
              >
                <div className="h-full w-full overflow-hidden rounded-full bg-[#09090B]">
                  {me.avatarUrl ? (
                    <img src={me.avatarUrl} alt={me.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                      {me.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </button>
              <div>
                <p className="font-semibold text-sm">My Status</p>
                <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                  {myStatuses.length > 0
                    ? `${myStatuses.length} active · ${hoursLeft(myStatuses[0].expiresAt)}h remaining`
                    : 'Tap to share a text, photo, or video update'}
                </p>
              </div>
            </div>
            {myStatuses.length > 0 && (
              <button
                type="button"
                onClick={() => openViewer(myStatuses[0])}
                className="min-h-[40px] rounded-lg border border-black/10 dark:border-white/15 px-3 text-xs font-medium"
              >
                View ({myStatuses[0].viewCount})
              </button>
            )}
          </div>
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
              No recent updates from your friends yet.
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
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`h-13 w-13 rounded-full p-[2px] border-2 ${
                        st.viewedByMe ? 'border-slate-500/40' : 'border-[#22C55E]'
                      }`}
                    >
                      <div className="h-full w-full overflow-hidden rounded-full bg-[#09090B]">
                        {st.authorAvatar ? (
                          <img src={st.authorAvatar} alt={st.authorName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                            {st.authorName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{st.authorName}</p>
                      <p className="text-xs text-slate-500 dark:text-[#9898A6]">
                        {st.mediaType === 'text' ? st.content.slice(0, 40) : st.caption || `${st.mediaType} update`} · {hoursLeft(st.expiresAt)}h left
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
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 p-3 text-left text-xs"
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
            className="w-full max-w-md rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-6 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-display text-lg font-semibold">Create Status Update</h3>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#9898A6] hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMediaType('text');
                  setSelectedFile(null);
                  setPreviewUrl(null);
                }}
                className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold ${
                  mediaType === 'text' ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-white/5 text-[#9898A6]'
                }`}
              >
                Text Status
              </button>
              <label className="flex flex-1 min-h-[40px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white/5 text-xs font-semibold text-[#F5E6B3] hover:bg-white/10">
                <ImagePlus size={15} />
                <span>Photo / Video</span>
                <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFilePick} />
              </label>
            </div>

            {mediaType === 'text' ? (
              <div className="mt-4">
                <div
                  className="flex min-h-[180px] items-center justify-center rounded-2xl p-5"
                  style={{ backgroundColor: bgColor }}
                >
                  <textarea
                    rows={4}
                    required
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Type a status update..."
                    className="w-full resize-none bg-transparent text-center font-display text-xl font-semibold text-white placeholder-white/40 focus:outline-none"
                  />
                </div>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {STATUS_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBgColor(c)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        bgColor === c ? 'border-[#D4AF37]' : 'border-white/20'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {previewUrl && (
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-black max-h-64 flex justify-center">
                    {mediaType === 'video' ? (
                      <video src={previewUrl} controls className="max-h-64" />
                    ) : (
                      <img src={previewUrl} alt="Status preview" className="max-h-64 object-contain" />
                    )}
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
              {submitting ? 'Publishing...' : 'Share Status (24h)'}
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
                  <img src={activeStatus.authorAvatar} alt={activeStatus.authorName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
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
            style={{ backgroundColor: activeStatus.mediaType === 'text' ? activeStatus.backgroundColor : '#060608' }}
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
              <video src={activeStatus.mediaUrl} controls autoPlay className="max-h-[70vh] max-w-full rounded-xl" />
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
