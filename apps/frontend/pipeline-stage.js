const STORAGE = {
  auth: "pf.auth",
  email: "pf.email",
  userId: "pf.userId",
  orgId: "pf.orgId",
  sandboxId: "pf.sandboxId",
  productId: "pf.productId",
  productContextReady: "pf.productContextReady",
  ideaId: "pf.ideaId",
  capabilityId: "pf.capabilityId"
};

const STAGE_ORDER = ["idea", "spec", "architecture", "compliance", "build"];

function getCtx() {
  return {
    auth: localStorage.getItem(STORAGE.auth) === "1",
    email: localStorage.getItem(STORAGE.email) || "",
    userId: localStorage.getItem(STORAGE.userId) || "ava-admin",
    orgId: localStorage.getItem(STORAGE.orgId) || "acme-health",
    sandboxId: localStorage.getItem(STORAGE.sandboxId) || "production",
    productId: localStorage.getItem(STORAGE.productId) || "",
    productContextReady: localStorage.getItem(STORAGE.productContextReady) === "1",
    ideaId: localStorage.getItem(STORAGE.ideaId) || "",
    capabilityId: localStorage.getItem(STORAGE.capabilityId) || ""
  };
}

function setCtx(next) {
  Object.entries(next).forEach(([k, v]) => {
    const key = STORAGE[k];
    if (!key || v == null) return;
    localStorage.setItem(key, String(v));
  });
}

function requireAuth() {
  if (!getCtx().auth) window.location.href = "/login.html";
}

function requireScope() {
  const ctx = getCtx();
  if (!ctx.orgId || !ctx.sandboxId || !ctx.productId) {
    window.location.href = "/context.html";
  }
}

async function api(path, method = "GET", body = null, options = {}) {
  const ctx = getCtx();
  const extraHeaders = options && typeof options === "object" && options.headers && typeof options.headers === "object"
    ? options.headers
    : {};
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": ctx.userId,
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parts = [
      payload.error || `API ${response.status}`,
      payload.reason || null,
      Array.isArray(payload.actions) && payload.actions.length ? `Actions: ${payload.actions.join(", ")}` : null
    ].filter(Boolean);
    const err = new Error(parts.join(" | "));
    err.payload = payload;
    err.status = response.status;
    throw err;
  }
  return payload;
}

function show(text, err = false) {
  const alert = document.getElementById("alert");
  if (alert) {
    alert.className = `alert${err ? " error" : ""}`;
    alert.textContent = text;
  }
  addActivity(text, err);
}

function output(payload) {
  const el = document.getElementById("output");
  if (el) el.textContent = JSON.stringify(payload, null, 2);
}

function addActivity(text, isError = false) {
  const feed = document.getElementById("activityFeed");
  if (!feed || !text) return;
  const first = feed.querySelector("li");
  if (first && /Waiting for first action/i.test(first.textContent || "")) {
    first.remove();
  }
  const item = document.createElement("li");
  const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  item.textContent = `[${ts}] ${text}`;
  if (isError) item.style.color = "#8f2f2f";
  feed.prepend(item);
  while (feed.childElementCount > 8) {
    feed.removeChild(feed.lastElementChild);
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function listOrFallback(items, fallback = "None") {
  if (!Array.isArray(items) || items.length === 0) return `<li>${escapeHtml(fallback)}</li>`;
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderSmartRendition(payload) {
  const host = document.getElementById("smartRendition");
  if (!host) return;
  const rendition = payload?.rendition || {};
  const sections = Array.isArray(rendition.sections) ? rendition.sections : [];
  const highlights = Array.isArray(rendition.highlights) ? rendition.highlights : [];
  host.innerHTML = `
    <article class="triage-box">
      <h3>Source</h3>
      <div class="triage-context">
        <span class="triage-chip">Mode: ${escapeHtml(payload?.source || "local")}</span>
        <span class="triage-chip">Stage: ${escapeHtml(payload?.stageKey || "-")}</span>
      </div>
    </article>
    <article class="triage-box">
      <h3>Headline</h3>
      <p>${escapeHtml(rendition.headline || "No heading found")}</p>
    </article>
    <article class="triage-box">
      <h3>Summary</h3>
      <p>${escapeHtml(rendition.firstParagraph || "No summary paragraph available.")}</p>
    </article>
    <article class="triage-box">
      <h3>Sections</h3>
      <ul class="triage-list">${listOrFallback(sections, "No section headings parsed.")}</ul>
    </article>
    <article class="triage-box">
      <h3>Highlights</h3>
      <ul class="triage-list">${listOrFallback(highlights, "No bullet highlights parsed.")}</ul>
    </article>
  `;
}

function summarizeContentLocally(content = "") {
  const lines = String(content || "").split("\n");
  const sections = lines.filter((line) => /^#{1,3}\s+/.test(line)).map((line) => line.replace(/^#{1,3}\s+/, "").trim());
  const highlights = lines.filter((line) => /^-\s+/.test(line)).slice(0, 8).map((line) => line.replace(/^-\s+/, "").trim());
  const firstParagraph = lines.find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("```")) || "";
  return {
    headline: sections[0] || "",
    firstParagraph: firstParagraph.trim(),
    sections,
    highlights
  };
}

function setAiProgress(percent, label) {
  const bar = document.getElementById("aiProgressBar") || document.getElementById("autoProgressBar");
  const text = document.getElementById("aiProgressLabel") || document.getElementById("autoProgressLabel");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  if (text && label) text.textContent = label;
}

function formatTs(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function runAiProgressFlow(steps = []) {
  for (const step of steps) {
    setAiProgress(step.percent, step.label);
    if (step.waitMs) await new Promise((resolve) => setTimeout(resolve, step.waitMs));
  }
}

async function loadProductContext() {
  const ctx = getCtx();
  const payload = await api(
    `/api/v1/factory/product-context?orgId=${encodeURIComponent(ctx.orgId)}&sandboxId=${encodeURIComponent(ctx.sandboxId)}&productId=${encodeURIComponent(ctx.productId)}`
  );
  const context = payload?.productContext?.context || {};
  const ready = Boolean(String(context.productVision || "").trim());
  setCtx({ productContextReady: ready ? "1" : "0" });

  const host = document.getElementById("productContextSummary");
  if (host) {
    if (ready) {
      host.innerHTML = `
        <div class="t code">${escapeHtml(ctx.orgId)} / ${escapeHtml(ctx.sandboxId)} / ${escapeHtml(ctx.productId)}</div>
        <div class="s"><strong>Vision:</strong> ${escapeHtml(context.productVision || "-")}</div>
        <div class="s"><strong>Users:</strong> ${escapeHtml(context.primaryUsers || "-")}</div>
        <div class="s"><strong>Metrics:</strong> ${escapeHtml(context.successMetrics || "-")}</div>
      `;
    } else {
      host.innerHTML = `<div class="t">Product context missing for this scope.</div><div class="s">Complete Product Onboarding before idea creation.</div>`;
    }
  }
  return { ready, payload };
}

function renderTriageRendition(payload) {
  const host = document.getElementById("triageRender");
  if (!host) return;
  const triage = payload?.triage || payload;
  const triageSource = payload?.source || "unknown";
  const enrichment = payload?.enrichment || {};
  const competitive = Array.isArray(enrichment?.competitiveAnalysis) ? enrichment.competitiveAnalysis : [];
  const imagePrompts = Array.isArray(enrichment?.richContent?.imagePrompts) ? enrichment.richContent.imagePrompts : [];
  const generatedImages = Array.isArray(payload?.assist?.attachments)
    ? payload.assist.attachments.filter((item) => typeof item === "string" && item.startsWith("data:image/")).slice(0, 2)
    : [];
  if (!triage || typeof triage !== "object") {
    host.innerHTML = `<p class="mini">No triage data available.</p>`;
    return;
  }

  const refined = triage.refinedIdea || {};
  const context = triage.context || {};
  const score = Number.isFinite(triage.readinessScore) ? triage.readinessScore : "n/a";

  host.innerHTML = `
    <section class="triage-score">
      <div>
        <div class="v">${escapeHtml(score)}</div>
        <div class="l">Readiness Score</div>
      </div>
      <div>
        <div class="l">Proposed capability</div>
        <div class="code">${escapeHtml(triage.proposedCapabilityTitle || "n/a")}</div>
        <div class="mini">Triage Source: ${escapeHtml(triageSource)}</div>
      </div>
    </section>
    <section class="triage-grid">
      <article class="triage-box">
        <h3>Refined Business Goal</h3>
        <p>${escapeHtml(refined.businessGoal || "Missing")}</p>
      </article>
      <article class="triage-box">
        <h3>Problem + Persona</h3>
        <p><strong>Problem:</strong> ${escapeHtml(refined.problemStatement || "Missing")}</p>
        <p style="margin-top:6px"><strong>Persona:</strong> ${escapeHtml(refined.userPersona || "Missing")}</p>
      </article>
      <article class="triage-box">
        <h3>Scope Context</h3>
        <div class="triage-context">
          <span class="triage-chip">Org: ${escapeHtml(context.orgName || "-")}</span>
          <span class="triage-chip">Sandbox: ${escapeHtml(context.sandboxName || "-")}</span>
          <span class="triage-chip">Product: ${escapeHtml(context.productName || "-")}</span>
          <span class="triage-chip">Active: ${escapeHtml(context.activeCapabilities ?? "-")}</span>
          <span class="triage-chip">Blocked: ${escapeHtml(context.blockedCapabilities ?? "-")}</span>
        </div>
      </article>
      <article class="triage-box">
        <h3>Acceptance Criteria</h3>
        <ul class="triage-list">${listOrFallback(refined.acceptanceCriteria, "No acceptance criteria generated.")}</ul>
      </article>
      <article class="triage-box">
        <h3>Gaps To Fill</h3>
        <ul class="triage-list">${listOrFallback(triage.missingInfo, "No major gaps detected.")}</ul>
      </article>
      <article class="triage-box">
        <h3>Risks</h3>
        <ul class="triage-list">${listOrFallback(triage.risks, "No critical risks detected.")}</ul>
      </article>
      <article class="triage-box">
        <h3>AI Suggestions</h3>
        <ul class="triage-list">${listOrFallback(triage.suggestions, "No suggestions returned.")}</ul>
      </article>
      <article class="triage-box">
        <h3>Constraints / Non-goals</h3>
        <p><strong>Constraints:</strong> ${escapeHtml(refined.constraints || "None")}</p>
        <p style="margin-top:6px"><strong>Non-goals:</strong> ${escapeHtml(refined.nonGoals || "None")}</p>
      </article>
      <article class="triage-box">
        <h3>Competitive Analysis</h3>
        <ul class="triage-list">${listOrFallback(competitive.map((item) => `${item.name || "Competitor"} (${item.competitorType || "adjacent"})`), "No competitor analysis yet.")}</ul>
      </article>
      <article class="triage-box">
        <h3>Rich Assets</h3>
        <ul class="triage-list">${listOrFallback(imagePrompts, "No image prompts generated yet.")}</ul>
      </article>
      <article class="triage-box">
        <h3>Generated Image Preview</h3>
        ${generatedImages.length
          ? generatedImages.map((src, idx) => `<img alt="AI generated asset ${idx + 1}" src="${src}" class="ai-image" />`).join("")
          : `<p class="mini">No generated image preview yet.</p>`}
      </article>
    </section>
  `;
}

function renderIdeaSuggestions(payload) {
  const host = document.getElementById("ideaSuggestions");
  if (!host) return;
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  if (!suggestions.length) {
    host.textContent = "No idea suggestions returned.";
    return;
  }
  const lines = [];
  lines.push(`Source: ${payload.source || "fallback"} | Context: ideas=${payload?.contextUsed?.relatedIdeas ?? 0}, capabilities=${payload?.contextUsed?.relatedCapabilities ?? 0}, docs=${payload?.contextUsed?.githubDocs ?? 0}`);
  for (const [idx, item] of suggestions.entries()) {
    lines.push("");
    lines.push(`${idx + 1}. ${item.title} [${item.priority || "p2"} | value=${item.businessValue || "medium"} | effort=${item.effort || "medium"}]`);
    lines.push(`   ${item.description || ""}`);
    if (item.reasoning) lines.push(`   Why: ${item.reasoning}`);
  }
  host.textContent = lines.join("\n");
}

function renderTop(stageKey) {
  const ctx = getCtx();
  const crumb = document.getElementById("crumb");
  const userEmail = document.getElementById("userEmail");
  const scopePill = document.getElementById("scopePill");
  if (crumb) crumb.textContent = `${ctx.orgId} / ${ctx.sandboxId} / ${ctx.productId}`;
  if (userEmail) userEmail.textContent = ctx.email || "org-admin";
  if (scopePill) scopePill.textContent = `${ctx.orgId} / ${ctx.sandboxId} / ${ctx.productId}`;
  const idea = document.getElementById("ideaBadge");
  const cap = document.getElementById("capBadge");
  if (idea) idea.textContent = ctx.ideaId || "-";
  if (cap) cap.textContent = ctx.capabilityId || "-";

  document.querySelectorAll(".flow-step").forEach((item) => {
    item.classList.remove("active");
    item.classList.remove("done");
    const itemStage = item.dataset.stage;
    if (itemStage && STAGE_ORDER.indexOf(itemStage) < STAGE_ORDER.indexOf(stageKey)) {
      item.classList.add("done");
    }
    if (item.dataset.stage === stageKey) item.classList.add("active");
  });

  document.querySelectorAll("[data-action='signout']").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
      window.location.href = "/login.html";
    };
  });
}

async function ensureCapabilityFromIdea() {
  const ctx = getCtx();
  if (ctx.capabilityId) return ctx.capabilityId;
  if (!ctx.ideaId) throw new Error("Need idea first.");
  const payload = await api(`/api/v1/factory/ideas/${encodeURIComponent(ctx.ideaId)}/triage`, "POST", {
    capabilityTitle: "Auto capability"
  });
  const capabilityId = payload.capability?.capabilityId || "";
  if (!capabilityId) throw new Error("Unable to auto-create capability from idea.");
  setCtx({ capabilityId });
  return capabilityId;
}

async function enforceStageGate(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) return;
  try {
    const detail = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}`);
    const current = detail?.capability?.stage || "";
    const allow = {
      idea: true,
      triage: true,
      spec: ["spec", "spec-approved", "architecture", "architecture-approved", "compliance", "compliance-approved", "pr-created"].includes(current),
      architecture: ["spec-approved", "architecture", "architecture-approved", "compliance", "compliance-approved", "pr-created"].includes(current),
      compliance: ["architecture-approved", "compliance", "compliance-approved", "pr-created"].includes(current),
      build: ["compliance-approved", "pr-created"].includes(current)
    };
    const canUse = Boolean(allow[stageKey]);
    if (canUse) return;

    const lockButtons = ["runStage", "docSave", "docAi", "docSync", "docApprove", "autoArchitecture", "hydrateFromGit", "runBuild"];
    lockButtons.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = true;
    });
    show(`Stage locked. Current capability stage is '${current}'. Complete required approvals first.`, true);
  } catch {
    // Non-blocking gate check.
  }
}

async function loadDoc(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) throw new Error("Need capability first.");
  const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/${encodeURIComponent(stageKey)}/doc`);
  document.getElementById("docContent").value = payload.latest?.content || "";
  document.getElementById("docAttachments").value = (payload.latest?.attachments || []).join(",");
  document.getElementById("docDiagram").value = payload.latest?.diagramSource || "";
  if (stageKey === "architecture") {
    renderSmartRendition({
      source: "local",
      stageKey,
      content: payload.latest?.content || "",
      diagramSource: payload.latest?.diagramSource || "",
      rendition: summarizeContentLocally(payload.latest?.content || "")
    });
  }
  output(payload);
}

async function saveDoc(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) throw new Error("Need capability first.");
  const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/${encodeURIComponent(stageKey)}/doc`, "POST", {
    content: document.getElementById("docContent").value,
    attachments: (document.getElementById("docAttachments").value || "").split(",").map((v) => v.trim()).filter(Boolean),
    diagramSource: document.getElementById("docDiagram").value,
    status: "draft"
  });
  output(payload);
  show(`Saved ${stageKey} document.`);
}

async function aiReview(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) throw new Error("Need capability first.");
  const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/${encodeURIComponent(stageKey)}/ai-review`, "POST", {});
  output(payload);
  show(`AI critique completed for ${stageKey}.`);
}

async function syncToPr(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) throw new Error("Need capability first.");
  const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/${encodeURIComponent(stageKey)}/sync-to-pr`, "POST", {});
  output(payload);
  show(`Synced ${stageKey} doc to PR.`);
}

async function approveStage(stageKey) {
  const ctx = getCtx();
  if (!ctx.capabilityId) throw new Error("Need capability first.");
  const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/${encodeURIComponent(stageKey)}/approve`, "POST", {
    note: `Approved via stage page ${stageKey}`
  });
  output(payload);
  show(`Approved ${stageKey} in Product Factory.`);
}

async function initIdea() {
  const initialProductContext = await loadProductContext().catch(() => null);

  const headlineInput = document.getElementById("ideaHeadline");
  const descriptionInput = document.getElementById("ideaDescription");
  const createIdea = document.getElementById("createIdea");
  const approveIdeaPr = document.getElementById("approveIdeaPr");
  const continueSpec = document.getElementById("continueSpec");
  const ideaPrStatus = document.getElementById("ideaPrStatus");
  const suggestionsHost = document.getElementById("ideaSuggestions");
  const ideaDraftSummary = document.getElementById("ideaDraftSummary");
  const ideaDraftSource = document.getElementById("ideaDraftSource");
  const ideaDraftDetails = document.getElementById("ideaDraftDetails");
  const enrichSummaryLine = document.getElementById("enrichSummaryLine");
  const viewFullIdea = document.getElementById("viewFullIdea");
  const chatHost = document.getElementById("enrichChatMessages");
  const chatInput = document.getElementById("enrichChatInput");
  const chatSend = document.getElementById("enrichChatSend");
  const chatImagesInput = document.getElementById("enrichChatImages");
  const chatImagePreview = document.getElementById("enrichChatImagePreview");
  const enrichLoadingSkeleton = document.getElementById("enrichLoadingSkeleton");
  const prLoadingSkeleton = document.getElementById("prLoadingSkeleton");
  const enrichSuccessBanner = document.getElementById("enrichSuccessBanner");
  const prSuccessBanner = document.getElementById("prSuccessBanner");
  const renditionCard = document.getElementById("fullIdeaRenditionCard");
  const renditionHost = document.getElementById("fullIdeaRendition");
  const prDialog = document.getElementById("ideaPrDialog");
  const prDialogMeta = document.getElementById("ideaPrDialogMeta");
  const prDialogOpenPr = document.getElementById("ideaPrDialogOpenPr");
  const prDialogClose = document.getElementById("ideaPrDialogClose");
  const decisionReadiness = document.getElementById("decisionReadiness");
  const decisionCompleteness = document.getElementById("decisionCompleteness");
  const decisionRisks = document.getElementById("decisionRisks");
  const decisionTestability = document.getElementById("decisionTestability");
  const decisionScope = document.getElementById("decisionScope");
  const decisionDependencies = document.getElementById("decisionDependencies");
  const decisionTopSuggestion = document.getElementById("decisionTopSuggestion");
  const decisionPrimaryRisk = document.getElementById("decisionPrimaryRisk");
  const ideaContextBadge = document.getElementById("ideaContextBadge");
  const currentIdeasContextMeta = document.getElementById("currentIdeasContextMeta");
  const currentIdeasContextList = document.getElementById("currentIdeasContextList");
  const relatedIdeasMeta = document.getElementById("relatedIdeasMeta");
  const relatedIdeasLoading = document.getElementById("relatedIdeasLoading");
  const relatedIdeasList = document.getElementById("relatedIdeasList");
  const relatedIdeasWarning = document.getElementById("relatedIdeasWarning");
  const enrichErrorBanner = document.getElementById("enrichErrorBanner");
  const enrichErrorText = document.getElementById("enrichErrorText");
  const enrichRetry = document.getElementById("enrichRetry");
  const enrichViewLogs = document.getElementById("enrichViewLogs");
  const prErrorBanner = document.getElementById("prErrorBanner");
  const prErrorText = document.getElementById("prErrorText");
  const prReconnect = document.getElementById("prReconnect");
  const prRetry = document.getElementById("prRetry");
  const ideaDrawerBackdrop = document.getElementById("ideaDrawerBackdrop");
  const ideaDrawer = document.getElementById("ideaDrawer");
  const ideaDrawerClose = document.getElementById("ideaDrawerClose");
  const ideaDrawerBody = document.getElementById("ideaDrawerBody");
  const ideaDrawerTitle = document.getElementById("ideaDrawerTitle");
  const ideaDrawerTabs = Array.from(document.querySelectorAll(".idea-drawer-tabs [data-tab]"));
  const ideaStateHelper = window.IdeaState || null;
  const ideaViewModelHelper = window.IdeaViewModel || null;
  const ui = window.UIComponents || null;

  const chatState = { messages: [] };
  let pendingChatImages = [];
  let latestDraft = null;
  let currentIdeasContext = { ideas: [], meta: null };
  let relatedIdeasState = { query: "", ideas: [], duplicateWarning: "" };
  let forkedSourceIdeaIds = [];
  let relatedIdeasTimer = null;
  let latestArtifactMeta = null;
  let lastEnrichmentFailure = null;
  let lastPrFailure = null;
  let lastPrFailureKind = "pr";
  let activeDrawerTab = "overview";
  let enrichmentLoading = false;
  let prCreationLoading = false;
  let productContextReady = Boolean(initialProductContext?.ready || getCtx().productContextReady);

  function currentIdeaSeed() {
    return {
      headline: String(headlineInput?.value || "").trim(),
      description: String(descriptionInput?.value || "").trim()
    };
  }

  function deriveSeedFromConversation() {
    const latestUser = [...chatState.messages]
      .reverse()
      .find((item) => item.role === "user" && (String(item.content || "").trim() || (Array.isArray(item.images) && item.images.length > 0)));
    if (!latestUser) return { headline: "", description: "" };
    const text = String(latestUser.content || "").replace(/\s+/g, " ").trim();
    const words = text ? text.split(" ").slice(0, 8) : ["Multimodal", "Idea"];
    const headline = words.join(" ").replace(/^\w/, (c) => c.toUpperCase());
    const descriptionParts = [];
    if (text) descriptionParts.push(text);
    if (Array.isArray(latestUser.images) && latestUser.images.length) {
      descriptionParts.push(`Includes ${latestUser.images.length} image attachment(s) for context.`);
    }
    return {
      headline,
      description: descriptionParts.join(" ").trim()
    };
  }

  function ensureSeedFromConversation() {
    const current = currentIdeaSeed();
    if (current.headline && current.description) return current;
    const fromChat = deriveSeedFromConversation();
    const next = {
      headline: current.headline || fromChat.headline,
      description: current.description || fromChat.description
    };
    setIdeaSeed(next);
    return next;
  }

  function setIdeaSeed({ headline = "", description = "" } = {}) {
    if (headlineInput) headlineInput.value = headline;
    if (descriptionInput) descriptionInput.value = description;
    refreshCreateIdeaCta();
  }

  function logClientEvent(event, data = {}) {
    const payload = {
      ts: new Date().toISOString(),
      event,
      ...data
    };
    try {
      console.info(JSON.stringify(payload));
    } catch {
      console.info(`[ui] ${event}`);
    }
  }

  function makeCorrelationId(prefix = "ui") {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function toggleLoading(node, loading) {
    if (!node) return;
    node.style.display = loading ? "grid" : "none";
    node.setAttribute("aria-hidden", loading ? "false" : "true");
  }

  function showSuccess(node, message) {
    if (!node) return;
    node.textContent = String(message || "").trim();
    node.style.display = node.textContent ? "block" : "none";
  }

  function hideSuccess(node) {
    if (!node) return;
    node.textContent = "";
    node.style.display = "none";
  }

  function hasSubmitSeed() {
    const current = currentIdeaSeed();
    if (current.headline && current.description) return true;
    const derived = deriveSeedFromConversation();
    return Boolean(derived.headline && derived.description);
  }

  function refreshCreateIdeaCta() {
    if (!createIdea) return;
    const hasSeed = hasSubmitSeed();
    const allowed = productContextReady && hasSeed && !prCreationLoading;
    createIdea.disabled = !allowed;
    if (allowed) {
      createIdea.removeAttribute("title");
      return;
    }
    if (!productContextReady) {
      createIdea.title = "Complete Product Onboarding context before creating a PR.";
      return;
    }
    if (!hasSeed) {
      createIdea.title = "Send at least one chat message to generate the idea draft.";
      return;
    }
    if (prCreationLoading) {
      createIdea.title = "PR creation in progress.";
    }
  }

  function setEnrichmentLoading(loading) {
    enrichmentLoading = Boolean(loading);
    toggleLoading(enrichLoadingSkeleton, enrichmentLoading);
    if (chatSend) chatSend.disabled = enrichmentLoading;
    if (chatInput) chatInput.disabled = enrichmentLoading;
  }

  function setPrLoading(loading) {
    prCreationLoading = Boolean(loading);
    toggleLoading(prLoadingSkeleton, prCreationLoading);
    refreshCreateIdeaCta();
  }

  function renderPendingChatImages(images = []) {
    if (!chatImagePreview) return;
    if (!images.length) {
      chatImagePreview.innerHTML = "";
      return;
    }
    chatImagePreview.innerHTML = images
      .map((src, idx) => `<img src="${src}" alt="Chat attachment ${idx + 1}" />`)
      .join("");
  }

  function appendChatMessage(role, content, images = []) {
    if (!chatHost || (!content && (!Array.isArray(images) || !images.length))) return;
    const row = document.createElement("div");
    row.className = `chat-msg ${role === "assistant" ? "assistant" : "user"}`;
    if (content) {
      const text = document.createElement("p");
      text.textContent = content;
      row.appendChild(text);
    }
    if (Array.isArray(images) && images.length) {
      const media = document.createElement("div");
      media.className = "chat-msg-images";
      for (const src of images) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Chat attachment";
        media.appendChild(img);
      }
      row.appendChild(media);
    }
    chatHost.appendChild(row);
    chatHost.scrollTop = chatHost.scrollHeight;
  }

  function renderCurrentIdeasContext(pack = null) {
    const ctx = getCtx();
    const ideas = Array.isArray(pack?.ideas) ? pack.ideas : [];
    const meta = pack?.meta || {};
    currentIdeasContext = { ideas, meta };

    const loadedCount = Number(meta.loadedIdeas || ideas.length || 0);
    const totalCount = Number(meta.totalIdeas || loadedCount || 0);
    const activeIdeaId = String(meta.activeIdeaId || ctx.ideaId || "");
    const statusCounts = meta.statusCounts && typeof meta.statusCounts === "object" ? meta.statusCounts : {};
    const statusLine = Object.entries(statusCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(" · ");

    if (ideaContextBadge) {
      const activePart = activeIdeaId ? ` · active=${activeIdeaId}` : "";
      ideaContextBadge.textContent = `Context focus: current ideas ${loadedCount}/${totalCount}${activePart}`;
    }
    if (currentIdeasContextMeta) {
      currentIdeasContextMeta.textContent = statusLine
        ? `Loaded ${loadedCount} of ${totalCount} ideas · ${statusLine}`
        : `Loaded ${loadedCount} of ${totalCount} ideas for enrichment context`;
    }
    if (!currentIdeasContextList) return;
    if (!ideas.length) {
      currentIdeasContextList.innerHTML = `<div class="mini">No current ideas found for this product yet.</div>`;
      return;
    }
    currentIdeasContextList.innerHTML = ideas
      .slice(0, 8)
      .map((item) => {
        const isActive = item.ideaId && item.ideaId === activeIdeaId;
        const title = String(item.title || "Untitled idea");
        const summary = String(item.description || "").replace(/\s+/g, " ").trim();
        const preview = summary.length > 88 ? `${summary.slice(0, 87)}...` : summary;
        return `
          <article class="current-ideas-context-item${isActive ? " active" : ""}">
            <div class="title">${escapeHtml(title)}</div>
            <div class="meta">${escapeHtml(item.ideaId || "-")} · ${escapeHtml(item.status || "new")}</div>
            <div class="mini" style="margin-top:4px;">${escapeHtml(preview || "No description yet.")}</div>
          </article>
        `;
      })
      .join("");
  }

  async function loadCurrentIdeasContext() {
    const ctx = getCtx();
    if (!ctx.orgId || !ctx.sandboxId || !ctx.productId) {
      renderCurrentIdeasContext({ ideas: [], meta: { loadedIdeas: 0, totalIdeas: 0, statusCounts: {}, activeIdeaId: ctx.ideaId || "" } });
      return null;
    }
    const payload = await api(
      `/api/v1/factory/ideas?orgId=${encodeURIComponent(ctx.orgId)}&sandboxId=${encodeURIComponent(ctx.sandboxId)}&productId=${encodeURIComponent(ctx.productId)}&page=1&pageSize=12`
    );
    const ideas = Array.isArray(payload?.ideas)
      ? payload.ideas.map((item) => ({
          ideaId: item.ideaId,
          title: item.title,
          description: item.description,
          status: item.status || "new",
          createdAt: item.createdAt || "",
          isActive: Boolean(ctx.ideaId) && item.ideaId === ctx.ideaId
        }))
      : [];
    const statusCounts = ideas.reduce((acc, item) => {
      const key = String(item.status || "new");
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    const pack = {
      ideas,
      meta: {
        loadedIdeas: ideas.length,
        totalIdeas: Number(payload?.total || ideas.length),
        statusCounts,
        activeIdeaId: ctx.ideaId || ""
      }
    };
    renderCurrentIdeasContext(pack);
    return pack;
  }

  function setRelatedIdeasLoading(loading) {
    toggleLoading(relatedIdeasLoading, Boolean(loading));
  }

  function renderRelatedIdeas(state = null) {
    const ideas = Array.isArray(state?.ideas) ? state.ideas : [];
    const query = String(state?.query || "").trim();
    const warning = String(state?.duplicateWarning || "").trim();
    if (relatedIdeasMeta) {
      if (query) {
        relatedIdeasMeta.textContent = ideas.length
          ? `Top ${ideas.length} similar ideas for "${query}".`
          : `No similar ideas found for "${query}".`;
      } else {
        relatedIdeasMeta.textContent = "Type in chat to retrieve similar ideas.";
      }
    }
    if (relatedIdeasWarning) {
      relatedIdeasWarning.textContent = warning;
      relatedIdeasWarning.style.display = warning ? "block" : "none";
    }
    if (!relatedIdeasList) return;
    if (!ideas.length) {
      relatedIdeasList.innerHTML = `<div class="mini">No related ideas yet.</div>`;
      return;
    }
    relatedIdeasList.innerHTML = ideas
      .map((item) => {
        const summary = String(item.description || "").replace(/\s+/g, " ").trim();
        const preview = summary.length > 110 ? `${summary.slice(0, 109)}...` : summary;
        return `
          <article class="related-idea-item">
            <div class="title">${escapeHtml(item.title || "Untitled idea")}</div>
            <div class="meta">${escapeHtml(item.ideaId || "-")} · similarity ${escapeHtml(Math.round(Number(item.similarity || 0) * 100))}% · ${escapeHtml(item.status || "new")}</div>
            <div class="summary">${escapeHtml(preview || "No description available.")}</div>
            <div class="row">
              <button type="button" class="ghost" data-action="fork-idea" data-idea-id="${escapeHtml(item.ideaId || "")}">Start From This Idea</button>
            </div>
          </article>
        `;
      })
      .join("");
    relatedIdeasList.querySelectorAll("button[data-action='fork-idea']").forEach((button) => {
      button.onclick = () => {
        const ideaId = String(button.getAttribute("data-idea-id") || "").trim();
        const candidate = ideas.find((item) => item.ideaId === ideaId);
        if (!candidate) return;
        const sourceSet = new Set([...(forkedSourceIdeaIds || []), ideaId]);
        forkedSourceIdeaIds = Array.from(sourceSet).slice(0, 20);
        setIdeaSeed({
          headline: String(candidate.title || ""),
          description: String(candidate.description || "")
        });
        appendChatMessage(
          "assistant",
          `Forked ${candidate.ideaId}. This idea will include provenance from the selected related artifact.`
        );
        show(`Forked from ${candidate.ideaId}. Source idea provenance will be attached.`);
      };
    });
  }

  async function fetchRelatedIdeas(query) {
    const ctx = getCtx();
    const normalized = String(query || "").trim();
    if (!ctx.orgId || !ctx.sandboxId || !ctx.productId || normalized.length < 3) {
      relatedIdeasState = { query: normalized, ideas: [], duplicateWarning: "" };
      renderRelatedIdeas(relatedIdeasState);
      return relatedIdeasState;
    }
    setRelatedIdeasLoading(true);
    try {
      const payload = await api(
        `/api/ideas/similar?orgId=${encodeURIComponent(ctx.orgId)}&sandboxId=${encodeURIComponent(ctx.sandboxId)}&productArea=${encodeURIComponent(ctx.productId)}&query=${encodeURIComponent(normalized)}&limit=6&excludeIdeaId=${encodeURIComponent(ctx.ideaId || "")}`
      );
      relatedIdeasState = {
        query: normalized,
        ideas: Array.isArray(payload?.ideas) ? payload.ideas : [],
        duplicateWarning: String(payload?.duplicateWarning || "")
      };
      renderRelatedIdeas(relatedIdeasState);
      return relatedIdeasState;
    } catch (error) {
      relatedIdeasState = { query: normalized, ideas: [], duplicateWarning: "" };
      renderRelatedIdeas(relatedIdeasState);
      show(`Related ideas retrieval failed: ${errorReason(error)}`, true);
      return relatedIdeasState;
    } finally {
      setRelatedIdeasLoading(false);
    }
  }

  function errorReason(error) {
    const payload = error?.payload || {};
    return String(payload.reason || payload.error || error?.message || "Unknown failure");
  }

  function showEnrichmentFailure(error) {
    lastEnrichmentFailure = error;
    if (!enrichErrorBanner || !enrichErrorText) return;
    const payload = error?.payload || {};
    logClientEvent("ui.idea.enrichment.failed", {
      correlationId: payload?.correlationId || null,
      reason: errorReason(error)
    });
    const actionable = ideaStateHelper?.buildActionableError
      ? ideaStateHelper.buildActionableError("enrichment", errorReason(error), payload?.correlationId || "")
      : null;
    enrichErrorText.textContent = actionable?.message || `Enrichment failed: ${errorReason(error)}`;
    enrichErrorBanner.style.display = "block";
  }

  function clearEnrichmentFailure() {
    lastEnrichmentFailure = null;
    if (!enrichErrorBanner || !enrichErrorText) return;
    enrichErrorText.textContent = "";
    enrichErrorBanner.style.display = "none";
  }

  function showPrFailure(error, kind = "pr") {
    lastPrFailure = error;
    lastPrFailureKind = kind === "approval" ? "approval" : "pr";
    if (!prErrorBanner || !prErrorText) return;
    const payload = error?.payload || {};
    logClientEvent(kind === "approval" ? "ui.idea.pr.approve.failed" : "ui.idea.pr.create.failed", {
      correlationId: payload?.correlationId || null,
      reason: errorReason(error)
    });
    const actionable = ideaStateHelper?.buildActionableError
      ? ideaStateHelper.buildActionableError(kind === "approval" ? "approval" : "pr", errorReason(error), payload?.correlationId || "")
      : null;
    prErrorText.textContent = actionable?.message
      || `${kind === "approval" ? "PR approval failed" : "PR creation failed"}: ${errorReason(error)}`;
    prErrorBanner.style.display = "block";
  }

  function clearPrFailure() {
    lastPrFailure = null;
    lastPrFailureKind = "pr";
    if (!prErrorBanner || !prErrorText) return;
    prErrorText.textContent = "";
    prErrorBanner.style.display = "none";
  }

  function renderStructuredList(items = [], ordered = false) {
    const normalized = Array.isArray(items) ? items.filter((item) => String(item || "").trim()) : [];
    if (!normalized.length) {
      return ui?.TextBlock ? ui.TextBlock({ text: "None", tone: "meta" }) : `<p class="mini">None</p>`;
    }
    if (ui?.IndentedList) {
      return ui.IndentedList({ items: normalized, ordered });
    }
    return ordered
      ? `<ol>${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
      : `<ul>${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderTextBlock(text, tone = "body", maxLines = 0) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    if (ui?.TextBlock) {
      return ui.TextBlock({ text: normalized, tone, maxLines });
    }
    return `<p class="text-block ${tone}">${escapeHtml(normalized)}</p>`;
  }

  function renderDrawerTab(tabKey = "overview") {
    if (!ideaDrawerBody) return;
    const model = ideaViewModelHelper?.buildIdeaDrawerTabs
      ? ideaViewModelHelper.buildIdeaDrawerTabs(latestDraft, latestArtifactMeta, {
          chatMessageCount: chatState.messages.length,
          contextMeta: currentIdeasContext?.meta || null
        })
      : null;
    if (!model || !model.tabs) {
      ideaDrawerBody.innerHTML = `<p class="mini">No enrichment artifact available.</p>`;
      return;
    }

    const selected = model.tabs[tabKey] || model.tabs.overview;
    activeDrawerTab = model.tabs[tabKey] ? tabKey : "overview";
    if (ideaDrawerTitle) ideaDrawerTitle.textContent = model.title || "Full Idea";

    ideaDrawerTabs.forEach((button) => {
      const isActive = button?.dataset?.tab === activeDrawerTab;
      button.classList.toggle("active", Boolean(isActive));
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    const paragraphsHtml = Array.isArray(selected.paragraphs)
      ? selected.paragraphs.map((line) => renderTextBlock(line, "body")).join("")
      : "";
    const primaryListHtml = renderStructuredList(selected.list || [], false);
    const secondaryListHtml = Array.isArray(selected.secondaryList) && selected.secondaryList.length
      ? `<div class="text-block label">Secondary</div>${renderStructuredList(selected.secondaryList, false)}`
      : "";
    const codeBlock = selected.code
      ? `<pre class="ui-code-block"><code>${escapeHtml(String(selected.code || ""))}</code></pre>`
      : "";

    const cardBody = `
      <div class="drawer-section-body scrollable-block">
        ${paragraphsHtml}
        ${primaryListHtml}
        ${secondaryListHtml}
        ${codeBlock}
      </div>
    `;

    const card = ui?.Card
      ? ui.Card({
          title: selected.title || "Section",
          subtitle: latestDraft?.title || "",
          bodyHtml: cardBody
        })
      : `<article class="card"><h3>${escapeHtml(selected.title || "Section")}</h3>${cardBody}</article>`;

    const auditExpanded = activeDrawerTab === "audit" && ui?.ExpandableSection
      ? ui.ExpandableSection({
          id: "idea-drawer-audit-expand",
          title: "Raw Draft Snapshot",
          contentHtml: `<pre class="ui-code-block"><code>${escapeHtml(JSON.stringify(latestDraft || {}, null, 2))}</code></pre>`,
          open: false
        })
      : "";

    ideaDrawerBody.innerHTML = `${card}${auditExpanded}`;
  }

  function openIdeaDrawer() {
    if (!ideaDrawer || !ideaDrawerBackdrop) return;
    renderDrawerTab(activeDrawerTab || "overview");
    ideaDrawerBackdrop.hidden = false;
    ideaDrawer.classList.add("open");
    ideaDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }

  function closeIdeaDrawer() {
    if (!ideaDrawer || !ideaDrawerBackdrop) return;
    ideaDrawer.classList.remove("open");
    ideaDrawer.setAttribute("aria-hidden", "true");
    ideaDrawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
  }

  function renderEnrichmentSummary(draft) {
    if (!enrichSummaryLine || !viewFullIdea) return;
    const view = ideaViewModelHelper?.buildIdeaSummaryView
      ? ideaViewModelHelper.buildIdeaSummaryView(draft, latestArtifactMeta)
      : null;
    if (!view || !draft) {
      enrichSummaryLine.textContent = "No enrichment yet.";
      viewFullIdea.disabled = true;
      return;
    }
    enrichSummaryLine.textContent = view.summaryLine || "AI Draft Updated";
    viewFullIdea.disabled = !view.canViewFullIdea;
  }

  function renderIdeaEnrichment(draft) {
    const truncate = (value, max = 220) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      if (text.length <= max) return text;
      return `${text.slice(0, max - 1)}...`;
    };

    const setDecisionValue = (node, value, fallback = "--") => {
      if (!node) return;
      node.textContent = value == null || value === "" ? fallback : String(value);
    };

    const renderDecisionPanel = () => {
      const triage = draft?.triage || {};
      const details = draft?.details || {};
      const suggestions = Array.isArray(triage.suggestions) ? triage.suggestions : [];
      const risks = Array.isArray(triage.risks) ? triage.risks : [];
      const acceptanceCriteria = Array.isArray(details.acceptanceCriteria) ? details.acceptanceCriteria : [];
      const dependencyCount = Array.isArray(triage.dependencies)
        ? triage.dependencies.length
        : Number(draft?.contextUsed?.relatedCapabilityCount || 0);

      if (!draft) {
        setDecisionValue(decisionReadiness, "--");
        setDecisionValue(decisionCompleteness, "--");
        setDecisionValue(decisionRisks, "--");
        setDecisionValue(decisionTestability, "--");
        setDecisionValue(decisionScope, "--");
        setDecisionValue(decisionDependencies, "--");
        if (decisionTopSuggestion) decisionTopSuggestion.textContent = "AI will suggest improvements after your first message.";
        if (decisionPrimaryRisk) decisionPrimaryRisk.textContent = "No primary risk identified yet.";
        return;
      }

      const readiness = Number.isFinite(Number(triage.readinessScore)) ? Number(triage.readinessScore) : "--";
      const completenessScore = Math.min(
        100,
        (acceptanceCriteria.length * 16)
          + (String(details.problemStatement || "").trim() ? 22 : 0)
          + (String(details.businessGoal || "").trim() ? 22 : 0)
      );
      const riskScore = Math.min(100, risks.length * 20);
      const testabilityScore = Math.min(100, (acceptanceCriteria.length * 18) + (String(details.userPersona || "").trim() ? 12 : 0));
      const scopeScore = Math.min(
        100,
        12 + (String(details.constraints || "").trim() ? 30 : 0) + (String(details.nonGoals || "").trim() ? 28 : 0)
      );
      const dependencyScore = Math.min(100, Number(dependencyCount || 0) * 12);

      setDecisionValue(decisionReadiness, readiness);
      setDecisionValue(decisionCompleteness, completenessScore);
      setDecisionValue(decisionRisks, riskScore);
      setDecisionValue(decisionTestability, testabilityScore);
      setDecisionValue(decisionScope, scopeScore);
      setDecisionValue(decisionDependencies, dependencyScore);
      if (decisionTopSuggestion) {
        decisionTopSuggestion.textContent = suggestions[0] || "No suggestion yet. Keep refining the idea.";
      }
      if (decisionPrimaryRisk) {
        decisionPrimaryRisk.textContent = risks[0] || "No primary risk identified.";
      }
    };

    renderDecisionPanel();

    if (!draft) {
      if (ideaDraftSource) ideaDraftSource.textContent = "No draft";
      renderEnrichmentSummary(null);
      if (ideaDraftSummary) {
        ideaDraftSummary.innerHTML = `
          <div class="idea-draft-summary-title">AI draft will appear here.</div>
          <p class="idea-draft-summary-text">Send a message to generate an enriched draft from product and idea context.</p>
        `;
      }
      if (ideaDraftDetails) ideaDraftDetails.open = false;
      if (!suggestionsHost) return;
      suggestionsHost.textContent = "AI enrichment output appears here as you chat.";
      return;
    }

    const details = draft.details || {};
    const triage = draft.triage || {};
    const criteria = Array.isArray(details.acceptanceCriteria) ? details.acceptanceCriteria : [];
    const suggestions = Array.isArray(triage.suggestions) ? triage.suggestions : [];
    const risks = Array.isArray(triage.risks) ? triage.risks : [];
    const contextUsed = draft.contextUsed || {};
    const conversationContextUsed = draft.conversationContextUsed || {};
    const artifactVersionLabel = latestArtifactMeta?.version ? `v${latestArtifactMeta.version}` : null;
    renderEnrichmentSummary(draft);

    if (ideaDraftSource) {
      const sourceLabel = draft.llmModel ? `${draft.source || "ai"} · ${draft.llmModel}` : (draft.source || "ai");
      ideaDraftSource.textContent = sourceLabel;
    }
    if (ideaDraftSummary) {
      const summaryText = truncate(draft.description || details.problemStatement || "Draft created from chat context.");
      ideaDraftSummary.innerHTML = `
        <div class="idea-draft-summary-title">${escapeHtml(draft.title || "Untitled idea")}</div>
        <p class="idea-draft-summary-text">${escapeHtml(summaryText)}</p>
        <p class="mini" style="margin:8px 0 0;">
          Readiness ${escapeHtml(triage.readinessScore ?? "n/a")} · ${escapeHtml(criteria.length)} criteria · ${escapeHtml(risks.length)} risks
          ${suggestions[0] ? ` · Next: ${escapeHtml(truncate(suggestions[0], 70))}` : ""}
        </p>
      `;
    }

    if (!suggestionsHost) return;
    const snapshotHtml = [
      renderTextBlock(draft.description || "No description generated.", "body"),
      renderTextBlock(
        `Source: ${draft.source || "unknown"}${draft.llmModel ? ` · Model: ${draft.llmModel}` : ""}${draft.fallbackReason ? ` · Fallback: ${draft.fallbackReason}` : ""}`,
        "meta"
      ),
      renderTextBlock(
        `Context used: product ideas=${contextUsed.productIdeaCount ?? 0}, current ideas=${conversationContextUsed.currentIdeaCount ?? 0}, related ideas=${conversationContextUsed.relatedIdeaCount ?? 0}, source ideas=${Array.isArray(conversationContextUsed.sourceIdeaIds) ? conversationContextUsed.sourceIdeaIds.length : 0}, capabilities=${contextUsed.relatedCapabilityCount ?? 0}, docs=${contextUsed.githubDocCount ?? 0}${conversationContextUsed.activeIdeaId ? ` · active=${conversationContextUsed.activeIdeaId}` : ""}${artifactVersionLabel ? ` · artifact=${artifactVersionLabel}` : ""}`,
        "meta"
      ),
      renderTextBlock(`Business goal: ${details.businessGoal || "-"}`, "body"),
      renderTextBlock(`Persona: ${details.userPersona || "-"}`, "body"),
      renderTextBlock(`Problem statement: ${details.problemStatement || "-"}`, "body"),
      `<div class="text-block label">Acceptance criteria</div>${renderStructuredList(criteria, false)}`,
      renderTextBlock(`AI triage score: ${triage.readinessScore ?? "n/a"}`, "body"),
      `<div class="text-block label">Top suggestions</div>${renderStructuredList(suggestions.slice(0, 4), false)}`,
      `<div class="text-block label">Risks</div>${renderStructuredList(risks.slice(0, 3), false)}`
    ].join("");
    const rendered = ui?.Card
      ? ui.Card({
          title: draft.title || "Untitled idea",
          subtitle: "Formatted enrichment snapshot",
          bodyHtml: `<div class="scrollable-block">${snapshotHtml}</div>`
        })
      : snapshotHtml;
    suggestionsHost.innerHTML = `<div class="idea-structured-output">${rendered}</div>`;
  }

  function renderApprovedRendition(stage = "") {
    if (!renditionCard || !renditionHost || !latestDraft) return;
    const details = latestDraft.details || {};
    const criteria = Array.isArray(details.acceptanceCriteria) ? details.acceptanceCriteria : [];
    renditionCard.style.display = "block";
    const bodyHtml = [
      renderTextBlock(latestDraft.description || "", "body"),
      renderTextBlock(`Problem: ${details.problemStatement || "-"}`, "body"),
      renderTextBlock(`Persona: ${details.userPersona || "-"}`, "body"),
      renderTextBlock(`Business goal: ${details.businessGoal || "-"}`, "body"),
      `<div class="text-block label">Acceptance criteria</div>${renderStructuredList(criteria, false)}`,
      renderTextBlock(`PR approved. Current stage: ${stage || "spec"}`, "meta")
    ].join("");
    renditionHost.innerHTML = ui?.Card
      ? ui.Card({
          title: latestDraft.title || "Approved idea",
          subtitle: "Ready for downstream stages",
          bodyHtml: `<div class="scrollable-block">${bodyHtml}</div>`
        })
      : bodyHtml;
  }

  function renderPrGate(detailPayload = null, prOverride = null) {
    const capability = detailPayload?.capability || {};
    const stage = String(capability.stage || "");
    const pr = prOverride || detailPayload?.pr || null;
    const unlocked = ["spec", "spec-approved", "architecture", "architecture-approved", "compliance", "compliance-approved", "pr-created"].includes(stage);
    const waitingApproval = stage === "triage";

    if (continueSpec) continueSpec.disabled = !unlocked;
    if (approveIdeaPr) approveIdeaPr.disabled = !waitingApproval || !pr;

    if (!ideaPrStatus) return;
    if (!getCtx().capabilityId) {
      ideaPrStatus.innerHTML = `<div class="t">PR gate pending</div><div class="s">Submit idea to open triage PR.</div>`;
      return;
    }
    if (!pr) {
      ideaPrStatus.innerHTML = `<div class="t">Capability stage: ${escapeHtml(stage || "unknown")}</div><div class="s">PR metadata not available yet.</div>`;
      return;
    }
    const prLink = pr.externalUrl
      ? `<a href="${pr.externalUrl}" target="_blank" rel="noreferrer">Open PR${pr.prNumber ? ` #${escapeHtml(pr.prNumber)}` : ""}</a>`
      : `Internal PR ${escapeHtml(pr.prId || "")}`;
    ideaPrStatus.innerHTML = `
      <div class="t code">${escapeHtml(pr.repo || "-")} · ${escapeHtml(pr.branch || "-")}</div>
      <div class="s">PR: ${prLink}</div>
      <div class="s">Capability stage: ${escapeHtml(stage || "-")} · ${escapeHtml(pr.status || "draft")}</div>
      <div class="s">${unlocked ? "Gate unlocked: Spec stage unlocked." : "Gate ready: PR created. Approve to unlock Spec."}</div>
    `;
    if (unlocked) renderApprovedRendition(stage);
  }

  function closePrSubmittedDialog() {
    if (!prDialog) return;
    if (typeof prDialog.close === "function" && prDialog.open) {
      prDialog.close();
      return;
    }
    prDialog.classList.remove("open-fallback");
  }

  function openPrSubmittedDialog(pr, stage) {
    if (!prDialog) return;
    const status = pr?.status || "open";
    const ref = [pr?.repo, pr?.branch].filter(Boolean).join(" / ");
    if (prDialogMeta) {
      prDialogMeta.textContent = ref
        ? `${ref} · ${status} · stage=${stage || "triage"}`
        : `Internal PR created · ${status} · stage=${stage || "triage"}`;
    }
    if (prDialogOpenPr) {
      if (pr?.externalUrl) {
        prDialogOpenPr.href = pr.externalUrl;
        prDialogOpenPr.style.display = "inline-flex";
      } else {
        prDialogOpenPr.removeAttribute("href");
        prDialogOpenPr.style.display = "none";
      }
    }
    if (typeof prDialog.showModal === "function") {
      if (prDialog.open) prDialog.close();
      prDialog.showModal();
    } else {
      prDialog.classList.add("open-fallback");
    }
  }

  async function refreshCapabilityGate() {
    const ctx = getCtx();
    if (!ctx.capabilityId) {
      renderPrGate(null, null);
      return null;
    }
    const detail = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}`);
    renderPrGate(detail, detail.pr || null);
    return detail;
  }

  async function requestChatEnrichment(ctx, seed, messages, options = {}) {
    const normalizedMessages = Array.isArray(messages)
      ? messages.slice(-18).map((item) => ({
          role: item.role,
          content: item.content,
          images: Array.isArray(item.images) ? item.images : []
        }))
      : [];
    const correlationId = String(options?.correlationId || "").trim();
    const relatedIdeasContext = {
      query: relatedIdeasState.query || "",
      sourceIdeaIds: forkedSourceIdeaIds.slice(0, 20),
      ideas: (Array.isArray(relatedIdeasState.ideas) ? relatedIdeasState.ideas : []).slice(0, 6)
    };
    try {
      return await api("/api/v1/factory/ideas/ai-chat-enrich", "POST", {
        orgId: ctx.orgId,
        sandboxId: ctx.sandboxId,
        productId: ctx.productId,
        ideaId: ctx.ideaId || "",
        headline: seed.headline,
        description: seed.description,
        details: {
          ...(latestDraft?.details || {}),
          metadata: {
            ...((latestDraft?.details && latestDraft.details.metadata) || {}),
            sourceIdeas: forkedSourceIdeaIds.slice(0, 20)
          }
        },
        messages: normalizedMessages,
        relatedIdeasContext
      }, {
        headers: correlationId ? { "x-correlation-id": correlationId } : {}
      });
    } catch (error) {
      if (error?.status !== 404) throw error;
      const transcript = normalizedMessages
        .map((item) => {
          const imageCount = Array.isArray(item.images) ? item.images.length : 0;
          const text = String(item.content || "").trim() || "[image message]";
          return `${String(item.role || "user").toUpperCase()}: ${text}${imageCount ? ` (images:${imageCount})` : ""}`;
        })
        .join("\n");
      const fallbackDraft = await api("/api/v1/factory/ideas/ai-draft", "POST", {
        orgId: ctx.orgId,
        sandboxId: ctx.sandboxId,
        productId: ctx.productId,
        title: seed.headline,
        description: seed.description,
        intent: [
          `Headline: ${seed.headline}`,
          `Description: ${seed.description}`,
          relatedIdeasContext.ideas.length
            ? `Related ideas:\n${relatedIdeasContext.ideas.map((item) => `- ${item.ideaId}: ${item.title}`).join("\n")}`
            : "",
          transcript ? `Conversation:\n${transcript}` : ""
        ].filter(Boolean).join("\n\n"),
        details: {
          ...(latestDraft?.details || {}),
          metadata: {
            ...((latestDraft?.details && latestDraft.details.metadata) || {}),
            sourceIdeas: forkedSourceIdeaIds.slice(0, 20)
          }
        }
      }, {
        headers: correlationId ? { "x-correlation-id": correlationId } : {}
      });
      return {
        ...fallbackDraft,
        assistant: {
          content: "Chat endpoint was unavailable. Used fallback enrichment path; restart backend to re-enable full chat endpoint."
        }
      };
    }
  }

  async function hydrateFromStoredIdea() {
    const ctx = getCtx();
    if (!ctx.ideaId) return;
    try {
      const ideas = await api(
        `/api/v1/factory/ideas?orgId=${encodeURIComponent(ctx.orgId)}&sandboxId=${encodeURIComponent(ctx.sandboxId)}&productId=${encodeURIComponent(ctx.productId)}&page=1&pageSize=50`
      );
      const ideaRows = Array.isArray(ideas?.ideas) ? ideas.ideas : [];
      renderCurrentIdeasContext({
        ideas: ideaRows.slice(0, 12).map((item) => ({
          ideaId: item.ideaId,
          title: item.title,
          description: item.description,
          status: item.status || "new",
          createdAt: item.createdAt || "",
          isActive: Boolean(ctx.ideaId) && item.ideaId === ctx.ideaId
        })),
        meta: {
          loadedIdeas: Math.min(12, ideaRows.length),
          totalIdeas: Number(ideas?.total || ideaRows.length),
          statusCounts: ideaRows.slice(0, 12).reduce((acc, item) => {
            const key = String(item.status || "new");
            acc[key] = Number(acc[key] || 0) + 1;
            return acc;
          }, {}),
          activeIdeaId: ctx.ideaId || ""
        }
      });
      const stored = ideaRows.find((item) => item.ideaId === ctx.ideaId);
      if (stored) {
        latestDraft = {
          ...stored,
          source: "stored",
          details: stored.details || {}
        };
        forkedSourceIdeaIds = Array.isArray(stored?.details?.metadata?.sourceIdeas)
          ? stored.details.metadata.sourceIdeas.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20)
          : [];
        const storedVersion = Number(stored?.details?._ideaArtifactVersion || 0);
        latestArtifactMeta = storedVersion > 0
          ? { ideaId: stored.ideaId, version: storedVersion, updatedAt: stored?.details?._ideaArtifactUpdatedAt || "" }
          : null;
        setIdeaSeed({ headline: stored.title || "", description: stored.description || "" });
        renderIdeaEnrichment(latestDraft);
      }
      const triagePayload = await api(`/api/v1/factory/ideas/${encodeURIComponent(ctx.ideaId)}/ai-triage`, "POST", {});
      if (triagePayload?.triage) {
        latestDraft = {
          ...(latestDraft || {}),
          triage: triagePayload.triage
        };
        renderIdeaEnrichment(latestDraft);
        renderTriageRendition(triagePayload);
      }
    } catch {
      // Best-effort hydration.
    }
  }

  if (chatSend && chatInput) {
    if (chatImagesInput) {
      chatImagesInput.onchange = async () => {
        const files = Array.from(chatImagesInput.files || [])
          .filter((file) => file && file.type && file.type.startsWith("image/"))
          .slice(0, 3);
        if (!files.length) {
          pendingChatImages = [];
          renderPendingChatImages([]);
          refreshCreateIdeaCta();
          return;
        }
        const maxBytes = 2 * 1024 * 1024;
        const convert = (file) => new Promise((resolve, reject) => {
          if (file.size > maxBytes) {
            reject(new Error(`${file.name} is too large. Max 2MB per image.`));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
          reader.readAsDataURL(file);
        });
        try {
          pendingChatImages = (await Promise.all(files.map(convert))).filter(Boolean);
          renderPendingChatImages(pendingChatImages);
          refreshCreateIdeaCta();
        } catch (error) {
          pendingChatImages = [];
          renderPendingChatImages([]);
          show(error.message, true);
          refreshCreateIdeaCta();
        }
      };
    }

    chatSend.onclick = async () => {
      let seed = ensureSeedFromConversation();
      const message = String(chatInput.value || "").trim();
      const imageAttachments = pendingChatImages.slice(0, 3);
      if (!message && !imageAttachments.length) return;
      chatInput.value = "";
      chatState.messages.push({ role: "user", content: message, images: imageAttachments });
      appendChatMessage("user", message || "Shared image context.", imageAttachments);
      try {
        hideSuccess(enrichSuccessBanner);
        setEnrichmentLoading(true);
        const correlationId = makeCorrelationId("enrich");
        const ctx = getCtx();
        seed = ensureSeedFromConversation();
        await loadCurrentIdeasContext().catch(() => {});
        const relatedQuery = message || seed.headline || seed.description || "";
        await fetchRelatedIdeas(relatedQuery).catch(() => {});
        await runAiProgressFlow([
          { percent: 24, label: "Applying conversational refinement...", waitMs: 120 },
          { percent: 66, label: "Re-generating idea draft from full context...", waitMs: 140 },
          { percent: 90, label: "Updating triage analysis..." }
        ]);
        const payload = await requestChatEnrichment(ctx, seed, chatState.messages, { correlationId });
        logClientEvent("ui.idea.enrichment.response", {
          correlationId: payload?.correlationId || correlationId,
          ideaId: payload?.artifact?.ideaId || ctx.ideaId || null,
          artifactVersion: payload?.artifact?.version || null
        });
        clearEnrichmentFailure();
        if (payload?.currentIdeasContext) {
          renderCurrentIdeasContext(payload.currentIdeasContext);
        }
        if (payload?.artifact) {
          latestArtifactMeta = payload.artifact;
        }
        latestDraft = payload?.draft || latestDraft;
        if (ideaStateHelper?.applyEnrichmentArtifact && latestDraft && payload?.artifact) {
          latestDraft = ideaStateHelper.applyEnrichmentArtifact(latestDraft, payload.draft || {}, payload.artifact);
        }
        if (latestDraft) {
          setIdeaSeed({
            headline: latestDraft.title || seed.headline,
            description: latestDraft.description || seed.description
          });
          renderIdeaEnrichment(latestDraft);
        }
        if (payload?.draft?.triage) {
          renderTriageRendition({ triage: payload.draft.triage, source: payload.draft.source || "ai-chat" });
        }
        const assistantText = String(payload?.assistant?.content || "Draft updated.");
        chatState.messages.push({ role: "assistant", content: assistantText, images: [] });
        appendChatMessage("assistant", assistantText);
        pendingChatImages = [];
        renderPendingChatImages([]);
        if (chatImagesInput) chatImagesInput.value = "";
        output(payload);
        setAiProgress(100, "Chat refinement applied.");
        showSuccess(enrichSuccessBanner, "AI draft updated from chat context.");
        refreshCreateIdeaCta();
      } catch (error) {
        showEnrichmentFailure(error);
        show(error.message, true);
      } finally {
        setEnrichmentLoading(false);
      }
    };

    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatSend.click();
      }
    });
    chatInput.addEventListener("input", () => {
      if (relatedIdeasTimer) clearTimeout(relatedIdeasTimer);
      const nextQuery = String(chatInput.value || "").trim();
      relatedIdeasTimer = setTimeout(() => {
        fetchRelatedIdeas(nextQuery).catch(() => {});
      }, 240);
    });
  }

  if (createIdea) {
    createIdea.onclick = async () => {
      try {
        hideSuccess(prSuccessBanner);
        setPrLoading(true);
        const correlationId = makeCorrelationId("create-pr");
        const productContext = await loadProductContext();
        if (!productContext.ready) {
          productContextReady = false;
          refreshCreateIdeaCta();
          throw new Error("Product context is required before creating ideas. Complete Product Onboarding first.");
        }
        productContextReady = true;
        const ctx = getCtx();
        const seed = ensureSeedFromConversation();
        if (!seed.headline || !seed.description) {
          throw new Error("Send at least one message so AI can build the idea before submitting.");
        }
        await runAiProgressFlow([
          { percent: 10, label: "Validating scope + context...", waitMs: 120 },
          { percent: 38, label: "Final AI enrichment from full context...", waitMs: 150 },
          { percent: 72, label: "Creating PR-backed idea artifacts...", waitMs: 160 },
          { percent: 92, label: "Applying stage lock..." }
        ]);
        const payload = await api("/api/v1/factory/ideas", "POST", {
          orgId: ctx.orgId,
          sandboxId: ctx.sandboxId,
          productId: ctx.productId,
          title: seed.headline,
          description: seed.description,
          intent: `Headline: ${seed.headline}\nDescription: ${seed.description}`,
          details: {
            ...(latestDraft?.details || {}),
            metadata: {
              ...((latestDraft?.details && latestDraft.details.metadata) || {}),
              sourceIdeas: forkedSourceIdeaIds.slice(0, 20)
            }
          },
          autoPipeline: true,
          enforceGithubPr: true
        }, {
          headers: {
            "x-correlation-id": correlationId
          }
        });
        logClientEvent("ui.idea.pr.create.response", {
          correlationId: payload?.correlationId || correlationId,
          ideaId: payload?.idea?.ideaId || null,
          capabilityId: payload?.triagePr?.capability?.capabilityId || null,
          prId: payload?.triagePr?.pr?.prId || null
        });
        setCtx({
          ideaId: payload.idea?.ideaId || "",
          capabilityId: payload.triagePr?.capability?.capabilityId || ""
        });
        clearPrFailure();
        renderTop("idea");
        await loadCurrentIdeasContext().catch(() => {});
        latestDraft = {
          ...payload.idea,
          details: payload.idea?.details || {},
          triage: payload?.generation?.triage || payload?.triagePr?.triage || null,
          source: payload?.generation?.source || "created",
          llmModel: payload?.generation?.llmModel || null,
          llmEnabled: payload?.generation?.llmEnabled,
          fallbackReason: payload?.generation?.fallbackReason || null,
          contextUsed: payload?.generation?.contextUsed || null
        };
        const createdVersion = Number(payload?.idea?.details?._ideaArtifactVersion || 0);
        latestArtifactMeta = createdVersion > 0
          ? { ideaId: payload?.idea?.ideaId || "", version: createdVersion, updatedAt: payload?.idea?.details?._ideaArtifactUpdatedAt || "" }
          : null;
        renderIdeaEnrichment(latestDraft);
        if (latestDraft.triage) {
          renderTriageRendition({
            triage: latestDraft.triage,
            source: payload?.generation?.source || "idea-create"
          });
        }
        renderPrGate({ capability: payload?.triagePr?.capability || null }, payload?.triagePr?.pr || null);
        openPrSubmittedDialog(payload?.triagePr?.pr || null, payload?.triagePr?.capability?.stage || "triage");
        await refreshCapabilityGate().catch(() => {});
        output(payload);
        setAiProgress(100, "Idea submitted and PR opened.");
        showSuccess(prSuccessBanner, "PR created and queued for approval.");
        show("Idea submitted. PR is open for human approval; next stage is locked.");
      } catch (error) {
        showPrFailure(error);
        if (error?.status === 412 && error?.payload) {
          const partial = error.payload;
          setCtx({
            ideaId: partial.idea?.ideaId || "",
            capabilityId: partial.triagePr?.capability?.capabilityId || ""
          });
          renderTop("idea");
          await loadCurrentIdeasContext().catch(() => {});
          renderPrGate({ capability: partial?.triagePr?.capability || null }, partial?.triagePr?.pr || null);
          output(partial);
        }
        show(error.message, true);
      } finally {
        setPrLoading(false);
      }
    };
  }

  if (approveIdeaPr) {
    approveIdeaPr.onclick = async () => {
      try {
        hideSuccess(prSuccessBanner);
        clearPrFailure();
        setPrLoading(true);
        const ctx = getCtx();
        if (!ctx.capabilityId) throw new Error("Submit idea first.");
        const correlationId = makeCorrelationId("approve-pr");
        await runAiProgressFlow([
          { percent: 25, label: "Syncing triage docs to PR...", waitMs: 120 },
          { percent: 62, label: "Submitting approval...", waitMs: 120 },
          { percent: 92, label: "Unlocking Spec stage..." }
        ]);
        const payload = await api(
          `/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/triage/approve`,
          "POST",
          { note: "Approved from Product Factory UI" },
          {
            headers: {
              "x-correlation-id": correlationId
            }
          }
        );
        output(payload);
        const detail = await refreshCapabilityGate().catch(() => null);
        if (detail?.capability?.stage) renderApprovedRendition(detail.capability.stage);
        setAiProgress(100, "Idea PR approved.");
        if (payload?.githubApproval?.mode === "local-self-approval-fallback") {
          const note = "GitHub blocked self-approval; Product Factory recorded local approval and unlocked Spec.";
          showSuccess(prSuccessBanner, note);
          show(note);
        } else {
          showSuccess(prSuccessBanner, "Idea PR approved. Spec stage is unlocked.");
          show("Idea PR approved. Spec stage is unlocked.");
        }
      } catch (error) {
        showPrFailure(error, "approval");
        show(error.message, true);
      } finally {
        setPrLoading(false);
      }
    };
  }

  if (continueSpec) {
    continueSpec.onclick = async () => {
      const ctx = getCtx();
      if (!ctx.capabilityId) {
        show("Submit and approve idea PR before moving to Spec.", true);
        return;
      }
      try {
        const detail = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}`);
        const stage = detail?.capability?.stage || "";
        if (!["spec", "spec-approved", "architecture", "architecture-approved", "compliance", "compliance-approved", "pr-created"].includes(stage)) {
          throw new Error(`Spec is locked. Current stage is '${stage}'.`);
        }
      } catch (error) {
        show(error.message, true);
        return;
      }
      window.location.href = "/pipeline-spec.html";
    };
  }

  if (prDialogClose) {
    prDialogClose.onclick = () => closePrSubmittedDialog();
  }
  if (prDialog) {
    prDialog.addEventListener("click", (event) => {
      if (event.target === prDialog) closePrSubmittedDialog();
    });
  }
  if (viewFullIdea) {
    viewFullIdea.onclick = () => openIdeaDrawer();
  }
  if (ideaDrawerClose) {
    ideaDrawerClose.onclick = () => closeIdeaDrawer();
  }
  if (ideaDrawerBackdrop) {
    ideaDrawerBackdrop.onclick = () => closeIdeaDrawer();
  }
  ideaDrawerTabs.forEach((button) => {
    button.onclick = () => renderDrawerTab(button?.dataset?.tab || "overview");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ideaDrawer?.classList.contains("open")) {
      closeIdeaDrawer();
    }
  });
  if (enrichRetry && chatSend) {
    enrichRetry.onclick = () => {
      clearEnrichmentFailure();
      chatSend.click();
    };
  }
  if (enrichViewLogs) {
    enrichViewLogs.onclick = () => {
      const payload = lastEnrichmentFailure?.payload || {};
      const corr = payload?.correlationId ? `correlationId=${payload.correlationId}` : "correlationId=unavailable";
      const reason = payload?.reason || payload?.error || lastEnrichmentFailure?.message || "unknown";
      show(`Enrichment logs: ${corr} · ${reason}`, true);
      output(payload);
    };
  }
  if (prReconnect) {
    prReconnect.onclick = () => {
      window.location.href = "/factory-config.html";
    };
  }
  if (prRetry && createIdea) {
    prRetry.onclick = () => {
      const retryKind = lastPrFailureKind;
      clearPrFailure();
      if (retryKind === "approval" && approveIdeaPr) {
        approveIdeaPr.click();
        return;
      }
      createIdea.click();
    };
  }

  clearEnrichmentFailure();
  clearPrFailure();
  hideSuccess(enrichSuccessBanner);
  hideSuccess(prSuccessBanner);
  renderIdeaEnrichment(null);
  refreshCreateIdeaCta();
  if (chatHost && chatHost.childElementCount === 0) {
    const greeting = "Describe the idea you want to build. Add screenshots or diagrams for multimodal enrichment.";
    chatState.messages.push({ role: "assistant", content: greeting, images: [] });
    appendChatMessage("assistant", greeting);
  }
  await loadCurrentIdeasContext().catch(() => {});
  await fetchRelatedIdeas(currentIdeaSeed().headline || currentIdeaSeed().description || "").catch(() => {});
  await hydrateFromStoredIdea();
  await refreshCapabilityGate().catch(() => {});
}

async function initTriage() {
  const previewBtn = document.getElementById("renderAiTriage");
  if (previewBtn) {
    previewBtn.onclick = async () => {
      try {
      const ctx = getCtx();
      if (!ctx.ideaId) throw new Error("Need idea first.");
      await runAiProgressFlow([
        { percent: 20, label: "AI reading idea context...", waitMs: 120 },
        { percent: 60, label: "AI scoring readiness...", waitMs: 120 },
        { percent: 85, label: "Generating triage report..." }
      ]);
      const payload = await api(`/api/v1/factory/ideas/${encodeURIComponent(ctx.ideaId)}/ai-triage`, "POST", {});
      renderTriageRendition(payload);
      output(payload);
      setAiProgress(100, "AI triage ready.");
      show("AI triage rendered.");
    } catch (error) { show(error.message, true); }
    };
  }

  document.getElementById("runTriage").onclick = async () => {
    try {
      const ctx = getCtx();
      if (!ctx.ideaId) throw new Error("Need idea first.");
      await runAiProgressFlow([
        { percent: 15, label: "Re-running AI triage...", waitMs: 120 },
        { percent: 55, label: "Refining capability scope...", waitMs: 120 },
        { percent: 85, label: "Updating triage artifacts..." }
      ]);
      const payload = await api(`/api/v1/factory/ideas/${encodeURIComponent(ctx.ideaId)}/triage`, "POST", {
        capabilityTitle: "Auto capability"
      });
      if (payload.capability?.capabilityId) setCtx({ capabilityId: payload.capability.capabilityId });
      renderTop("triage");
      renderTriageRendition(payload);
      output(payload);
      setAiProgress(100, "Triage complete.");
      show("Triage completed. Capability created.");
    } catch (error) { show(error.message, true); }
  };

  const ctx = getCtx();
  if (ctx.ideaId) {
    api(`/api/v1/factory/ideas/${encodeURIComponent(ctx.ideaId)}/ai-triage`, "POST", {})
      .then((payload) => renderTriageRendition(payload))
      .catch(() => {});
    if (!ctx.capabilityId) {
      ensureCapabilityFromIdea()
        .then(() => renderTop("triage"))
        .catch(() => {});
    }
  }
}

async function initArchitectureEnhancers() {
  const autoBtn = document.getElementById("autoArchitecture");
  if (autoBtn) {
    autoBtn.onclick = async () => {
      try {
        const ctx = getCtx();
        if (!ctx.capabilityId) throw new Error("Need capability first.");
        await runAiProgressFlow([
          { percent: 10, label: "Reading idea/spec context...", waitMs: 120 },
          { percent: 40, label: "Generating architecture narrative...", waitMs: 120 },
          { percent: 70, label: "Generating diagram and persisting draft..." }
        ]);
        const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/auto-architecture`, "POST", {});
        setAiProgress(90, "Loading generated draft...");
        output(payload);
        show("Auto-generated architecture draft from idea/spec context.");
        await loadDoc("architecture");
        setAiProgress(100, "Auto-generation complete.");
      } catch (error) { show(error.message, true); }
    };
  }

  const gitBtn = document.getElementById("hydrateFromGit");
  if (gitBtn) {
    gitBtn.onclick = async () => {
      try {
        const ctx = getCtx();
        if (!ctx.capabilityId) throw new Error("Need capability first.");
        const payload = await api(
          `/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/architecture/rendition?source=auto`,
          "GET"
        );
        document.getElementById("docContent").value = payload.content || "";
        document.getElementById("docDiagram").value = payload.diagramSource || "";
        renderSmartRendition(payload);
        setAiProgress(payload.content ? 100 : 0, payload.content ? "Loaded architecture from Git branch." : "No Git architecture doc found.");
        output(payload);
        show("Hydrated architecture content from Git branch.");
      } catch (error) { show(error.message, true); }
    };
  }

  try {
    const ctx = getCtx();
    if (ctx.capabilityId) {
      const payload = await api(
        `/api/v1/factory/capabilities/${encodeURIComponent(ctx.capabilityId)}/stages/architecture/rendition?source=auto`,
        "GET"
      );
      renderSmartRendition(payload);
      setAiProgress(payload.content ? 100 : 0, payload.content ? "Architecture draft available." : "No architecture draft yet.");
    }
  } catch {
    // Best effort render.
  }
}

function wireDocStage(stageKey, runEndpoint, approveAllowed = false) {
  const runBtn = document.getElementById("runStage");
  if (runBtn && runEndpoint) {
    runBtn.onclick = async () => {
      try {
        const capabilityId = await ensureCapabilityFromIdea();
        const intent = String(document.getElementById("docIntent")?.value || "").trim();
        if (!intent) throw new Error(`Provide Human Intent before running ${stageKey}.`);
        await runAiProgressFlow([
          { percent: 15, label: `Executing ${stageKey} stage...`, waitMs: 120 },
          { percent: 45, label: "Generating baseline artifact...", waitMs: 120 }
        ]);
        const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/${runEndpoint}`, "POST", {});
        await runAiProgressFlow([
          { percent: 70, label: "Applying AI augmentation...", waitMs: 120 }
        ]);
        const aiDraft = await api(
          `/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/stages/${encodeURIComponent(stageKey)}/ai-generate`,
          "POST",
          { intent }
        );
        if (aiDraft?.doc?.content && document.getElementById("docContent")) {
          document.getElementById("docContent").value = aiDraft.doc.content;
        } else {
          await loadDoc(stageKey).catch(() => {});
        }
        output(payload);
        setAiProgress(100, `AI generation complete for ${stageKey}.`);
        show(`${stageKey} execution completed.`);
      } catch (error) { show(error.message, true); }
    };
  }

  const loadBtn = document.getElementById("docLoad");
  const saveBtn = document.getElementById("docSave");
  const aiBtn = document.getElementById("docAi");
  const syncBtn = document.getElementById("docSync");
  const approveBtn = document.getElementById("docApprove");

  if (loadBtn) loadBtn.onclick = () => loadDoc(stageKey).catch((e) => show(e.message, true));
  if (saveBtn) saveBtn.onclick = () => saveDoc(stageKey).catch((e) => show(e.message, true));
  if (aiBtn) aiBtn.onclick = () => aiReview(stageKey).catch((e) => show(e.message, true));
  if (syncBtn) syncBtn.onclick = () => syncToPr(stageKey).catch((e) => show(e.message, true));
  if (approveBtn) {
    if (!approveAllowed) {
      approveBtn.disabled = true;
    } else {
      approveBtn.onclick = () => approveStage(stageKey).catch((e) => show(e.message, true));
    }
  }
}

async function initBuild() {
  const prState = document.getElementById("prControlState");
  const refreshPrStatus = document.getElementById("refreshPrStatus");
  const approveBuildPr = document.getElementById("approveBuildPr");

  function renderPrControl(detailPayload) {
    const pr = detailPayload?.pr || null;
    if (!prState) return;
    if (!pr) {
      prState.innerHTML = `<div class="t">PR: not created</div><div class="s">Run Build to PR first.</div>`;
      if (approveBuildPr) approveBuildPr.disabled = true;
      return;
    }
    const url = pr.externalUrl
      ? `<a href="${pr.externalUrl}" target="_blank" rel="noreferrer">Open PR</a>`
      : `Internal PR ${escapeHtml(pr.prId || "")}`;
    prState.innerHTML = `
      <div class="t code">${escapeHtml(pr.repo || "-")} · ${escapeHtml(pr.branch || "-")}</div>
      <div class="s">Status: ${escapeHtml(pr.status || "open")} · ${url}</div>
    `;
    if (approveBuildPr) approveBuildPr.disabled = false;
  }

  async function loadBuildDetail() {
    const capabilityId = await ensureCapabilityFromIdea();
    const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}`);
    renderPrControl(payload);
    output(payload);
    return payload;
  }

  document.getElementById("runBuild").onclick = async () => {
    try {
      const capabilityId = await ensureCapabilityFromIdea();
      const detail = await api(`/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}`);
      const stage = detail?.capability?.stage || "";
      if (stage !== "compliance-approved" && stage !== "pr-created") {
        throw new Error(`Build is locked. Current stage is '${stage}'. Approve compliance PR first.`);
      }
      const intent = String(document.getElementById("buildIntent")?.value || "").trim();
      if (!intent) throw new Error("Provide Human Intent before running Build.");
      await runAiProgressFlow([
        { percent: 20, label: "Generating AI build plan...", waitMs: 120 }
      ]);
      await api(
        `/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/stages/build/ai-generate`,
        "POST",
        { intent }
      );
      await runAiProgressFlow([
        { percent: 55, label: "Preparing PR/ticket payload...", waitMs: 120 },
        { percent: 80, label: "Creating PR and tickets..." }
      ]);
      const payload = await api(`/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/build-to-pr`, "POST", {});
      output(payload);
      renderPrControl(payload);
      if (!payload?.pr?.externalUrl) {
        show("Internal PR created in Product Factory.");
      }
      setAiProgress(100, "Build + AI delivery complete.");
      show("Build to PR completed.");
    } catch (error) { show(error.message, true); }
  };

  document.getElementById("loadDetail").onclick = async () => {
    try {
      await loadBuildDetail();
      show("Capability detail loaded.");
    } catch (error) { show(error.message, true); }
  };

  if (refreshPrStatus) {
    refreshPrStatus.onclick = async () => {
      try {
        await loadBuildDetail();
        show("PR status refreshed.");
      } catch (error) { show(error.message, true); }
    };
  }

  if (approveBuildPr) {
    approveBuildPr.onclick = async () => {
      try {
        const capabilityId = await ensureCapabilityFromIdea();
        await runAiProgressFlow([
          { percent: 25, label: "Syncing build evidence to PR...", waitMs: 120 },
          { percent: 60, label: "Submitting PR approval...", waitMs: 120 },
          { percent: 85, label: "Applying approval transition..." }
        ]);
        const payload = await api(
          `/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/stages/build/approve`,
          "POST",
          { note: "Build PR approved in Product Factory" }
        );
        output(payload);
        await loadBuildDetail();
        setAiProgress(100, "PR approval complete.");
        show("PR approved in Product Factory.");
      } catch (error) { show(error.message, true); }
    };
  }

  await loadBuildDetail().catch(() => {});
}

function bootstrap() {
  requireAuth();
  requireScope();
  const stageKey = document.body.dataset.stage || "idea";
  renderTop(stageKey);

  if (stageKey === "idea") initIdea();
  if (stageKey === "triage") initTriage();
  if (stageKey === "spec") wireDocStage("spec", "spec", true);
  if (stageKey === "architecture") {
    wireDocStage("architecture", "architecture", true);
    initArchitectureEnhancers();
  }
  if (stageKey === "compliance") wireDocStage("compliance", "compliance", true);
  if (stageKey === "build") initBuild();
  enforceStageGate(stageKey).catch(() => {});
}

bootstrap();
