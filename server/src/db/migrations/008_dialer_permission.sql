-- ═══════════════════════════════════════════════════════════════════════════
-- 008 — grandfather existing users into the new 'useDialer' permission
--
-- The calling dialer is now a per-broker permission the manager can toggle. New
-- brokers (and anyone on role defaults / NULL permissions) get it automatically.
-- But a user with an EXPLICIT permission set saved before this existed would
-- otherwise silently lose the dialer they already had — so add it to any such
-- user who can already call owners. (Managers on an explicit set get it too,
-- harmlessly; they never see the dialer.) One-time, additive, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE users
   SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'useDialer')
 WHERE permissions IS NOT NULL
   AND JSON_CONTAINS(permissions, '"callOwners"')
   AND NOT JSON_CONTAINS(permissions, '"useDialer"');
