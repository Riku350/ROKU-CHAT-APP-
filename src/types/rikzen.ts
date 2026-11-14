export interface PrivacySettings {
  lastSeen: 'everyone' | 'friends' | 'nobody';
  onlineStatus: 'everyone' | 'friends' | 'nobody';
  profilePhoto: 'everyone' | 'friends' | 'nobody';
  bioVisibility: 'everyone' | 'friends' | 'nobody';
  readReceipts: boolean;
  friendRequests: 'everyone' | 'nobody';
  discoverableByPhone: boolean;
  discoverableByName: boolean;
  emailVisibility: 'everyone' | 'friends' | 'nobody';
}

export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'system';
  wallpaper: 'obsidian-web' | 'midnight' | 'emerald-silk' | 'champagne-mist';
  accentColor: 'gold' | 'emerald' | 'ivory';
  fontSize: 'small' | 'medium' | 'large';
  bubbleStyle: 'rounded' | 'classic' | 'minimal';
}

export interface NotificationSettings {
  messages: boolean;
  friendRequests: boolean;
  groups: boolean;
  calls: boolean;
  statuses: boolean;
  sound: boolean;
  vibration: boolean;
}

export interface StorageSettings {
  autoDownloadImages: boolean;
  autoDownloadVideo: boolean;
  autoDownloadDocs: boolean;
}

export interface AccessibilitySettings {
  reducedMotion: boolean;
  highContrast: boolean;
  appLanguage: string;
}

export interface UserProfile {
  id: string;
  rikzenId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  dateOfBirth: string | null;
  onboardingCompleted: boolean;
  privacySettings: PrivacySettings;
  appearanceSettings: AppearanceSettings;
  notificationSettings: NotificationSettings;
  storageSettings: StorageSettings;
  accessibilitySettings: AccessibilitySettings;
  isAdmin: boolean;
}

export interface PublicPeer {
  id: string;
  rikzenId: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  email: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  typingInConversationId?: string | null;
  typingActivity?: 'typing' | 'recording' | 'idle' | null;
  isFriend: boolean;
  relationship?: 'friends' | 'sent' | 'received' | 'rejected' | 'none';
  requestId?: string | null;
  canSendRequest?: boolean;
}

export interface FriendRequestItem {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
  sender_rikzen_id: string;
  sender_name: string;
  sender_avatar: string | null;
  sender_bio: string;
  receiver_rikzen_id: string;
  receiver_name: string;
  receiver_avatar: string | null;
  receiver_bio: string;
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  groupId?: string;
  title: string;
  description?: string;
  avatarUrl: string | null;
  inviteCode?: string | null;
  peer?: PublicPeer | null;
  isBlocked?: boolean;
  onlyAdminsMessage?: boolean;
  onlyAdminsEditInfo?: boolean;
  myRole?: 'owner' | 'admin' | 'member';
  memberCount?: number;
  muted: boolean;
  archived: boolean;
  pinned?: boolean;
  markedUnread?: boolean;
  disappearingSeconds?: number;
  chatTheme?: string | null;
  customList?: string;
  unreadCount: number;
  lastMessageAt: string;
  lastMessage: {
    id: string;
    content: string;
    messageType: string;
    senderId: string;
    senderName: string;
    status?: 'sent' | 'delivered' | 'read';
    createdAt: string;
  } | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'voice' | 'location' | 'system';
  replyToId: string | null;
  replyTo: {
    id: string;
    content: string;
    messageType: string;
    senderName: string;
  } | null;
  forwardedFromId: string | null;
  metadata: Record<string, any>;
  isEdited: boolean;
  isDeleted: boolean;
  isPinned: boolean;
  isStarred: boolean;
  status: 'sent' | 'delivered' | 'read';
  reactions: Array<{ emoji: string; user_id: string }>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  pendingLocal?: boolean;
  failedLocal?: boolean;
}

export interface StatusItem {
  id: string;
  userId: string;
  authorName: string;
  authorAvatar: string | null;
  authorRikzenId: string;
  mediaType: 'text' | 'image' | 'video';
  content: string;
  mediaUrl: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  caption: string;
  backgroundColor: string;
  fontStyle?: 'sans' | 'serif' | 'bold' | 'mono';
  privacy?: 'everyone' | 'friends' | 'contacts' | 'selected';
  isMuted: boolean;
  viewedByMe: boolean;
  viewCount: number;
  viewers: Array<{
    viewer_id: string;
    full_name: string;
    avatar_url: string | null;
    rikzen_id: string;
    reaction: string | null;
    viewed_at: string;
  }>;
  expiresAt: string;
  createdAt: string;
}

export interface CommunityItem {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  owner_id: string;
  memberCount: number;
  isMember: boolean;
  myRole: string | null;
  linkedGroups: Array<{ id: string; name: string; description: string; avatar_url: string | null }>;
  announcements: Array<{ id: string; content: string; author_name: string; created_at: string }>;
  created_at: string;
}

export interface ChannelItem {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  owner_id: string;
  isVerified: boolean;
  followerCount: number;
  isFollowing: boolean;
  isAdmin: boolean;
  posts: Array<{
    id: string;
    content: string;
    media_url: string | null;
    media_type: string;
    author_name: string;
    reactions: Record<string, number>;
    created_at: string;
  }>;
  created_at: string;
}

export interface CallLogItem {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: 'voice' | 'video';
  status: 'ringing' | 'connected' | 'ended' | 'missed' | 'rejected' | 'busy';
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  caller_name: string;
  caller_avatar: string | null;
  caller_rikzen_id: string;
  callee_name: string;
  callee_avatar: string | null;
  callee_rikzen_id: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}
