# Pillar 8: GenAI Pipeline (UI + Backend from Spec; Features in Minutes)

**Goal:** Approved product spec and architecture approval are turned into working UI and backend within minutes via a GenAI-based pipeline. New approvals automatically unblock feature generation.

---

## Principles

- **Spec and approval as trigger** — only approved product spec and architecture ([04-human-in-the-loop.md](./04-human-in-the-loop.md)) feed the pipeline.
- **End-to-end generation** — GenAI produces (or scaffolds) UI components, API contracts, backend logic, and optionally agent/skill stubs ([06-agents-and-skills.md](./06-agents-and-skills.md)).
- **Minutes, not days** — pipeline is automated and fast; output is committed and wired into CI/CD ([05-release-and-cicd.md](./05-release-and-cicd.md)) and tickets ([03-ticket-automation.md](./03-ticket-automation.md)).
- **COGS-aware pipeline** — Pipeline run cost (e.g. GenAI API usage) is tracked. Generated capabilities and code include or reference estimated COGS ([02-product-to-technology.md](./02-product-to-technology.md)). Optional cost gates (e.g. reject or alert if estimated COGS exceeds threshold); all feed the COGS dashboard ([01-technology.md](./01-technology.md)).

---

## Scope

- **Input:** Tech capabilities from [02-product-to-technology.md](./02-product-to-technology.md) (derived from approved product spec).
- **Pipeline steps:** Codegen for frontend + backend; schema/API generation; DB migrations or config; **quality test cases** (from spec/acceptance criteria); PR or branch creation; **COGS estimate per generated capability**.
- **Quality test cases** — Test cases are **derived from the spec and acceptance criteria** (GenAI or template from capability YAML). They cover success criteria, edge cases, and UAT scenarios; are **traceable** to the capability ID and spec; and are **quality** (e.g. coverage goals, quality gates). **Test results** (pass/fail, coverage) are **published** for the leadership view (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md) — Senior leadership visibility, Automatic software building factory).
- **Output:** Merge-ready or review-ready code; **test cases and test results** (published); linked tickets; optional preview environment; **COGS data for dashboard**.

---

## Details to Add (your input)

*Add below: GenAI provider, pipeline runner (e.g. GitHub Actions, custom service), templates, and how “minutes” is achieved (caching, incremental, parallel).*

- [ ] **GenAI provider(s) and models:** _TBD_
- [ ] **Pipeline runner and triggers:** _TBD_
- [ ] **Scaffolding rules (stack from [01-technology.md](./01-technology.md)):** _TBD_
- [ ] **Output format (monorepo, services, etc.):** _TBD_
- [ ] **Quality gates (lint, test, security) before merge:** _TBD_
- [ ] **Test case generation from spec/acceptance criteria (format, coverage, traceability):** _TBD_
- [ ] **Publishing test results and quality metrics to leadership dashboard (source: CI/test runner):** _TBD_
- [ ] **SLA target (“within minutes”):** _TBD_
- [ ] **Pipeline run COGS tracking and cost gates:** _TBD_

---

## Dependencies

- Input: approved spec → tech capabilities ([02-product-to-technology.md](./02-product-to-technology.md)); approval ([04-human-in-the-loop.md](./04-human-in-the-loop.md)).
- Output: codebase; CI/CD ([05-release-and-cicd.md](./05-release-and-cicd.md)); tickets ([03-ticket-automation.md](./03-ticket-automation.md)); agents/skills ([06-agents-and-skills.md](./06-agents-and-skills.md)), [07-orchestration.md](./07-orchestration.md).
