/**
 * RIKZEN CHAT — Firestore Security Rules "Dirty Dozen" Verification Suite
 * Designed for @firebase/rules-unit-testing against firestore.rules.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  actor: { uid: string | null; email?: string; email_verified?: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read on private PII user document',
    actor: { uid: null },
    operation: 'get',
    path: '/users/user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-user PII read attempt by non-owner',
    actor: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    operation: 'get',
    path: '/users/user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Blanket list query scraping private /users collection',
    actor: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    operation: 'list',
    path: '/users',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified email spoofing admin bootstrap email',
    actor: { uid: 'attacker', email: 'phonedata9955@gmail.com', email_verified: false },
    operation: 'create',
    path: '/admins/attacker',
    payload: { uid: 'attacker', email: 'phonedata9955@gmail.com', createdAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow field injection (isAdmin/role) on public profile',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/publicProfiles/user_a',
    payload: {
      uid: 'user_a',
      rikzenId: 'RIKZEN-AB12CD',
      fullName: 'Alice',
      onboardingCompleted: true,
      isAdmin: true,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Identity spoofing UID mismatch on profile create',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/publicProfiles/user_a',
    payload: {
      uid: 'user_b',
      rikzenId: 'RIKZEN-AB12CD',
      fullName: 'Alice',
      onboardingCompleted: true,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Impersonated senderUid on friend request',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/friendRequests/req_impersonated',
    payload: {
      id: 'req_impersonated',
      senderUid: 'user_b',
      receiverUid: 'user_c',
      status: 'pending',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Self-directed friend request',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/friendRequests/req_self',
    payload: {
      id: 'req_self',
      senderUid: 'user_a',
      receiverUid: 'user_a',
      status: 'pending',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal state bypass (mutating rejected friend request)',
    actor: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    operation: 'update',
    path: '/friendRequests/req_rejected',
    payload: {
      status: 'accepted',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Non-member message injection into private conversation',
    actor: { uid: 'user_c', email: 'c@example.com', email_verified: true },
    operation: 'create',
    path: '/conversations/conv_1/messages/msg_1',
    payload: {
      id: 'msg_1',
      conversationId: 'conv_1',
      senderUid: 'user_c',
      content: 'Intruder message',
      messageType: 'text',
      isDeleted: false,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Path ID poisoning and oversized string value poisoning',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: `/publicProfiles/${'x'.repeat(200)}`,
    payload: {
      uid: 'user_a',
      rikzenId: 'RIKZEN-AB12CD',
      fullName: 'A'.repeat(500),
      onboardingCompleted: true,
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Client-spoofed historical timestamp on create',
    actor: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/publicProfiles/user_a',
    payload: {
      uid: 'user_a',
      rikzenId: 'RIKZEN-AB12CD',
      fullName: 'Alice',
      onboardingCompleted: true,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    expected: 'PERMISSION_DENIED',
  },
];
