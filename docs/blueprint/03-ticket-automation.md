# Pillar 3: Ticket Automation (Spec → Clean Ticketed Model)

**Goal:** Every product capability is tracked as tickets automatically. Product spec (or tech capabilities) is converted into a clean ticketed model for engineering, product, release management, press, and marketing campaigns.

---

## Principles

- **Single source of truth** — one approved spec/capability set drives all ticket types.
- **Tickets at every pipeline step** — Tickets are created or updated at **every stage** (triage, spec, spec approval, architecture, architecture approval, **compliance**, build, CI/CD, UAT, release), not only once. **Multiple tickets per stage per capability** are allowed as required (e.g. separate write/review/approve tickets). Status and capacity come from the **connected ticket systems** via **configurable connectors** (e.g. JIRA, GitHub, Linear); Product Factory consumes them (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md)).
- **Automated creation** — no manual ticket creation for standard capability rollout at each step.
- **Multi-audience tickets** — same capability can spawn: engineering (JIRA/Git), product, release, press release, marketing campaign items. **Customer-facing product documentation** (release notes, external docs) is in scope: tickets or linked work can drive release notes and external docs so they stay in sync with what we ship (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md)).
- **COGS visibility** — Tickets (or linked capability metadata) carry estimated COGS so that engineering, product, and release decisions are cost-aware. COGS dashboard ([01-technology.md](./01-technology.md)) is fed by capability and ticket data.

---

## Ticket Types (target)

| Audience | System (candidate) | Purpose |
|----------|--------------------|--------|
| Engineering | JIRA / GitHub Issues / Linear | Tasks, stories, bugs, tech debt |
| Product | JIRA / Productboard / same | Features, acceptance criteria, prioritization |
| Release | JIRA / custom / release tool | Release notes, version, scope |
| Press | Internal or vendor | Press release drafts, embargo, launch narrative |
| Marketing | HubSpot / internal / vendor | Campaigns, copy, channels |

---

## Software Options

- **External vendors:** JIRA + automation (e.g. Automation for Jira), Linear, Shortcut; Zapier/Make for cross-tool sync; dedicated PR/marketing tools.
- **Built-in:** Custom service that reads capability schema and creates/updates issues via JIRA API, GitHub API, etc.; optional internal “campaign” and “press” modules.
- **Hybrid:** Core ticketing in JIRA/Git; GenAI + scripts to generate and push tickets; webhooks to marketing/PR tools.

---

## Details to Add (your input)

*Add below when you set up GitHub: ticket schemas, field mappings, and how GenAI output (from pillar 2) maps to each ticket type.*

- [x] **Primary ticket system(s):** **GitHub Issues** (to start with). May add JIRA/Linear later if needed.
- [ ] **Ticket schema per type:** _TBD_ (e.g. issue templates, labels for engineering/product/release/press/marketing).
- [ ] **Vendor vs built-in decision:** _TBD_
- [ ] **Mapping: capability → engineering/product/release/press/marketing:** _TBD_ (e.g. one parent issue per capability vs one per type).
- [ ] **Automation triggers (e.g. on approval, on merge):** _TBD_
- [ ] **COGS on tickets:** _TBD_ (e.g. label, issue body, or only in capability YAML + hybrid layer).

---

## Dependencies

- Input: tech capabilities from [02-product-to-technology.md](./02-product-to-technology.md); approval from [04-human-in-the-loop.md](./04-human-in-the-loop.md).
- Feeds: engineering work, release notes, press, marketing (and indirectly [05-release-and-cicd.md](./05-release-and-cicd.md)).
