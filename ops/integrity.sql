-- Per-row SHA256 keeps large media bytes out of the aggregate; output contains only table digests.
SELECT 'attachments', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM attachments t
UNION ALL SELECT 'audit', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM audit t
UNION ALL SELECT 'conversations', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM conversations t
UNION ALL SELECT 'delivery_parts', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY message_id,part),''),'UTF8')),'hex') FROM delivery_parts t
UNION ALL SELECT 'messages', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM messages t
UNION ALL SELECT 'outbox', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM outbox t
UNION ALL SELECT 'provider_ledger', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY message_id,part),''),'UTF8')),'hex') FROM provider_ledger t
UNION ALL SELECT 'provider_state', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY account_id),''),'UTF8')),'hex') FROM provider_state t
UNION ALL SELECT 'read_cursors', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY user_id,conversation_id),''),'UTF8')),'hex') FROM read_cursors t
UNION ALL SELECT 'sessions', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY token_hash),''),'UTF8')),'hex') FROM sessions t
UNION ALL SELECT 'users', encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'), E'\n' ORDER BY id),''),'UTF8')),'hex') FROM users t
ORDER BY 1;
