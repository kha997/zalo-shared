# API contract v1

Same origin React SPA + Fastify API. JSON envelopes: successful single resource direct object, lists `{items:[...]}`; errors `{error:{code,message}}`. camelCase ISO dates. All `/api` except login require opaque session cookie `zs_session`. Mutation requires `X-CSRF-Token` from login/me response plus same-origin validation. No hardcoded staff count. PostgreSQL UUID resource IDs.

## Auth / staff
- POST `/api/auth/login` `{email,password}` -> `{user,csrfToken}` + cookie; generic 401 invalid.
- GET `/api/auth/me` -> `{user,csrfToken}`. POST `/api/auth/logout` -> `{ok:true}`.
- User `{id,name,email,role:'admin'|'supervisor'|'agent',active:boolean}`.
- GET `/api/users` -> `{items:User[]}` (authenticated for assignment display; email/active acceptable same workspace).
- POST `/api/users` `{name,email,password,role}` -> User, admin only.
- PATCH `/api/users/:id` `{role?,active?,name?}` -> User, admin only; prevent last-admin disable/demotion.

## Inbox
- GET `/api/conversations?search=&status=open|resolved&assignedTo=me|unassigned|<uuid>&limit=50&before=<uuid>` -> `{items:Conversation[],nextCursor:string|null}`. Default page50/max200; keyset ordered updatedAt/id descending, cursor account-scoped. Older loaded UI pages are snapshots until explicit refresh.
- Conversation `{id,contactName,contactId,status:'open'|'resolved',assigneeId:null|string,version:number,unreadCount:number,lastMessage:string,updatedAt:string}`.
- GET `/api/conversations/:id/messages` -> `{items:Message[]}` in chronological order (bounded pagination via optional `before` and `limit` supported/documented).
- PATCH `/api/conversations/:id` `{expectedVersion:number,assigneeId?:string|null,status?:'open'|'resolved'}` -> Conversation; version conflict 409; agent can claim unassigned/self, cannot steal another agent's conversation, supervisor/admin may reassign.
- POST `/api/conversations/:id/read` -> `{ok:true}`; per-user read cursor preferred; if shared unread document limitation.
- POST `/api/conversations/:id/messages` header `Idempotency-Key` required `{text:string,attachmentIds?:string[]}` -> Message; agent must be assigned, 403 otherwise. Reusing key with different payload returns 409; identical retry returns same message.
- Message `{id,conversationId,direction:'inbound'|'outbound',text,actorId:null|string,status:'received'|'pending'|'processing'|'sent'|'failed'|'unknown',providerId:null|string,createdAt,attachments:Attachment[]}`.
- Attachment `{id,name,mime,size,url}` with url an authenticated relative download endpoint.
- POST `/api/attachments` JSON `{name,mime,dataBase64}` -> Attachment; 5MiB max, safe file types PNG/JPEG/PDF/plain text; server verifies magic where relevant; no SVG/HTML, no arbitrary fetch URLs. Bound total HTTP body and max 5 attachments per message.
- GET `/api/attachments/:id` authenticated private bytes.

## Operations
- GET `/api/provider` -> `{mode:'mock'|'disabled',status:'connected'|'disconnected'|'expired',lastEventAt:null|string}`; safe staff view.
- POST `/api/provider/mock/state` `{status:'connected'|'disconnected'|'expired'}` admin-only, mock enabled only.
- POST `/api/provider/mock/inbound` `{contactId,contactName,providerId,text}` admin-only -> `{ok:true,duplicate:boolean}`.
- GET `/api/audit?limit=100` -> `{items:[{id,actorId,actorName,action,targetId,metadata,createdAt}]}` admin/supervisor.
- GET `/health/live` process only; GET `/health/ready` DB ready (no sensitive details), GET `/metrics` protected bearer `METRICS_TOKEN` (not session), exposes counts/latency/queue health without personal labels.

## Implementation module contracts

`server/app.ts` exports async `buildApp({pool,config})`, returns Fastify instance; config shape defined and exported in server/config.ts. `server/db.ts` exports `createPool(databaseUrl)`, `migrate(pool)`, `seed(pool,{adminEmail,adminPassword,adminName?,demo?:boolean})`. `server/worker.ts` exports `runWorkerOnce(pool,provider)` and worker CLI starts only when entrypoint. Provider mock state persisted in DB; simulator delivery ledger persisted. Server CLI `server/main.ts`; seed CLI `server/seed.ts`; migration CLI `server/migrate.ts`. All scripts via tsx. UI `client/` with Vite root client, build output `dist/client`; API serves dist when exists. Root controls package.json/tsconfig/vite config/dependencies. Backend implementer owns server/ and tests/backend/ only; UI owns client/ only; QA owns tests/e2e/, tests/load/, playwright.config.ts only; Ops owns ops/, docs/operations/, .github/ only. Root coordinates interfaces and shared files. No worker/test resets in server prod.
