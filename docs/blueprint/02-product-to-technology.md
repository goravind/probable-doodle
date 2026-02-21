# Pillar 2: Product Definition → Technology Capabilities (GenAI)

**Goal:** Turn product definition specs into concrete technology capabilities using GenAI, so engineering and automation have a clear, machine-readable target.

---

## Principles

- **Product-led** — technology serves product; capabilities are derived from approved product specs.
- **GenAI in the loop** — product spec (natural language or structured) is converted to tech capabilities (APIs, data model, UX flows, agent skills) via GenAI.
- **Structured output** — GenAI output must be in a format usable by ticket automation ([03-ticket-automation.md](./03-ticket-automation.md)) and the GenAI pipeline ([08-genai-pipeline.md](./08-genai-pipeline.md)).
- **COGS-aware** — Every capability produced must include an estimated COGS (see [01-technology.md](./01-technology.md)). The capability schema and GenAI output support COGS so that cost is visible from spec to release.

---

## Scope

- Input: product spec in a **structured template** (standard sections: User, Success criteria, Scope, Out of scope, COGS, Legal; plus free-form sections). Specs may be created in Product Factory via **question-driven flow** with the PM, then **persisted in Git** and **approved by product leaders and stakeholders** (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md)).
- Output: technology capability description in **YAML** (e.g. entities, APIs, flows, skill specs) **including estimated COGS per capability**.
- GenAI prompts, schemas, and validation rules for spec → capabilities.

---

## Details to Add (your input)

*Add below: product spec format, capability schema, example mappings, and how this ties to JIRA/epics and the pipeline.*

- [x] **Product spec format:** **Structured template with standard sections plus free-form sections.** Standard sections: User, Success criteria, Scope, Out of scope, COGS, Legal (and any others from the PM question set). Additional **free-form sections** allowed so PMs can add custom content. Template provides structure; flexibility where needed.
- [x] **Capability schema:** **YAML.** GenAI output (spec → tech capabilities) is in YAML format. Exact fields (entities, APIs, screens, skills, COGS estimate) _TBD_ when schema is designed.
- [ ] **GenAI model & prompt strategy:** _TBD_
- [ ] **Examples (spec → capabilities):** _TBD_
- [ ] **Handoff to ticket system:** _TBD_
- [ ] **COGS in capability schema:** _TBD (fields, units, refresh cadence)_

---

## Dependencies

- Input: product spec (after human approval — [04-human-in-the-loop.md](./04-human-in-the-loop.md)).
- Output consumed by: [03-ticket-automation.md](./03-ticket-automation.md), [08-genai-pipeline.md](./08-genai-pipeline.md).
