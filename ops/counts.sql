SELECT 'attachments', count(*) FROM attachments
UNION ALL SELECT 'audit', count(*) FROM audit
UNION ALL SELECT 'conversations', count(*) FROM conversations
UNION ALL SELECT 'delivery_parts', count(*) FROM delivery_parts
UNION ALL SELECT 'messages', count(*) FROM messages
UNION ALL SELECT 'outbox', count(*) FROM outbox
UNION ALL SELECT 'provider_events', count(*) FROM provider_events
UNION ALL SELECT 'provider_ledger', count(*) FROM provider_ledger
UNION ALL SELECT 'provider_state', count(*) FROM provider_state
UNION ALL SELECT 'read_cursors', count(*) FROM read_cursors
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'users', count(*) FROM users
ORDER BY 1;
