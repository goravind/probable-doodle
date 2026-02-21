# Pillar 6: Agents & Agent Skills (First-Class Constructs)

**Goal:** Agents and agent skills are first-class constructs in the product and codebase — not afterthoughts. They are designed, versioned, tested, and released like other software components.

---

## Principles

- **Skills as units of capability** — each skill is a reusable, composable unit (e.g. “lookup contact”, “create deal”, “send email template”).
- **Agents compose skills** — agents are defined by which skills they use and how they are orchestrated ([07-orchestration.md](./07-orchestration.md)).
- **Same lifecycle as code** — skills and agents live in repo, go through CI/CD ([05-release-and-cicd.md](./05-release-and-cicd.md)), and are tied to product capabilities and tickets.
- **COGS per skill and agent** — Each skill and agent has an estimated COGS (e.g. API cost, model tokens, external calls). Skill/agent schema and runtime support COGS so the COGS dashboard ([01-technology.md](./01-technology.md)) can report by feature, capability, and agent.

---

## Scope

- **Skill definition** — name, input/output schema, implementation (e.g. function, API, GenAI prompt), idempotency, safety, **estimated COGS**.
- **Agent definition** — list of skills, routing/orchestration rules, guardrails, **aggregate/estimated COGS**.
- **Storage** — skills and agents as code (YAML/JSON + implementation) or in a registry; versioned and auditable.

---

## Details to Add (your input)

*Add below: skill/agent schema, runtime (e.g. in-house, Cursor/Codex, vendor agent platform), and how they map to product capabilities and tickets.*

- [ ] **Skill schema and examples:** _TBD_
- [ ] **Agent schema and examples:** _TBD_
- [ ] **Runtime / execution environment:** _TBD_
- [ ] **Mapping: product capability → skills/agents:** _TBD_
- [ ] **Testing and safety (e.g. PII, approvals):** _TBD_
- [ ] **COGS fields in skill/agent schema and runtime reporting:** _TBD_

---

## Dependencies

- Feeds: [07-orchestration.md](./07-orchestration.md) (orchestration of skills for customer features), [08-genai-pipeline.md](./08-genai-pipeline.md) (codegen can emit skill/agent stubs).
- Constrained by: [01-technology.md](./01-technology.md), [04-human-in-the-loop.md](./04-human-in-the-loop.md) (architecture/stack approval).
