# Probable Doodle — GenAI-Native Product Blueprint

This repository is a **generic blueprint** for building a next-generation, GenAI-driven organization that can ship **any application** — with high efficiency and automation as core goals. It defines how product specs become technology, tickets, approvals, agents, and shipped software. **CRM is one application** you can build; the same blueprint applies to other products (internal tools, marketplaces, vertical apps, etc.).

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
product-specs/      # Approved product specs (input to GenAI)
scripts/            # Automation (e.g. spec→tickets, pipeline triggers)
agents/             # Agent and skill definitions (when you add them)
.cursor/            # Cursor rules for GenAI-assisted development
```

You can add `engineering/`, `marketing/`, `release/` etc. as needed; keep the blueprint in `docs/blueprint/` as the canonical reference.
