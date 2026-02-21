# Pillar 7: Orchestrating Agent Skills for Customer-Facing Features

**Goal:** Customer-facing features use orchestrated agent skills — multi-step flows, routing, and composition — so the product (e.g. CRM or any application you build) delivers intelligent, automated experiences.

---

## Principles

- **Customer-facing first** — orchestration design is driven by user value (e.g. “qualify lead”, “schedule follow-up”, “draft email”).
- **Composable** — reuse skills from [06-agents-and-skills.md](./06-agents-and-skills.md); orchestration defines order, conditions, and fallbacks.
- **Observable and safe** — execution is logged; sensitive actions can require human-in-the-loop ([04-human-in-the-loop.md](./04-human-in-the-loop.md)) or policy checks.
- **COGS at flow level** — Orchestrated flows have estimated COGS (sum of skills + orchestration overhead). Flow definitions and runtime support COGS visibility so high-cost flows can be optimized or gated; feeds the COGS dashboard ([01-technology.md](./01-technology.md)).

---

## Scope

- **Orchestration model** — workflows, state machines, or agentic loops that call skills.
- **Triggers** — user action, webhook, schedule, or event from the application (e.g. in a CRM: “deal stage changed”; in other apps: equivalent domain events).
- **Integration** — how orchestration is exposed in UI/API and how it appears in product spec → capabilities ([02-product-to-technology.md](./02-product-to-technology.md)).

---

## Details to Add (your input)

*Add below: orchestration engine (e.g. Temporal, Inngest, custom, vendor), DSL or config format, and example customer-facing flows.*

- [ ] **Orchestration engine / framework:** _TBD_
- [ ] **Flow definition format (e.g. YAML, DSL):** _TBD_
- [ ] **Example customer-facing flows:** _TBD_
- [ ] **UI/API surface for end users:** _TBD_
- [ ] **Error handling and human escalation:** _TBD_
- [ ] **Flow-level COGS (estimate and actual) and optimization:** _TBD_

---

## Dependencies

- Consumes: skills and agents from [06-agents-and-skills.md](./06-agents-and-skills.md).
- Driven by: product capabilities from [02-product-to-technology.md](./02-product-to-technology.md); tickets from [03-ticket-automation.md](./03-ticket-automation.md).
