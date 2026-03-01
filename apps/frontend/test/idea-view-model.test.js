const test = require("node:test");
const assert = require("node:assert/strict");

const { buildIdeaSummaryView, buildIdeaDrawerTabs } = require("../idea-view-model");

test("buildIdeaSummaryView includes artifact version for updated enrichment", () => {
  const draft = {
    title: "Semantic Profile",
    details: {
      acceptanceCriteria: ["KPI baseline tracked"],
      _ideaArtifactVersion: 2
    },
    triage: {
      readinessScore: 92,
      risks: ["Schema drift"]
    }
  };

  const summary = buildIdeaSummaryView(draft, { version: 3 });
  assert.equal(summary.canViewFullIdea, true);
  assert.match(summary.summaryLine, /Artifact v3/);
  assert.match(summary.summaryLine, /Readiness 92/);
});

test("buildIdeaDrawerTabs composes sections for full idea drawer", () => {
  const draft = {
    title: "Semantic Profile",
    description: "Build a semantic profile feature",
    source: "ai-chat",
    details: {
      businessGoal: "Raise lead conversion",
      problemStatement: "Team cannot target intent",
      userPersona: "Marketing Operations Manager",
      nonGoals: ["Do not replace CRM"],
      acceptanceCriteria: ["Track baseline KPI", "Include retry + audit"],
      constraints: "SOC2, HIPAA",
      integrationLandscape: "Salesforce + HubSpot"
    },
    triage: {
      readinessScore: 90,
      suggestions: ["Define KPI baseline"],
      risks: ["Data privacy risk"],
      dependencies: ["Warehouse schema feed"]
    }
  };

  const vm = buildIdeaDrawerTabs(draft, { version: 5, updatedAt: "2026-03-01T10:00:00.000Z" }, {
    chatMessageCount: 4,
    contextMeta: { loadedIdeas: 3 }
  });
  assert.equal(vm.title, "Semantic Profile");
  assert.ok(Array.isArray(vm.tabs.criteria.list));
  assert.ok(vm.tabs.criteria.list.length >= 2);
  assert.ok(vm.tabs.audit.paragraphs.some((line) => line.includes("Artifact Version: v5")));
  assert.ok(vm.tabs.audit.paragraphs.some((line) => line.includes("Conversation Messages: 4")));
});
