# PDF to MXL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved v2 PDF score to MXL web app design as a staged Next.js, worker, Docker, and eval scaffold.

**Architecture:** Next.js App Router handles upload/job APIs and the client UI. A BullMQ worker owns the long-running PDF pipeline: detect, preprocess, Audiveris, render, crop, vision, apply, validate, repack, and eval. Core worker modules are testable without external Audiveris, Supabase, or Claude credentials.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase Storage/Postgres, BullMQ/Redis, Audiveris CLI in Docker, poppler, sharp, fast-xml-parser, Anthropic SDK, OSMD, Vitest.

---

### Task 1: Project Foundation

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `shared/types.ts`

- [ ] Install pinned dependencies.
- [ ] Define shared job, stage, report, and correction types.
- [ ] Run the initial tests to confirm missing implementation failures.

### Task 2: Worker Core

**Files:**
- Create: `worker/src/audiveris.ts`, `worker/src/pdfKind.ts`, `worker/src/preprocess.ts`
- Create: `worker/src/render.ts`, `worker/src/musicxml.ts`, `worker/src/systems.ts`
- Create tests under `worker/src/*.test.ts`

- [ ] Implement subprocess-safe Audiveris wrapper and output collection.
- [ ] Implement poppler-based PDF kind detection and conservative preprocessing.
- [ ] Implement render, MXL unzip, MusicXML parse, page mapping, and system slicing.
- [ ] Run `npm test` for worker core.

### Task 3: Vision and Correction

**Files:**
- Create: `worker/src/vision.ts`, `worker/src/prompts/verify-system.ts`
- Create: `worker/src/apply.ts`, `worker/src/adapt.ts`, `worker/src/sanity.ts`, `worker/src/validate.ts`, `worker/src/mxl.ts`
- Create: `worker/src/score.ts`, `worker/src/oscillation.ts`, `worker/src/refine.ts`

- [ ] Implement strict tool-use response parsing with injectable Anthropic client for tests.
- [ ] Implement REPORT and cautious AUTO_PATCH behavior with validation rollback.
- [ ] Implement scoring, oscillation tracking, and refine-loop stop reasons.
- [ ] Run mocked tests without real Claude calls.

### Task 4: API and Queue

**Files:**
- Create: `lib/supabase/server.ts`, `lib/server/env.ts`
- Create: `app/api/uploads/route.ts`, `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts`
- Create: `worker/src/queue.ts`, `worker/src/pipeline.ts`

- [ ] Add lazy Supabase, Redis, and queue clients.
- [ ] Keep server secrets out of client code.
- [ ] Make route handlers metadata-only; uploads use signed URLs.

### Task 5: Frontend

**Files:**
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `app/jobs/[id]/page.tsx`
- Create: `components/Uploader.tsx`, `components/ProgressSteps.tsx`, `components/ScorePreview.tsx`, `components/ScorePreviewInner.tsx`, `components/DiffReport.tsx`, `components/AccuracyBadge.tsx`

- [ ] Build a usable first screen, not a landing-only page.
- [ ] Implement polling without browser storage.
- [ ] Load OSMD only on the client with `ssr:false`.

### Task 6: Docker, Supabase, Eval, Verification

**Files:**
- Create: `docker/Dockerfile.audiveris`, `docker/run-audiveris.sh`, `docker/README.md`
- Create: `docker-compose.yml`, `supabase/migrations/0001_jobs.sql`
- Create: `eval/run.ts`, `eval/README.md`, `eval/baseline.json`

- [ ] Add reproducible service wiring.
- [ ] Add Supabase schema with RLS enabled.
- [ ] Run tests, type/build checks, and a dev-server smoke test.
