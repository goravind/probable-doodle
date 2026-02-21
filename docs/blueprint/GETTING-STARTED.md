# Getting Started with the Blueprint

Use this when onboarding or when you need to “start from zero” with the blueprint.

---

## 1. Read the flow

Open [INDEX.md](./INDEX.md) and follow the high-level flow: **Product Spec → Approvals → GenAI (spec→tech + tickets) → Pipeline → Agents/UI/Backend → CI/CD → Release.**

---

## 2. How to build the Product Factory app

See **[IMPLEMENTATION.md](./IMPLEMENTATION.md)** for phasing (MVP → connectors → automation → GenAI), components (UI, API, connectors, config, pipeline runner, COGS), and a concrete build order. Use it as the implementation checklist for the factory itself.

---

## 3. Fill in “Details to add” in order

Recommended order so dependencies are clear:

1. **[01-technology.md](./01-technology.md)** — Lock stack (lang, framework, DB, infra). Needed for pipeline and agents.
2. **[04-human-in-the-loop.md](./04-human-in-the-loop.md)** — Define approval tool and gates. Needed before automation creates tickets or runs pipeline.
3. **[02-product-to-technology.md](./02-product-to-technology.md)** — Product spec format and capability schema. Needed for tickets and pipeline.
4. **[03-ticket-automation.md](./03-ticket-automation.md)** — JIRA/Git (and optional press/marketing) schema and vendor vs built-in.
5. **[08-genai-pipeline.md](./08-genai-pipeline.md)** — How approved spec becomes code in minutes.
6. **[06-agents-and-skills.md](./06-agents-and-skills.md)** and **[07-orchestration.md](./07-orchestration.md)** — Skill/agent model and orchestration for customer-facing features.
7. **[05-release-and-cicd.md](./05-release-and-cicd.md)** — CI/CD platform and release coordination (can be done in parallel with 6–7).

---

## 4. Drive tooling from the blueprint

- Ticket templates and custom fields should match what’s in [03-ticket-automation.md](./03-ticket-automation.md).
- Approval workflows should implement gates in [04-human-in-the-loop.md](./04-human-in-the-loop.md).
- Pipeline config (e.g. GitHub Actions) should implement [08-genai-pipeline.md](./08-genai-pipeline.md) and use stack from [01-technology.md](./01-technology.md).

---

## 5. Version the blueprint

When you lock a major revision (e.g. “v1 org shape”), tag or branch (e.g. `blueprint-v1`). Keep `main` as the living blueprint; use tags for milestones.
