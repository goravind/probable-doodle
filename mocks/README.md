# Mocks

Static HTML mocks for how the product will look. Open in a browser (no build step).

| File | Description |
|------|--------------|
| **login.html** | **Enterprise login**: Sign in (email/password or SSO). Mock only — sets session and redirects to product select. |
| **product-select.html** | **Select a product**: After login, choose CRM, Internal Tools, or Marketplace. Opens the pipeline for that product. |
| **product-factory-dashboard.html** | **Pipeline for selected product**: Leadership view, Pipeline (Kanban, context panel with **Open in GitHub/Jira/Slack/Git**), All capabilities. Context bundle also shown in ticket & PRs; link to ticket mock. Requires login + product. |
| **capability-lifecycle.html** | **How we build a capability**: One capability through every stage (Triage → … → Compliance → Build → … → Release). **Context bundle** at each step with **Open in GitHub / Open spec in Git / Open Slack**. Timeline view. |
| **ticket-context-mock.html** | **Ticket with Product Factory context**: Mock of context injected into a ticket (GitHub/Jira). Capability ID, stage, spec/arch links, Slack, approved version, COGS — same bundle as pipeline panel. |
| **how-we-build-software.html** | **How we build the software** (double-click on Build): Trigger → Load context → Spec→YAML → GenAI pipeline → Code + PR → Human review → Merge → CI/CD. Build readiness callout (required/recommended, product config). Linked from dashboard nav and from capability-lifecycle (Software creation stage). |
| **product-config-mock.html** | **Product configuration**: Ticketing (JIRA/GitHub/Linear), repos, codebase context (required for new product), meeting notes, messaging (Slack), cycle time, compliance. Configure when building the factory or defining a new product. Linked from dashboard (“Configure product”) and product-select. |
| **customer-app-placeholder.html** | **Customer-facing app** (placeholder): Shell for the application you build (e.g. CRM). |

**Check-ins:** When you change the blueprint or Product Factory behavior, update these mocks so the UI stays in sync. Any check-in that touches docs/blueprint or product-factory flows should include mock updates as needed.

**Flow:** Start at **login.html** → sign in (any credentials for mock) → **product-select.html** → choose a product → **product-factory-dashboard.html?product=CRM** (pipeline for that product).

Open from the repo root, e.g.:
- `open mocks/login.html`
- Or direct: `open mocks/product-factory-dashboard.html?product=CRM` (after visiting login once to set session)

Or drag the file into a browser.
