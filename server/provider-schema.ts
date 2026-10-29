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
`;
