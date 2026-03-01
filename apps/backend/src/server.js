const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

function parseEnvValue(raw = "") {
  const value = String(raw || "").trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadLocalEnvFile() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../../../.env")
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] != null && String(process.env[key]).length > 0) continue;
      process.env[key] = parseEnvValue(match[2]);
    }
    return;
  }
}

loadLocalEnvFile();

const {
  data,
  allowedStages,
  getOrganizations,
  getOrganization,
  getSandbox,
  getProduct,
  getCapabilityState,
  transitionCapabilityState,
  getCapabilityEvents,
  summarizeOrg,
  listAgents,
  getCapabilityAgents,
  semanticSearch
} = require("./data");
const { MetricsStore } = require("./metrics");
const {
  resolveIdentity,
  canAccessOrganization,
  canAccessSandbox,
  canAccessProduct,
  requireRoles
} = require("./core/rbac");
const {
  listMembershipsByOrg,
  upsertMembership,
  listConnectors,
  markConnectorSync,
  upsertConnector,
  getGithubConnectorByOrg,
  initializeStore,
  getFactoryConfig,
  upsertFactoryConfig,
  getFactoryProductContext,
  upsertFactoryProductContext,
  listFactoryIdeasByProductScope,
  getFactoryIdea,
  updateFactoryIdea,
  listFactorySandboxes,
  upsertFactorySandbox,
  listFactoryProducts,
  upsertFactoryProduct,
  purgeFactoryProducts
} = require("./core/store");
const {
  hasGithubAppConfig,
  encodeInstallState,
  decodeInstallState,
  buildInstallUrl,
  listAppInstallations
} = require("./core/github_app_auth");
const {
  buildCapabilityContext,
  orchestrateCapability,
  getOrchestrationStatus
} = require("./core/orchestrator");
const {
  createIdea,
  generateIdeaDraft,
  suggestIdeas,
  aiAssistIdea,
  aiTriageIdea,
  runIdeaToPr,
  triageIdeaToCapability,
  writeSpec,
  approveSpec,
  writeArchitecture,
  approveArchitecture,
  runCompliance,
  buildToPr,
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
} = require("./core/factory_pipeline");
const { getLlmHealth } = require("./core/llm");

const FRONTEND_ROOT = path.resolve(__dirname, "../../frontend");
const MOCKS_ROOT = path.resolve(__dirname, "../../../mocks");

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function forbidden(res, reason = "Forbidden") {
  json(res, 403, { error: reason });
}

function readStaticAssetFromRoot(rootPath, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const targetPath = path.join(rootPath, cleanPath);
  const normalizedPath = path.normalize(targetPath);

  if (!normalizedPath.startsWith(rootPath)) return null;
  if (!fs.existsSync(normalizedPath) || fs.statSync(normalizedPath).isDirectory()) return null;

  const ext = path.extname(normalizedPath);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[ext] || "application/octet-stream";

  return { content: fs.readFileSync(normalizedPath), mime };
}

function readBody(req) {
  const maxBodyBytes = Math.max(1024 * 1024, Number(process.env.MAX_REQUEST_BODY_BYTES || (12 * 1024 * 1024)));
  return new Promise((resolve, reject) => {
    let buffer = "";
    req.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maxBodyBytes) reject(new Error("Request body too large"));
    });
    req.on("end", () => resolve(buffer));
    req.on("error", reject);
  });
}

function normalizeMultimodalImages(value, { maxImages = 3, maxDataUrlChars = 2_000_000 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(item) || /^https?:\/\//i.test(item))
    .filter((item) => item.length <= maxDataUrlChars)
    .slice(0, maxImages);
}

function nowIso() {
  return new Date().toISOString();
}

function buildCorrelationId(req) {
  const provided = String(req?.headers?.["x-correlation-id"] || "").trim();
  if (provided) return provided.slice(0, 120);
  return `corr-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function logEvent(event, data = {}) {
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

async function loadCurrentIdeasContextPack({
  orgId,
  sandboxId,
  productId,
  activeIdeaId = "",
  limit = 12
}) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(20, Number(limit))) : 12;
  const ideasPayload = await listFactoryIdeasByProductScope({
    orgId,
    sandboxId,
    productId,
    limit: safeLimit,
    offset: 0
  });
  const ideas = Array.isArray(ideasPayload?.ideas)
    ? ideasPayload.ideas.map((item) => ({
        ideaId: item.ideaId,
        title: item.title,
        description: item.description,
        status: item.status || "new",
        createdAt: item.createdAt || "",
        isActive: Boolean(activeIdeaId) && item.ideaId === activeIdeaId
      }))
    : [];
  const statusCounts = ideas.reduce((acc, item) => {
    const key = String(item.status || "new");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const topTitles = ideas.slice(0, 5).map((item) => `${item.ideaId}: ${item.title}`);
  const summaryLines = [
    `Current product ideas (latest ${ideas.length} / total ${Number(ideasPayload?.total || ideas.length)}):`,
    ...topTitles.map((item) => `- ${item}`)
  ];
  if (activeIdeaId) {
    summaryLines.push(`Active idea in focus: ${activeIdeaId}`);
  }
  return {
    ideas,
    summary: summaryLines.join("\n"),
    meta: {
      totalIdeas: Number(ideasPayload?.total || ideas.length),
      loadedIdeas: ideas.length,
      statusCounts,
      activeIdeaId: activeIdeaId || null
    }
  };
}

function buildIdeaAssistantReply(draft, latestUserMessage = "", imageCount = 0, contextMeta = null) {
  const details = draft?.details || {};
  const triage = draft?.triage || {};
  const criteria = Array.isArray(details.acceptanceCriteria) ? details.acceptanceCriteria : [];
  const suggestions = Array.isArray(triage.suggestions) ? triage.suggestions : [];
  const risks = Array.isArray(triage.risks) ? triage.risks : [];
  const lines = [];
  if (latestUserMessage) {
    lines.push(`Applied your refinement: "${latestUserMessage}".`);
  }
  if (imageCount > 0) {
    lines.push(`Processed ${imageCount} image attachment(s) for multimodal enrichment.`);
  }
  lines.push(`Updated headline: ${draft?.title || "Untitled idea"}`);
  lines.push(`Readiness score: ${triage.readinessScore ?? "n/a"}`);
  if (contextMeta && Number.isFinite(Number(contextMeta.loadedIdeas))) {
    lines.push(`Context grounding: ${Number(contextMeta.loadedIdeas)} current ideas loaded for this product.`);
  }
  if (suggestions.length) lines.push(`Top suggestion: ${suggestions[0]}`);
  if (risks.length) lines.push(`Primary risk: ${risks[0]}`);
  if (criteria.length) lines.push(`Acceptance criteria count: ${criteria.length}`);
  lines.push("Continue refining or submit the idea to open a PR.");
  return lines.join("\n");
}

function getOrgProductivity(org) {
  const summary = summarizeOrg(org);
  const products = org.sandboxes.flatMap((sandbox) => sandbox.products);

  const productHealth = products.map((product) => {
    const capabilitiesWithState = product.capabilities.map((capability) => ({
      ...capability,
      stage: (getCapabilityState(capability.id) || { stage: capability.stage }).stage
    }));

    const blocked = capabilitiesWithState.filter((capability) => capability.blockedBy).length;
    const monthlyCogs = capabilitiesWithState.reduce((sum, capability) => sum + capability.cogs, 0);
    const active = capabilitiesWithState.length;

    return {
      id: product.id,
      name: product.name,
      activeCapabilities: active,
      blockedCapabilities: blocked,
      monthlyCogs,
      cycleTimeDays: Number((2.8 + active * 0.3).toFixed(1)),
      status: blocked > 1 ? "needs-action" : "healthy"
    };
  });

  return {
    organization: { id: org.id, name: org.name },
    metrics: {
      activeCapabilities: summary.activeCapabilities,
      blockedCapabilities: summary.blockedCapabilities,
      avgCycleTimeDays: 4.3,
      qualityPassRate: summary.qualityPassRate,
      monthlyCogs: summary.monthlyCogs,
      onTimeDeliveryRate: 91
    },
    productHealth,
    accessEvents: [
      "Ava granted Nina access: Production Sandbox -> CRM.",
      "Chris requested elevated role for release approvals (pending).",
      "Omar removed from Marketplace product scope."
    ]
  };
}

function getPlatformDashboard() {
  return {
    platformHealth: data.platformHealth,
    services: data.platformServices,
    actions: [
      "Connector incident: Jira sync retries exceeded across 3 tenants.",
      "Factory upgrade: pipeline-runner v2 rollout paused by elevated error rate.",
      "Queue pressure: approval sync backlog above threshold for 17 minutes.",
      "Security: rotate expired connector token for GitHub integration."
    ]
  };
}

async function listScopedProducts(orgId, sandboxId, options = {}) {
  const includeStatic = options.includeStatic === true;
  const sandbox = getSandbox(orgId, sandboxId);
  const staticProducts = includeStatic && Array.isArray(sandbox?.products)
    ? sandbox.products.map((product) => ({ id: product.id, name: product.name, source: "static" }))
    : [];
  const dynamicProducts = await listFactoryProducts({ orgId, sandboxId });
  const map = new Map();
  for (const item of staticProducts) {
    map.set(item.id, { id: item.id, name: item.name, source: item.source });
  }
  for (const item of dynamicProducts) {
    map.set(item.id, { id: item.id, name: item.name, source: "dynamic", description: item.description || "" });
  }
  return Array.from(map.values());
}

async function handleApi(req, res, url, metrics, identity, requestMeta = {}) {
  const pathname = url.pathname;
  const correlationId = String(requestMeta?.correlationId || "");

  if (pathname === "/api/v1/health" && req.method === "GET") {
    json(res, 200, { status: "ok", service: "probable-toodle-backend" });
    return "api.health";
  }

  if (pathname === "/api/v1/platform/dashboard" && req.method === "GET") {
    if (!requireRoles(identity, ["platform_admin"])) {
      forbidden(res, "Platform admin role required");
      return "api.platform.dashboard.forbidden";
    }
    json(res, 200, getPlatformDashboard());
    return "api.platform.dashboard";
  }

  if (pathname === "/api/v1/system/overview" && req.method === "GET") {
    json(res, 200, {
      identity,
      capabilities: {
        agentComposed: true,
        semanticSearch: true,
        statefulWorkflow: true,
        connectors: true,
        orchestration: true
      },
      endpoints: {
        agents: "/api/v1/agents",
        semanticSearch: "/api/v1/semantic/search",
        connectors: "/api/v1/connectors",
        orchestrate: "/api/v1/capabilities/:id/orchestrate"
      }
    });
    return "api.system.overview";
  }

  if (pathname === "/api/v1/system/llm-health" && req.method === "GET") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.system.llm_health.forbidden";
    }
    const health = await getLlmHealth();
    json(res, 200, { llm: health });
    return "api.system.llm_health";
  }

  if (pathname === "/api/v1/organizations" && req.method === "GET") {
    json(res, 200, { organizations: getOrganizations() });
    return "api.organizations";
  }

  if (pathname === "/api/v1/factory/config" && req.method === "GET") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.config.forbidden";
    }
    json(res, 200, { config: await getFactoryConfig() });
    return "api.factory.config";
  }

  if (pathname === "/api/v1/factory/config" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.config.write.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.config.write.invalid";
    }
    const config = await upsertFactoryConfig(payload);
    json(res, 200, { config });
    return "api.factory.config.write";
  }

  if (pathname === "/api/v1/factory/product-context" && req.method === "GET") {
    const orgId = url.searchParams.get("orgId") || "";
    const sandboxId = url.searchParams.get("sandboxId") || "";
    const productId = url.searchParams.get("productId") || "";
    if (!orgId || !sandboxId || !productId) {
      json(res, 400, { error: "orgId, sandboxId and productId are required" });
      return "api.factory.product_context.invalid";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.product_context.scope_forbidden";
    }
    const entry = await getFactoryProductContext({ orgId, sandboxId, productId });
    json(res, 200, { productContext: entry });
    return "api.factory.product_context";
  }

  if (pathname === "/api/v1/factory/product-context" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.product_context.write.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.product_context.write.invalid";
    }
    const required = ["orgId", "sandboxId", "productId"];
    const missing = required.filter((key) => !payload[key]);
    if (missing.length) {
      json(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return "api.factory.product_context.write.missing";
    }
    if (!canAccessOrganization(identity, payload.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.product_context.write.scope_forbidden";
    }
    const entry = await upsertFactoryProductContext({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      context: payload.context || {},
      updatedBy: identity.userId
    });
    json(res, 200, { productContext: entry });
    return "api.factory.product_context.write";
  }

  if (pathname === "/api/v1/factory/admin/purge-products" && req.method === "POST") {
    if (!requireRoles(identity, ["platform_admin", "organization_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.purge_products.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      payload = {};
    }
    const orgId = payload.orgId || null;
    const sandboxId = payload.sandboxId || null;
    if (orgId && !canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.purge_products.scope_forbidden";
    }
    const result = await purgeFactoryProducts({ orgId, sandboxId });
    json(res, 200, { result });
    return "api.factory.purge_products";
  }

  if (pathname === "/api/v1/factory/ideas" && req.method === "GET") {
    const orgId = url.searchParams.get("orgId") || "";
    const sandboxId = url.searchParams.get("sandboxId") || "";
    const productId = url.searchParams.get("productId") || "";
    const page = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("pageSize") || "10");
    if (!orgId || !sandboxId || !productId) {
      json(res, 400, { error: "orgId, sandboxId and productId are required" });
      return "api.factory.ideas.list.invalid";
    }
    if (!canAccessSandbox(identity, orgId, sandboxId)) {
      forbidden(res, "No sandbox access");
      return "api.factory.ideas.list.scope_forbidden";
    }
    const safePage = Number.isFinite(page) ? Math.max(1, page) : 1;
    const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.min(50, pageSize)) : 10;
    const offset = (safePage - 1) * safePageSize;
    const result = await listFactoryIdeasByProductScope({
      orgId,
      sandboxId,
      productId,
      limit: safePageSize,
      offset
    });
    json(res, 200, {
      orgId,
      sandboxId,
      productId,
      page: safePage,
      pageSize: safePageSize,
      total: result.total,
      ideas: result.ideas
    });
    return "api.factory.ideas.list";
  }

  if (pathname === "/api/v1/factory/ideas" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.ideas.create.forbidden";
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.ideas.create.invalid";
    }

    const required = ["orgId", "sandboxId", "productId"];
    const missing = required.filter((key) => !payload[key]);
    if (missing.length) {
      json(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return "api.factory.ideas.create.missing";
    }
    const hasMinimalIntent = Boolean(String(payload.intent || "").trim());
    const hasStructuredSeed = Boolean(String(payload.title || "").trim()) && Boolean(String(payload.description || "").trim());
    if (!hasMinimalIntent && !hasStructuredSeed) {
      json(res, 400, { error: "Provide either `intent` or both `title` and `description`." });
      return "api.factory.ideas.create.intent_required";
    }

    if (!canAccessOrganization(identity, payload.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.ideas.create.scope_forbidden";
    }

    const productContext = await getFactoryProductContext({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId
    });
    if (!productContext || !productContext.context || !String(productContext.context.productVision || "").trim()) {
      json(res, 400, {
        error: "Product onboarding is required before ideas. Complete product context first.",
        requiredAction: "open-product-onboarding",
        scope: {
          orgId: payload.orgId,
          sandboxId: payload.sandboxId,
          productId: payload.productId
        }
      });
      return "api.factory.ideas.create.missing_product_context";
    }

    logEvent("idea.create.start", {
      correlationId,
      actor: identity.userId,
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      autoPipeline: payload.autoPipeline !== false
    });

    const result = await createIdea({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      title: payload.title,
      description: payload.description,
      details: payload.details || {},
      intent: payload.intent || "",
      actor: identity.userId
    });
    logEvent("idea.create.generated", {
      correlationId,
      ideaId: result?.idea?.ideaId || null,
      source: result?.generation?.source || "unknown"
    });
    const autoPipeline = payload.autoPipeline !== false;
    if (!autoPipeline) {
      json(res, 200, { ...result, autoPipeline: "disabled", correlationId });
      return "api.factory.ideas.create";
    }

    let triagePr = null;
    try {
      logEvent("idea.pr_pipeline.start", {
        correlationId,
        ideaId: result.idea.ideaId
      });
      triagePr = await createTriagePrFromIdea({
        ideaId: result.idea.ideaId,
        capabilityTitle: payload.capabilityTitle || `${result.idea.title} capability`,
        actor: identity.userId
      });
    } catch (error) {
      const reason = String(error?.message || error || "triage_pr_creation_failed");
      logEvent("idea.pr_pipeline.exception", {
        correlationId,
        ideaId: result.idea.ideaId,
        reason
      });
      json(res, 502, {
        error: "Idea created but PR creation failed",
        reason,
        correlationId,
        idea: result.idea,
        actions: ["retry-submit-idea", "open-factory-config", "reconnect-github"]
      });
      return "api.factory.ideas.create.pr_pipeline_exception";
    }
    if (triagePr.error) {
      logEvent("idea.pr_pipeline.failed", {
        correlationId,
        ideaId: result.idea.ideaId,
        reason: triagePr.error
      });
      json(res, 502, {
        error: "Idea created but PR creation failed",
        reason: triagePr.error,
        correlationId,
        idea: result.idea,
        actions: ["retry-submit-idea", "open-factory-config", "reconnect-github"]
      });
      return "api.factory.ideas.create.auto_pipeline_error";
    }
    if (!triagePr.pr || !triagePr.pr.prId) {
      const reason = "No PR metadata was returned from the triage pipeline.";
      logEvent("idea.pr_pipeline.missing_pr", {
        correlationId,
        ideaId: result.idea.ideaId
      });
      json(res, 502, {
        error: "Idea created but PR creation failed",
        reason,
        correlationId,
        idea: result.idea,
        triagePr,
        actions: ["retry-submit-idea", "open-factory-config", "reconnect-github"]
      });
      return "api.factory.ideas.create.missing_pr";
    }

    logEvent("idea.pr_pipeline.success", {
      correlationId,
      ideaId: result.idea.ideaId,
      capabilityId: triagePr?.capability?.capabilityId || null,
      prId: triagePr?.pr?.prId || null,
      prStatus: triagePr?.pr?.status || null
    });

    json(res, 200, {
      ...result,
      autoPipeline: "idea-to-triage-pr",
      triagePr,
      correlationId,
      stageGate: {
        locked: true,
        currentStage: triagePr.capability?.stage || "triage",
        blockedUntil: "triage-pr-approved"
      }
    });
    return "api.factory.ideas.create";
  }

  if (pathname === "/api/v1/factory/ideas/ai-draft" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.ideas.ai_draft.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.ideas.ai_draft.invalid";
    }
    const required = ["orgId", "sandboxId", "productId"];
    const missing = required.filter((key) => !payload[key]);
    if (missing.length) {
      json(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return "api.factory.ideas.ai_draft.missing";
    }
    if (!canAccessOrganization(identity, payload.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.ideas.ai_draft.scope_forbidden";
    }
    if (!String(payload.intent || "").trim() && !String(payload.title || "").trim()) {
      json(res, 400, { error: "Provide at least an intent or seed title for AI draft generation." });
      return "api.factory.ideas.ai_draft.intent_required";
    }
    const draft = await generateIdeaDraft({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      intent: payload.intent || "",
      title: payload.title || "",
      description: payload.description || "",
      details: payload.details || {}
    });
    json(res, 200, { draft });
    return "api.factory.ideas.ai_draft";
  }

  if (pathname === "/api/v1/factory/ideas/ai-chat-enrich" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.ideas.ai_chat.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.ideas.ai_chat.invalid";
    }
    const required = ["orgId", "sandboxId", "productId", "headline", "description"];
    const missing = required.filter((key) => !String(payload[key] || "").trim());
    if (missing.length) {
      json(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return "api.factory.ideas.ai_chat.missing";
    }
    if (!canAccessOrganization(identity, payload.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.ideas.ai_chat.scope_forbidden";
    }

    const thread = Array.isArray(payload.messages)
      ? payload.messages
          .map((item) => ({
            role: item?.role === "assistant" ? "assistant" : "user",
            content: String(item?.content || "").trim(),
            images: normalizeMultimodalImages(item?.images)
          }))
          .filter((item) => item.content || (Array.isArray(item.images) && item.images.length > 0))
          .slice(-18)
      : [];
    const conversation = thread
      .map((item) => `${item.role.toUpperCase()}: ${item.content || "[image message]"}${item.images.length ? ` (images:${item.images.length})` : ""}`)
      .join("\n");
    const activeIdeaId = String(payload.ideaId || "").trim();
    logEvent("idea.enrichment.start", {
      correlationId,
      actor: identity.userId,
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      activeIdeaId: activeIdeaId || null,
      messageCount: thread.length
    });
    const currentIdeasContext = await loadCurrentIdeasContextPack({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      activeIdeaId
    });
    const intent = [
      `Headline: ${String(payload.headline).trim()}`,
      `Description: ${String(payload.description).trim()}`,
      currentIdeasContext.summary ? `Current Idea Context:\n${currentIdeasContext.summary}` : "",
      conversation ? `Conversation:\n${conversation}` : ""
    ].filter(Boolean).join("\n\n");

    const draft = await generateIdeaDraft({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      title: String(payload.headline || "").trim(),
      description: String(payload.description || "").trim(),
      details: payload.details || {},
      intent,
      chatThread: thread,
      conversationContext: {
        activeIdeaId: activeIdeaId || "",
        currentIdeas: currentIdeasContext.ideas,
        currentIdeasSummary: currentIdeasContext.summary
      }
    });

    let artifact = null;
    if (activeIdeaId) {
      const existingIdea = await getFactoryIdea(activeIdeaId);
      if (!existingIdea) {
        json(res, 404, {
          error: "Idea not found for enrichment persistence",
          reason: `No idea matches ${activeIdeaId}`,
          correlationId
        });
        return "api.factory.ideas.ai_chat.idea_not_found";
      }
      if (
        existingIdea.orgId !== payload.orgId
        || existingIdea.sandboxId !== payload.sandboxId
        || existingIdea.productId !== payload.productId
      ) {
        json(res, 400, {
          error: "Idea scope does not match enrichment request",
          correlationId
        });
        return "api.factory.ideas.ai_chat.scope_mismatch";
      }
      const currentVersion = Number(existingIdea?.details?._ideaArtifactVersion || 0);
      const nextVersion = currentVersion + 1;
      const mergedDetails = {
        ...(existingIdea.details || {}),
        ...(draft.details || {}),
        _ideaArtifactVersion: nextVersion,
        _ideaArtifactUpdatedAt: nowIso(),
        _ideaArtifactSource: "ai-chat-enrich"
      };
      const updatedIdea = await updateFactoryIdea(activeIdeaId, {
        title: draft.title || existingIdea.title,
        description: draft.description || existingIdea.description,
        details: mergedDetails,
        status: existingIdea.status || "new"
      });
      if (!updatedIdea) {
        json(res, 500, {
          error: "Failed to persist enriched idea artifact",
          correlationId
        });
        return "api.factory.ideas.ai_chat.persistence_failed";
      }
      artifact = {
        ideaId: activeIdeaId,
        version: nextVersion,
        updatedAt: updatedIdea.updatedAt || nowIso()
      };
      logEvent("idea.enrichment.artifact_written", {
        correlationId,
        ideaId: activeIdeaId,
        version: nextVersion
      });
    }

    const latestUserEntry = [...thread].reverse().find((item) => item.role === "user") || null;
    const latestUser = latestUserEntry?.content || "";
    const latestImageCount = Array.isArray(latestUserEntry?.images) ? latestUserEntry.images.length : 0;
    logEvent("idea.enrichment.completed", {
      correlationId,
      activeIdeaId: activeIdeaId || null,
      readinessScore: draft?.triage?.readinessScore ?? null,
      suggestionCount: Array.isArray(draft?.triage?.suggestions) ? draft.triage.suggestions.length : 0
    });
    json(res, 200, {
      draft,
      currentIdeasContext,
      artifact,
      correlationId,
      assistant: {
        content: buildIdeaAssistantReply(draft, latestUser, latestImageCount, currentIdeasContext.meta)
      }
    });
    return "api.factory.ideas.ai_chat";
  }

  if (pathname === "/api/v1/factory/ideas/suggestions" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.ideas.suggestions.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.ideas.suggestions.invalid";
    }
    const required = ["orgId", "sandboxId", "productId"];
    const missing = required.filter((key) => !payload[key]);
    if (missing.length) {
      json(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return "api.factory.ideas.suggestions.missing";
    }
    if (!canAccessOrganization(identity, payload.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.ideas.suggestions.scope_forbidden";
    }

    const result = await suggestIdeas({
      orgId: payload.orgId,
      sandboxId: payload.sandboxId,
      productId: payload.productId,
      businessGoal: payload.businessGoal || "",
      limit: payload.limit || 5
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.ideas.suggestions.error";
    }
    json(res, 200, result);
    return "api.factory.ideas.suggestions";
  }

  const factoryIdeaRunMatch = pathname.match(/^\/api\/v1\/factory\/ideas\/(IDEA-[0-9]+)\/run-to-pr$/);
  if (factoryIdeaRunMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.idea.run_to_pr.forbidden";
    }

    const ideaId = factoryIdeaRunMatch[1];
    const idea = await getFactoryIdea(ideaId);
    if (!idea) {
      json(res, 404, { error: "Idea not found" });
      return "api.factory.idea.run_to_pr.not_found";
    }
    if (!canAccessOrganization(identity, idea.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.idea.run_to_pr.scope_forbidden";
    }

    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.idea.run_to_pr.invalid";
    }

    const result = await runIdeaToPr({
      ideaId,
      capabilityTitle: payload.capabilityTitle,
      actor: identity.userId
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.idea.run_to_pr.error";
    }
    json(res, 200, result);
    return "api.factory.idea.run_to_pr";
  }

  const factoryIdeaSpecPrMatch = pathname.match(/^\/api\/v1\/factory\/ideas\/(IDEA-[0-9]+)\/create-spec-pr$/);
  if (factoryIdeaSpecPrMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.idea.create_spec_pr.forbidden";
    }

    const ideaId = factoryIdeaSpecPrMatch[1];
    const idea = await getFactoryIdea(ideaId);
    if (!idea) {
      json(res, 404, { error: "Idea not found" });
      return "api.factory.idea.create_spec_pr.not_found";
    }
    if (!canAccessOrganization(identity, idea.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.idea.create_spec_pr.scope_forbidden";
    }

    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.idea.create_spec_pr.invalid";
    }

    const result = await createSpecPrFromIdea({
      ideaId,
      capabilityTitle: payload.capabilityTitle,
      actor: identity.userId
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.idea.create_spec_pr.error";
    }
    json(res, 200, result);
    return "api.factory.idea.create_spec_pr";
  }

  const factoryIdeaTriageAiMatch = pathname.match(/^\/api\/v1\/factory\/ideas\/(IDEA-[0-9]+)\/ai-triage$/);
  if (factoryIdeaTriageAiMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.idea.ai_triage.forbidden";
    }
    const ideaId = factoryIdeaTriageAiMatch[1];
    const idea = await getFactoryIdea(ideaId);
    if (!idea) {
      json(res, 404, { error: "Idea not found" });
      return "api.factory.idea.ai_triage.not_found";
    }
    if (!canAccessOrganization(identity, idea.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.idea.ai_triage.scope_forbidden";
    }
    const result = await aiTriageIdea(ideaId);
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.idea.ai_triage.error";
    }
    json(res, 200, result);
    return "api.factory.idea.ai_triage";
  }

  const factoryIdeaAssistMatch = pathname.match(/^\/api\/v1\/factory\/ideas\/(IDEA-[0-9]+)\/ai-assist$/);
  if (factoryIdeaAssistMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.idea.ai_assist.forbidden";
    }
    const ideaId = factoryIdeaAssistMatch[1];
    const idea = await getFactoryIdea(ideaId);
    if (!idea) {
      json(res, 404, { error: "Idea not found" });
      return "api.factory.idea.ai_assist.not_found";
    }
    if (!canAccessOrganization(identity, idea.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.idea.ai_assist.scope_forbidden";
    }
    const result = await aiAssistIdea(ideaId);
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.idea.ai_assist.error";
    }
    json(res, 200, result);
    return "api.factory.idea.ai_assist";
  }

  if (pathname === "/api/v1/agents" && req.method === "GET") {
    json(res, 200, { agents: listAgents() });
    return "api.agents";
  }

  if (pathname === "/api/v1/connectors" && req.method === "GET") {
    const orgId = url.searchParams.get("orgId") || (identity.orgId !== "*" ? identity.orgId : null);
    json(res, 200, { connectors: await listConnectors(orgId) });
    return "api.connectors";
  }

  if (pathname === "/api/v1/connectors/github/install-url" && req.method === "GET") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.connectors.github.install_url.forbidden";
    }
    const orgId = url.searchParams.get("orgId") || identity.orgId;
    if (!orgId || orgId === "*") {
      json(res, 400, { error: "orgId is required" });
      return "api.connectors.github.install_url.invalid";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.connectors.github.install_url.scope_forbidden";
    }
    if (!hasGithubAppConfig()) {
      json(res, 400, {
        error: "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG."
      });
      return "api.connectors.github.install_url.missing_config";
    }
    const state = encodeInstallState({ orgId, userId: identity.userId });
    const installUrl = buildInstallUrl({ state });
    json(res, 200, { orgId, installUrl, state });
    return "api.connectors.github.install_url";
  }

  if (pathname === "/api/v1/connectors/github/app-health" && req.method === "GET") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.connectors.github.app_health.forbidden";
    }
    const missing = [];
    if (!process.env.GITHUB_APP_ID) missing.push("GITHUB_APP_ID");
    if (!process.env.GITHUB_APP_SLUG) missing.push("GITHUB_APP_SLUG");
    if (!process.env.GITHUB_APP_PRIVATE_KEY) missing.push("GITHUB_APP_PRIVATE_KEY");
    if (!process.env.GITHUB_APP_STATE_SECRET) missing.push("GITHUB_APP_STATE_SECRET");
    const appBaseUrl = process.env.APP_PUBLIC_URL || "http://localhost:8080";
    json(res, 200, {
      configured: missing.length === 0,
      missing,
      appBaseUrl,
      expectedSetupUrl: `${appBaseUrl}/api/v1/connectors/github/callback`,
      installEntry: hasGithubAppConfig()
        ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`
        : null
    });
    return "api.connectors.github.app_health";
  }

  if (pathname === "/api/v1/connectors/github/callback" && req.method === "GET") {
    const installationId = Number(url.searchParams.get("installation_id") || "0");
    const setupAction = url.searchParams.get("setup_action") || "";
    const state = url.searchParams.get("state") || "";
    const decoded = decodeInstallState(state);
    if (!decoded || !installationId) {
      json(res, 400, { error: "Invalid callback state or installation_id" });
      return "api.connectors.github.callback.invalid";
    }

    const connector = await upsertConnector({
      id: `github-app-${decoded.orgId}`,
      type: "github_app",
      scope: "organization",
      orgId: decoded.orgId,
      sandboxId: null,
      status: "healthy",
      lastSyncAt: new Date().toISOString(),
      details: {
        installationId,
        setupAction,
        connectedBy: decoded.userId || "unknown",
        connectedAt: new Date().toISOString()
      }
    });

    // Callback is browser-facing; redirect back to app config page.
    res.writeHead(302, {
      Location: `/factory-config.html?github_connected=1&orgId=${encodeURIComponent(decoded.orgId)}&installationId=${installationId}`
    });
    res.end();
    return "api.connectors.github.callback";
  }

  if (pathname === "/api/v1/connectors/github/status" && req.method === "GET") {
    const orgId = url.searchParams.get("orgId") || (identity.orgId !== "*" ? identity.orgId : null);
    if (!orgId) {
      json(res, 400, { error: "orgId is required" });
      return "api.connectors.github.status.invalid";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.connectors.github.status.scope_forbidden";
    }
    const connector = await getGithubConnectorByOrg(orgId);
    const connectionType = connector?.type || null;
    const appConnected = Boolean(connector && connector.type === "github_app" && connector.details?.installationId);
    const patDetected = Boolean(connector && connector.type === "github_pat" && connector.details?.token);
    const reason = connector
      ? (connector.type === "github_pat"
        ? "PAT connector exists, but GitHub App connection is required for enterprise mode."
        : null)
      : hasGithubAppConfig()
        ? "GitHub App is configured but not installed for this organization."
        : "GitHub App is not configured. Set GitHub App env vars.";
    json(res, 200, {
      orgId,
      connected: appConnected,
      connectionType,
      connectedByPat: patDetected,
      connectedByApp: appConnected,
      reason,
      connector: connector || null
    });
    return "api.connectors.github.status";
  }

  if (pathname === "/api/v1/connectors/github/installations" && req.method === "GET") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.connectors.github.installations.forbidden";
    }
    if (!hasGithubAppConfig()) {
      json(res, 400, {
        error: "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG."
      });
      return "api.connectors.github.installations.missing_config";
    }
    const installations = await listAppInstallations();
    json(res, 200, { installations });
    return "api.connectors.github.installations";
  }

  if (pathname === "/api/v1/connectors/github/link-installation" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.connectors.github.link_installation.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.connectors.github.link_installation.invalid";
    }
    const orgId = payload.orgId || identity.orgId;
    const installationId = Number(payload.installationId || "0");
    if (!orgId || orgId === "*" || !installationId) {
      json(res, 400, { error: "orgId and installationId are required" });
      return "api.connectors.github.link_installation.missing";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.connectors.github.link_installation.scope_forbidden";
    }
    const connector = await upsertConnector({
      id: `github-app-${orgId}`,
      type: "github_app",
      scope: "organization",
      orgId,
      sandboxId: null,
      status: "healthy",
      lastSyncAt: new Date().toISOString(),
      details: {
        installationId,
        setupAction: "manual-link",
        connectedBy: identity.userId,
        connectedAt: new Date().toISOString()
      }
    });
    json(res, 200, { orgId, connector, connected: true });
    return "api.connectors.github.link_installation";
  }

  if (pathname === "/api/v1/connectors/github/pat" && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.connectors.github.pat.forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.connectors.github.pat.invalid";
    }
    const orgId = payload.orgId || identity.orgId;
    const token = payload.token || "";
    if (!orgId || orgId === "*" || !token.trim()) {
      json(res, 400, { error: "orgId and token are required" });
      return "api.connectors.github.pat.missing";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.connectors.github.pat.scope_forbidden";
    }
    const connector = await upsertConnector({
      id: `github-pat-${orgId}`,
      type: "github_pat",
      scope: "organization",
      orgId,
      sandboxId: null,
      status: "healthy",
      lastSyncAt: new Date().toISOString(),
      details: {
        token: token.trim(),
        connectedBy: identity.userId,
        connectedAt: new Date().toISOString()
      }
    });
    json(res, 200, { orgId, connector, connected: true });
    return "api.connectors.github.pat";
  }

  const connectorSyncMatch = pathname.match(/^\/api\/v1\/connectors\/([a-z0-9-]+)\/sync$/);
  if (connectorSyncMatch && req.method === "POST") {
    if (!requireRoles(identity, ["platform_admin", "organization_admin"])) {
      forbidden(res, "Admin role required for connector sync");
      return "api.connectors.sync.forbidden";
    }
    const connectorId = connectorSyncMatch[1];
    const connector = await markConnectorSync(connectorId, "healthy");
    if (!connector) {
      json(res, 404, { error: "Connector not found" });
      return "api.connectors.sync.not_found";
    }
    json(res, 200, { connector });
    return "api.connectors.sync";
  }

  if (pathname === "/api/v1/monitoring/summary" && req.method === "GET") {
    json(res, 200, metrics.getSummary());
    return "api.monitoring.summary";
  }

  if (pathname === "/api/v1/semantic/search" && req.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const limit = Number(url.searchParams.get("limit") || 10);
    if (!query.trim()) {
      json(res, 400, { error: "Missing query parameter: q" });
      return "api.semantic_search.invalid";
    }
    json(res, 200, semanticSearch(query, Number.isNaN(limit) ? 10 : limit));
    return "api.semantic_search";
  }

  const orgMembersMatch = pathname.match(/^\/api\/v1\/organizations\/([a-z0-9-]+)\/members$/);
  if (orgMembersMatch && req.method === "GET") {
    const orgId = orgMembersMatch[1];
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.org.members.forbidden";
    }
    json(res, 200, { members: await listMembershipsByOrg(orgId) });
    return "api.org.members";
  }

  if (orgMembersMatch && req.method === "POST") {
    const orgId = orgMembersMatch[1];
    if (!requireRoles(identity, ["organization_admin", "platform_admin"]) || !canAccessOrganization(identity, orgId)) {
      forbidden(res, "Admin access required");
      return "api.org.members.write.forbidden";
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.org.members.write.invalid";
    }

    if (!payload.userId || !payload.role) {
      json(res, 400, { error: "Missing required fields: userId, role" });
      return "api.org.members.write.invalid";
    }

    const member = await upsertMembership({
      userId: payload.userId,
      role: payload.role,
      orgId,
      sandboxIds: payload.sandboxIds || [],
      productIds: payload.productIds || []
    });

    json(res, 200, { member });
    return "api.org.members.write";
  }

  const orgDashboardMatch = pathname.match(/^\/api\/v1\/organizations\/([a-z0-9-]+)\/dashboard$/);
  if (orgDashboardMatch && req.method === "GET") {
    const orgId = orgDashboardMatch[1];
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.organizations.dashboard.forbidden";
    }
    const org = getOrganization(orgId);
    if (!org) {
      json(res, 404, { error: `Organization not found: ${orgId}` });
      return "api.organizations.dashboard.not_found";
    }
    json(res, 200, getOrgProductivity(org));
    return "api.organizations.dashboard";
  }

  const sandboxesMatch = pathname.match(
    /^\/api\/v1\/organizations\/([a-z0-9-]+)\/sandboxes$/
  );
  if (sandboxesMatch && req.method === "GET") {
    const [_, orgId] = sandboxesMatch;
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.sandboxes.forbidden";
    }
    const org = getOrganization(orgId);
    if (!org) {
      json(res, 404, { error: "Organization not found" });
      return "api.sandboxes.not_found";
    }
    const staticSandboxes = org.sandboxes.map((item) => ({ id: item.id, name: item.name, source: "static" }));
    const dynamicSandboxes = await listFactorySandboxes(orgId);
    const map = new Map();
    for (const item of staticSandboxes) map.set(item.id, item);
    for (const item of dynamicSandboxes) {
      map.set(item.id, { id: item.id, name: item.name, description: item.description || "", source: "dynamic" });
    }
    json(res, 200, { organizationId: orgId, sandboxes: Array.from(map.values()) });
    return "api.sandboxes";
  }

  if (sandboxesMatch && req.method === "POST") {
    const [_, orgId] = sandboxesMatch;
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.sandboxes.write.forbidden";
    }
    if (!canAccessOrganization(identity, orgId)) {
      forbidden(res, "No organization access");
      return "api.sandboxes.write.scope_forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.sandboxes.write.invalid";
    }
    const sandboxId = String(payload.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const name = String(payload.name || "").trim();
    if (!sandboxId || !name) {
      json(res, 400, { error: "id and name are required" });
      return "api.sandboxes.write.missing";
    }
    const sandbox = await upsertFactorySandbox({
      orgId,
      sandboxId,
      name,
      description: String(payload.description || "").trim(),
      createdBy: identity.userId
    });
    json(res, 200, { sandbox });
    return "api.sandboxes.write";
  }

  const productsMatch = pathname.match(
    /^\/api\/v1\/organizations\/([a-z0-9-]+)\/sandboxes\/([a-z0-9-]+)\/products$/
  );
  if (productsMatch && req.method === "GET") {
    const [_, orgId, sandboxId] = productsMatch;
    if (!canAccessSandbox(identity, orgId, sandboxId)) {
      forbidden(res, "No sandbox access");
      return "api.products.forbidden";
    }
    const sandbox = getSandbox(orgId, sandboxId);
    if (!sandbox) {
      json(res, 404, { error: "Sandbox not found" });
      return "api.products.not_found";
    }
    const includeStaticParam = String(url.searchParams.get("includeStatic") || "").toLowerCase();
    const includeStatic = includeStaticParam === "1" || includeStaticParam === "true";
    const products = await listScopedProducts(orgId, sandboxId, { includeStatic });
    json(res, 200, {
      organizationId: orgId,
      sandboxId,
      includeStatic,
      products
    });
    return "api.products";
  }

  if (productsMatch && req.method === "POST") {
    const [_, orgId, sandboxId] = productsMatch;
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.products.write.forbidden";
    }
    if (!canAccessSandbox(identity, orgId, sandboxId)) {
      forbidden(res, "No sandbox access");
      return "api.products.write.scope_forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.products.write.invalid";
    }
    const requestedId = String(payload.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const name = String(payload.name || "").trim();
    const generatedId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const productId = requestedId || generatedId;
    if (!productId || !name) {
      json(res, 400, { error: "name is required" });
      return "api.products.write.missing";
    }
    const product = await upsertFactoryProduct({
      orgId,
      sandboxId,
      productId,
      name,
      description: String(payload.description || "").trim(),
      createdBy: identity.userId
    });
    json(res, 200, {
      product: {
        ...product,
        productId: product.productId || product.id
      }
    });
    return "api.products.write";
  }

  const pipelineMatch = pathname.match(
    /^\/api\/v1\/organizations\/([a-z0-9-]+)\/sandboxes\/([a-z0-9-]+)\/products\/([a-z0-9-]+)\/pipeline$/
  );
  if (pipelineMatch && req.method === "GET") {
    const [_, orgId, sandboxId, productId] = pipelineMatch;
    if (!canAccessProduct(identity, orgId, sandboxId, productId) && !canAccessSandbox(identity, orgId, sandboxId)) {
      forbidden(res, "No product access");
      return "api.pipeline.forbidden";
    }

    const product = getProduct(orgId, sandboxId, productId);
    if (!product) {
      const dynamicProducts = await listFactoryProducts({ orgId, sandboxId });
      const dynamicProduct = dynamicProducts.find((item) => item.id === productId);
      if (!dynamicProduct) {
        json(res, 404, { error: "Product not found" });
        return "api.pipeline.not_found";
      }
      json(res, 200, {
        organizationId: orgId,
        sandboxId,
        product: { id: dynamicProduct.id, name: dynamicProduct.name },
        capabilities: []
      });
      return "api.pipeline";
    }

    json(res, 200, {
      organizationId: orgId,
      sandboxId,
      product: { id: product.id, name: product.name },
      capabilities: product.capabilities.map((capability) => ({
        ...capability,
        stage: (getCapabilityState(capability.id) || { stage: capability.stage }).stage
      }))
    });
    return "api.pipeline";
  }

  const capabilityAgentsMatch = pathname.match(/^\/api\/v1\/capabilities\/([A-Z0-9-]+)\/agents$/);
  if (capabilityAgentsMatch && req.method === "GET") {
    const capabilityId = capabilityAgentsMatch[1];
    const result = getCapabilityAgents(capabilityId);
    if (!result) {
      json(res, 404, { error: "Capability not found" });
      return "api.capability.agents.not_found";
    }
    json(res, 200, result);
    return "api.capability.agents";
  }

  const capabilityContextMatch = pathname.match(/^\/api\/v1\/capabilities\/([A-Z0-9-]+)\/context$/);
  if (capabilityContextMatch && req.method === "GET") {
    const capabilityId = capabilityContextMatch[1];
    const context = buildCapabilityContext(capabilityId);
    if (!context) {
      json(res, 404, { error: "Capability not found" });
      return "api.capability.context.not_found";
    }
    json(res, 200, context);
    return "api.capability.context";
  }

  const factoryCapabilityDetailMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)$/);
  if (factoryCapabilityDetailMatch && req.method === "GET") {
    const capabilityId = factoryCapabilityDetailMatch[1];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.capability.detail.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.capability.detail.scope_forbidden";
    }
    json(res, 200, detail);
    return "api.factory.capability.detail";
  }

  const factoryStageDocMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/doc$/);
  if (factoryStageDocMatch && req.method === "GET") {
    const capabilityId = factoryStageDocMatch[1];
    const stageKey = factoryStageDocMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_doc.read.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_doc.read.scope_forbidden";
    }
    const result = await getStageDocument(capabilityId, stageKey);
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_doc.read.error";
    }
    json(res, 200, result);
    return "api.factory.stage_doc.read";
  }

  if (factoryStageDocMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.stage_doc.write.forbidden";
    }
    const capabilityId = factoryStageDocMatch[1];
    const stageKey = factoryStageDocMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_doc.write.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_doc.write.scope_forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.stage_doc.write.invalid";
    }
    const result = await saveStageDocument({
      capabilityId,
      stageKey,
      content: payload.content || "",
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      diagramSource: payload.diagramSource || "",
      status: payload.status || "draft",
      actor: identity.userId
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_doc.write.error";
    }
    json(res, 200, result);
    return "api.factory.stage_doc.write";
  }

  const factoryStageAiReviewMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/ai-review$/);
  if (factoryStageAiReviewMatch && req.method === "POST") {
    const capabilityId = factoryStageAiReviewMatch[1];
    const stageKey = factoryStageAiReviewMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_ai_review.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_ai_review.scope_forbidden";
    }
    const result = await aiReviewStageDocument(capabilityId, stageKey);
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_ai_review.error";
    }
    json(res, 200, result);
    return "api.factory.stage_ai_review";
  }

  const factoryStageAiGenerateMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/ai-generate$/);
  if (factoryStageAiGenerateMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.stage_ai_generate.forbidden";
    }
    const capabilityId = factoryStageAiGenerateMatch[1];
    const stageKey = factoryStageAiGenerateMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_ai_generate.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_ai_generate.scope_forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      payload = {};
    }
    const result = await aiGenerateStageDocument({
      capabilityId,
      stageKey,
      actor: identity.userId,
      intent: String(payload.intent || "").trim()
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_ai_generate.error";
    }
    json(res, 200, result);
    return "api.factory.stage_ai_generate";
  }

  const factoryStageRenditionMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/rendition$/);
  if (factoryStageRenditionMatch && req.method === "GET") {
    const capabilityId = factoryStageRenditionMatch[1];
    const stageKey = factoryStageRenditionMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_rendition.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_rendition.scope_forbidden";
    }
    const source = url.searchParams.get("source") || "auto";
    const result = await getStageRendition({ capabilityId, stageKey, source });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_rendition.error";
    }
    json(res, 200, result);
    return "api.factory.stage_rendition";
  }

  const factoryAutoArchMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/auto-architecture$/);
  if (factoryAutoArchMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.auto_arch.forbidden";
    }
    const capabilityId = factoryAutoArchMatch[1];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.auto_arch.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.auto_arch.scope_forbidden";
    }
    const result = await autoGenerateArchitectureForCapability({
      capabilityId,
      actor: identity.userId,
      source: "manual-auto-architecture"
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.auto_arch.error";
    }
    json(res, 200, result);
    return "api.factory.auto_arch";
  }

  const factoryStageSyncMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/sync-to-pr$/);
  if (factoryStageSyncMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.stage_sync.forbidden";
    }
    const capabilityId = factoryStageSyncMatch[1];
    const stageKey = factoryStageSyncMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_sync.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_sync.scope_forbidden";
    }
    const result = await syncStageToPr({ capabilityId, stageKey, actor: identity.userId });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_sync.error";
    }
    json(res, 200, result);
    return "api.factory.stage_sync";
  }

  const factoryStageApproveMatch = pathname.match(/^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/stages\/([a-z-]+)\/approve$/);
  if (factoryStageApproveMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.stage_approve.forbidden";
    }
    const capabilityId = factoryStageApproveMatch[1];
    const stageKey = factoryStageApproveMatch[2];
    const detail = await getFactoryCapabilityDetail(capabilityId);
    if (!detail) {
      json(res, 404, { error: "Factory capability not found" });
      return "api.factory.stage_approve.not_found";
    }
    if (!canAccessOrganization(identity, detail.capability.orgId)) {
      forbidden(res, "No organization access");
      return "api.factory.stage_approve.scope_forbidden";
    }
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.stage_approve.invalid";
    }

    const result = await approveStageWithGithub({
      capabilityId,
      stageKey,
      actor: identity.userId,
      note: payload.note || ""
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.stage_approve.error";
    }
    json(res, 200, result);
    return "api.factory.stage_approve";
  }

  if (pathname === "/api/v1/github/webhooks" && req.method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid webhook JSON" });
      return "api.github.webhook.invalid";
    }

    let result = { ignored: true };
    if (payload.review?.state === "approved" && payload.pull_request?.head?.ref) {
      const ref = String(payload.pull_request.head.ref);
      const capMatch = ref.match(/cap-([0-9]+)/i);
      if (capMatch) {
        const capabilityId = `CAP-${capMatch[1]}`;
        result = await applyWebhookSignal({ capabilityId, signal: "approved" });
      }
    }
    json(res, 200, { ok: true, result });
    return "api.github.webhook";
  }

  const factoryCapabilityTriageMatch = pathname.match(/^\/api\/v1\/factory\/ideas\/(IDEA-[0-9]+)\/triage$/);
  if (factoryCapabilityTriageMatch && req.method === "POST") {
    if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
      forbidden(res, "Admin role required");
      return "api.factory.idea.triage.forbidden";
    }
    const ideaId = factoryCapabilityTriageMatch[1];
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.factory.idea.triage.invalid";
    }
    const result = await triageIdeaToCapability({
      ideaId,
      capabilityTitle: payload.capabilityTitle,
      actor: identity.userId
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return "api.factory.idea.triage.error";
    }
    // Fire-and-forget auto architecture draft generation from current context.
    if (result.capability?.capabilityId) {
      autoGenerateArchitectureForCapability({
        capabilityId: result.capability.capabilityId,
        actor: `${identity.userId}:auto`,
        source: "triage-background"
      }).catch(() => {});
    }
    json(res, 200, {
      ...result,
      backgroundJobs: [{ name: "auto-architecture", status: "scheduled" }]
    });
    return "api.factory.idea.triage";
  }

  const stageMap = [
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/spec$/, fn: writeSpec, key: "spec" },
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/approve-spec$/, fn: approveSpec, key: "approve_spec" },
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/architecture$/, fn: writeArchitecture, key: "architecture" },
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/approve-architecture$/, fn: approveArchitecture, key: "approve_architecture" },
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/compliance$/, fn: runCompliance, key: "compliance" },
    { regex: /^\/api\/v1\/factory\/capabilities\/(CAP-[0-9]+)\/build-to-pr$/, fn: buildToPr, key: "build_to_pr" }
  ];

  for (const stageAction of stageMap) {
    const match = pathname.match(stageAction.regex);
    if (match && req.method === "POST") {
      if (!requireRoles(identity, ["organization_admin", "platform_admin"])) {
        forbidden(res, "Admin role required");
        return `api.factory.capability.${stageAction.key}.forbidden`;
      }
      const capabilityId = match[1];
      const result = await stageAction.fn({ capabilityId, actor: identity.userId });
      if (result.error) {
        json(res, 400, { error: result.error });
        return `api.factory.capability.${stageAction.key}.error`;
      }
      json(res, 200, result);
      return `api.factory.capability.${stageAction.key}`;
    }
  }

  const capabilityOrchestrationMatch = pathname.match(/^\/api\/v1\/capabilities\/([A-Z0-9-]+)\/orchestrate$/);
  if (capabilityOrchestrationMatch && req.method === "POST") {
    if (!requireRoles(identity, ["platform_admin", "organization_admin"])) {
      forbidden(res, "Admin role required for orchestration");
      return "api.capability.orchestrate.forbidden";
    }

    const capabilityId = capabilityOrchestrationMatch[1];
    const result = await orchestrateCapability(capabilityId, identity.role === "platform_admin" ? "pipeline-agent" : identity.userId);
    if (result.error) {
      json(res, 404, { error: result.error });
      return "api.capability.orchestrate.not_found";
    }

    json(res, 200, result);
    return "api.capability.orchestrate";
  }

  const capabilityRunsMatch = pathname.match(/^\/api\/v1\/capabilities\/([A-Z0-9-]+)\/runs$/);
  if (capabilityRunsMatch && req.method === "GET") {
    const capabilityId = capabilityRunsMatch[1];
    json(res, 200, await getOrchestrationStatus(capabilityId));
    return "api.capability.runs";
  }

  const capabilityStateMatch = pathname.match(/^\/api\/v1\/capabilities\/([A-Z0-9-]+)\/state$/);
  if (capabilityStateMatch && req.method === "GET") {
    const capabilityId = capabilityStateMatch[1];
    const state = getCapabilityState(capabilityId);
    if (!state) {
      json(res, 404, { error: "Capability not found" });
      return "api.capability.state.not_found";
    }

    json(res, 200, {
      state,
      allowedStages,
      events: getCapabilityEvents(capabilityId)
    });
    return "api.capability.state";
  }

  if (capabilityStateMatch && req.method === "POST") {
    const capabilityId = capabilityStateMatch[1];

    let payload;
    try {
      const body = await readBody(req);
      payload = body ? JSON.parse(body) : {};
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return "api.capability.transition.invalid_body";
    }

    const nextStage = payload.nextStage;
    const note = payload.note || "";
    const actor = payload.actor || identity.userId || "manual";

    if (!nextStage) {
      json(res, 400, { error: "Missing required field: nextStage" });
      return "api.capability.transition.missing_stage";
    }

    const result = transitionCapabilityState(capabilityId, nextStage, note, actor);
    if (result.error) {
      const statusCode = result.error.includes("not found") ? 404 : 400;
      json(res, statusCode, { error: result.error });
      return "api.capability.transition.error";
    }

    json(res, 200, {
      state: result.state,
      event: result.event,
      allowedStages,
      events: getCapabilityEvents(capabilityId)
    });
    return "api.capability.transition";
  }

  if (pathname.startsWith("/api/")) {
    if (!["GET", "POST"].includes(req.method)) {
      json(res, 405, { error: "Method not allowed" });
      return "api.method_not_allowed";
    }

    json(res, 404, { error: "Not found" });
    return "api.not_found";
  }

  json(res, 404, { error: "Not found" });
  return "api.not_found";
}

function createServer() {
  const metrics = new MetricsStore();

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    await initializeStore();
    const identity = await resolveIdentity(req);
    const correlationId = buildCorrelationId(req);

    const finish = (routeKey) => {
      metrics.recordRequest({
        path: routeKey,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        persona: identity.role
      });
    };

    if (url.pathname === "/metrics") {
      const text = metrics.toPrometheusText();
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(text);
      finish("metrics");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const routeKey = await handleApi(req, res, url, metrics, identity, { correlationId });
        finish(routeKey);
      } catch (error) {
        const reason = String(error?.message || error || "Unhandled API failure");
        logEvent("api.unhandled_error", {
          correlationId,
          method: req.method,
          path: url.pathname,
          reason
        });
        if (!res.headersSent) {
          json(res, 500, {
            error: "Unhandled server error",
            reason,
            correlationId
          });
        }
        finish("api.unhandled_error");
      }
      return;
    }

    if (url.pathname.startsWith("/mocks/")) {
      const mockPath = url.pathname.replace(/^\/mocks/, "") || "/index.html";
      const mockAsset = readStaticAssetFromRoot(MOCKS_ROOT, mockPath);
      if (mockAsset) {
        res.writeHead(200, {
          "Content-Type": mockAsset.mime,
          "Cache-Control": "no-store"
        });
        res.end(mockAsset.content);
        finish("static.mock");
        return;
      }
    }

    const asset = readStaticAssetFromRoot(FRONTEND_ROOT, url.pathname);
    if (!asset) {
      json(res, 404, { error: "Asset not found" });
      finish("static.not_found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": asset.mime,
      "Cache-Control": "no-store"
    });
    res.end(asset.content);
    finish("static.asset");
  });

  return { server, metrics };
}

function startServer(port = Number(process.env.PORT || 8080)) {
  const { server } = createServer();
  server.listen(port, () => {
    console.log(`Probable Toodle app listening on http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  startServer
};
