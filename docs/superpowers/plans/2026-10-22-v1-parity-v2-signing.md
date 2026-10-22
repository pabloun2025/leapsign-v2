# LeapSign v1 Parity on v2 Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete v1 coordination experience on the private v2 document, signing, validation, email, and audit foundation, with local P12/PFX signing as an additional option to external signing.

**Architecture:** Keep the existing `signing_v2` document/version/stage/intent core authoritative. Add isolated parity tables and server modules for contacts, open queues, lifecycle controls, final shares, arcade, and administration; expose them only through the v2 Worker. Split the current UI into focused screens that reuse the original visual identity while both signing paths converge on the existing v2 submission pipeline.

**Tech Stack:** TypeScript, React, Cloudflare Workers, Supabase Postgres/Auth/Storage, Resend, Python validator, Vitest, PostgreSQL migration tests.

**Spec:** `docs/superpowers/specs/2026-10-22-v1-parity-v2-signing-design.md`

## Global Constraints

- Modify and deploy only LeapSign v2 resources; never touch `firmador`, `firma.veryfacil.org`, or the v1 Supabase project.
- Never migrate v1 users, documents, contacts, records, or configuration.
- Keep P12/PFX and password exclusively in the browser.
- Local and external signing must use the same authenticated v2 validation, CAS persistence, and receipt path.
- Keep Storage private, RLS enabled, internal RPC unavailable to `anon` and `authenticated`, and economic guards on billable operations.
- Preserve the strict BCE production policy and fail closed for unknown revocation.
- Add no simulated control: every visible action must have a tested server contract.

## Review Focus

- Simultaneous queue claims must yield exactly one active lease and stable positions; Task 3 tests concurrent claims and expiration promotion.
- Rollback while an invitation or intent is active must invalidate stale work without deleting audit evidence; Task 4 tests stale intent rejection.
- Duplicate contact emails and Unicode/case variants must not create duplicate invitations; Task 2 tests normalization and capacity.
- Arcade replay, impossible timing, and concurrent podium writes must be rejected or serialized; Task 6 tests all three.
- Final-share tokens must fail after rollback, purge, replacement, or expiry and must never expose participant metadata; Task 5 tests those states.

---

### Task 1: Parity schema and private contracts

**Files:**
- Create: `v2/migrations/008_v1_parity.sql`
- Create: `tests/v2-parity-migration.test.ts`
- Create: `scripts/test-v2-parity-db.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables `process_access`, `queue_entries`, `turn_leases`, `owner_contacts`, `process_incidents`, `final_shares`, `arcade_runs`, `arcade_records`, `email_templates`, `lifecycle_jobs`, `admin_roles`, `admin_settings`, and `admin_audit` in `signing_v2`.
- Produces service-role-only RPC for contact mutation, queue claim/release/promotion, process action, final-share capability, arcade start/finish, and lifecycle claiming.

- [ ] Write static migration tests for table/RLS/grant invariants and a PostgreSQL integration test for owner isolation and RPC denial.
- [ ] Run the new tests and verify they fail because migration 008 is absent.
- [ ] Implement migration 008 with checks, indexes, foreign keys, RLS, revoked defaults, and atomic RPC.
- [ ] Run migration tests and database concurrency tests until they pass.
- [ ] Commit schema and tests.

### Task 2: Contacts, invitations, and process creation

**Files:**
- Create: `server/v2/contacts-api.ts`
- Create: `server/v2/contacts-domain.ts`
- Modify: `server/v2/process-api.ts`
- Modify: `server/v2/supabase-repository.ts`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-contacts-api.test.ts`
- Modify: `tests/v2-process-api.test.ts`

**Interfaces:**
- Produces `normalizeContactEmail(value:string):string` and `validateContactDrafts(drafts, capacity)`.
- Produces authenticated `/api/v2/contacts` CRUD and participant creation under `/api/v2/processes/:id/participants`.
- Extends process creation with `mode:'directed'|'open_queue'`, expected signatures, optional message, and optional access secret.

- [ ] Write failing tests for normalization, duplicates, capacity, ownership, CRUD, and process modes.
- [ ] Implement domain validation and repository methods using only private RPC.
- [ ] Implement handlers with origin, body-size, authentication, and economic guards.
- [ ] Run contact and process suites and commit.

### Task 3: Open queue, agenda, and exclusive turn leases

**Files:**
- Create: `server/v2/queue-api.ts`
- Create: `server/v2/queue-domain.ts`
- Modify: `server/v2/supabase-repository.ts`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-queue-api.test.ts`
- Create: `tests/v2-queue-domain.test.ts`

**Interfaces:**
- Produces `/api/v2/rounds/:id/access`, `/queue`, and `/turn`.
- A claimed turn produces a guest actor and active v2 stage consumed by existing preparation/submission handlers.
- Scheduled promotion returns notification jobs for the existing email outbox.

- [ ] Write failing tests for access-secret verification, stable positions, duplicate joins, concurrent claims, lease expiry, release, pause, and promotion.
- [ ] Implement the queue domain state machine and repository RPC calls.
- [ ] Implement authenticated/guest handlers and scheduled promotion.
- [ ] Run queue, guest-session, signing preparation, and submission regression tests and commit.

### Task 4: History, incidents, rollback, and lifecycle actions

**Files:**
- Create: `server/v2/process-actions-api.ts`
- Create: `server/v2/lifecycle.ts`
- Modify: `server/v2/supabase-repository.ts`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-process-actions.test.ts`
- Create: `tests/v2-lifecycle.test.ts`

**Interfaces:**
- Produces `/api/v2/processes/:id/actions`, `/versions`, and `/incidents`.
- Actions are `pause`, `resume`, `release_turn`, `rollback`, `cancel`, `complete`, and `purge` with idempotency keys.
- Rollback retains prior rows for audit, changes canonical version atomically, and invalidates stale leases/intents.

- [ ] Write failing authorization, stale-intent, rollback, purge, and retry tests.
- [ ] Implement lifecycle rules and private repository calls.
- [ ] Route actions and scheduled cleanup through the economic guard.
- [ ] Run process, intent, receipt, and lifecycle suites and commit.

### Task 5: Final document sharing

**Files:**
- Create: `server/v2/final-share.ts`
- Create: `server/v2/final-share-api.ts`
- Modify: `server/v2/supabase-repository.ts`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-final-share.test.ts`
- Create: `tests/v2-final-share-api.test.ts`

**Interfaces:**
- Produces owner endpoint `/api/v2/processes/:id/final-share` and recipient endpoint `/api/v2/final/:id`.
- Produces `createFinalShareCapability(secret, documentId, versionId, expiresAt)` and constant-time verification.
- Public responses include only filename, expiry, and a short-lived download URL.

- [ ] Write failing token mutation, expiry, rollback, purge, ownership, quota, and metadata-minimization tests.
- [ ] Implement domain-separated HMAC capabilities stored only as hashes.
- [ ] Implement owner and recipient handlers with no-referrer/no-store responses.
- [ ] Run final-share and process regression tests and commit.

### Task 6: Waiting-room arcade and podium

**Files:**
- Create: `server/v2/arcade-domain.ts`
- Create: `server/v2/arcade-api.ts`
- Create: `v2/preview/ui/QueueArcade.tsx`
- Create: `v2/preview/ui/queue-arcade.css`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-arcade-domain.test.ts`
- Create: `tests/v2-arcade-api.test.ts`
- Create: `tests/v2-arcade-ui.test.tsx`

**Interfaces:**
- Produces `/api/v2/arcade/leaderboard`, `/start`, and `/finish`.
- Server calculates score from a maximum of 1,000 timestamped inputs over at most five minutes.
- Public leaderboard returns at most three `{alias,score,createdAt}` records.

- [ ] Write failing deterministic replay, timing, expiry, alias, consent, quota, concurrency, keyboard, touch, pause, and reduced-motion tests.
- [ ] Implement the deterministic engine and ticket-based API.
- [ ] Implement the isolated accessible React game and podium.
- [ ] Run arcade, queue, and UI tests and commit.

### Task 7: Original visual system and account experience

**Files:**
- Create: `v2/preview/ui/icons.tsx`
- Create: `v2/preview/ui/Brand.tsx`
- Create: `v2/preview/ui/AuthViews.tsx`
- Create: `v2/preview/ui/LegalViews.tsx`
- Create: `v2/preview/ui/design-system.css`
- Modify: `v2/preview/ui/FunctionalApp.tsx`
- Modify: `v2/preview/ui/model.ts`
- Modify: `v2/preview/ui/functional.css`
- Modify: `tests/v2-functional-ui.test.tsx`

**Interfaces:**
- Produces reusable `Brand`, `Footer`, `Icon`, `Notice`, `PasswordInput`, and `DocumentArt` components.
- Produces routes `/privacidad`, `/seguridad`, and `/condiciones`.
- Auth views preserve existing `AuthPort` and session exchange contracts.

- [ ] Write failing UI tests for password rules, confirmation, visibility, legal routes, focus, copy, and responsive landmarks.
- [ ] Implement the original ink/ivory/gold design system using existing local frog assets and Avenir fallback stack.
- [ ] Split account/legal views out of `FunctionalApp.tsx` without changing authentication behavior.
- [ ] Run UI/auth suites and commit.

### Task 8: Owner workspace, agenda, and tracking experience

**Files:**
- Create: `v2/preview/ui/OwnerWorkspace.tsx`
- Create: `v2/preview/ui/ContactAgenda.tsx`
- Create: `v2/preview/ui/TrackingWorkspace.tsx`
- Create: `v2/preview/ui/FinalShareCard.tsx`
- Modify: `v2/preview/ui/functional-client.ts`
- Modify: `v2/preview/ui/FunctionalApp.tsx`
- Modify: `v2/preview/ui/functional.css`
- Create: `tests/v2-owner-workspace.test.tsx`
- Create: `tests/v2-tracking-workspace.test.tsx`

**Interfaces:**
- Extends `FunctionalV2Client` with typed contacts, queue, versions, incidents, actions, and final-share methods.
- Owner creation supports directed/open modes and progresses through create/share/track stages.

- [ ] Write failing tests for both creation modes, contact selection, WhatsApp/copy, process grouping, progress, queue, history, controls, and final sharing.
- [ ] Implement the focused components and client methods.
- [ ] Add serialized visibility-aware refresh that retains prior data on transient errors.
- [ ] Run owner, client, API, and accessibility-focused suites and commit.

### Task 9: Signer dual path and waiting room

**Files:**
- Create: `v2/preview/ui/SignerWorkspace.tsx`
- Create: `v2/preview/ui/WaitingRoom.tsx`
- Modify: `src/v2/SigningPanel.tsx`
- Modify: `src/v2/signing-workflow.ts`
- Modify: `v2/preview/ui/FunctionalApp.tsx`
- Modify: `tests/v2-signing-workflow.test.ts`
- Create: `tests/v2-signer-workspace.test.tsx`

**Interfaces:**
- `SignerWorkspace` offers `local` and `external` methods over one prepared intent.
- External mode downloads canonical bytes and uploads only a signed PDF; local mode continues to use `LocalSigner` and the Web Worker.
- Waiting room consumes queue state and embeds `QueueArcade` without coupling their state.

- [ ] Write failing tests for method selection, canonical download, external upload, local privacy, retry receipt, altered PDF response, queue promotion, and game isolation.
- [ ] Implement both methods against existing prepare/submit contracts.
- [ ] Integrate waiting-room polling and arcade.
- [ ] Run signing, queue, privacy, idempotency, and UI suites and commit.

### Task 10: Administration, operational email, and release

**Files:**
- Create: `v2/preview/ui/AdminWorkspace.tsx`
- Modify: `server/v2/admin-api.ts`
- Modify: `server/v2/email-outbox.ts`
- Modify: `v2/preview/ui/FunctionalApp.tsx`
- Modify: `v2/preview/src/worker.ts`
- Create: `tests/v2-admin-parity.test.ts`
- Modify: `tests/v2-email-outbox.test.ts`
- Modify: `docs/v2/HANDOFF.md`

**Interfaces:**
- Admin API exposes metrics, process actions, communication settings, templates, jobs, and audit with v2 role checks.
- Scheduled handler promotes queues, claims email jobs, refreshes revocation, and processes lifecycle jobs with independent failure boundaries.

- [ ] Write failing tests for admin authorization, safe metrics, template variables, job retry, and scheduler isolation.
- [ ] Implement admin/API/UI and scheduled job orchestration.
- [ ] Apply migration 008 only to Supabase v2 and verify grants/RLS.
- [ ] Run `npm test`, `npm run build`, Python validator tests, SQL integration tests, and browser QA at 1440/768/390.
- [ ] Push commits to `v2-staging`, wait for Render, deploy only `leapsign-v2-ui-preview`, and verify published account, directed, open queue, both signing paths, final share, arcade, administration boundaries, config, health, and ready.
