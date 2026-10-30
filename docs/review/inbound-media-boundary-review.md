# Inbound media boundary independent review

Verdict: **no P0/P1/P2 identified in the reviewed pure foundation; accepted conditionally on later integration and hosted evidence**. This is not durable inbound-media, CDN, actual account or production acceptance.

## Scope and method

Reviewed `adapters/zalo/inbound-media.ts`, `server/locator-cipher.ts`, their two focused transport test files, implementation report and the pure portion of Task1 in `docs/plans/connector-inbound-media.md`. No production code edits, network operation, account/SDK login, database attempts, subagents or commits were performed. Only this report was authored. Concurrent fault-version/downloader work is outside this review.

## Assessment

- Candidate extraction admits only the two source-shaped categories and an object with exactly the own enumerable href/title fields. It returns copied primitive fields in frozen candidate/array objects. Albums, extra schema fields and fallback URLs are refused. The parser checks bounded well-formed names/URL text, raw userinfo/fragment/backslash ambiguities and HTTPS/default-port syntax; throwing getters are contained. It intentionally does not prove routing identity, trusted host, DNS safety or permission to fetch. Those gates must remain separate.
- Actual UserMessage/GroupMessage constructor fixtures establish only that the pinned artifact preserves synthetic content. Generic SDK types and these fixtures do not verify real photo/file payloads. The exact two-field contract can refuse richer legitimate payloads; that is an explicit unsupported outcome rather than a claim of live compatibility.
- Encryption uses copied 32-byte AES keys, random 12-byte nonces and AES-256-GCM with 16-byte tags. AAD binds version, key ID and canonical account/event/item context. Envelope decoding enforces exact field shape, known key ID, canonical bounded base64, byte lengths and authenticated decryption before fatal UTF-8/locator validation. Context/key/ciphertext swaps fail closed. Fixed errors carry no raw causes, URLs or key material.
- Stable HMAC-SHA256 uses a copied distinct 32-byte fingerprint key and separate domain prefix, so encryption-key rotation/random nonces do not break replay comparison. Old envelopes can be opened only with retained key IDs. Map/key caller mutation cannot alter the cipher. The primitive neither loads secrets nor provides key recovery, secure erasure, retention or fingerprint-key rotation migration; those remain integration/operating requirements.
- The candidate contains a private raw locator and `open` returns it to trusted server code by design. No application projection, API or audit path was added. Future wiring must keep those values out of JSON/API/logs/errors and encrypt them before persistence. A syntactically accepted IP, Unicode hostname or private address here is not a downloader allowlist; the separately reviewed downloader must reject inadmissible destinations independently.

## Executed evidence and remaining gates

Independently ran `node --import tsx --test --test-isolation=none tests/transport/inbound-media.test.ts tests/transport/locator-cipher.test.ts`: **6 tests, 6 passed, 0 failed**. This covers actual constructor-shaped parsing, rejection/mutation checks, random envelopes, AAD/key/tag/ciphertext tamper, canonical encoding, rotation/copied keys, stable fingerprints and safe failures. No network API or real account operation was invoked.

Durable receipt/jobs, atomic replay/conflict behavior, owned ingress integration, approved-host/public-IP-pinned HTTPS, private materialization, key recovery/retention, PostgreSQL/HTTP/queue/restart/restore and live schema/domain/phone compatibility remain **UNPROVEN by this review**. Preserve default-deny activation and require approved dedicated-account observations before accepting any live media contract or host.
