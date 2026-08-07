# Security Specification for Firestore Rules

## 1. Data Invariants
- A user profile document ID MUST match the authenticated user's Firebase Auth `uid` (`request.auth.uid == userId`).
- A user can only read, create, or update their own profile document.
- The `email` field is immutable and cannot be changed after creation.
- Field types and exact key schemas must be strictly validated during creations and updates (e.g. `xp` matches type `int`, schema has required properties, strings have length validation).

## 2. The "Dirty Dozen" Payloads (Denial/Exploit Scenarios)
1. **Unauthenticated Read**: Attempting to read a profile without being logged in. (Expected: `PERMISSION_DENIED`)
2. **Identity Spoofing Read**: Authenticated as `UserA`, trying to read `UserB`'s profile. (Expected: `PERMISSION_DENIED`)
3. **Unauthenticated Create**: Attempting to create a profile without credentials. (Expected: `PERMISSION_DENIED`)
4. **Identity Spoofing Create**: Authenticated as `UserA`, trying to write a profile at `users/UserB`. (Expected: `PERMISSION_DENIED`)
5. **Ghost Field Injection Create**: Creating a profile containing an un-whitelisted/shadow property (e.g. `isVerifiedAdmin: true`). (Expected: `PERMISSION_DENIED`)
6. **Missing Keys Create**: Creating a profile lacking required keys (e.g., missing `xp`). (Expected: `PERMISSION_DENIED`)
7. **Invalid Type Injection (XP)**: Passing a string `"100"` as `xp` value instead of an integer. (Expected: `PERMISSION_DENIED`)
8. **Invalid Pattern Injection (Username)**: Registering a username that does not start with `@`, or contains forbidden characters. (Expected: `PERMISSION_DENIED`)
9. **Unauthenticated Update**: Attempting to update a user's stats without authentication. (Expected: `PERMISSION_DENIED`)
10. **Cross-User Hijacking Update**: Authenticated as `UserA`, attempting to edit any stats in `UserB`'s profile. (Expected: `PERMISSION_DENIED`)
11. **Immutable Email Mutation**: Modifying the registered `email` field after document creation. (Expected: `PERMISSION_DENIED`)
12. **Extreme String Denial-of-Wallet**: Attempting to submit a username or display name with a 1MB payload to deplete database storage or incur bloated network egress. (Expected: `PERMISSION_DENIED`)

## 3. Test Cases (TDD mapping)
Every payload is mapped against the final Firestore transaction limits ensuring mathematical restriction on the backend.
