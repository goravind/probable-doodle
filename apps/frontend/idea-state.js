(function attachIdeaState(globalScope) {
  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function applyEnrichmentArtifact(previousIdea = {}, draft = {}, artifact = null) {
    const base = previousIdea && typeof previousIdea === "object" ? previousIdea : {};
    const draftNext = draft && typeof draft === "object" ? draft : {};
    const prevDetails = base.details && typeof base.details === "object" ? base.details : {};
    const draftDetails = draftNext.details && typeof draftNext.details === "object" ? draftNext.details : {};
    const nextVersion = artifact && artifact.version != null
      ? toNumber(artifact.version, toNumber(prevDetails._ideaArtifactVersion, 0) + 1)
      : toNumber(prevDetails._ideaArtifactVersion, 0) + 1;

    return {
      ...base,
      ...draftNext,
      title: String(draftNext.title || base.title || "").trim(),
      description: String(draftNext.description || base.description || "").trim(),
      details: {
        ...prevDetails,
        ...draftDetails,
        _ideaArtifactVersion: nextVersion,
        _ideaArtifactUpdatedAt: String((artifact && artifact.updatedAt) || new Date().toISOString()),
        _ideaArtifactSource: "ai-chat-enrich"
      }
    };
  }

  function buildActionableError(kind, reason, correlationId = "") {
    const errorReason = String(reason || "Unknown failure").trim();
    const suffix = correlationId ? ` (correlationId=${correlationId})` : "";
    if (kind === "approval") {
      return {
        message: `PR approval failed: ${errorReason}${suffix}`,
        actions: ["Open PR", "Retry", "Reconnect GitHub"]
      };
    }
    if (kind === "pr") {
      return {
        message: `PR creation failed: ${errorReason}${suffix}`,
        actions: ["Reconnect GitHub", "Retry"]
      };
    }
    return {
      message: `Enrichment failed: ${errorReason}${suffix}`,
      actions: ["Retry", "View logs"]
    };
  }

  const api = {
    applyEnrichmentArtifact,
    buildActionableError
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.IdeaState = api;
})(typeof window !== "undefined" ? window : globalThis);
