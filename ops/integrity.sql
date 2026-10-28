-- Deterministic content fingerprints; output contains digests, never original private data.
SELECT 'attachments', encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text, E'\n' ORDER BY id),''),'UTF8')),'hex') FROM attachments t
UNION ALL SELECT 'messages', encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text, E'\n' ORDER BY id),''),'UTF8')),'hex') FROM messages t
UNION ALL SELECT 'audit', encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text, E'\n' ORDER BY id),''),'UTF8')),'hex') FROM audit t
UNION ALL SELECT 'users', encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text, E'\n' ORDER BY id),''),'UTF8')),'hex') FROM users t
ORDER BY 1;
