# Pillar 4: Human-in-the-Loop (Approvals)

**Goal:** Critical decisions require explicit human approval before automation proceeds. No production impact without signed-off gates.

---

## Approval Gates

| Gate | Owner (example) | Triggers | Downstream |
|------|-----------------|----------|------------|
| **Product spec approval** | Product leaders + stakeholders | New/updated product spec (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md): question-driven, persisted git/wiki) | GenAI spec→tech; ticket creation; then architecture |
| **Architecture approval** | Architecture leaders (architect/engineers create with current architecture context; leaders approve) | New services, data model, integrations (context-aware; see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md)) | Compliance gate |
| **Compliance gate** | **Legal / compliance** (or designated reviewers) | Approved spec + approved architecture | Build; no build until compliance sign-off (see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md)) |
| **Software stack approval** | CTO / Tech | New languages, frameworks, vendors | [01-technology.md](./01-technology.md); pipeline templates |
| **UAT sign-off** | Product manager + engineer (both approve; sign-off template; tracked as tickets) | After deploy to stage; before prod | [05-release-and-cicd.md](./05-release-and-cicd.md); see [PRODUCT-FACTORY.md](./PRODUCT-FACTORY.md) |
| **Release approval** | Release manager / Product | Before deploy to prod | [05-release-and-cicd.md](./05-release-and-cicd.md) — actual release |

---

## Principles

- **Explicit, auditable** — every approval is recorded (who, when, what version).
- **Blocking** — pipeline and ticket automation respect gates; no auto-skip without policy. **Rejection = rework:** when a gate says no, the capability returns to the previous stage (see [PRODUCT-FACTORY.md — Rejection and rework](./PRODUCT-FACTORY.md#rejection-and-rework-back-edges)); same capability ID, recorded on the ticket.
- **Tooling** — approvals are **in line with the connected ticketing systems**. Whatever you connect (JIRA, GitHub, Linear) via the same **configurable connectors** used for tickets and capacity also drives approval state (e.g. JIRA workflows, GitHub issue/PR state, Linear approval). The hybrid layer reads approval state from those connectors; no separate approval tool required unless you add one.
- **COGS in approvals** — Approval context should surface estimated COGS impact where relevant (e.g. new capability, new agent). High-COGS or above-threshold items may require explicit cost review or sign-off (policy TBD).

---

## Details to Add (your input)

*Add below: roles, SLA, and audit requirements; approval mechanism follows ticketing.*

- [x] **Approval tool(s):** **Aligned with ticketing.** Approvals are handled **in line with the connected ticketing systems** (JIRA, GitHub, Linear). Same connectors used for tickets and capacity expose approval state (workflows, issue/PR state, etc.); the hybrid layer reads it. No separate approval tool unless you introduce one.
- [ ] **Roles and responsibilities:** _TBD_ (per gate: who can approve/reject; can be configured in the connected system).
- [ ] **Approval SLA / escalation:** _TBD_
- [x] **Integration with pipeline and ticket automation:** Approval state is read from the **same connectors** as tickets and capacity; pipeline and ticket automation use that state for gates.
- [ ] **Audit log requirements:** _TBD_
- [ ] **COGS threshold / cost review (e.g. above $X requires extra approval):** _TBD_

---

## Dependencies

- Gates feed: [02-product-to-technology.md](./02-product-to-technology.md), [03-ticket-automation.md](./03-ticket-automation.md), [05-release-and-cicd.md](./05-release-and-cicd.md), [08-genai-pipeline.md](./08-genai-pipeline.md).
