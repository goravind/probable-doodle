# Process Audit — What We Have vs What’s Wrong / Missing

This doc (1) outlines the process as designed, then (2) argues what’s wrong or missing so you can fix it.

---

## Part 1: Process outline (as designed)

| Step | Stage | Owner | Output | Next |
|------|--------|--------|--------|------|
| 1 | **Ideas** | Anyone | Idea / opportunity | → 2 |
| 2 | **Product spec** | PM (question-driven) | Spec doc → git/wiki | → 3 |
| 3 | **Product spec approval** | Product leaders + stakeholders | Approved spec | → 4 |
| 4 | **Spec → tech capabilities** | GenAI (Pillar 2) | Capability schema + COGS | → 5 |
| 5 | **Architecture review** | Architect (+ engineers) | Architecture doc (context-aware) | → 6 |
| 6 | **Architecture approval** | Architecture leaders | Approved architecture | → 7 |
| 7 | **Ticket creation** | Automation (Pillar 3) | Eng/product/release/press/marketing tickets | → 8 |
| 8 | **Software creation** | Engineering + GenAI pipeline (Pillar 8) | Code, agents, UI/backend | → 9 |
| 9 | **CI/CD to stage** | CI/CD | Deployed to staging | → 10 |
| 10 | **UAT** | Product + engineers | UAT sign-off | → 11 |
| 11 | **Release approval** | Release manager / authorized | Approved release | → 12 |
| 12 | **Ship to prod** | Deploy | Live in production | Done |

- **Unit of tracking:** One feature/capability = one pipeline item; referenced by stable ID everywhere (tickets, Slack, docs).
- **Collaboration:** Slack (and other channels) linked to capability/ticket; tracked in Product Factory.
- **Senior leadership:** Every active capability visible (row/card: stage, owner, COGS, blocker, links to tickets/docs/collaboration).
- **Artifacts:** All docs in git/wiki with lineage; linked to tickets.

---

## Part 2: What’s wrong or missing (argue with me)

### 1. Idea → feature: who decides “one idea = how many features?”

**Gap:** You say “one feature = one pipeline item” but not how an **idea** becomes one or many **features**. One idea (e.g. “Lead scoring”) might be one capability, or it might be three (“Data pipeline,” “Scoring model,” “UI for scores”). If someone files a big idea, who splits it into pipeline items, and when?

**Argument:** Without an **idea triage / scope-to-features** step (owner: e.g. product or PM), you’ll have either (a) huge “features” that block the pipeline or (b) ad-hoc splitting with no rule. Add an explicit step or policy: e.g. “Ideas are triaged by product; output is one or more capability IDs that enter the pipeline.”

---

### 2. Order of operations: spec→tech vs architecture (plain-language summary)

**What the question was:** After the product spec is approved, two things happen: (A) **GenAI** turns the spec into “tech capabilities” (APIs, data model, etc.), and (B) an **architect** writes an architecture doc with “current product architecture in mind.” The gap was: which comes first?

- **If GenAI runs first:** You get a capability schema from the spec; then the architect reviews (or amends) it. The architect is reviewing GenAI output.
- **If architecture runs first:** The architect defines the design; then GenAI (or eng) fills in capabilities within that design. GenAI is constrained by architecture.

**Status:** No single order was pinned. The pipeline allows both to be informed by the approved spec; you can implement as **spec approved → GenAI spec→tech** and **architecture review** in either order, or in parallel, and reconcile before tickets/build. If you want to pin one order later (e.g. architecture first so GenAI respects it), update Pillar 2 and the pipeline diagram.

---

### 3. Bugs, hotfixes, tech debt — decided

**Decision:** Bugs and hotfixes use a **different pipeline**. They can **skip** steps like product spec approval and architecture approval (e.g. bug → ticket → fix → CI/CD → release approval). **Context is very important:** each bug/hotfix must be linked to context (which capability, component, or area) so traceability is preserved. Product Factory can show them in a separate view/lane (e.g. “Hotfixes”) so they’re visible but not forced through the full feature pipeline.

---

### 4. Dependencies between capabilities

**Gap:** Capability B may **depend on** capability A (e.g. “Lead scoring UI” depends on “Lead scoring API”). The process doesn’t say:

- Can B’s spec be written before A is in prod?
- Is there a **“depends on”** field and a **gate**: e.g. “B cannot start build until A is shipped (or dependency waived)?”
- How does the pipeline show “blocked by A” for leadership?

**Decision:** Dependency model is important and is now in the blueprint. A capability can list **depends on** (other capabilities); the pipeline supports a gate (e.g. B cannot start build until A is shipped or dependency waived) and the dashboard shows **blocked by**.

---

### 5. Rejection and rework (back-flow) — decided

**Gap:** The flow is **linear**. What happens when:

- Product leaders **reject** the spec?
- Architecture leaders **reject** the architecture?
- **UAT fails** (product/eng don’t sign off)?

**Decision:** Back-edges are now in the blueprint. See Product Factory **Rejection and rework (back-edges)**:

- **Spec rejected** → back to **Product spec** (triggered by product leaders / spec approvers).
- **Architecture rejected** → back to **Architecture review** (triggered by architecture leaders).
- **UAT failed** → back to **Software creation** (PM/engineer don’t sign off; item reworked and re-submitted).
- **Release denied** → back to **Build** or **UAT** (triggered by release manager / deployer).

Rejection is recorded on the ticket; dashboard shows regression (same capability ID). Cancel is separate from rework; policy defines who can cancel.

---

### 6. Who builds and runs Product Factory? (plain-language summary)

**What the question was:** Product Factory is a *tool*. Someone has to build v1. That v1 couldn’t have been created by the pipeline, because the pipeline didn’t exist yet. So: who builds it, and does it ever go through itself?

**Decision:** A **bootstrap** rule is in the blueprint: **Product Factory v1** is built and launched **outside** the full pipeline. From **v2 onward**, changes to Product Factory (new features, process changes) go through the full pipeline. So the factory “eats its own dog food” only from v2 on.

---

### 7. Software stack approval (plain-language summary)

**What the question was:** “Stack approval” = when does the CTO (or tech lead) sign off on new technology (new language, new framework, new DB)? Two options: (a) **once for the whole org** (“we use stack X”), or (b) **per capability** when a capability introduces new tech (then it’s a gate in the pipeline, e.g. after architecture). The blueprint now documents both; the org decides which applies.

---

### 8. Legal / compliance — decided

**Decision:** **Legal and compliance** are part of **product spec approval** and/or **architecture approval** (not a separate pipeline stage). The blueprint and Pillar 4 state that product leaders/stakeholders and architecture leaders include legal/compliance review where policy requires.

---

### 9. COGS — decided

**Decision:** **COGS can come in at any stage**; **generally it is set or refined at architecture review** (architect has context on infra, APIs, agents). The pipeline and COGS dashboard show the latest estimate per capability; no single “COGS moment” is required.

---

### 10. When exactly are tickets created? — decided

**Decision:** **Tickets are created or updated at every step of the pipeline** (triage, spec, spec approval, architecture, architecture approval, build, CI/CD, UAT, release). There is no single “ticket creation” moment; each stage creates or updates the relevant tickets so JIRA (or the chosen tool) is always the source of truth for status and capacity.

---

### 11. Prioritization and capacity — decided

**Decision:** **Capacity is flexible:** you provide **configurable connectors** to the backends you use (e.g. **JIRA**, **GitHub**, **Linear**). Product Factory reads capacity and WIP from connected systems and uses it for prioritization, backlog ordering, and “ready for spec / ready for architecture” so the pipeline respects real capacity and doesn’t overload a stage. No single mandated backend.

---

### 12. Post-launch (success, incidents)

**Decision:** **No view for now.** Post-launch (success metrics, incident linkage, actual COGS) is out of scope for the current blueprint. Can be revisited later if needed.

---

## Summary: fix list and status

| # | Issue | Status | What was done |
|---|--------|--------|----------------|
| 1 | Idea → feature | **Done** | Idea triage / scope-to-features added (product owner; output = capability IDs). |
| 2 | Spec→tech vs architecture order | **Clarified** | Plain-language explanation added; order left flexible. |
| 3 | Bugs/hotfixes | **Done** | Separate pipeline; skip steps like arch; context required; separate view in Product Factory. |
| 4 | Dependencies | **Done** | “Depends on” + gate + “blocked by” in blueprint. |
| 5 | Rejection/rework | Open | Back-edges (reject → previous stage) not yet added. |
| 6 | Who builds Product Factory | **Done** | Bootstrap added: v1 outside pipeline; v2+ through pipeline. |
| 7 | Stack approval | **Clarified** | Both options (org-level vs per-capability) documented; org decides. |
| 8 | Legal/compliance | **Done** | Part of product spec approval and/or architecture approval. |
| 9 | COGS | **Done** | COGS anytime; generally at arch review. |
| 10 | Ticket creation | **Done** | Tickets at every pipeline step; JIRA (or other) source of truth. |
| 11 | Prioritization/capacity | **Done** | JIRA (or other tools) as source of truth for capacity; Product Factory reads it. |
| 12 | Post-launch | **Out of scope** | No view for now. |

---

## Next step

Remaining open item: **#5 Rejection/rework** — define back-edges (e.g. spec rejected → back to spec draft; UAT failed → back to software creation) when you’re ready. Everything else above is reflected in PRODUCT-FACTORY.md and the pillars.
