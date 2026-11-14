import React, { useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, Megaphone, Plus, Radio, Send, Users, X } from 'lucide-react';
import { apiFetch, uploadMediaFile } from '../services/api';
import type { ChannelItem, CommunityItem, ConversationSummary } from '../types/rikzen';

interface CommunitiesChannelsViewProps {
  conversations: ConversationSummary[];
}

export const CommunitiesChannelsView: React.FC<CommunitiesChannelsViewProps> = ({ conversations }) => {
  const [subTab, setSubTab] = useState<'communities' | 'channels'>('communities');
  const [communities, setCommunities] = useState<CommunityItem[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityItem | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelItem | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [announcementText, setAnnouncementText] = useState('');
  const [linkGroupId, setLinkGroupId] = useState('');

  const [postText, setPostText] = useState('');
  const [postMediaFile, setPostMediaFile] = useState<File | null>(null);

  const loadAll = async () => {
    try {
      const [commRes, chanRes] = await Promise.all([apiFetch('/api/communities'), apiFetch('/api/channels')]);
      const comms = commRes.communities || [];
      const chans = chanRes.channels || [];
      setCommunities(comms);
      setChannels(chans);
      if (selectedCommunity) {
        setSelectedCommunity(comms.find((c: CommunityItem) => c.id === selectedCommunity.id) || null);
      }
      if (selectedChannel) {
        setSelectedChannel(chans.find((c: ChannelItem) => c.id === selectedChannel.id) || null);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    let avatarUrl: string | null = null;
    if (coverFile) {
      const up = await uploadMediaFile(coverFile, coverFile.name);
      avatarUrl = up.fileUrl;
    } else if (subTab === 'communities') {
      avatarUrl = '/src/assets/images/rikzen_community_cover_1794652829395.jpg';
    }
    const endpoint = subTab === 'communities' ? '/api/communities' : '/api/channels';
    await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), description: description.trim(), avatarUrl }),
    });
    setCreateOpen(false);
    setName('');
    setDescription('');
    setCoverFile(null);
    await loadAll();
  };

  const joinCommunity = async (id: string) => {
    await apiFetch(`/api/communities/${id}/join`, { method: 'POST' });
    await loadAll();
  };

  const postAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommunity || !announcementText.trim()) return;
    await apiFetch(`/api/communities/${selectedCommunity.id}/announcements`, {
      method: 'POST',
      body: JSON.stringify({ content: announcementText.trim() }),
    });
    setAnnouncementText('');
    await loadAll();
  };

  const linkGroup = async () => {
    if (!selectedCommunity || !linkGroupId) return;
    await apiFetch(`/api/communities/${selectedCommunity.id}/link-group`, {
      method: 'POST',
      body: JSON.stringify({ groupId: linkGroupId }),
    });
    setLinkGroupId('');
    await loadAll();
  };

  const toggleFollowChannel = async (id: string) => {
    await apiFetch(`/api/channels/${id}/follow`, { method: 'POST' });
    await loadAll();
  };

  const publishChannelPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || (!postText.trim() && !postMediaFile)) return;
    let mediaUrl: string | null = null;
    let mediaType = 'text';
    if (postMediaFile) {
      const up = await uploadMediaFile(postMediaFile, postMediaFile.name);
      mediaUrl = up.fileUrl;
      mediaType = postMediaFile.type.startsWith('video') ? 'video' : 'image';
    }
    await apiFetch(`/api/channels/${selectedChannel.id}/posts`, {
      method: 'POST',
      body: JSON.stringify({ content: postText.trim(), mediaUrl, mediaType }),
    });
    setPostText('');
    setPostMediaFile(null);
    await loadAll();
  };

  const reactChannelPost = async (postId: string, emoji: string) => {
    await apiFetch(`/api/channels/posts/${postId}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    await loadAll();
  };

  const myGroups = conversations.filter((c) => c.type === 'group' && c.groupId);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-[#0B0B0E] p-4 sm:p-6">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-[#141418] p-1">
            <button
              type="button"
              onClick={() => {
                setSubTab('communities');
                setSelectedChannel(null);
              }}
              className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold transition ${
                subTab === 'communities' ? 'bg-[#D4AF37] text-[#09090B]' : 'text-slate-600 dark:text-[#9898A6]'
              }`}
            >
              Communities
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('channels');
                setSelectedCommunity(null);
              }}
              className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold transition ${
                subTab === 'channels' ? 'bg-[#D4AF37] text-[#09090B]' : 'text-slate-600 dark:text-[#9898A6]'
              }`}
            >
              Channels
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex min-h-[42px] items-center gap-2 rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B]"
          >
            <Plus size={16} />
            <span>{subTab === 'communities' ? 'New Community' : 'New Channel'}</span>
          </button>
        </div>

        {/* Communities Tab */}
        {subTab === 'communities' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-3">
              {communities.length === 0 ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 p-6 text-sm text-slate-500 dark:text-[#9898A6]">
                  No communities created yet. Start one to bring related groups and announcements together!
                </div>
              ) : (
                communities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCommunity(c)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedCommunity?.id === c.id
                        ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                        : 'border-black/8 dark:border-white/10 bg-slate-50 dark:bg-[#141418] hover:border-[#D4AF37]/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[#D4AF37]/30 bg-[#09090B]">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt={c.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[#D4AF37]">
                            <Users size={20} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-sm">{c.name}</p>
                        <p className="text-xs text-slate-500 dark:text-[#9898A6] tabular-nums">
                          {c.memberCount} members · {c.linkedGroups.length} groups
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="lg:col-span-7">
              {selectedCommunity ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-[#141418] overflow-hidden">
                  <div className="relative h-36 bg-[#09090B]">
                    {selectedCommunity.avatar_url && (
                      <img
                        src={selectedCommunity.avatar_url}
                        alt={selectedCommunity.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover opacity-70"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-end justify-between p-4">
                      <div>
                        <h3 className="font-display text-xl font-bold text-white">{selectedCommunity.name}</h3>
                        <p className="text-xs text-white/75">{selectedCommunity.description}</p>
                      </div>
                      {!selectedCommunity.isMember && (
                        <button
                          type="button"
                          onClick={() => joinCommunity(selectedCommunity.id)}
                          className="min-h-[40px] rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B]"
                        >
                          Join Community
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-4 space-y-5">
                    {(selectedCommunity.myRole === 'owner' || selectedCommunity.myRole === 'admin') && (
                      <div className="space-y-3 rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 p-3.5">
                        <form onSubmit={postAnnouncement} className="flex gap-2">
                          <input
                            type="text"
                            value={announcementText}
                            onChange={(e) => setAnnouncementText(e.target.value)}
                            placeholder="Broadcast community announcement..."
                            className="h-10 flex-1 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#09090B] px-3 text-xs focus:border-[#D4AF37] focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="min-h-[40px] rounded-xl bg-[#D4AF37] px-3.5 text-xs font-semibold text-[#09090B]"
                          >
                            Announce
                          </button>
                        </form>

                        {myGroups.length > 0 && (
                          <div className="flex gap-2">
                            <select
                              value={linkGroupId}
                              onChange={(e) => setLinkGroupId(e.target.value)}
                              className="h-10 flex-1 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#09090B] px-3 text-xs"
                            >
                              <option value="">Link one of your groups...</option>
                              {myGroups.map((g) => (
                                <option key={g.groupId} value={g.groupId}>
                                  {g.title}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={linkGroup}
                              className="min-h-[40px] rounded-xl border border-[#D4AF37]/40 px-3 text-xs font-medium text-[#D4AF37]"
                            >
                              Add Group
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-2">
                        <Megaphone size={14} />
                        <span>Announcements</span>
                      </h4>
                      {selectedCommunity.announcements.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-[#9898A6]">No announcements yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {selectedCommunity.announcements.map((a) => (
                            <div key={a.id} className="rounded-xl border border-black/8 dark:border-white/10 p-3 text-sm">
                              <p>{a.content}</p>
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-[#9898A6]">
                                {a.author_name} · {new Date(a.created_at).toLocaleString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#9898A6] mb-2">
                        Linked Groups ({selectedCommunity.linkedGroups.length})
                      </h4>
                      {selectedCommunity.linkedGroups.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-[#9898A6]">No groups linked yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {selectedCommunity.linkedGroups.map((g) => (
                            <div key={g.id} className="rounded-xl border border-black/8 dark:border-white/10 p-3 text-sm font-medium">
                              {g.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-black/15 dark:border-white/15 text-sm text-slate-500 dark:text-[#9898A6]">
                  Select a community to view announcements and linked groups.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Channels Tab */}
        {subTab === 'channels' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-3">
              {channels.length === 0 ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 p-6 text-sm text-slate-500 dark:text-[#9898A6]">
                  No channels available yet. Create the first RIKZEN Channel!
                </div>
              ) : (
                channels.map((ch) => (
                  <div
                    key={ch.id}
                    onClick={() => setSelectedChannel(ch)}
                    className={`cursor-pointer rounded-2xl border p-4 transition ${
                      selectedChannel?.id === ch.id
                        ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                        : 'border-black/8 dark:border-white/10 bg-slate-50 dark:bg-[#141418] hover:border-[#D4AF37]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[#D4AF37]/30 bg-[#09090B]">
                          {ch.avatar_url ? (
                            <img src={ch.avatar_url} alt={ch.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[#D4AF37]">
                              <Radio size={18} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate font-semibold text-sm">{ch.name}</p>
                            {ch.isVerified && <CheckCircle2 size={14} className="text-[#22C55E] shrink-0" />}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-[#9898A6] tabular-nums">
                            {ch.followerCount} followers
                          </p>
                        </div>
                      </div>
                      {!ch.isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFollowChannel(ch.id);
                          }}
                          className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${
                            ch.isFollowing
                              ? 'border border-white/15 text-slate-400'
                              : 'bg-[#D4AF37] text-[#09090B]'
                          }`}
                        >
                          {ch.isFollowing ? 'Following' : 'Follow'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="lg:col-span-7">
              {selectedChannel ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-[#141418] p-4 space-y-4">
                  <div className="border-b border-black/8 dark:border-white/10 pb-3">
                    <h3 className="font-display text-xl font-bold">{selectedChannel.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-[#9898A6] mt-0.5">
                      {selectedChannel.description} · {selectedChannel.followerCount} followers
                    </p>
                  </div>

                  {selectedChannel.isAdmin && (
                    <form onSubmit={publishChannelPost} className="space-y-2 rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 p-3">
                      <textarea
                        rows={2}
                        value={postText}
                        onChange={(e) => setPostText(e.target.value)}
                        placeholder="Publish a channel update..."
                        className="w-full rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#09090B] p-2.5 text-sm focus:border-[#D4AF37] focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#D4AF37]">
                          <ImagePlus size={15} />
                          <span>{postMediaFile ? postMediaFile.name : 'Attach photo or video'}</span>
                          <input
                            type="file"
                            accept="image/*,video/*"
                            className="hidden"
                            onChange={(e) => setPostMediaFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        <button
                          type="submit"
                          className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B]"
                        >
                          <Send size={13} />
                          <span>Publish</span>
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-3">
                    {selectedChannel.posts.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500 dark:text-[#9898A6]">
                        No updates published in this channel yet.
                      </p>
                    ) : (
                      selectedChannel.posts.map((post) => (
                        <div key={post.id} className="rounded-xl border border-black/8 dark:border-white/10 p-3.5 space-y-2">
                          {post.media_url && post.media_type === 'image' && (
                            <img src={post.media_url} alt="Channel media" className="max-h-72 rounded-xl object-cover" />
                          )}
                          {post.media_url && post.media_type === 'video' && (
                            <video src={post.media_url} controls className="max-h-72 rounded-xl" />
                          )}
                          {post.content && <p className="text-sm leading-relaxed">{post.content}</p>}
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-slate-500 dark:text-[#9898A6]">
                              {new Date(post.created_at).toLocaleString()}
                            </span>
                            <div className="flex gap-1.5">
                              {['👍', '🔥', '❤️'].map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() => reactChannelPost(post.id, em)}
                                  className="rounded-lg border border-black/10 dark:border-white/10 px-2 py-1 text-xs hover:bg-white/10"
                                >
                                  {em} {post.reactions[em] || 0}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-black/15 dark:border-white/15 text-sm text-slate-500 dark:text-[#9898A6]">
                  Select a channel to view updates and reactions.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-display text-lg font-semibold">
                {subTab === 'communities' ? 'Create Community' : 'Create Channel'}
              </h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-[#9898A6] hover:text-white">
                <X size={20} />
              </button>
            </div>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={subTab === 'communities' ? 'Community name' : 'Channel name'}
              className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
            />
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description..."
              className="w-full rounded-xl border border-white/10 bg-[#09090B] p-3 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/20 p-3 text-xs text-[#9898A6] hover:border-[#D4AF37]">
              <ImagePlus size={16} className="text-[#D4AF37]" />
              <span>{coverFile ? coverFile.name : 'Upload cover image (optional)'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
            </label>
            <button
              type="submit"
              className="min-h-[46px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B]"
            >
              Create
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
