# Rota State Management Document

## 1. State Locations & Classification

| Data | Location | Storage Type | Rationale | Wipe Condition |
|---|---|---|---|---|
| Access Token | Mobile Client | Expo SecureStore | 15-min JWT containing user ID and `sid`. Hardware keystore. | Logout, session revoked |
| Refresh Token | Mobile Client | Expo SecureStore | Rotated on every use. Hardware keystore. | Logout, session revoked |
| Active User / UI State | Mobile Client | Zustand | Transient client-only state (e.g. modal open, draft filters). | App reload / Logout |
| Server Entities (Shifts, Swaps, Roster) | Mobile Client | TanStack Query | Server cache with automated refetching and invalidation. | Logout |
| Offline Upcoming Shifts | Mobile Client | TanStack Query Persister (AsyncStorage) | Published shifts for next 30 days only; no notes (P-02). | Logout, user switch, stale > 14 days |
| Revoked Sessions | Backend | Redis Cache (`sid` set) | 15-minute TTL matching access token lifespan. | Expired by TTL |
| Rate Limits | Backend | Redis Cache | Sliding window counter with TTL. | Expired by TTL |
| Persistent Data | Backend | PostgreSQL (Control + Shards) | Authoritative source of truth for all business entities. | Append-only or soft-delete |

## 2. Cross-Device Settings & Conflict Resolution
- Settings updates use `PATCH` of changed fields only (P-08).
- Each column is stamped with `field_updated_at`.
- Field-level last-write-wins is applied per field rather than whole-row replacement.

## 3. Query Cache & Invalidation
- Calendar views: `team:{id}:cal:pub:{start}:{end}:v{n}` (D-03).
- Team cache version is bumped in the request transaction immediately upon shift publish/update.
- First feed page (newest 50 events) is cached in Redis for 30 seconds.
