/** Kept independent of adapters and store to avoid migration import cycles. */
export const providerSchema = `
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_thread_type integer CHECK(provider_thread_type IN (0,1));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_thread_id text;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_provider_thread ON conversations(account_id,provider_thread_type,provider_thread_id);
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS reconciliation_required boolean NOT NULL DEFAULT false;
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS fault_code text;
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
CREATE INDEX IF NOT EXISTS provider_events_held ON provider_events(conversation_id,state);
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
