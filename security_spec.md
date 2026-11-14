# RIKZEN CHAT — Firestore Security Specification

## 1. Data Invariants
1. **Default Deny & Verified Identity**: All Firestore operations default to `false`. Every user write requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **PII Isolation (Split Collection)**: Private PII (`email`, `phone`, `dateOfBirth`) resides exclusively in `/users/{userId}` and is readable/writable ONLY by the owner (`request.auth.uid == userId`) or a verified admin (`isAdmin()`). Non-PII public discovery (`rikzenId`, `fullName`, `avatarUrl`, `bio`) resides in `/publicProfiles/{userId}`.
3. **Immutable Ownership & Timestamps**: `uid`, `createdBy`, `senderUid`, `rikzenId`, and `createdAt` are immutable after creation. Both `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
4. **Master Gate Relational Sync**: Access to `/conversations/{conversationId}/messages/{messageId}` strictly requires an active membership document at `/conversations/{conversationId}/members/{request.auth.uid}` via `exists()`/`get()`.
5. **Terminal State Locking**: Once a `/friendRequests/{requestId}` document reaches `'accepted'` or `'rejected'`, non-admin users cannot revert or mutate its `status`.
6. **Privilege Escalation Prevention**: Only a bootstrapped verified admin (`phonedata9955@gmail.com` with `email_verified == true`) or existing admin can write `/admins/{userId}`. Users cannot self-assign admin privileges or inject shadow fields (`hasOnly` enforced on every entity).
7. **ID & Size Hardening**: All path IDs match `^[a-zA-Z0-9_\\-]+$` with max length 128, and every string field enforces explicit `.size()` bounds to prevent resource poisoning.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Read on Private User PII**: Unauthenticated client requests `get /users/user_a` -> `PERMISSION_DENIED`.
2. **Cross-User PII Leak**: Authenticated `user_b` attempts `get /users/user_a` -> `PERMISSION_DENIED`.
3. **Blanket List Scraping on PII**: Authenticated `user_b` attempts `list /users` -> `PERMISSION_DENIED`.
4. **Email Spoofing Admin Bypass**: User with `email: "phonedata9955@gmail.com"` and `email_verified: false` attempts `create /admins/attacker` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: `user_a` creates `/publicProfiles/user_a` with extra field `isAdmin: true` or `role: "superadmin"` -> `PERMISSION_DENIED`.
6. **Identity Spoofing on Profile**: `user_a` creates `/publicProfiles/user_a` with `uid: "user_b"` -> `PERMISSION_DENIED`.
7. **Impersonated Friend Request**: `user_a` creates `/friendRequests/req_1` with `senderUid: "user_b"` -> `PERMISSION_DENIED`.
8. **Self-Directed Friend Request**: `user_a` creates `/friendRequests/req_self` with `senderUid: "user_a"` and `receiverUid: "user_a"` -> `PERMISSION_DENIED`.
9. **Terminal State Bypass on Friend Request**: `user_b` tries to change `/friendRequests/req_1` from `status: "rejected"` back to `"accepted"` -> `PERMISSION_DENIED`.
10. **Non-Member Message Injection**: `user_c` (not in `/conversations/conv_1/members/user_c`) attempts `create /conversations/conv_1/messages/msg_1` -> `PERMISSION_DENIED`.
11. **Path ID Poisoning / Oversized Payload**: `user_a` attempts write with 200-char ID or 10KB `fullName` -> `PERMISSION_DENIED`.
12. **Client-Spoofed Timestamp**: `user_a` creates `/publicProfiles/user_a` with backdated `createdAt: Timestamp(2020-01-01)` instead of `request.time` -> `PERMISSION_DENIED`.
