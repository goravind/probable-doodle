const {
  createFactoryIdea,
  getFactoryIdea,
  listFactoryIdeasByScope,
  listFactoryIdeasByProductScope,
  updateFactoryIdeaStatus,
  upsertFactoryCapability,
  getFactoryCapability,
  getFactoryCapabilityByIdea,
  listFactoryCapabilitiesByScope,
  addFactoryArtifact,
  listFactoryArtifacts,
  createFactoryPullRequest,
  getFactoryPullRequestByCapability,
  createFactoryStageDoc,
  listFactoryStageDocs,
  getLatestFactoryStageDoc,
  getFactoryConfig,
  getFactoryProductContext,
  createFactoryTicket,
  listFactoryTickets
} = require("./store");
const {
  createGithubIssue,
  createGithubPullRequest,
  syncDocsToPullRequest,
  readGithubDocsFromBranch,
  readGithubDocsByPrefix,
  approveGithubPullRequest,
  parsePrNumberFromUrl
} = require("./github_integration");
const { getOrganization, getSandbox, getProduct } = require("../data");
const {
  hasLlm,
  generateSpecSectionsWithLlm,
  generateStageDraftWithLlm,
  generateIdeaSuggestionsWithLlm,
  generateIdeaDraftWithLlm,
  generateIdeaEnrichmentWithLlm,
  generateImagesWithLlm
} = require("./llm");

const STAGES = [
  "idea",
  "triage",
  "spec",
  "spec-approved",
  "architecture",
  "architecture-approved",
  "compliance",
  "compliance-approved",
  "build",
  "pr-created"
];

function nowIso() {
  return new Date().toISOString();
}

function pipelineLog(event, data = {}) {
  const payload = {
    ts: nowIso(),
    event,
    ...data
  };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    console.log(`[${payload.ts}] ${event}`);
  }
}

function addHistory(capability, event) {
  const history = capability.history || [];
  history.push({ ...event, at: nowIso() });
  return history;
}

function stageGuard(capability, requiredStage) {
  if (!capability) return { error: "Capability not found" };
  if (capability.stage !== requiredStage) {
    return { error: `Invalid stage transition. Required stage: ${requiredStage}, current: ${capability.stage}` };
  }
  return null;
}

async function createIdea({ orgId, sandboxId, productId, title, description, details = {}, intent = "", actor }) {
  const intentText = String(intent || "").trim();
  const seedTitle = String(title || "").trim();
  const seedDescription = String(description || "").trim();
  const seedDetails = details && typeof details === "object" ? details : {};
  const shouldGenerate = Boolean(intentText) || !seedTitle || !seedDescription;
  const draft = shouldGenerate
    ? await generateIdeaDraft({
        orgId,
        sandboxId,
        productId,
        intent: intentText,
        title: seedTitle,
        description: seedDescription,
        details: seedDetails
      })
    : {
        source: "manual",
        title: seedTitle,
        description: seedDescription,
        details: seedDetails,
        triage: null,
        enrichment: null
      };

  const finalTitle = String(draft.title || seedTitle || `${productId} capability idea`).trim();
  const finalDescription = String(draft.description || seedDescription || intent || `Capability idea for ${productId}`).trim();
  const finalDetails = draft.details && typeof draft.details === "object" ? draft.details : seedDetails;
  const ideaId = `IDEA-${Date.now()}`;
  const idea = await createFactoryIdea({
    ideaId,
    orgId,
    sandboxId,
    productId,
    title: finalTitle,
    description: finalDescription,
    details: finalDetails,
    status: "new",
    createdBy: actor || "unknown",
    createdAt: nowIso()
  });
  return {
    idea,
    generation: {
      source: draft.source || "manual",
      triage: draft.triage || null,
      enrichment: draft.enrichment || null,
      contextUsed: draft.contextUsed || null,
      usedIntent: Boolean(intentText),
      llmEnabled: Boolean(draft.llmEnabled),
      llmModel: draft.llmModel || null,
      fallbackReason: draft.fallbackReason || null
    }
  };
}

function deriveOrgContext(idea) {
  const org = getOrganization(idea.orgId);
  const sandbox = getSandbox(idea.orgId, idea.sandboxId);
  const product = getProduct(idea.orgId, idea.sandboxId, idea.productId);
  const capabilities = product?.capabilities || [];
  const sandboxProducts = (sandbox?.products || []).map((item) => ({
    id: item.id,
    name: item.name,
    capabilityCount: Array.isArray(item.capabilities) ? item.capabilities.length : 0
  }));
  const capabilityInventory = capabilities.map((item) => ({
    id: item.id,
    name: item.name,
    stage: item.stage,
    blockedBy: item.blockedBy || null,
    summary: item.summary || ""
  }));
  const blocked = capabilities.filter((item) => item.blockedBy).length;
  return {
    orgName: org?.name || idea.orgId,
    sandboxName: sandbox?.name || idea.sandboxId,
    productName: product?.name || idea.productId,
    activeCapabilities: capabilities.length,
    blockedCapabilities: blocked,
    sandboxProducts,
    capabilityInventory
  };
}

function normalizeBranchToken(value, fallback = "scope") {
  const token = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return token || fallback;
}

function docsBaseFromScope({ orgId, sandboxId, productId, ideaId }) {
  return `${orgId}/${sandboxId}/${productId}/${ideaId}`;
}

function capabilityBranchFromScope(branchPrefix, capability) {
  const productToken = normalizeBranchToken(capability?.productId, "product");
  const capToken = normalizeBranchToken(capability?.capabilityId, "capability");
  return `${branchPrefix}/${productToken}/${capToken}`;
}

function prLikeStatusFromSyncMode(mode) {
  return mode === "github-error" ? "draft" : "open";
}

function truncateText(value, limit = 900) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

async function loadAllProductIdeas({ orgId, sandboxId, productId, pageSize = 100, maxIdeas = 1200 }) {
  const rows = [];
  let offset = 0;
  let total = 0;
  while (rows.length < maxIdeas) {
    const take = Math.max(1, Math.min(pageSize, maxIdeas - rows.length));
    const page = await listFactoryIdeasByProductScope({
      orgId,
      sandboxId,
      productId,
      limit: take,
      offset
    });
    const ideas = Array.isArray(page?.ideas) ? page.ideas : [];
    total = Number(page?.total || total || 0);
    if (!ideas.length) break;
    rows.push(...ideas);
    offset += ideas.length;
    if (total && offset >= total) break;
    if (ideas.length < take) break;
  }
  return {
    ideas: rows,
    total: total || rows.length,
    truncated: total ? rows.length < total : false
  };
}

function ideaContextSnapshot(item) {
  return {
    ideaId: item?.ideaId || "",
    orgId: item?.orgId || "",
    sandboxId: item?.sandboxId || "",
    productId: item?.productId || "",
    title: item?.title || "",
    description: item?.description || "",
    details: item?.details && typeof item.details === "object" ? item.details : {},
    status: item?.status || "",
    createdBy: item?.createdBy || "",
    createdAt: item?.createdAt || ""
  };
}

async function loadOrgSandboxLlmContext(
  idea,
  {
    maxChars = 22000,
    maxProductIdeas = 1200,
    includeGithubDocs = true
  } = {}
) {
  if (!idea) return { summary: "", relatedIdeas: [], relatedCapabilities: [], githubDocs: [] };

  const [scopeIdeas, allProductIdeas, scopeCapabilities, config, productContext] = await Promise.all([
    listFactoryIdeasByScope({ orgId: idea.orgId, sandboxId: idea.sandboxId, limit: 100 }),
    loadAllProductIdeas({
      orgId: idea.orgId,
      sandboxId: idea.sandboxId,
      productId: idea.productId,
      pageSize: 100,
      maxIdeas: maxProductIdeas
    }),
    listFactoryCapabilitiesByScope({ orgId: idea.orgId, sandboxId: idea.sandboxId, limit: 30 }),
    getFactoryConfig(),
    getFactoryProductContext({ orgId: idea.orgId, sandboxId: idea.sandboxId, productId: idea.productId })
  ]);

  const productIdeaRows = Array.isArray(allProductIdeas?.ideas) ? allProductIdeas.ideas : [];
  const productIdeaSnapshots = productIdeaRows.map(ideaContextSnapshot);
  const relatedIdeas = scopeIdeas
    .filter((item) => item.ideaId !== idea.ideaId)
    .slice(0, 40)
    .map((item) => ideaContextSnapshot(item));

  const relatedCapabilities = scopeCapabilities
    .filter((item) => item.ideaId !== idea.ideaId)
    .slice(0, 10)
    .map((item) => ({
      capabilityId: item.capabilityId,
      ideaId: item.ideaId,
      productId: item.productId,
      title: item.title,
      stage: item.stage,
      status: item.status
    }));

  let githubDocs = [];
  const repo = Array.isArray(config?.codeRepos) && config.codeRepos.length > 0 ? config.codeRepos[0] : null;
  if (includeGithubDocs && repo) {
    const prefix = `${idea.orgId}/${idea.sandboxId}`;
    const github = await readGithubDocsByPrefix({
      repo,
      branch: "main",
      prefix,
      orgId: idea.orgId,
      maxFiles: 24
    });
    githubDocs = Object.entries(github?.files || {})
      .slice(0, 20)
      .map(([path, content]) => ({
        path,
        excerpt: truncateText(content, 950)
      }));
  }

  const parts = [];
  parts.push(`Organization=${idea.orgId}; Sandbox=${idea.sandboxId}; Product=${idea.productId}`);
  if (relatedIdeas.length) {
    parts.push("Related ideas:");
    for (const item of relatedIdeas) {
      parts.push(`- ${item.ideaId} (${item.productId}) ${item.title} [${item.status}] :: ${item.description}`);
    }
  }
  if (productIdeaRows.length) {
    parts.push("Product idea history (full context):");
    for (const item of productIdeaRows) {
      const d = item?.details || {};
      const criteria = Array.isArray(d.acceptanceCriteria) ? d.acceptanceCriteria.join(" | ") : "";
      parts.push(`- ${item.ideaId} ${item.title} [${item.status}]`);
      parts.push(`  Description: ${truncateText(item.description || "", 1000)}`);
      parts.push(`  Problem: ${truncateText(d.problemStatement || "", 600)}`);
      parts.push(`  Persona: ${truncateText(d.userPersona || "", 420)}`);
      parts.push(`  Goal: ${truncateText(d.businessGoal || "", 520)}`);
      if (criteria) parts.push(`  Acceptance: ${truncateText(criteria, 1200)}`);
      parts.push(`  Constraints: ${truncateText(d.constraints || "", 620)}`);
      parts.push(`  Non-goals: ${truncateText(d.nonGoals || "", 620)}`);
    }
  }
  if (relatedCapabilities.length) {
    parts.push("Capability inventory:");
    for (const item of relatedCapabilities) {
      parts.push(`- ${item.capabilityId} (${item.productId}) ${item.title} stage=${item.stage} status=${item.status}`);
    }
  }
  if (productContext?.context) {
    parts.push("Product onboarding context:");
    parts.push(`- Vision: ${truncateText(productContext.context.productVision || "", 1200)}`);
    parts.push(`- Primary users: ${truncateText(productContext.context.primaryUsers || "", 1000)}`);
    parts.push(`- Success metrics: ${truncateText(productContext.context.successMetrics || "", 1000)}`);
    parts.push(`- Constraints: ${truncateText(productContext.context.constraints || "", 1000)}`);
    parts.push(`- Integrations: ${truncateText(productContext.context.integrationLandscape || "", 1000)}`);
    parts.push(`- Competitive analysis: ${truncateText(productContext.context.competitiveNotes || "", 1200)}`);
  }
  if (githubDocs.length) {
    parts.push("GitHub scope docs:");
    for (const item of githubDocs) {
      parts.push(`- ${item.path}: ${item.excerpt}`);
    }
  }

  const summary = truncateText(parts.join("\n"), maxChars);
  return {
    summary,
    relatedIdeas,
    relatedCapabilities,
    githubDocs,
    productContext: productContext?.context || null,
    productIdeas: productIdeaSnapshots,
    contextMeta: {
      productIdeaCount: productIdeaSnapshots.length,
      productIdeaTotal: allProductIdeas.total,
      productIdeasTruncated: Boolean(allProductIdeas.truncated),
      relatedIdeaCount: relatedIdeas.length,
      relatedCapabilityCount: relatedCapabilities.length,
      githubDocCount: githubDocs.length,
      summaryChars: summary.length
    }
  };
}

function normalizeIdeaDetails(idea, context = null) {
  const details = idea.details || {};
  const goal = details.businessGoal
    || (context?.productName ? `Improve ${context.productName} outcomes with measurable capability delivery.` : "")
    || "Improve business outcomes with measurable capability delivery.";

  return {
    problemStatement: details.problemStatement || idea.description || "Problem statement not provided.",
    userPersona: details.userPersona || "Organization admin",
    businessGoal: goal,
    acceptanceCriteria: Array.isArray(details.acceptanceCriteria) && details.acceptanceCriteria.length > 0
      ? details.acceptanceCriteria
      : [
          "Stage artifacts are complete and reviewable",
          "PR includes context docs for approvals",
          "Quality gates are explicit and auditable"
        ],
    constraints: details.constraints || "No CI/CD automation in this phase; maintain enterprise auditability.",
    nonGoals: details.nonGoals || "Production deployment automation in this phase",
    attachments: Array.isArray(details.attachments) ? details.attachments : []
  };
}

function asString(value) {
  return String(value || "").trim();
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function mergeGeneratedIdeaDetails(seed = {}, generated = {}) {
  const seedDetails = seed && typeof seed === "object" ? seed : {};
  const generatedDetails = generated && typeof generated === "object" ? generated : {};
  return {
    problemStatement: asString(generatedDetails.problemStatement || seedDetails.problemStatement),
    userPersona: asString(generatedDetails.userPersona || seedDetails.userPersona),
    businessGoal: asString(generatedDetails.businessGoal || seedDetails.businessGoal),
    acceptanceCriteria: asStringList(generatedDetails.acceptanceCriteria).length
      ? asStringList(generatedDetails.acceptanceCriteria)
      : asStringList(seedDetails.acceptanceCriteria),
    constraints: asString(generatedDetails.constraints || seedDetails.constraints),
    nonGoals: asString(generatedDetails.nonGoals || seedDetails.nonGoals),
    attachments: asStringList(seedDetails.attachments)
  };
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function deriveIdeaTitleFromIntent(intentText, productId) {
  const cleaned = String(intentText || "")
    .replace(/^build\s+/i, "")
    .replace(/^create\s+/i, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `${productId} capability idea`;
  const words = cleaned.split(" ").slice(0, 8);
  return titleCaseWords(words.join(" "));
}

function deterministicIdeaFromContext({ intentText, seed, scopeContext, productId }) {
  const onboarding = scopeContext?.productContext || {};
  const primaryUsers = asString(onboarding.primaryUsers || "");
  const metrics = asString(onboarding.successMetrics || "");
  const constraints = asString(onboarding.constraints || "");

  const fallbackTitle = deriveIdeaTitleFromIntent(intentText, productId);
  const problem = asString(seed?.details?.problemStatement)
    || (intentText ? `Current workflow gap: ${intentText}` : `Workflow inefficiency exists in ${productId}.`);
  const goal = asString(seed?.details?.businessGoal)
    || (metrics ? `Improve ${metrics} for ${productId}.` : `Improve measurable productivity outcomes for ${productId}.`);
  const persona = asString(seed?.details?.userPersona) || primaryUsers || "Organization admin";
  const acceptanceCriteria = asStringList(seed?.details?.acceptanceCriteria);
  const baseCriteria = acceptanceCriteria.length
    ? acceptanceCriteria
    : [
        "Capture measurable KPI baseline and target.",
        "Define user journey and approval checkpoints.",
        "Document scope boundaries and integration touchpoints.",
        "Create PR-backed artifact with audit-ready traceability."
      ];

  return {
    title: asString(seed?.title) || fallbackTitle,
    description: asString(seed?.description) || `${fallbackTitle} for ${productId} in ${scopeContext?.summary ? "current scope context" : "enterprise context"}.`,
    details: {
      problemStatement: problem,
      userPersona: persona,
      businessGoal: goal,
      acceptanceCriteria: baseCriteria,
      constraints: asString(seed?.details?.constraints) || constraints || "Enterprise RBAC, audit logs, and tenant isolation are mandatory.",
      nonGoals: asString(seed?.details?.nonGoals) || "No CI/CD automation in this phase; no cross-tenant data sharing."
    }
  };
}

async function generateIdeaDraft({
  orgId,
  sandboxId,
  productId,
  intent = "",
  title = "",
  description = "",
  details = {},
  chatThread = [],
  conversationContext = null
}) {
  const llmEnabled = hasLlm();
  const seed = {
    title: asString(title),
    description: asString(description),
    details: details && typeof details === "object" ? details : {}
  };
  const intentText = asString(intent);
  const seedTitle = seed.title || intentText || `${productId} capability idea`;
  const seedDescription = seed.description || intentText || `Capability idea for ${productId}`;
  const pseudoIdea = {
    ideaId: `DRAFT-${Date.now()}`,
    orgId,
    sandboxId,
    productId,
    title: seedTitle,
    description: seedDescription,
    details: seed.details
  };

  const scopeContext = await loadOrgSandboxLlmContext(pseudoIdea, {
    maxChars: 28000,
    maxProductIdeas: 1200,
    includeGithubDocs: true
  });
  const normalizedConversationContext = conversationContext && typeof conversationContext === "object"
    ? {
        activeIdeaId: asString(conversationContext.activeIdeaId || ""),
        currentIdeasSummary: asString(conversationContext.currentIdeasSummary || ""),
        currentIdeas: Array.isArray(conversationContext.currentIdeas)
          ? conversationContext.currentIdeas
              .map((item) => ({
                ideaId: asString(item?.ideaId),
                title: asString(item?.title),
                description: asString(item?.description),
                status: asString(item?.status),
                createdAt: asString(item?.createdAt)
              }))
              .filter((item) => item.ideaId || item.title || item.description)
              .slice(0, 20)
          : []
      }
    : {
        activeIdeaId: "",
        currentIdeasSummary: "",
        currentIdeas: []
      };
  const deterministic = deterministicIdeaFromContext({
    intentText,
    seed,
    scopeContext,
    productId
  });
  const baselineTriage = buildIdeaTriageAnalysis(pseudoIdea, deriveOrgContext(pseudoIdea));
  const draft = await generateIdeaDraftWithLlm({
    orgId,
    sandboxId,
    productId,
    intent: intentText,
    seed,
    scopeContext,
    chatThread,
    conversationContext: normalizedConversationContext
  });
  const enrichmentRaw = await generateIdeaEnrichmentWithLlm({
    idea: pseudoIdea,
    triage: baselineTriage,
    scopeContext,
    conversationContext: normalizedConversationContext
  });
  const enrichment = normalizeIdeaEnrichment(enrichmentRaw, baselineTriage);

  const mergedDetails = mergeGeneratedIdeaDetails(seed.details, {
    problemStatement: draft?.details?.problemStatement || enrichment?.enrichedIdea?.problemStatement || deterministic.details.problemStatement,
    userPersona: draft?.details?.userPersona || enrichment?.enrichedIdea?.userPersona || deterministic.details.userPersona,
    businessGoal: draft?.details?.businessGoal || enrichment?.enrichedIdea?.businessGoal || deterministic.details.businessGoal,
    acceptanceCriteria: draft?.details?.acceptanceCriteria || enrichment?.enrichedIdea?.acceptanceCriteria || deterministic.details.acceptanceCriteria,
    constraints: draft?.details?.constraints
      || (enrichment?.enrichedIdea?.constraints || []).join("; ")
      || deterministic.details.constraints,
    nonGoals: draft?.details?.nonGoals
      || (enrichment?.enrichedIdea?.nonGoals || []).join("; ")
      || deterministic.details.nonGoals
  });

  const titleOut = asString(draft?.title || enrichment?.enrichedIdea?.title || deterministic.title || seedTitle);
  const descriptionOut = asString(
    draft?.description
      || enrichment?.enrichedIdea?.problemStatement
      || deterministic.description
      || seed.description
      || [mergedDetails.problemStatement, mergedDetails.businessGoal].filter(Boolean).join(" ")
      || seedDescription
  );
  const normalizedFallback = normalizeIdeaDetails(
    {
      description: descriptionOut,
      details: mergedDetails
    },
    deriveOrgContext(pseudoIdea)
  );
  const detailsOut = {
    problemStatement: mergedDetails.problemStatement || normalizedFallback.problemStatement,
    userPersona: mergedDetails.userPersona || normalizedFallback.userPersona,
    businessGoal: mergedDetails.businessGoal || normalizedFallback.businessGoal,
    acceptanceCriteria: mergedDetails.acceptanceCriteria.length
      ? mergedDetails.acceptanceCriteria
      : normalizedFallback.acceptanceCriteria,
    constraints: mergedDetails.constraints || normalizedFallback.constraints,
    nonGoals: mergedDetails.nonGoals || normalizedFallback.nonGoals,
    attachments: mergedDetails.attachments
  };

  const resolved = {
    ideaId: pseudoIdea.ideaId,
    orgId,
    sandboxId,
    productId,
    title: titleOut || `${productId} capability idea`,
    description: descriptionOut || `Capability idea for ${productId}`,
    details: detailsOut
  };
  const triage = buildIdeaTriageAnalysis(resolved, deriveOrgContext(resolved));
  const usedLlm = Boolean(draft || enrichment);
  const llmModel = draft?.__llmMeta?.model || enrichmentRaw?.__llmMeta?.model || null;
  return {
    source: usedLlm ? `llm:${process.env.OPENAI_MODEL || "gpt-4.1-mini"}` : "fallback",
    llmModel,
    title: resolved.title,
    description: resolved.description,
    details: resolved.details,
    triage,
    enrichment,
    llmEnabled,
    contextUsed: scopeContext?.contextMeta || {
      productIdeaCount: 0,
      productIdeaTotal: 0,
      productIdeasTruncated: false,
      relatedIdeaCount: 0,
      relatedCapabilityCount: 0,
      githubDocCount: 0,
      summaryChars: 0
    },
    conversationContextUsed: {
      activeIdeaId: normalizedConversationContext.activeIdeaId || "",
      currentIdeaCount: normalizedConversationContext.currentIdeas.length,
      hasCurrentIdeaSummary: Boolean(normalizedConversationContext.currentIdeasSummary)
    },
    fallbackReason: usedLlm ? null : (llmEnabled ? "llm_generation_failed_or_empty" : "missing_openai_api_key")
  };
}

function buildIdeaTriageAnalysis(idea, context = null) {
  const details = idea.details || {};
  const refinedIdea = normalizeIdeaDetails(idea, context);

  const missing = [];
  if (!details.problemStatement) missing.push("problemStatement");
  if (!details.userPersona) missing.push("userPersona");
  if (!details.businessGoal) missing.push("businessGoal");
  if (!Array.isArray(details.acceptanceCriteria) || details.acceptanceCriteria.length === 0) {
    missing.push("acceptanceCriteria");
  }

  const risks = [];
  if (!refinedIdea.constraints || String(refinedIdea.constraints).length < 20) {
    risks.push("Constraints are underspecified; implementation risk is high.");
  }
  if (!refinedIdea.nonGoals) {
    risks.push("Non-goals are not explicit; scope creep likely.");
  }
  if (!refinedIdea.attachments || refinedIdea.attachments.length === 0) {
    risks.push("No augmentation assets provided (images/diagrams/references).");
  }
  if ((context?.activeCapabilities || 0) > 8) {
    risks.push("High active capability load in this product; triage should de-risk dependencies.");
  }
  if ((context?.blockedCapabilities || 0) > 1) {
    risks.push("Existing blocked capabilities in this scope may impact delivery.");
  }

  const suggestions = [
    "Clarify measurable outcome and success metric for first release.",
    "Add explicit non-goals to prevent scope drift.",
    "Attach one architecture sketch or reference diagram.",
    "Map the capability to org/sandbox/product dependency constraints."
  ];

  return {
    readinessScore: Math.max(0, 100 - missing.length * 12 - risks.length * 8),
    missingInfo: missing,
    risks,
    suggestions,
    proposedCapabilityTitle: `${idea.title} capability`,
    refinedIdea,
    context
  };
}

function triageToMarkdown(idea, triage) {
  const refined = triage.refinedIdea || {};
  const ctx = triage.context || {};
  const criteria = Array.isArray(refined.acceptanceCriteria) ? refined.acceptanceCriteria : [];
  const risks = Array.isArray(triage.risks) ? triage.risks : [];
  const suggestions = Array.isArray(triage.suggestions) ? triage.suggestions : [];
  const gaps = Array.isArray(triage.missingInfo) ? triage.missingInfo : [];

  return [
    "# Triage Report",
    "",
    "## Scope Context",
    `- Organization: ${ctx.orgName || idea.orgId}`,
    `- Sandbox: ${ctx.sandboxName || idea.sandboxId}`,
    `- Product: ${ctx.productName || idea.productId}`,
    `- Active capabilities: ${ctx.activeCapabilities ?? "n/a"}`,
    `- Blocked capabilities: ${ctx.blockedCapabilities ?? "n/a"}`,
    "",
    "## Refined Idea",
    `- Problem statement: ${refined.problemStatement || ""}`,
    `- User persona: ${refined.userPersona || ""}`,
    `- Business goal: ${refined.businessGoal || ""}`,
    `- Constraints: ${refined.constraints || ""}`,
    `- Non-goals: ${refined.nonGoals || ""}`,
    "",
    "## Acceptance Criteria",
    ...criteria.map((item) => `- ${item}`),
    "",
    "## AI Triage",
    `- Readiness score: ${triage.readinessScore}`,
    `- Proposed capability title: ${triage.proposedCapabilityTitle}`,
    "",
    "## Gaps",
    ...(gaps.length ? gaps.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Risks",
    ...(risks.length ? risks.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Suggestions",
    ...suggestions.map((item) => `- ${item}`)
  ].join("\n");
}

function architectureDiagramFromContext({ title, refinedIdea, context }) {
  const lower = `${title || ""} ${refinedIdea?.problemStatement || ""} ${refinedIdea?.businessGoal || ""}`.toLowerCase();
  const hasEmployee = /employee|hr|workforce|staff/.test(lower);
  const hasMobile = /mobile|ios|android|app/.test(lower);
  const identity = hasEmployee ? "SSO / Directory" : "Identity Provider";
  const portal = hasEmployee ? "Employee App UI" : "User Experience UI";
  const client = hasMobile ? "Mobile Client" : "Web Client";

  return [
    "flowchart LR",
    `  ${client.replace(/\s+/g, "")}[${client}] --> ${portal.replace(/\s+/g, "")}[${portal}]`,
    `  ${portal.replace(/\s+/g, "")} --> ApiGateway[API Gateway]`,
    "  ApiGateway --> CapabilitySvc[Capability Service]",
    "  CapabilitySvc --> PolicySvc[Policy / Rules Service]",
    "  CapabilitySvc --> SearchSvc[Semantic Search Index]",
    "  CapabilitySvc --> Pg[(Postgres)]",
    `  ${portal.replace(/\s+/g, "")} --> Identity[${identity}]`,
    "  CapabilitySvc --> Obs[Metrics + Audit Logs]",
    `  Obs --> OrgDash[${(context?.orgName || "Organization")} Admin Dashboard]`
  ].join("\n");
}

function architectureMarkdownFromContext({ capability, triage, specDoc }) {
  const refined = triage?.refinedIdea || {};
  const context = triage?.context || {};
  const criteria = Array.isArray(refined.acceptanceCriteria) ? refined.acceptanceCriteria : [];
  const constraints = refined.constraints || "Enterprise governance and auditability";
  const nonGoals = refined.nonGoals || "CI/CD automation in this phase";
  const specExcerpt = (specDoc?.content || "").split("\n").slice(0, 14).join("\n");

  return [
    "# Architecture Draft (Auto-generated)",
    "",
    `## Capability`,
    `- ID: ${capability.capabilityId}`,
    `- Title: ${capability.title}`,
    `- Organization: ${context.orgName || capability.orgId}`,
    `- Sandbox: ${context.sandboxName || capability.sandboxId}`,
    `- Product: ${context.productName || capability.productId}`,
    "",
    "## Intent",
    `- Problem statement: ${refined.problemStatement || capability.description || "Not specified"}`,
    `- Business goal: ${refined.businessGoal || "Not specified"}`,
    "",
    "## Logical Components",
    "- Experience Layer: UI (web/mobile) and role-aware workflows",
    "- Application Layer: capability service, policy/rules service",
    "- Data Layer: transactional store + semantic index for search/augmentation",
    "- Platform Layer: identity, observability, audit pipeline",
    "",
    "## Key Constraints",
    `- ${constraints}`,
    "- Tenant-scoped access controls per organization/sandbox/product",
    "- Traceability from idea -> triage -> spec -> architecture -> PR",
    "",
    "## Non-goals",
    `- ${nonGoals}`,
    "",
    "## Acceptance Criteria Mapping",
    ...(criteria.length ? criteria.map((item) => `- ${item}`) : ["- Acceptance criteria pending"]),
    "",
    "## Spec Context Excerpt",
    "```text",
    specExcerpt || "No spec document available yet.",
    "```",
    "",
    "## Operational Notes",
    "- Emit metrics for stage transitions and PR synchronization outcomes",
    "- Record reviewer actions for product-factory and GitHub approvals",
    "- Alert on connector failures and branch sync drift"
  ].join("\n");
}

async function getCapabilityRepoBranch(capability) {
  const config = await getFactoryConfig();
  const repo = Array.isArray(config.codeRepos) && config.codeRepos.length > 0
    ? config.codeRepos[0]
    : "goravind/probable-doodle";
  const branchPrefix = config.branchPrefix || "capability";
  const branch = capabilityBranchFromScope(branchPrefix, capability);
  return { repo, branch };
}

async function buildAutoArchitectureDraft(capabilityId) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };
  const idea = capability.ideaId ? await getFactoryIdea(capability.ideaId) : null;
  if (!idea) return { error: "Idea not found for capability" };
  const context = deriveOrgContext(idea);
  const triage = buildIdeaTriageAnalysis(idea, context);
  const scopeContext = await loadOrgSandboxLlmContext(idea);
  const { repo, branch } = await getCapabilityRepoBranch(capability);
  const docsBase = docsBaseFromScope({
    orgId: capability.orgId,
    sandboxId: capability.sandboxId,
    productId: capability.productId,
    ideaId: capability.ideaId
  });
  const gitDocs = await readGithubDocsFromBranch({
    repo,
    branch,
    paths: [`${docsBase}/spec.md`, `${docsBase}/triage.md`],
    orgId: capability.orgId
  });

  const localSpecDoc = await getLatestFactoryStageDoc(capabilityId, "spec");
  const specDoc = {
    content: gitDocs?.files?.[`${docsBase}/spec.md`] || localSpecDoc?.content || ""
  };
  const triageFromGit = gitDocs?.files?.[`${docsBase}/triage.md`] || "";
  if (triageFromGit) {
    triage.refinedIdea.problemStatement = triage.refinedIdea.problemStatement || triageFromGit.split("\n").slice(0, 8).join(" ");
  }

  const llmDraft = await generateStageDraftWithLlm({
    stageKey: "architecture",
    capability,
    idea,
    triage,
    existingContent: [specDoc.content, triageFromGit].filter(Boolean).join("\n\n"),
    scopeContext
  });
  if (llmDraft?.content) {
    return {
      capability,
      idea,
      triage,
      content: llmDraft.content,
      diagramSource: llmDraft.diagramSource || ""
    };
  }

  return {
    capability,
    idea,
    triage,
    content: architectureMarkdownFromContext({ capability, triage, specDoc }),
    diagramSource: architectureDiagramFromContext({
      title: capability.title,
      refinedIdea: triage.refinedIdea,
      context: triage.context
    })
  };
}

function aiReviewDocument(stageKey, content) {
  const text = String(content || "").trim();
  const short = text.length < 240;
  const hasAcceptance = /acceptance|success criteria|definition of done/i.test(text);
  const hasRisks = /risk|constraint|dependency/i.test(text);
  const hasOps = /monitor|metric|alert|rollback|slo/i.test(text);

  const issues = [];
  if (short) issues.push("Document is too short for a production gate.");
  if (!hasAcceptance) issues.push("Missing clear acceptance criteria.");
  if (!hasRisks) issues.push("Dependencies and risks are not explicit.");
  if ((stageKey === "architecture" || stageKey === "compliance") && !hasOps) {
    issues.push("Operational considerations are missing (metrics/alerts/rollback).");
  }

  return {
    stageKey,
    verdict: issues.length ? "needs-work" : "strong",
    challenges: issues.length ? issues : ["No critical issues found."],
    improvements: [
      "Add concrete test scenarios tied to acceptance criteria.",
      "Document failure modes and mitigation plans.",
      "Add at least one executable example or sequence diagram."
    ]
  };
}

async function triageIdeaToCapability({ ideaId, capabilityTitle, actor }) {
  const idea = await getFactoryIdea(ideaId);
  if (!idea) return { error: "Idea not found" };
  const context = deriveOrgContext(idea);
  const triage = buildIdeaTriageAnalysis(idea, context);

  const capabilityId = `CAP-${Date.now()}`;
  const capability = await upsertFactoryCapability({
    capabilityId,
    ideaId,
    orgId: idea.orgId,
    sandboxId: idea.sandboxId,
    productId: idea.productId,
    title: capabilityTitle || triage.proposedCapabilityTitle || idea.title,
    description: idea.description,
    stage: "triage",
    status: "in_progress",
    history: [{ type: "triaged", actor: actor || "triage-agent", at: nowIso() }]
  });

  await updateFactoryIdeaStatus(ideaId, "triaged");
  return { idea, capability, triage };
}

async function writeSpec({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "triage");
  if (guard) return guard;

  const idea = capability.ideaId ? await getFactoryIdea(capability.ideaId) : null;
  const context = idea ? deriveOrgContext(idea) : null;
  const triage = idea ? buildIdeaTriageAnalysis(idea, context) : null;
  const scopeContext = idea ? await loadOrgSandboxLlmContext(idea) : null;

  const fallbackSections = {
    user: triage?.refinedIdea?.userPersona || "Enterprise team member",
    successCriteria: Array.isArray(triage?.refinedIdea?.acceptanceCriteria) && triage.refinedIdea.acceptanceCriteria.length > 0
      ? triage.refinedIdea.acceptanceCriteria
      : ["Feature works in stage", "Tests are generated", "PR is produced"],
    scope: triage?.refinedIdea?.problemStatement || capability.description || "MVP scope for capability",
    outOfScope: triage?.refinedIdea?.nonGoals || "CI/CD deployment",
    cogs: "Estimated from generated components"
  };

  const llmSections = await generateSpecSectionsWithLlm({ capability, idea, triage, scopeContext });
  const sections = llmSections || fallbackSections;

  const spec = {
    capabilityId,
    generatedBy: llmSections ? `llm:${process.env.OPENAI_MODEL || "gpt-4.1-mini"}` : "deterministic-fallback",
    llmEnabled: hasLlm(),
    sections
  };

  await addFactoryArtifact({
    artifactId: `ART-${Date.now()}-spec`,
    capabilityId,
    artifactType: "spec",
    version: 1,
    content: spec
  });

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "spec",
    history: addHistory(capability, { type: "spec-written", actor: actor || "spec-agent" })
  });

  return { capability: updated, spec };
}

async function approveSpec({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "spec");
  if (guard) return guard;

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "spec-approved",
    history: addHistory(capability, { type: "spec-approved", actor: actor || "product-approver" })
  });

  return { capability: updated };
}

async function writeArchitecture({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "spec-approved");
  if (guard) return guard;

  const architecture = {
    capabilityId,
    services: ["api-service", "frontend-module"],
    data: ["postgres", "vector-index optional"],
    constraints: ["backward compatibility", "auditability"]
  };

  await addFactoryArtifact({
    artifactId: `ART-${Date.now()}-arch`,
    capabilityId,
    artifactType: "architecture",
    version: 1,
    content: architecture
  });

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "architecture",
    history: addHistory(capability, { type: "architecture-written", actor: actor || "architecture-agent" })
  });

  return { capability: updated, architecture };
}

async function approveArchitecture({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "architecture");
  if (guard) return guard;

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "architecture-approved",
    history: addHistory(capability, { type: "architecture-approved", actor: actor || "architecture-approver" })
  });

  return { capability: updated };
}

async function runCompliance({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "architecture-approved");
  if (guard) return guard;

  await addFactoryArtifact({
    artifactId: `ART-${Date.now()}-compliance`,
    capabilityId,
    artifactType: "compliance",
    version: 1,
    content: {
      checks: ["data handling", "access control", "logging"],
      result: "approved"
    }
  });

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "compliance",
    history: addHistory(capability, { type: "compliance-approved", actor: actor || "compliance-agent" })
  });

  return { capability: updated };
}

async function approveCompliance({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "compliance");
  if (guard) return guard;

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "compliance-approved",
    history: addHistory(capability, { type: "compliance-approved", actor: actor || "compliance-approver" })
  });

  return { capability: updated };
}

async function buildToPr({ capabilityId, actor }) {
  const capability = await getFactoryCapability(capabilityId);
  const guard = stageGuard(capability, "compliance-approved");
  if (guard) return guard;

  const generatedFiles = [
    `src/features/${capabilityId.toLowerCase()}/handler.ts`,
    `src/features/${capabilityId.toLowerCase()}/schema.ts`,
    `test/features/${capabilityId.toLowerCase()}.test.ts`
  ];

  await addFactoryArtifact({
    artifactId: `ART-${Date.now()}-build`,
    capabilityId,
    artifactType: "build-plan",
    version: 1,
    content: {
      generatedFiles,
      tests: ["unit", "integration"],
      source: "agent-composed pipeline"
    }
  });

  const config = await getFactoryConfig();
  const codeRepos = Array.isArray(config.codeRepos) && config.codeRepos.length > 0
    ? config.codeRepos
    : ["goravind/probable-doodle"];
  const repoMode = config.repoMode === "multi" ? "multi" : "single";
  const targetCodeRepos = repoMode === "multi" ? codeRepos : [codeRepos[0]];
  const configuredTicketRepos = Array.isArray(config.ticketRepos) && config.ticketRepos.length > 0
    ? config.ticketRepos
    : [targetCodeRepos[0]];
  const ticketRepos = repoMode === "multi" ? configuredTicketRepos : [configuredTicketRepos[0]];
  const labels = Array.isArray(config.ticketLabels) ? config.ticketLabels : [];
  const branchPrefix = config.branchPrefix || "capability";
  const areaLabel = config.ticketArea ? `area:${config.ticketArea}` : null;
  const mergedLabels = areaLabel ? [...new Set([...labels, areaLabel])] : labels;

  const prTitle = `[${capability.productId}/${capabilityId}] ${capability.title}`;
  const prDescription = "Auto-generated by Product Factory capability build pipeline";
  const prs = [];
  for (const repo of targetCodeRepos) {
    const prId = `PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const branch = capabilityBranchFromScope(branchPrefix, capability);
  const prResult = await createGithubPullRequest({
      repo,
      branch,
      title: prTitle,
      description: prDescription,
      files: generatedFiles,
      orgId: capability.orgId
    });

    const pr = await createFactoryPullRequest({
      prId,
      capabilityId,
      repo,
      branch: prResult.branch || branch,
      title: prTitle,
      description: prDescription,
      files: generatedFiles,
      status: prLikeStatusFromSyncMode(prResult.mode),
      externalUrl: prResult.url || null,
      createdAt: nowIso()
    });
    prs.push(pr);
  }

  const tickets = [];
  for (const repo of ticketRepos) {
    const ticketTitle = `[${capability.productId}/${capabilityId}] ${capability.title} implementation`;
    const ticketBody = `Capability: ${capabilityId}\\nStage: build\\nRepos: ${targetCodeRepos.join(", ")}.`;
    const issue = await createGithubIssue(repo, ticketTitle, ticketBody, mergedLabels, capability.orgId);

    const ticket = await createFactoryTicket({
      ticketId: `TICKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      capabilityId,
      repo,
      title: ticketTitle,
      body: ticketBody,
      labels: mergedLabels,
      status: prLikeStatusFromSyncMode(issue.mode),
      externalUrl: issue.url || null,
      createdAt: nowIso()
    });
    tickets.push(ticket);
  }

  const updated = await upsertFactoryCapability({
    ...capability,
    stage: "pr-created",
    status: "ready_for_review",
    history: addHistory(capability, {
      type: "pr-created",
      actor: actor || "pipeline-agent",
      prId: prs[0] ? prs[0].prId : null
    })
  });

  return {
    capability: updated,
    pr: prs[0] || null,
    prs,
    prUrl: prs[0]?.externalUrl || null,
    tickets
  };
}

async function runIdeaToPr({ ideaId, capabilityTitle, actor }) {
  const triaged = await triageIdeaToCapability({ ideaId, capabilityTitle, actor });
  if (triaged.error) return triaged;

  const capabilityId = triaged.capability.capabilityId;

  const spec = await writeSpec({ capabilityId, actor });
  if (spec.error) return spec;

  const specApproval = await approveSpec({ capabilityId, actor });
  if (specApproval.error) return specApproval;

  const arch = await writeArchitecture({ capabilityId, actor });
  if (arch.error) return arch;

  const archApproval = await approveArchitecture({ capabilityId, actor });
  if (archApproval.error) return archApproval;

  const compliance = await runCompliance({ capabilityId, actor });
  if (compliance.error) return compliance;

  const complianceApproval = await approveCompliance({ capabilityId, actor });
  if (complianceApproval.error) return complianceApproval;

  const build = await buildToPr({ capabilityId, actor });
  if (build.error) return build;

  return {
    idea: triaged.idea,
    capability: build.capability,
    pr: build.pr,
    prUrl: build.prUrl,
    artifacts: await listFactoryArtifacts(capabilityId)
  };
}

async function aiTriageIdea(ideaId) {
  const idea = await getFactoryIdea(ideaId);
  if (!idea) return { error: "Idea not found" };
  const context = deriveOrgContext(idea);
  return {
    idea,
    triage: buildIdeaTriageAnalysis(idea, context)
  };
}

async function saveStageDocument({
  capabilityId,
  stageKey,
  content,
  attachments = [],
  diagramSource = "",
  status = "draft",
  actor = "unknown"
}) {
  pipelineLog("stage_doc.write.start", { capabilityId, stageKey, status, actor });
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };
  const latest = await getLatestFactoryStageDoc(capabilityId, stageKey);
  const doc = await createFactoryStageDoc({
    docId: `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    capabilityId,
    stageKey,
    version: latest ? latest.version + 1 : 1,
    content: String(content || ""),
    attachments,
    diagramSource,
    status,
    createdBy: actor,
    createdAt: nowIso()
  });

  await addFactoryArtifact({
    artifactId: `ART-${Date.now()}-${stageKey}-doc`,
    capabilityId,
    artifactType: `${stageKey}-doc`,
    version: doc.version,
    content: {
      docId: doc.docId,
      stageKey,
      status: doc.status
    }
  });

  pipelineLog("stage_doc.write.success", { capabilityId, stageKey, version: doc.version, docId: doc.docId });

  if (stageKey === "triage" || stageKey === "spec") {
    autoGenerateArchitectureForCapability({
      capabilityId,
      actor: `${actor}:auto-evolve`,
      source: `context-evolved:${stageKey}`
    }).catch(() => {});
  }

  return { capability, doc };
}

async function getStageDocument(capabilityId, stageKey) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };
  const latest = await getLatestFactoryStageDoc(capabilityId, stageKey);
  const versions = await listFactoryStageDocs(capabilityId, stageKey);
  return { capability, latest, versions };
}

async function aiReviewStageDocument(capabilityId, stageKey) {
  const latest = await getLatestFactoryStageDoc(capabilityId, stageKey);
  if (!latest) return { error: "No stage document found" };
  return {
    stageKey,
    doc: latest,
    review: aiReviewDocument(stageKey, latest.content)
  };
}

function complianceMarkdownFromContext({ capability, triage }) {
  const refined = triage?.refinedIdea || {};
  return [
    "# Compliance Draft (Auto-generated)",
    "",
    `## Capability`,
    `- ID: ${capability.capabilityId}`,
    `- Title: ${capability.title}`,
    "",
    "## Control Objectives",
    "- Enforce tenant isolation by organization/sandbox/product scope",
    "- Ensure auditable approval and stage transitions",
    "- Protect PII and sensitive business records",
    "",
    "## Risks",
    ...(Array.isArray(triage?.risks) && triage.risks.length ? triage.risks.map((item) => `- ${item}`) : ["- Risks pending explicit capture"]),
    "",
    "## Constraints",
    `- ${refined.constraints || "Enterprise governance constraints apply"}`,
    "",
    "## Non-goals",
    `- ${refined.nonGoals || "Automated production deployment in this phase"}`
  ].join("\n");
}

function buildMarkdownFromContext({ capability, triage }) {
  const criteria = Array.isArray(triage?.refinedIdea?.acceptanceCriteria) ? triage.refinedIdea.acceptanceCriteria : [];
  return [
    "# Build Plan (AI-assisted)",
    "",
    `## Capability`,
    `- ID: ${capability.capabilityId}`,
    `- Title: ${capability.title}`,
    "",
    "## Generated Components",
    `- src/features/${capability.capabilityId.toLowerCase()}/handler.ts`,
    `- src/features/${capability.capabilityId.toLowerCase()}/schema.ts`,
    `- test/features/${capability.capabilityId.toLowerCase()}.test.ts`,
    "",
    "## Validation",
    ...(criteria.length ? criteria.map((item) => `- ${item}`) : ["- Validate capability acceptance criteria"]),
    "",
    "## Delivery Notes",
    "- Open PR with stage docs attached",
    "- Create ticket in configured area",
    "- Keep traceability from idea to implementation"
  ].join("\n");
}

function toStringList(items, fallback = []) {
  if (!Array.isArray(items)) return fallback;
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeIdeaEnrichment(raw, triage) {
  if (!raw || typeof raw !== "object") return null;
  const enrichedIdea = raw.enrichedIdea || {};
  const enrichedTriage = raw.triage || {};
  const competitive = Array.isArray(raw.competitiveAnalysis) ? raw.competitiveAnalysis : [];
  const richContent = raw.richContent || {};

  return {
    enrichedIdea: {
      title: String(enrichedIdea.title || "").trim(),
      problemStatement: String(enrichedIdea.problemStatement || triage?.refinedIdea?.problemStatement || "").trim(),
      userPersona: String(enrichedIdea.userPersona || triage?.refinedIdea?.userPersona || "").trim(),
      businessGoal: String(enrichedIdea.businessGoal || triage?.refinedIdea?.businessGoal || "").trim(),
      outcomes: Array.isArray(enrichedIdea.outcomes) ? enrichedIdea.outcomes : [],
      scope: {
        inScope: toStringList(enrichedIdea?.scope?.inScope),
        outOfScope: toStringList(enrichedIdea?.scope?.outOfScope)
      },
      acceptanceCriteria: toStringList(enrichedIdea.acceptanceCriteria),
      constraints: toStringList(enrichedIdea.constraints),
      nonGoals: toStringList(enrichedIdea.nonGoals),
      dependencies: toStringList(enrichedIdea.dependencies),
      assumptions: toStringList(enrichedIdea.assumptions),
      openQuestions: toStringList(enrichedIdea.openQuestions)
    },
    triage: {
      readinessScore: Math.max(0, Math.min(100, Number(enrichedTriage.readinessScore || triage?.readinessScore || 0))),
      priority: String(enrichedTriage.priority || "p2").toLowerCase(),
      businessValue: String(enrichedTriage.businessValue || "medium").toLowerCase(),
      effort: String(enrichedTriage.effort || "medium").toLowerCase(),
      riskLevel: String(enrichedTriage.riskLevel || "medium").toLowerCase(),
      riskItems: Array.isArray(enrichedTriage.riskItems) ? enrichedTriage.riskItems : [],
      recommendedNextStep: String(enrichedTriage.recommendedNextStep || "").trim()
    },
    architectureSeed: raw.architectureSeed || {},
    competitiveAnalysis: competitive,
    richContent: {
      markdownSections: toStringList(richContent.markdownSections),
      imagePrompts: toStringList(richContent.imagePrompts),
      architectureDiagramPrompt: String(richContent.architectureDiagramPrompt || "").trim(),
      suggestedArtifacts: toStringList(richContent.suggestedArtifacts)
    },
    githubArtifacts: raw.githubArtifacts || {}
  };
}

function ideaEnrichmentToMarkdown(enrichment, triage) {
  const idea = enrichment?.enrichedIdea || {};
  const tri = enrichment?.triage || {};
  const competitive = Array.isArray(enrichment?.competitiveAnalysis) ? enrichment.competitiveAnalysis : [];
  const outcomes = Array.isArray(idea.outcomes) ? idea.outcomes : [];

  return [
    "# Idea Enrichment (AI)",
    "",
    "## Refined Goal",
    idea.businessGoal || triage?.refinedIdea?.businessGoal || "",
    "",
    "## Problem + Persona",
    `- Problem: ${idea.problemStatement || triage?.refinedIdea?.problemStatement || ""}`,
    `- Persona: ${idea.userPersona || triage?.refinedIdea?.userPersona || ""}`,
    "",
    "## Outcomes",
    ...(outcomes.length
      ? outcomes.map((item) => `- ${item.metric || "Metric"}: ${item.baseline || "n/a"} -> ${item.target || "n/a"} (${item.timeframe || "n/a"})`)
      : ["- Outcomes pending"]),
    "",
    "## In Scope",
    ...(idea.scope?.inScope?.length ? idea.scope.inScope.map((item) => `- ${item}`) : ["- pending"]),
    "",
    "## Out Of Scope",
    ...(idea.scope?.outOfScope?.length ? idea.scope.outOfScope.map((item) => `- ${item}`) : ["- pending"]),
    "",
    "## Acceptance Criteria",
    ...(idea.acceptanceCriteria?.length ? idea.acceptanceCriteria.map((item) => `- ${item}`) : (triage?.refinedIdea?.acceptanceCriteria || []).map((item) => `- ${item}`)),
    "",
    "## Competitive Analysis",
    ...(competitive.length
      ? competitive.flatMap((item) => [
          `- ${item.name || "Competitor"} (${item.competitorType || "adjacent"})`,
          ...(Array.isArray(item.strengths) ? item.strengths.map((x) => `  - Strength: ${x}`) : []),
          ...(Array.isArray(item.weaknesses) ? item.weaknesses.map((x) => `  - Weakness: ${x}`) : []),
          ...(Array.isArray(item.differentiation) ? item.differentiation.map((x) => `  - Differentiation: ${x}`) : [])
        ])
      : ["- No competitor data generated"]),
    "",
    "## Rich Content Suggestions",
    ...(enrichment?.richContent?.imagePrompts?.length
      ? enrichment.richContent.imagePrompts.map((item) => `- Image prompt: ${item}`)
      : ["- Image prompt suggestions pending"]),
    ...(enrichment?.richContent?.architectureDiagramPrompt
      ? [`- Architecture diagram prompt: ${enrichment.richContent.architectureDiagramPrompt}`]
      : []),
    ...(enrichment?.richContent?.suggestedArtifacts?.length
      ? enrichment.richContent.suggestedArtifacts.map((item) => `- Artifact: ${item}`)
      : []),
    "",
    "## Generated Images",
    "- AI-generated images are attached to this stage document for in-app preview.",
    "",
    "## Triage Decision",
    `- Readiness score: ${tri.readinessScore || triage?.readinessScore || 0}`,
    `- Priority: ${tri.priority || "p2"}`,
    `- Business value: ${tri.businessValue || "medium"}`,
    `- Effort: ${tri.effort || "medium"}`,
    `- Risk level: ${tri.riskLevel || "medium"}`,
    ...(tri.recommendedNextStep ? [`- Recommended next step: ${tri.recommendedNextStep}`] : [])
  ].join("\n");
}

function enrichmentCompetitiveMarkdown(enrichment) {
  const items = Array.isArray(enrichment?.competitiveAnalysis) ? enrichment.competitiveAnalysis : [];
  if (!items.length) return "";
  const lines = [
    "",
    "## Competitive Analysis (AI)"
  ];
  for (const item of items) {
    lines.push(`- ${item.name || "Competitor"} (${item.competitorType || "adjacent"})`);
    if (Array.isArray(item.strengths)) item.strengths.forEach((x) => lines.push(`  - Strength: ${x}`));
    if (Array.isArray(item.weaknesses)) item.weaknesses.forEach((x) => lines.push(`  - Weakness: ${x}`));
    if (Array.isArray(item.differentiation)) item.differentiation.forEach((x) => lines.push(`  - Differentiation: ${x}`));
  }
  return lines.join("\n");
}

async function aiAssistIdea(ideaId) {
  const idea = await getFactoryIdea(ideaId);
  if (!idea) return { error: "Idea not found" };
  const context = deriveOrgContext(idea);
  const baselineTriage = buildIdeaTriageAnalysis(idea, context);
  const scopeContext = await loadOrgSandboxLlmContext(idea);
  const llmEnrichment = await generateIdeaEnrichmentWithLlm({
    idea,
    triage: baselineTriage,
    scopeContext
  });
  const enrichment = normalizeIdeaEnrichment(llmEnrichment, baselineTriage);
  const generatedImages = enrichment?.richContent?.imagePrompts?.length
    ? await generateImagesWithLlm({
        prompts: enrichment.richContent.imagePrompts.slice(0, 2),
        size: "1024x1024",
        maxImages: 2
      })
    : [];
  const mergedTriage = enrichment
    ? {
        ...baselineTriage,
        readinessScore: enrichment.triage.readinessScore || baselineTriage.readinessScore,
        refinedIdea: {
          ...baselineTriage.refinedIdea,
          problemStatement: enrichment.enrichedIdea.problemStatement || baselineTriage.refinedIdea.problemStatement,
          userPersona: enrichment.enrichedIdea.userPersona || baselineTriage.refinedIdea.userPersona,
          businessGoal: enrichment.enrichedIdea.businessGoal || baselineTriage.refinedIdea.businessGoal,
          acceptanceCriteria: enrichment.enrichedIdea.acceptanceCriteria.length
            ? enrichment.enrichedIdea.acceptanceCriteria
            : baselineTriage.refinedIdea.acceptanceCriteria,
          constraints: enrichment.enrichedIdea.constraints.length
            ? enrichment.enrichedIdea.constraints.join("; ")
            : baselineTriage.refinedIdea.constraints,
          nonGoals: enrichment.enrichedIdea.nonGoals.length
            ? enrichment.enrichedIdea.nonGoals.join("; ")
            : baselineTriage.refinedIdea.nonGoals
        },
        risks: enrichment.triage.riskItems.length
          ? enrichment.triage.riskItems.map((item) => `${item.risk || "Risk"} | Mitigation: ${item.mitigation || "pending"}`)
          : baselineTriage.risks,
        suggestions: [
          ...(baselineTriage.suggestions || []),
          ...(enrichment.richContent.suggestedArtifacts || []),
          ...(enrichment.richContent.imagePrompts || []).map((item) => `Generate asset: ${item}`)
        ].slice(0, 12)
      }
    : baselineTriage;

  const llmDraft = enrichment
    ? {
        content: ideaEnrichmentToMarkdown(enrichment, mergedTriage),
        diagramSource: "",
        highlights: [
          `priority:${enrichment.triage.priority || "p2"}`,
          `value:${enrichment.triage.businessValue || "medium"}`,
          `effort:${enrichment.triage.effort || "medium"}`
        ],
        attachments: generatedImages.map((item) => item.dataUrl)
      }
    : await generateStageDraftWithLlm({
        stageKey: "idea",
        capability: { title: idea.title, description: idea.description },
        idea,
        triage: mergedTriage,
        existingContent: idea.description || "",
        scopeContext
      });
  return {
    idea,
    triage: mergedTriage,
    assist: llmDraft || {
      content: [
        `# Idea Refinement`,
        ``,
        `- Problem: ${mergedTriage.refinedIdea.problemStatement}`,
        `- Persona: ${mergedTriage.refinedIdea.userPersona}`,
        `- Business goal: ${mergedTriage.refinedIdea.businessGoal}`
      ].join("\n"),
      diagramSource: "",
      highlights: mergedTriage.suggestions || [],
      attachments: []
    },
    enrichment
  };
}

async function suggestIdeas({ orgId, sandboxId, productId, businessGoal = "", limit = 5 }) {
  const pseudoIdea = {
    ideaId: `SCOPE-${orgId}-${sandboxId}-${productId}`,
    orgId,
    sandboxId,
    productId,
    title: "Context suggestion scope",
    description: businessGoal || "Identify high-value ideas for this scope",
    details: { businessGoal }
  };
  const scopeContext = await loadOrgSandboxLlmContext(pseudoIdea);
  const llmSuggestions = await generateIdeaSuggestionsWithLlm({
    orgId,
    sandboxId,
    productId,
    businessGoal,
    scopeContext,
    limit
  });

  const fallback = [
    {
      title: `Self-service workflow automation for ${productId}`,
      description: "Reduce manual handoffs with guided workflows and approvals.",
      businessValue: "high",
      effort: "medium",
      priority: "p1",
      reasoning: "Frequent enterprise ask; leverages existing access and pipeline context."
    },
    {
      title: `${productId} health score and anomaly detection`,
      description: "Create operational scorecards with proactive incident signals.",
      businessValue: "high",
      effort: "medium",
      priority: "p1",
      reasoning: "Directly improves org admin productivity and capability health visibility."
    },
    {
      title: `Context-aware assistant for ${sandboxId} ${productId}`,
      description: "Use semantic search over org/sandbox docs for faster decisions.",
      businessValue: "medium",
      effort: "medium",
      priority: "p2",
      reasoning: "Builds on document corpus and accelerates triage/spec quality."
    }
  ].slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));

  return {
    scope: { orgId, sandboxId, productId, businessGoal },
    source: Array.isArray(llmSuggestions) && llmSuggestions.length > 0
      ? `llm:${process.env.OPENAI_MODEL || "gpt-4.1-mini"}`
      : "fallback",
    suggestions: Array.isArray(llmSuggestions) && llmSuggestions.length > 0 ? llmSuggestions : fallback,
    contextUsed: {
      relatedIdeas: scopeContext.relatedIdeas.length,
      relatedCapabilities: scopeContext.relatedCapabilities.length,
      githubDocs: scopeContext.githubDocs.length
    }
  };
}

async function aiGenerateStageDocument({ capabilityId, stageKey, actor = "unknown", intent = "" }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };
  const idea = capability.ideaId ? await getFactoryIdea(capability.ideaId) : null;
  if (!idea) return { error: "Idea not found for capability" };
  const context = deriveOrgContext(idea);
  const triage = buildIdeaTriageAnalysis(idea, context);
  const scopeContext = await loadOrgSandboxLlmContext(idea);
  const existing = await getLatestFactoryStageDoc(capabilityId, stageKey);

  const humanIntent = String(intent || "").trim();
  const llmDraft = await generateStageDraftWithLlm({
    stageKey,
    capability,
    idea,
    triage,
    existingContent: [existing?.content || "", humanIntent ? `## Human Intent\n${humanIntent}` : ""].filter(Boolean).join("\n\n"),
    scopeContext
  });

  let content = "";
  let diagramSource = "";
  let attachments = existing?.attachments || [];
  if (llmDraft?.content) {
    content = llmDraft.content;
    diagramSource = llmDraft.diagramSource || "";
  } else if (stageKey === "spec") {
    if (capability.stage === "triage") {
      const spec = await writeSpec({ capabilityId, actor });
      if (spec.error) return spec;
      content = specToMarkdown(spec.spec);
    } else {
      if (existing?.content) {
        content = existing.content;
      } else {
        const artifacts = await listFactoryArtifacts(capabilityId);
        const specArtifact = [...artifacts]
          .reverse()
          .find((item) => item.artifactType === "spec" && item.content);
        content = specArtifact ? specToMarkdown(specArtifact.content) : "";
      }
    }
  } else if (stageKey === "architecture") {
    const auto = await buildAutoArchitectureDraft(capabilityId);
    if (auto.error) return auto;
    content = auto.content;
    diagramSource = auto.diagramSource || "";
    const archImages = await generateImagesWithLlm({
      prompts: [
        `Enterprise architecture diagram for capability ${capability.title} in ${idea.orgId}/${idea.sandboxId}/${idea.productId}. Show user app, API gateway, services, data store, identity, observability.`
      ],
      size: "1024x1024",
      maxImages: 1
    });
    if (archImages.length) {
      attachments = [...attachments, ...archImages.map((item) => item.dataUrl)];
    }
  } else if (stageKey === "compliance") {
    content = complianceMarkdownFromContext({ capability, triage });
  } else if (stageKey === "build") {
    content = buildMarkdownFromContext({ capability, triage });
  } else if (stageKey === "triage") {
    content = triageToMarkdown(idea, triage);
  } else {
    content = existing?.content || "";
    diagramSource = existing?.diagramSource || "";
  }

  const saved = await saveStageDocument({
    capabilityId,
    stageKey,
    content,
    attachments,
    diagramSource,
    status: "draft",
    actor
  });
  if (saved.error) return saved;

  return {
    capability,
    stageKey,
    source: llmDraft?.content ? `llm:${process.env.OPENAI_MODEL || "gpt-4.1-mini"}` : "fallback",
    doc: saved.doc
  };
}

async function autoGenerateArchitectureForCapability({ capabilityId, actor = "architecture-agent-auto", source = "contextual-ai" }) {
  const draft = await buildAutoArchitectureDraft(capabilityId);
  if (draft.error) return draft;

  const saved = await saveStageDocument({
    capabilityId,
    stageKey: "architecture",
    content: draft.content,
    attachments: [],
    diagramSource: draft.diagramSource,
    status: "draft",
    actor
  });
  if (saved.error) return saved;

  return {
    capability: draft.capability,
    stageKey: "architecture",
    source,
    doc: saved.doc
  };
}

function summarizeRendition(content = "") {
  const lines = String(content || "").split("\n");
  const headings = lines.filter((line) => /^#{1,3}\s+/.test(line)).map((line) => line.replace(/^#{1,3}\s+/, "").trim());
  const bullets = lines.filter((line) => /^-\s+/.test(line)).slice(0, 8).map((line) => line.replace(/^-\s+/, "").trim());
  const firstParagraph = lines.find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("```")) || "";
  return {
    headline: headings[0] || "",
    firstParagraph: firstParagraph.trim(),
    sections: headings,
    highlights: bullets
  };
}

async function getStageRendition({ capabilityId, stageKey, source = "auto" }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };

  const config = await getFactoryConfig();
  const repo = Array.isArray(config.codeRepos) && config.codeRepos.length > 0
    ? config.codeRepos[0]
    : "goravind/probable-doodle";
  const branchPrefix = config.branchPrefix || "capability";
  const branch = capabilityBranchFromScope(branchPrefix, capability);
  const docsBase = docsBaseFromScope({
    orgId: capability.orgId,
    sandboxId: capability.sandboxId,
    productId: capability.productId,
    ideaId: capability.ideaId
  });
  const stagePath = `${docsBase}/${stageKey}.md`;
  const diagramPath = `${docsBase}/${stageKey}.mmd`;

  let mode = "local";
  let content = "";
  let diagramSource = "";
  const preferGithub = source === "github" || source === "auto";
  if (preferGithub) {
    const github = await readGithubDocsFromBranch({
      repo,
      branch,
      paths: [stagePath, diagramPath],
      orgId: capability.orgId
    });
    const fromGit = github?.files || {};
    if (fromGit[stagePath] || fromGit[diagramPath]) {
      mode = "github";
      content = fromGit[stagePath] || "";
      diagramSource = fromGit[diagramPath] || "";
    }
  }

  if (!content && !diagramSource) {
    const local = await getLatestFactoryStageDoc(capabilityId, stageKey);
    content = local?.content || "";
    diagramSource = local?.diagramSource || "";
  }

  return {
    capability,
    stageKey,
    source: mode,
    content,
    diagramSource,
    rendition: summarizeRendition(content)
  };
}

async function syncStageToPr({ capabilityId, stageKey, actor = "unknown" }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };

  const doc = await getLatestFactoryStageDoc(capabilityId, stageKey);
  if (!doc) return { error: "No stage document found to sync" };

  const config = await getFactoryConfig();
  const repo = Array.isArray(config.codeRepos) && config.codeRepos.length > 0
    ? config.codeRepos[0]
    : "goravind/probable-doodle";
  const branchPrefix = config.branchPrefix || "capability";
  const branch = capabilityBranchFromScope(branchPrefix, capability);
  const prTitle = `[${capability.productId}/${capabilityId}] ${capability.title}`;
  const prDescription = `Stage sync: ${stageKey}`;

  const docsBase = docsBaseFromScope({
    orgId: capability.orgId,
    sandboxId: capability.sandboxId,
    productId: capability.productId,
    ideaId: capability.ideaId
  });
  const files = [
    {
      path: `${docsBase}/${stageKey}.md`,
      content: doc.content
    }
  ];

  if (doc.diagramSource && doc.diagramSource.trim()) {
    files.push({
      path: `${docsBase}/${stageKey}.mmd`,
      content: doc.diagramSource
    });
  }

  if (stageKey === "spec") {
    const triageDoc = await getLatestFactoryStageDoc(capabilityId, "triage");
    if (triageDoc && triageDoc.content) {
      files.push({
        path: `${docsBase}/triage.md`,
        content: triageDoc.content
      });
    }
  }

  const result = await syncDocsToPullRequest({
    repo,
    branch,
    title: prTitle,
    description: prDescription,
    files,
    orgId: capability.orgId
  });

  const existingPr = await getFactoryPullRequestByCapability(capabilityId);
  const prId = existingPr?.prId || `PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const pr = await createFactoryPullRequest({
    prId,
    capabilityId,
    repo,
    branch: result.branch || branch,
    title: prTitle,
    description: prDescription,
    files: files.map((item) => item.path),
    status: prLikeStatusFromSyncMode(result.mode),
    externalUrl: result.url || existingPr?.externalUrl || null,
    createdAt: existingPr?.createdAt || nowIso(),
    updatedBy: actor
  });

  return {
    capability,
    stageKey,
    doc,
    pr,
    sync: result
  };
}

async function applyWebhookSignal({ capabilityId, signal }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };

  if (signal === "approved" && capability.stage === "triage") {
    return createSpecPrFromCapability({ capabilityId, actor: "github-webhook" });
  }
  if (signal === "approved" && capability.stage === "spec") {
    return approveSpec({ capabilityId, actor: "github-webhook" });
  }
  if (signal === "approved" && capability.stage === "architecture") {
    return approveArchitecture({ capabilityId, actor: "github-webhook" });
  }
  if (signal === "approved" && capability.stage === "compliance") {
    return approveCompliance({ capabilityId, actor: "github-webhook" });
  }
  return { capability, ignored: true };
}

function specToMarkdown(spec) {
  const sections = spec.sections || {};
  const criteria = Array.isArray(sections.successCriteria) ? sections.successCriteria : [];
  return [
    `# Spec`,
    ``,
    `## User`,
    `${sections.user || ""}`,
    ``,
    `## Scope`,
    `${sections.scope || ""}`,
    ``,
    `## Success Criteria`,
    ...criteria.map((item) => `- ${item}`),
    ``,
    `## Out of Scope`,
    `${sections.outOfScope || ""}`,
    ``,
    `## COGS`,
    `${sections.cogs || ""}`
  ].join("\n");
}

function ideaToMarkdown(idea) {
  const details = idea.details || {};
  const criteria = Array.isArray(details.acceptanceCriteria) ? details.acceptanceCriteria : [];
  return [
    "# Idea Submission",
    "",
    `## Title`,
    `${idea.title}`,
    "",
    "## Description",
    `${idea.description || ""}`,
    "",
    "## User Persona",
    `${details.userPersona || ""}`,
    "",
    "## Business Goal",
    `${details.businessGoal || ""}`,
    "",
    "## Problem Statement",
    `${details.problemStatement || ""}`,
    "",
    "## Acceptance Criteria",
    ...(criteria.length ? criteria.map((item) => `- ${item}`) : ["- none provided"]),
    "",
    "## Constraints",
    `${details.constraints || ""}`,
    "",
    "## Non-goals",
    `${details.nonGoals || ""}`
  ].join("\n");
}

async function createSpecPrFromCapability({ capabilityId, actor = "unknown" }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };
  if (capability.stage !== "triage" && capability.stage !== "spec") {
    return { error: `Cannot generate spec from stage ${capability.stage}` };
  }

  let specResult = { capability };
  if (capability.stage === "triage") {
    specResult = await writeSpec({ capabilityId, actor });
    if (specResult.error) return specResult;
  }

  const artifacts = await listFactoryArtifacts(capabilityId);
  const latestSpecArtifact = [...artifacts].reverse().find((item) => item.artifactType === "spec" && item.content);
  if (!latestSpecArtifact) return { error: "Spec artifact not found" };

  const docSave = await saveStageDocument({
    capabilityId,
    stageKey: "spec",
    content: specToMarkdown(latestSpecArtifact.content),
    attachments: [],
    diagramSource: "",
    status: "draft",
    actor
  });
  if (docSave.error) return docSave;

  const sync = await syncStageToPr({ capabilityId, stageKey: "spec", actor });
  if (sync.error) return sync;

  return {
    capability: specResult.capability || capability,
    spec: latestSpecArtifact.content,
    doc: docSave.doc,
    pr: sync.pr,
    sync: sync.sync
  };
}

async function createTriagePrFromIdea({ ideaId, capabilityTitle, actor = "unknown" }) {
  pipelineLog("triage_pr.create.start", { ideaId, actor });
  let triaged = null;
  const existingCapability = await getFactoryCapabilityByIdea(ideaId);
  if (existingCapability) {
    const idea = await getFactoryIdea(ideaId);
    if (!idea) return { error: "Idea not found" };
    const context = deriveOrgContext(idea);
    triaged = {
      idea,
      capability: existingCapability,
      triage: buildIdeaTriageAnalysis(idea, context)
    };
  } else {
    triaged = await triageIdeaToCapability({ ideaId, capabilityTitle, actor });
    if (triaged.error) return triaged;
  }

  const capabilityId = triaged.capability.capabilityId;
  const config = await getFactoryConfig();
  const repo = Array.isArray(config.codeRepos) && config.codeRepos.length > 0
    ? config.codeRepos[0]
    : "goravind/probable-doodle";
  const branchPrefix = config.branchPrefix || "capability";
  const branch = capabilityBranchFromScope(branchPrefix, triaged.capability);
  const prTitle = `[${triaged.capability.productId}/${capabilityId}] ${triaged.capability.title} · Triage`;
  const prDescription = "Auto-generated triage PR (raw idea + AI enrichment)";
  const docsBase = docsBaseFromScope({
    orgId: triaged.capability.orgId,
    sandboxId: triaged.capability.sandboxId,
    productId: triaged.capability.productId,
    ideaId: triaged.capability.ideaId
  });

  const rawIdea = ideaToMarkdown(triaged.idea);
  const assisted = await aiAssistIdea(ideaId);
  const enrichedIdea = assisted?.assist?.content || rawIdea;
  const triageSource = assisted?.triage || triaged.triage;
  const triageReport = `${triageToMarkdown(triaged.idea, triageSource)}${enrichmentCompetitiveMarkdown(assisted?.enrichment)}`;

  const rawDocSave = await saveStageDocument({
    capabilityId,
    stageKey: "idea",
    content: enrichedIdea,
    attachments: Array.isArray(assisted?.assist?.attachments) ? assisted.assist.attachments : [],
    diagramSource: "",
    status: "draft",
    actor
  });
  if (rawDocSave.error) return rawDocSave;

  const triageDocSave = await saveStageDocument({
    capabilityId,
    stageKey: "triage",
    content: triageReport,
    attachments: [],
    diagramSource: "",
    status: "draft",
    actor
  });
  if (triageDocSave.error) return triageDocSave;

  let result = null;
  try {
    result = await syncDocsToPullRequest({
      repo,
      branch,
      title: prTitle,
      description: prDescription,
      files: [
        {
          path: `${docsBase}/idea.md`,
          content: rawIdea,
          message: `triage(raw): capture original idea ${ideaId}`
        },
        {
          path: `${docsBase}/idea.md`,
          content: enrichedIdea,
          message: `triage(ai): enrich idea using org/sandbox context ${ideaId}`
        },
        {
          path: `${docsBase}/triage.md`,
          content: triageReport,
          message: `triage(ai): add LLM enrichment for ${capabilityId}`
        }
      ],
      orgId: triaged.capability.orgId
    });
  } catch (error) {
    pipelineLog("triage_pr.sync.failed", {
      ideaId,
      capabilityId,
      repo,
      branch,
      reason: String(error?.message || error || "sync_failed")
    });
    throw error;
  }
  pipelineLog("triage_pr.sync.completed", {
    ideaId,
    capabilityId,
    mode: result?.mode || "unknown",
    repo,
    branch: result?.branch || branch,
    url: result?.url || null
  });

  const pr = await createFactoryPullRequest({
    prId: `PR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    capabilityId,
    repo,
    branch: result.branch || branch,
    title: prTitle,
    description: prDescription,
    files: [`${docsBase}/idea.md`, `${docsBase}/triage.md`],
    status: prLikeStatusFromSyncMode(result.mode),
    externalUrl: result.url || null,
    createdAt: nowIso(),
    updatedBy: actor
  });
  pipelineLog("triage_pr.record.created", {
    ideaId,
    capabilityId,
    prId: pr.prId,
    status: pr.status
  });

  return {
    idea: triaged.idea,
    triage: triaged.triage,
    capability: triaged.capability,
    triageRawDoc: rawDocSave.doc,
    triageDoc: triageDocSave.doc,
    pr,
    sync: result
  };
}

async function createSpecPrFromIdea({ ideaId, capabilityTitle, actor = "unknown" }) {
  const existingCapability = await getFactoryCapabilityByIdea(ideaId);
  let triage = null;
  if (existingCapability) {
    const idea = await getFactoryIdea(ideaId);
    if (!idea) return { error: "Idea not found" };
    triage = {
      idea,
      triage: buildIdeaTriageAnalysis(idea, deriveOrgContext(idea)),
      triageDoc: await getLatestFactoryStageDoc(existingCapability.capabilityId, "triage"),
      capability: existingCapability,
      pr: await getFactoryPullRequestByCapability(existingCapability.capabilityId)
    };
  } else {
    triage = await createTriagePrFromIdea({ ideaId, capabilityTitle, actor });
    if (triage.error) return triage;
  }
  const spec = await createSpecPrFromCapability({ capabilityId: triage.capability.capabilityId, actor });
  if (spec.error) return spec;
  return {
    idea: triage.idea,
    triage: triage.triage,
    triageDoc: triage.triageDoc,
    triagePr: triage.pr,
    capability: spec.capability,
    spec: spec.spec,
    doc: spec.doc,
    pr: spec.pr,
    sync: spec.sync
  };
}

async function approveStageWithGithub({ capabilityId, stageKey, actor = "unknown", note = "" }) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return { error: "Capability not found" };

  const latest = await getLatestFactoryStageDoc(capabilityId, stageKey);
  if (!latest) return { error: `No ${stageKey} document found` };

  const sync = await syncStageToPr({ capabilityId, stageKey, actor });
  if (sync.error) return sync;

  let githubApproval = { mode: "draft", skipped: true };
  const prNumber = parsePrNumberFromUrl(sync.pr?.externalUrl || sync.sync?.url || null);
  const canApproveInGithub = Boolean(prNumber && sync.pr?.repo);
  if (!canApproveInGithub) {
    githubApproval = {
      mode: "local",
      prId: sync.pr?.prId || null,
      state: "APPROVED",
      url: null,
      note: note || `Stage ${stageKey} approved in Product Factory (local mode)`
    };
  }

  if (canApproveInGithub) {
    try {
      githubApproval = await approveGithubPullRequest({
        repo: sync.pr.repo,
        prNumber,
        body: note || `Stage ${stageKey} approved in Product Factory`,
        orgId: capability.orgId
      });
    } catch (error) {
      githubApproval = {
        mode: "github-error",
        repo: sync.pr.repo,
        prNumber,
        state: "APPROVAL_FAILED",
        error: String(error?.message || error || "GitHub approval failed"),
        nonFatal: false
      };
    }
  }

  const approvalOk = String(githubApproval?.state || "").toUpperCase() === "APPROVED";
  if (!approvalOk) {
    return {
      error: "Stage transition blocked. Pull request is not approved.",
      githubApproval,
      pr: sync.pr,
      sync: sync.sync
    };
  }

  // Keep immutable history by creating an approved version snapshot only after PR approval.
  await createFactoryStageDoc({
    docId: `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    capabilityId,
    stageKey,
    version: latest.version + 1,
    content: latest.content,
    attachments: latest.attachments || [],
    diagramSource: latest.diagramSource || "",
    status: "approved",
    createdBy: actor,
    createdAt: nowIso()
  });

  let transition = { capability };
  if (stageKey === "triage" || stageKey === "spec" || stageKey === "architecture" || stageKey === "compliance") {
    transition = await applyWebhookSignal({ capabilityId, signal: "approved" });
    if (transition.error) return transition;
  }

  return {
    capability: transition.capability || capability,
    stageKey,
    githubApproval,
    pr: sync.pr,
    sync: sync.sync,
    transitionSource: "pull-request-approval"
  };
}

async function getFactoryCapabilityDetail(capabilityId) {
  const capability = await getFactoryCapability(capabilityId);
  if (!capability) return null;

  return {
    capability,
    artifacts: await listFactoryArtifacts(capabilityId),
    pr: await getFactoryPullRequestByCapability(capabilityId),
    tickets: await listFactoryTickets(capabilityId)
  };
}

module.exports = {
  STAGES,
  createIdea,
  generateIdeaDraft,
  suggestIdeas,
  aiAssistIdea,
  aiTriageIdea,
  triageIdeaToCapability,
  writeSpec,
  approveSpec,
  writeArchitecture,
  approveArchitecture,
  runCompliance,
  approveCompliance,
  buildToPr,
  runIdeaToPr,
  getFactoryCapabilityDetail,
  saveStageDocument,
  getStageDocument,
  aiReviewStageDocument,
  aiGenerateStageDocument,
  autoGenerateArchitectureForCapability,
  getStageRendition,
  syncStageToPr,
  applyWebhookSignal,
  createTriagePrFromIdea,
  createSpecPrFromCapability,
  createSpecPrFromIdea,
  approveStageWithGithub
};
