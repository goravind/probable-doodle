# Pillar 1: Technology

**Goal:** Define the technology foundation for high-efficiency development of the product(s) and the GenAI-native organization. The blueprint is generic (CRM, internal tools, or other applications).

---

## Principles

- **High-efficiency technology development** — minimal friction from idea to shipped feature.
- **Spec-driven** — technology choices support product spec → tech capabilities → implementation (see [02-product-to-technology.md](./02-product-to-technology.md)).
- **Automation-first** — CI/CD, ticket generation, and GenAI pipelines are mandatory, not optional.
- **Agents & skills as first-class** — see [06-agents-and-skills.md](./06-agents-and-skills.md) and [07-orchestration.md](./07-orchestration.md).
- **COGS everywhere** — Every feature and capability has estimated COGS; a COGS dashboard is mandatory. All pillars consider COGS (spec, tickets, approvals, release, agents, orchestration, pipeline).

---

## Scope

- Core software stack (frontend, backend, data, infra).
- Dev tooling (IDE, CLI, codegen, testing).
- Integration points for JIRA/Git, approval systems, and GenAI pipeline.
- COGS (Cost of Goods Sold) per feature/capability and COGS dashboard.

---

## Stack (decided)

- **Multi-surface** — Stack must work across all device surfaces (web, mobile, etc.).
- **Mixed stack OK** — Frontend and backend chosen for value-for-the-buck; no single-language mandate. Specific choices made during implementation and architecture review.
- **Agents** — Each agent is independent in function; software stack is an independent choice per agent. Decisions taken during software implementation and architecture review (see [04-human-in-the-loop.md](./04-human-in-the-loop.md)).
- **Semantics from day one** — Stack is bleeding-edge and understands semantics from day one. UI exists but natural language is a first-class way of doing anything.

### Data

- **Database mix** — Combination of relational, distributed NoSQL, and vector databases. Final choices depend on technology capabilities we build (see [02-product-to-technology.md](./02-product-to-technology.md)).
- **Semantic / vector** — Vector DB and semantic capabilities are in scope from the start.

---

## APIs & contracts (decided)

- **Style** — Combination of REST and GraphQL.
- **Semantic operations** — APIs understand and support semantic operations (e.g. query by intent, natural language).
- **Versioning** — API versioning is mandatory.
- **Compatibility** — Everything must remain backward compatible.

---

## Infrastructure (decided)

- **Cloud** — Public or hosted cloud. Must support replication of the full app on a developer laptop (local parity).
- **Environments** — Local, stage, prod. Local must support offline development (work on laptop without internet).
- **Deploy to prod** — Only people with explicit permissions can deploy to production.
- **Agentic** — Infrastructure and tooling must support agentic behavior (agents as first-class; see [06-agents-and-skills.md](./06-agents-and-skills.md)).
- **Observability** — Logging and observability can start with technology suitable for development on a laptop (e.g. local log aggregation, minimal external deps). Must work offline where possible.

---

## Compliance & cost (decided)

- **Compliance** — To be accounted for in stack and design (audit, data residency, etc.).
- **Tool choice** — Prefer best tool for the job; vendor lock-in acceptable if it delivers value.
- **Cost** — Kept minimal as much as possible.

---

## COGS (Cost of Goods Sold)

- **Per feature/capability** — Every feature or capability must clearly state its estimated COGS (e.g. API calls, model tokens, storage, egress).
- **COGS dashboard** — A COGS dashboard is mandatory. It must surface cost by feature, capability, agent, and/or environment so that cost is visible and manageable.

---

## Details to Add (future)

*TBD until architecture review. To be filled during architecture review / implementation:*

- [ ] **Concrete stack per layer** — Specific frontend/backend languages and frameworks (once chosen).
- [ ] **Exact DB products** — Relational, NoSQL, vector DB choices after capability mapping.
- [ ] **Auth** — Identity provider and API auth (e.g. OAuth, API keys).
- [ ] **Offline strategy** — How local/offline is achieved (e.g. local containers, sync, feature flags).

---

## Dependencies

- Feeds into: [02-product-to-technology.md](./02-product-to-technology.md) (capability schema should include COGS estimate), [05-release-and-cicd.md](./05-release-and-cicd.md), [08-genai-pipeline.md](./08-genai-pipeline.md).
- Constrained by: [04-human-in-the-loop.md](./04-human-in-the-loop.md) (software stack approval).
- COGS dashboard and per-feature COGS will be a product capability; ticket automation and pipeline should account for it.
