(function attachIdeaViewModel(globalScope) {
  function toText(value) {
    return String(value == null ? "" : value).trim();
  }

  function toArray(value) {
    if (Array.isArray(value)) {
      return value.map((item) => toText(item)).filter(Boolean);
    }
    const text = toText(value);
    if (!text) return [];
    return text
      .split(/\n|;|,/)
      .map((item) => item.replace(/^[\s\-*0-9.)]+/, "").trim())
      .filter(Boolean);
  }

  function buildIdeaSummaryView(draft = null, artifact = null) {
    if (!draft) {
      return {
        title: "Full Idea",
        summaryLine: "No enrichment yet.",
        canViewFullIdea: false,
        artifactVersion: 0
      };
    }
    const triage = draft?.triage || {};
    const details = draft?.details || {};
    const criteria = toArray(details.acceptanceCriteria);
    const risks = toArray(triage.risks);
    const readiness = Number.isFinite(Number(triage.readinessScore)) ? Number(triage.readinessScore) : "n/a";
    const artifactVersion = Number(artifact?.version || details?._ideaArtifactVersion || 0);
    const summaryParts = [];
    if (artifactVersion > 0) summaryParts.push(`Artifact v${artifactVersion}`);
    summaryParts.push(`Readiness ${readiness}`);
    summaryParts.push(`${criteria.length} criteria`);
    summaryParts.push(`${risks.length} risks`);

    return {
      title: toText(draft.title) || "Untitled idea",
      summaryLine: `AI Draft Updated - ${summaryParts.join(" · ")}`,
      canViewFullIdea: true,
      artifactVersion
    };
  }

  function buildIdeaDrawerTabs(draft = null, artifact = null, options = {}) {
    const chatMessageCount = Number(options?.chatMessageCount || 0);
    const contextMeta = options?.contextMeta && typeof options.contextMeta === "object" ? options.contextMeta : {};

    if (!draft) {
      return {
        title: "Full Idea",
        tabs: {
          overview: { title: "Overview", paragraphs: ["No enrichment artifact available yet."], list: [] },
          scope: { title: "Scope & Non-Goals", paragraphs: [], list: [] },
          personas: { title: "Personas", paragraphs: [], list: [] },
          architecture: { title: "Architecture", paragraphs: [], list: [] },
          criteria: { title: "Acceptance Criteria", paragraphs: [], list: [] },
          audit: { title: "Audit Trail", paragraphs: [], list: [] }
        }
      };
    }

    const details = draft?.details || {};
    const triage = draft?.triage || {};
    const criteria = toArray(details.acceptanceCriteria);
    const suggestions = toArray(triage.suggestions);
    const risks = toArray(triage.risks);
    const personas = toArray(details.personas || details.userPersona);
    const dependencies = toArray(triage.dependencies || details.dependencies);
    const nonGoals = toArray(details.nonGoals);
    const inScope = toArray(details.scope || details.businessGoal || draft.description);
    const architectureNotes = toArray(details.architectureNotes || details.integrationLandscape || details.constraints);
    const artifactVersion = Number(artifact?.version || details?._ideaArtifactVersion || 0);
    const artifactUpdatedAt = toText(artifact?.updatedAt || details?._ideaArtifactUpdatedAt);

    return {
      title: toText(draft.title) || "Untitled idea",
      tabs: {
        overview: {
          title: "Overview",
          paragraphs: [
            toText(draft.description) || "No summary available.",
            toText(details.problemStatement) ? `Problem Statement: ${toText(details.problemStatement)}` : "",
            toText(details.businessGoal) ? `Business Goal: ${toText(details.businessGoal)}` : ""
          ].filter(Boolean),
          list: [
            `Readiness Score: ${Number.isFinite(Number(triage.readinessScore)) ? Number(triage.readinessScore) : "n/a"}`,
            `Acceptance Criteria Count: ${criteria.length}`,
            `Risk Count: ${risks.length}`,
            ...(suggestions.length ? [`Top Suggestion: ${suggestions[0]}`] : [])
          ]
        },
        scope: {
          title: "Scope & Non-Goals",
          paragraphs: [toText(details.constraints) ? `Constraints: ${toText(details.constraints)}` : ""].filter(Boolean),
          list: inScope,
          secondaryList: nonGoals
        },
        personas: {
          title: "Personas",
          paragraphs: [toText(details.userPersona) ? `Primary Persona: ${toText(details.userPersona)}` : ""].filter(Boolean),
          list: personas
        },
        architecture: {
          title: "Architecture",
          paragraphs: architectureNotes,
          list: dependencies
        },
        criteria: {
          title: "Acceptance Criteria",
          paragraphs: [
            toText(details.successMetrics) ? `Success Metrics: ${toText(details.successMetrics)}` : "",
            toText(details.kpiBaseline) ? `KPI Baseline: ${toText(details.kpiBaseline)}` : ""
          ].filter(Boolean),
          list: criteria
        },
        audit: {
          title: "Audit Trail",
          paragraphs: [
            `Source: ${toText(draft.source) || "unknown"}`,
            toText(draft.llmModel) ? `Model: ${toText(draft.llmModel)}` : "",
            toText(draft.fallbackReason) ? `Fallback: ${toText(draft.fallbackReason)}` : "",
            artifactVersion > 0 ? `Artifact Version: v${artifactVersion}` : "",
            artifactUpdatedAt ? `Artifact Updated At: ${artifactUpdatedAt}` : "",
            `Conversation Messages: ${chatMessageCount}`,
            Number.isFinite(Number(contextMeta?.loadedIdeas)) ? `Context Ideas Loaded: ${Number(contextMeta.loadedIdeas)}` : ""
          ].filter(Boolean),
          list: suggestions.slice(0, 4),
          secondaryList: risks.slice(0, 4)
        }
      }
    };
  }

  const api = {
    buildIdeaSummaryView,
    buildIdeaDrawerTabs
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.IdeaViewModel = api;
})(typeof window !== "undefined" ? window : globalThis);
