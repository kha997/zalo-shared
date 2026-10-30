/** Kept independent of adapters and store to avoid migration import cycles. */
export const providerSchema = `
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_thread_type integer CHECK(provider_thread_type IN (0,1));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_thread_id text;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_provider_thread ON conversations(account_id,provider_thread_type,provider_thread_id);
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS reconciliation_required boolean NOT NULL DEFAULT false;
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS fault_code text;
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS gap_version bigint NOT NULL DEFAULT 0 CHECK(gap_version>=0);
CREATE TABLE IF NOT EXISTS provider_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
 thread_type integer NOT NULL CHECK(thread_type IN (0,1)), thread_id varchar(200) NOT NULL,
 direction text NOT NULL CHECK(direction IN ('inbound','outbound')), provider_id varchar(200) NOT NULL,
 sender_id varchar(200) NOT NULL, client_id varchar(200), provider_timestamp varchar(64),
 kind text NOT NULL CHECK(kind IN ('text','unsupported')), text text CHECK(length(text)<=10000),
 semantic_hash char(64) NOT NULL, state text NOT NULL CHECK(state IN ('linked','held','conflict')),
 message_id uuid REFERENCES messages, conflict boolean NOT NULL DEFAULT false,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,thread_type,thread_id,direction,provider_id)
);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS media_descriptor jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(media_descriptor)='array' AND jsonb_array_length(media_descriptor)<=5);
CREATE INDEX IF NOT EXISTS provider_events_held ON provider_events(conversation_id,state);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS resolution_version bigint NOT NULL DEFAULT 0 CHECK(resolution_version>=0);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users;
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS resolution_ref varchar(256);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS variant_overflow boolean NOT NULL DEFAULT false;
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS overflow_receipts bigint NOT NULL DEFAULT 0 CHECK(overflow_receipts>=0);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS last_overflow_hash char(64);
ALTER TABLE provider_events ADD COLUMN IF NOT EXISTS variant_evidence_missing boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS provider_event_variants(
 event_id uuid NOT NULL REFERENCES provider_events ON DELETE CASCADE,semantic_hash char(64) NOT NULL,
 sender_id varchar(200) NOT NULL,kind text NOT NULL CHECK(kind IN ('text','unsupported')),
 text text CHECK(length(text)<=10000),client_id varchar(200),provider_timestamp varchar(64),
 received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,semantic_hash)
);
ALTER TABLE provider_event_variants ADD COLUMN IF NOT EXISTS media_descriptor jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(media_descriptor)='array' AND jsonb_array_length(media_descriptor)<=5);
CREATE TABLE IF NOT EXISTS provider_media_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,event_id uuid NOT NULL REFERENCES provider_events ON DELETE CASCADE,
 item_index integer NOT NULL CHECK(item_index BETWEEN 0 AND 4),category text NOT NULL CHECK(category IN ('photo','file')),
 name varchar(200) NOT NULL,locator_fingerprint char(64) NOT NULL CHECK(locator_fingerprint ~ '^[a-f0-9]{64}$'),
 locator_envelope jsonb CHECK(locator_envelope IS NULL OR (jsonb_typeof(locator_envelope)='object' AND octet_length(locator_envelope::text)<=16384)),
 status text NOT NULL CHECK(status IN ('held','pending','processing','ready','unavailable')),
 message_id uuid REFERENCES messages ON DELETE CASCADE,attachment_id uuid REFERENCES attachments,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 error_code varchar(64),created_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,item_index),CHECK(status<>'ready' OR (attachment_id IS NOT NULL AND locator_envelope IS NULL))
);
CREATE INDEX IF NOT EXISTS provider_media_jobs_pending ON provider_media_jobs(account_id,status,next_attempt_at);
-- Older conflicts discarded their variants. Never imply that a later replay recovered all evidence.
UPDATE provider_events e SET variant_evidence_missing=true WHERE conflict AND resolution_version=0
 AND NOT EXISTS(SELECT 1 FROM provider_event_variants v WHERE v.event_id=e.id);
CREATE TABLE IF NOT EXISTS connector_ownership(
 account_id uuid PRIMARY KEY, epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0),
 phase text NOT NULL DEFAULT 'idle' CHECK(phase IN ('idle','reserved','active','uncertain')),
 owner_id uuid, owner_label varchar(128), reserved_at timestamptz, heartbeat_at timestamptz,
 uncertain_at timestamptz, fault_code varchar(64),
 last_fenced_owner_id uuid, last_fenced_epoch bigint, last_fenced_at timestamptz,
 CHECK((phase='idle')=(owner_id IS NULL))
);
INSERT INTO connector_ownership(account_id) SELECT account_id FROM provider_state ON CONFLICT DO NOTHING;
`;
