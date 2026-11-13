# G5 pilot teardown and D7 deletion procedure

**Status:** procedure only. **No deletion has been performed.** This document does not authorize destructive action; the Owner must issue a teardown command after the pilot.

Scope: the dedicated pilot account, its single allowlisted peer, the pilot connector session, private pilot files and pilot-only database rows. Do **not** delete unrelated application data, users, general encryption keys, audit history or shared infrastructure.

## 1. Freeze and inventory before deleting

1. Stop the connector with one `SIGTERM`; confirm the process/container is gone. Stop the application worker if it could claim pilot work.
2. Confirm the provider session is revoked from the official phone and no replacement connector is running.
3. Record the UTC stop time, the final session status, ownership epoch/state and the last confirmed outbound boundary.
4. Enumerate private files without printing contents:

```bash
find "$PILOT_STATE_DIR" -maxdepth 2 -printf '%M %u:%g %s %p\n'
stat -c '%a %U:%G %s %n' "$PILOT_MANIFEST_FILE" "$PILOT_KEY_FILE" 2>/dev/null
```

5. Inventory pilot database rows with private psql variables supplied on the command line or in a 0600 `psqlrc` outside the repository. Never commit the real values.

`account` is the fixed application account UUID (`ACCOUNT` in `server/db.ts`), **not** the Zalo account UID. `peer` is the direct-message provider thread id, which is the private peer UID; it is matched against `provider_thread_id`, not the local `contact_id`.

```sql
\set account '00000000-0000-4000-8000-000000000001'
\set peer    'PEER_B_UID'
\set win_start 'YYYY-MM-DDTHH:MM:SS.sssZ'
\set win_end   'YYYY-MM-DDTHH:MM:SS.sssZ'

SELECT c.id AS conversation_id, c.created_at
FROM conversations c
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer';

SELECT count(*) AS pilot_messages
FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND m.created_at >= :'win_start' AND m.created_at < :'win_end';

SELECT count(*) AS pilot_attachments, coalesce(sum(octet_length(a.data)), 0) AS attachment_bytes
FROM attachments a JOIN messages m ON m.id = a.message_id
JOIN conversations c ON c.id = m.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND m.created_at >= :'win_start' AND m.created_at < :'win_end';

SELECT count(*) AS pilot_part_ledger_rows
FROM pilot_part_ledger l JOIN messages m ON m.id = l.message_id
JOIN conversations c ON c.id = m.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND m.created_at >= :'win_start' AND m.created_at < :'win_end';

SELECT count(*) AS provider_ledger_rows
FROM provider_ledger l JOIN messages m ON m.id = l.message_id
JOIN conversations c ON c.id = m.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND m.created_at >= :'win_start' AND m.created_at < :'win_end';

SELECT count(*) AS pilot_provider_events
FROM provider_events e JOIN conversations c ON c.id = e.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer';

SELECT count(*) AS pending_or_unknown
FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND m.status IN ('pending', 'processing', 'unknown');
```

6. Preserve sanitized reports, security evidence, aggregate metrics and defect records. Do not copy real identifiers, message bodies, QR images, session material or keys into the repository.

## 2. Resolve unknown or interrupted work first

If any pilot message is `unknown` or `processing`, do not delete it silently. Compare authoritative provider evidence, record the classification and obtain an explicit Owner decision. D7 deletion applies only after the unknown-work decision is recorded. Never resend unknown work.

## 3. Delete pilot data (template; Owner-authorized and reviewed)

Run inside a single transaction after a verified backup or an explicit Owner waiver. Keep the audit table intact; it is append-only security evidence and must remain in the private environment.

Order matters. `pilot_part_ledger` references messages with `ON DELETE RESTRICT`; `provider_events` references messages with no cascade and cascades to its variants and media jobs. Delete both before the messages.

```sql
BEGIN;
CREATE TEMP TABLE pilot_conversations ON COMMIT DROP AS
SELECT c.id
FROM conversations c
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer';

CREATE TEMP TABLE pilot_messages ON COMMIT DROP AS
SELECT m.id
FROM messages m
WHERE m.conversation_id IN (SELECT id FROM pilot_conversations)
  AND m.created_at >= :'win_start' AND m.created_at < :'win_end';

SELECT count(*) AS to_delete FROM pilot_messages;

DELETE FROM pilot_part_ledger WHERE message_id IN (SELECT id FROM pilot_messages);
DELETE FROM provider_ledger WHERE message_id IN (SELECT id FROM pilot_messages);
DELETE FROM provider_events
WHERE conversation_id IN (SELECT id FROM pilot_conversations)
  AND (message_id IN (SELECT id FROM pilot_messages)
       OR (received_at >= :'win_start' AND received_at < :'win_end'));
DELETE FROM delivery_parts WHERE message_id IN (SELECT id FROM pilot_messages);
DELETE FROM attachments WHERE message_id IN (SELECT id FROM pilot_messages);
DELETE FROM outbox WHERE message_id IN (SELECT id FROM pilot_messages);
DELETE FROM messages WHERE id IN (SELECT id FROM pilot_messages);
DELETE FROM pilot_send_budget
WHERE account_id = :'account'
  AND day BETWEEN (:'win_start'::timestamptz AT TIME ZONE 'utc')::date
              AND (:'win_end'::timestamptz AT TIME ZONE 'utc')::date;
COMMIT;
```

Deleting `provider_events` also removes their variants and any unsupported-media job rows. Attachments are deleted explicitly after the delivery parts that reference them; `pilot_send_budget` holds only per-day counters, not message content or peer identifiers.

Then, only if the Owner decides the empty pilot conversations themselves are temporary identity mappings:

```sql
BEGIN;
DELETE FROM read_cursors
WHERE conversation_id IN (
  SELECT c.id FROM conversations c
  WHERE c.account_id = :'account'
    AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
);
DELETE FROM conversations c
WHERE c.account_id = :'account'
  AND c.provider_thread_type = 0 AND c.provider_thread_id = :'peer'
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id);
COMMIT;
```

Do not delete `users`, `sessions` for unrelated staff, `audit`, `provider_state` rows for other accounts or any table not listed here.

## 4. Delete private pilot material

After the database step and only on the private pilot host:

- remove `session.enc`, `session.key`, the enrollment/observe/send manifests and any temporary grant copies;
- remove `qr.png` and the entire local QR view directory (the connector normally clears the PNG after use);
- remove empty state/temp directories created for the pilot;
- revoke the provider session from the official phone; do not attempt a replacement login;
- remove temporary recipient/identity mappings and the private consent file only after retaining a sanitized consent reference and the Owner's approval record.

Secure deletion is not proven on SSDs, copy-on-write filesystems, snapshots or provider backups. Report what was deleted, what remains in encrypted backups and when those backups expire. Never claim physical erasure that was not verified.

## 5. Verify and report

1. Re-run the inventory queries: pilot messages, attachments/bytes, `pilot_part_ledger`/`provider_ledger` rows, provider events, budget rows for the window and pending/processing/unknown counts must be `0` (or the Owner-approved residual).
2. Confirm the private paths are absent and no `qr.png`, `session.enc`, `session.key` or manifest copy remains under the pilot state, home, `/tmp` or Docker volumes.
3. Confirm no connector container, image or volume holding session material remains unless the Owner explicitly retains the reviewed image for evidence.
4. Record the retained encrypted backups (location, scope, expiry) and the sanitized evidence kept.
5. Complete the D7 section of `G5-LIVE-PILOT-SUMMARY.md` with UTC times, counts, residuals, backup disclosure and the Owner's teardown approval reference.

## 6. Prohibited shortcuts

- Do not drop the database, schema or shared volumes.
- Do not delete `audit` rows or bypass its append-only trigger.
- Do not delete unrelated conversations, users, attachments or storage.
- Do not rotate or destroy general application encryption keys to simulate erasure.
- Do not delete evidence of an unknown send before the Owner decision is recorded.
