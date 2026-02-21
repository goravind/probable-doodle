# Building the Product Factory — Implementation Plan

**Purpose:** How to materialize the Product Factory *software itself* — the internal app (dashboard, pipeline, connectors, config) that your team uses to run the idea→spec→build→release flow. This doc is about building *the factory*, not the customer-facing app (CRM, etc.) that the factory produces.

---

## What You Are Building

The Product Factory is an **internal application** with these parts:

| Component | Responsibility |
|-----------|-----------------|
| **UI** | Login, product select, pipeline (Kanban), leadership view, capability context panel, product configuration, “How we build” and lifecycle views. |
| **API / Backend** | Product and capability metadata, pipeline state (or derivation from connectors), config CRUD, auth, optional webhooks. |
| **Connectors** | Read/write to **ticketing** (JIRA, GitHub Issues, Linear), **repos** (Git: specs, arch, app), **messaging** (Slack). Configurable per product; see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md) product configuration. |
| **Config store** | Per-product and org-wide config: ticketing URLs/auth, repo paths, codebase context, meeting pipeline, messaging, cycle time, compliance. |
| **Pipeline runner (optional)** | Orchestrator that triggers “Build” (load context → spec→YAML → GenAI → PR). Can be a separate service or GitHub Actions / CI job that the factory triggers and then polls. |
| **COGS aggregation** | Ingest cost data (e.g. from GenAI pipeline runs, CI) and feed the COGS dashboard in the leadership view. |

**Separation:** The *customer-facing app* (e.g. CRM) lives in **another repo**. The Product Factory repo contains only the factory app (and optionally pipeline scripts or actions that *run against* the app repo).

---

## Recommended Phasing

| Phase | Goal | Delivered |
|-------|------|-----------|
| **1 — MVP** | Visible pipeline and one source of truth. | UI (dashboard, pipeline Kanban, product config screen), backend that **reads** from one ticketing system (e.g. GitHub Issues) and optional Git (specs/arch paths). Pipeline state **derived** from tickets + config; no write-back yet. Manual “context bundle” (links to ticket, spec, Slack) from config. |
| **2 — Connectors** | Factory drives tickets and stays in sync. | **Connectors** that create/update issues and link them to capability IDs. Product config persisted; optional Slack channel creation/linking. Leadership view shows live data from connectors. |
| **3 — Automation** | Build trigger and quality visibility. | **Build readiness** check; trigger for “Software creation” (e.g. webhook or button → pipeline job). Ingest **test/build results** from CI (e.g. GitHub Actions) and show in capability card. Optional: meeting pipeline (transcribe → summarize → tag by capability). |
| **4 — GenAI pipeline** | Spec → code in minutes. | **Pipeline runner** that loads context, runs spec→YAML, calls GenAI, opens PR in app repo. COGS per run recorded and shown in dashboard. Full “How we build the software” flow implemented. |

You can ship Phase 1 and use it with manual ticket creation and manual builds; then add connectors and automation without changing the UI contract.

---

## Build Order (Concrete)

1. **Lock stack** ([01-technology.md](./01-technology.md))  
   Choose: frontend (e.g. React, Vue), backend (Node, Go, Python, etc.), DB (e.g. Postgres for config + pipeline cache), auth (OAuth/SSO or API keys). Decide where the app runs (cloud + local parity per blueprint).

2. **Scaffold and auth**  
   New repo (or this repo) with app scaffold: login → product select → dashboard shell. Auth: at least “who is logged in” and “which product”; optional SSO. No pipeline data yet.

3. **Product configuration**  
   Config model and API: products, and per-product ticketing (URL, project, auth), repos (app, specs, arch paths), codebase context, messaging, cycle time, compliance. Persist in DB; serve to UI. Product config screen in UI (already mocked).

4. **Pipeline state from tickets**  
   Connector that **reads** from one ticketing system (e.g. GitHub Issues) using product config. Map issues to capability IDs (e.g. label `capability:PROJ-123` or project+number in title). Derive pipeline stages from issue state or labels. API: “list capabilities for product,” “get context bundle for capability.” Dashboard Kanban and context panel consume this API.

5. **Leadership view and context panel**  
   Aggregate: active count, blocked, conflicts, “calls to take,” longest in stage. Context panel: Open in GitHub/Jira/Slack/Git (links from config + ticket). Optional: inject context into ticket (e.g. bot comment with spec/arch links).

6. **Connectors that write**  
   On “move stage” or “create capability,” create or update issues in JIRA/GitHub/Linear; create Slack channel if configured. Keep capability ID as spine; store doc path + approved version on ticket when applicable.

7. **Build trigger and test ingestion**  
   “Start build” (or trigger on compliance sign-off) → call pipeline runner or enqueue job. Pipeline runner (or CI) loads context, runs GenAI, opens PR. Webhook or poll from CI → update “tests pass/fail, coverage” and “build: green” in factory DB → show on capability card.

8. **COGS**  
   Pipeline runner (or GenAI layer) reports cost per run; store by capability. COGS dashboard in leadership view: by capability, product, time range.

9. **GenAI pipeline in full**  
   Implement [08-genai-pipeline.md](./08-genai-pipeline.md): spec→tech capabilities (YAML), codegen, PR creation, optional test-case generation. All wired to product config (app repo, codebase context).

---

## Where Decisions Live

| Decision | Document |
|----------|----------|
| Core stack (lang, framework, DB, infra) | [01-technology.md](./01-technology.md) |
| Approval gates and who approves | [04-human-in-the-loop.md](./04-human-in-the-loop.md) |
| Ticket schema and connector mapping | [03-ticket-automation.md](./03-ticket-automation.md) |
| Spec format and capability schema | [02-product-to-technology.md](./02-product-to-technology.md) |
| GenAI provider, pipeline runner, “minutes” SLA | [08-genai-pipeline.md](./08-genai-pipeline.md) |
| CI/CD platform and release approval | [05-release-and-cicd.md](./05-release-and-cicd.md) |
| Product Factory app phasing and build order | This doc (IMPLEMENTATION.md) |

---

## Local Parity and Deployment

Per [01-technology.md](./01-technology.md):

- **Environments:** Local, stage, prod. Local should support offline development where possible.
- **Deploy to prod:** Only people with explicit permissions.
- **Observability:** Logging and metrics; start with something that works on a laptop (e.g. local logs, minimal external deps).

So: the Product Factory app should run locally (e.g. `docker compose` or local backend + frontend dev server), with config pointing at local or sandbox ticketing/repos if needed. Stage and prod use same code path with different config and auth.

---

## Summary

- **What:** Product Factory = UI + API + config store + connectors (ticketing, Git, Slack) + optional pipeline runner + COGS aggregation.
- **How:** Phase 1 = read-only pipeline from tickets + config; Phase 2 = connectors write; Phase 3 = build trigger + test ingestion; Phase 4 = full GenAI pipeline.
- **Build order:** Lock stack → scaffold + auth → product config → pipeline state from tickets → leadership + context panel → connectors write → build trigger + test ingestion → COGS → full GenAI pipeline.
- **Where:** Factory in its own repo (or this repo); customer-facing app in separate repo(s). Fill “Details to add” in pillar docs as you make choices; use this doc as the implementation checklist for the factory itself.
