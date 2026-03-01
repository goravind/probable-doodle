# Probable Doodle — GenAI-Native Product Blueprint + MVP App

This repository is a **generic blueprint** for building a next-generation, GenAI-driven organization that can ship **any application** — with high efficiency and automation as core goals. It defines how product specs become technology, tickets, approvals, agents, and shipped software. **CRM is one application** you can build; the same blueprint applies to other products (internal tools, marketplaces, vertical apps, etc.).

It now also includes a runnable **Probable Toodle MVP** codebase (frontend + backend + monitoring + local deployment) so you can test Product Factory concepts end-to-end locally.

---

## Run The MVP

### Prerequisites
- Node.js 18+
- Docker (optional, for containerized local deploy)

### Local dev (no containers)

```bash
npm run dev
```

Open:
- App UI: `http://localhost:8080`
- Health: `http://localhost:8080/api/v1/health`
- Prometheus metrics: `http://localhost:8080/metrics`

### Run tests

```bash
npm test
```

### Local deploy with monitoring

```bash
docker compose up --build
```

### One-command runner (guided)

```bash
./scripts/run-local.sh dev
./scripts/run-local.sh test
./scripts/run-local.sh docker
```

Open:
- App UI: `http://localhost:8080`
- Prometheus: `http://localhost:9090`

### GitHub auth per customer/org (real PRs)

Use tenant-scoped GitHub authorization via GitHub App (recommended), or fallback to one global token.

Set env vars (for Docker, in `.env` or shell):

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-github-app-slug
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_STATE_SECRET=replace-me
# Optional LLM-generated specs:
OPENAI_API_KEY=sk-...   # or OPEN_API_KEY
OPENAI_MODEL=gpt-4.1-mini
```

Optional fallback:

```bash
GITHUB_TOKEN=ghp_...
# Set to 0 to require real GitHub branch/PR operations.
FACTORY_LOCAL_PR_ONLY=0
```

Flow:
1. Open `http://localhost:8080/factory-config.html`
2. Click **Connect GitHub Org** (per organization)
3. Finish GitHub App installation
4. Return to app; PR sync uses org installation token.

If PR creation fails in Idea Builder, the UI now shows an actionable error with:
- exact reason text
- correlation ID
- **Reconnect GitHub** and **Retry** actions
- and enforced GitHub PR mode from Idea screen (`enforceGithubPr=true`) to prevent silent draft-only success

### AI enrichment local runbook

Idea chat enrichment endpoint:

```bash
curl -H "x-user-id: ava-admin" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/factory/ideas/ai-chat-enrich \
  -d '{"orgId":"acme-health","sandboxId":"production","productId":"crm","ideaId":"IDEA-123","headline":"Semantic Profile","description":"Seed","messages":[{"role":"user","content":"add measurable KPI","images":[]}]}'
```

Behavior:
- returns enriched `draft`
- persists artifact version when `ideaId` is provided
- returns `artifact.version` and `correlationId`

If enrichment fails, Idea Builder now shows:
- `Enrichment failed: <reason> (correlationId=...)`
- **Retry** and **View logs**

Related ideas retrieval endpoint:

```bash
curl -H "x-user-id: ava-admin" \
  "http://localhost:8080/api/ideas/similar?orgId=acme-health&sandboxId=production&productArea=crm&query=semantic%20profile&limit=6"
```

Behavior:
- returns ranked `ideas[]` and optional `duplicateWarning`
- supports fork/provenance in Idea UI (`details.metadata.sourceIdeas`)
- enrichment accepts `relatedIdeasContext` and records usage in `draft.conversationContextUsed`

### Enterprise UI system (Idea Builder)

Idea Builder now uses a reusable UI layer for structured AI output and failure handling:
- `TextBlock`, `IndentedList`, `Card`, `ExpandableSection`, `ErrorBanner`, `SuccessBanner`, `LoadingSkeleton`
- tokenized typography and spacing for consistent headings/body/meta text
- `View Full Idea` drawer with tabs:
  - Overview
  - Scope & Non-Goals
  - Personas
  - Architecture
  - Acceptance Criteria
  - Audit Trail
- loading skeletons for enrichment + PR creation, and actionable retry banners
- scroll-safe containers for long AI output to prevent overflow

### Regression verification (automated)

Regression tests that reproduce and guard the production-critical issues:

```bash
npm test
```

Key coverage:
- enrichment persistence: `apps/backend/test/api.test.js` (`ai chat enrichment persists idea artifact and increments version`)
- PR failure surfacing: `apps/backend/test/api.test.js` (`idea creation returns actionable PR failure payload when GitHub sync fails`)
- UI artifact summary/version model: `apps/frontend/test/idea-view-model.test.js`
- UI component rendering for banners/skeletons/structured blocks: `apps/frontend/test/ui-components.test.js`

---

## MVP Code Structure

```text
apps/backend/src/      # HTTP API + persona/org/product endpoints + /metrics
apps/backend/test/     # Backend integration tests (node:test)
apps/frontend/         # Static SPA served by backend
monitoring/            # Prometheus scrape config
Dockerfile             # Container image for app
docker-compose.yml     # App + Prometheus local stack
```

## Agent-Native Capability Model (MVP)

The backend now includes first-pass support for:
- **Agent registry** (`/api/v1/agents`)
- **Capability composition by agents** (`/api/v1/capabilities/:id/agents`)
- **Capability state management + event history**
  - `GET /api/v1/capabilities/:id/state`
  - `POST /api/v1/capabilities/:id/state`
- **Semantic search across capabilities**
  - `GET /api/v1/semantic/search?q=...&limit=...`

This establishes the pattern you requested: Product Factory itself can be built as agent-composed capabilities with explicit semantic context and state transitions.

## Capability Build Flow (Idea -> PR)

New factory pipeline endpoints (CI/CD intentionally excluded for now):

- `POST /api/v1/factory/ideas`
  - By default this now auto-runs `idea -> triage PR` (raw + AI enrichment commits).
  - After triage PR approval webhook, backend auto-runs `spec -> spec PR sync`.
  - Set `"autoPipeline": false` in request body to disable.
- `POST /api/v1/factory/ideas/:ideaId/triage`
- `POST /api/v1/factory/capabilities/:capabilityId/spec`
- `POST /api/v1/factory/capabilities/:capabilityId/approve-spec`
- `POST /api/v1/factory/capabilities/:capabilityId/architecture`
- `POST /api/v1/factory/capabilities/:capabilityId/approve-architecture`
- `POST /api/v1/factory/capabilities/:capabilityId/compliance`
- `POST /api/v1/factory/capabilities/:capabilityId/build-to-pr`
- `GET /api/v1/factory/capabilities/:capabilityId`
- One-shot execution:
  - `POST /api/v1/factory/ideas/:ideaId/run-to-pr`

Example (organization admin):

```bash
curl -H "x-user-id: ava-admin" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/factory/ideas \
  -d '{"orgId":"acme-health","sandboxId":"production","productId":"crm","title":"Hello World capability","description":"Simple flow"}'
```

---

## What This Repo Is

- **Single source of truth** for the eight pillars of the org and product (see below).
- **Place to add details** for product spec format, engineering practices, tooling (JIRA/Git, CI/CD, vendors), and GenAI pipeline.
- **Foundation for automation** — ticket schemas, approval workflows, and pipeline configs should be derivable from the blueprint (and eventually from GenAI).
- **[Product Factory](./docs/blueprint/PRODUCT-FACTORY.md)** — the *software for creating software*: pipeline from ideas → spec → approvals → architecture → build → CI/CD → UAT → prod; all ticket-tracked with senior leadership visibility.

---

## The Eight Pillars

| # | Pillar | Purpose |
|---|--------|--------|
| 1 | [Technology](./docs/blueprint/01-technology.md) | Stack, principles, high-efficiency development |
| 2 | [Product → Technology](./docs/blueprint/02-product-to-technology.md) | Product spec → tech capabilities via GenAI |
| 3 | [Ticket Automation](./docs/blueprint/03-ticket-automation.md) | Spec → JIRA/Git + product/release/press/marketing tickets |
| 4 | [Human-in-the-Loop](./docs/blueprint/04-human-in-the-loop.md) | Approvals: product spec, architecture, stack, release |
| 5 | [Release & CI/CD](./docs/blueprint/05-release-and-cicd.md) | Coordinated releases, CI/CD mandatory |
| 6 | [Agents & Skills](./docs/blueprint/06-agents-and-skills.md) | Agents and skills as first-class constructs |
| 7 | [Orchestration](./docs/blueprint/07-orchestration.md) | Orchestrating agent skills for customer-facing features |
| 8 | [GenAI Pipeline](./docs/blueprint/08-genai-pipeline.md) | UI + backend from approved spec; features in minutes |

**Start here:** [Blueprint Index](./docs/blueprint/INDEX.md) — flow diagram, links, and how the pillars connect.
For implementation wiring from spec to enterprise operations, see: [Spec to Operations Contract](./docs/blueprint/SPEC-TO-OPERATIONS-CONTRACT.md).
System control-plane details are in: [System Backbone](./docs/blueprint/SYSTEM-BACKBONE.md).

### API identity header (role-scoped behavior)

Most control-plane endpoints use `x-user-id` for role scope:
- `platform-root` (`platform_admin`)
- `ava-admin` (`organization_admin`)
- `nina-user` (`enterprise_user`)

Example:
```bash
curl -H "x-user-id: ava-admin" http://localhost:8080/api/v1/organizations/acme-health/members
```

---

## Next Steps

1. **Add details** in each pillar doc (sections marked “Details to add”).
2. **Choose tooling** — JIRA vs GitHub Issues vs Linear; CI/CD platform; approval app; vendor vs built-in for ticket/campaign/press.
3. **Define schemas** — product spec format, capability schema, ticket types, skill/agent schema.
4. **Implement in order** — Technology → Approvals → Product→Tech + Ticket automation → GenAI pipeline → Agents & orchestration → CI/CD.

---

## Repo Structure (suggested as you grow)

```
docs/blueprint/     # This blueprint (pillars 1–8)
apps/               # Runnable MVP app (frontend + backend)
monitoring/         # Monitoring config (Prometheus)
product-specs/      # Approved product specs (input to GenAI)
scripts/            # Automation (e.g. spec→tickets, pipeline triggers)
agents/             # Agent and skill definitions (when you add them)
.cursor/            # Cursor rules for GenAI-assisted development
```

You can add `engineering/`, `marketing/`, `release/` etc. as needed; keep the blueprint in `docs/blueprint/` as the canonical reference.
