const fs = require("node:fs");
const path = require("node:path");

const STORE_FILE = path.resolve(__dirname, "../../../../data/runtime/store.json");
const STORE_PROVIDER = process.env.STORE_PROVIDER || "file";
const DATABASE_URL = process.env.DATABASE_URL || "";

const DEFAULT_STORE = {
  memberships: [
    {
      userId: "ava-admin",
      role: "organization_admin",
      orgId: "acme-health",
      sandboxIds: ["production", "pre-production"],
      productIds: ["crm", "internal-tools", "marketplace"]
    },
    {
      userId: "nina-user",
      role: "enterprise_user",
      orgId: "acme-health",
      sandboxIds: ["production"],
      productIds: ["crm"]
    },
    {
      userId: "platform-root",
      role: "platform_admin",
      orgId: "*",
      sandboxIds: ["*"],
      productIds: ["*"]
    }
  ],
  connectors: [
    {
      id: "github-main",
      type: "github",
      scope: "organization",
      orgId: "acme-health",
      status: "healthy",
      lastSyncAt: null,
      details: { repo: "goravind/probable-doodle" }
    },
    {
      id: "jira-acme",
      type: "jira",
      scope: "organization",
      orgId: "acme-health",
      status: "degraded",
      lastSyncAt: null,
      details: { projectKey: "ACME" }
    },
    {
      id: "aws-prod",
      type: "aws",
      scope: "sandbox",
      orgId: "acme-health",
      sandboxId: "production",
      status: "healthy",
      lastSyncAt: null,
      details: { account: "acme-prod" }
    }
  ],
  orchestrationRuns: [],
  factory: {
    ideas: [],
    productContexts: [],
    productCatalog: [],
    sandboxCatalog: [],
    capabilities: [],
    artifacts: [],
    stageDocs: [],
    pullRequests: [],
    tickets: [],
    config: {
      repoMode: "single",
      codeRepos: ["goravind/probable-doodle"],
      ticketRepos: ["goravind/probable-doodle"],
      ticketLabels: ["product-factory", "capability"],
      ticketArea: "product-factory",
      branchPrefix: "capability"
    }
  }
};

let initPromise = null;
let pgPool = null;

function ensureStoreFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2));
  }
}

function readStoreFile() {
  ensureStoreFile();
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function writeStoreFile(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

async function initializePostgres() {
  const { Pool } = require("pg");
  pgPool = new Pool({ connectionString: DATABASE_URL });

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      org_id TEXT NOT NULL,
      sandbox_ids JSONB NOT NULL,
      product_ids JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      org_id TEXT,
      sandbox_id TEXT,
      status TEXT NOT NULL,
      last_sync_at TIMESTAMPTZ,
      details JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orchestration_runs (
      run_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      agents JSONB NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_ideas (
      idea_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_capabilities (
      capability_id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      history JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_artifacts (
      artifact_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      content JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_stage_docs (
      doc_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      diagram_source TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_pull_requests (
      pr_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      files JSONB NOT NULL,
      external_url TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_tickets (
      ticket_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      labels JSONB NOT NULL,
      status TEXT NOT NULL,
      external_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_config (
      config_key TEXT PRIMARY KEY,
      config_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS factory_product_contexts (
      org_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, sandbox_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS factory_product_catalog (
      org_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, sandbox_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS factory_sandbox_catalog (
      org_id TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, sandbox_id)
    );

    ALTER TABLE factory_pull_requests ADD COLUMN IF NOT EXISTS external_url TEXT;
    ALTER TABLE factory_ideas ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  const membershipCount = Number((await pgPool.query("SELECT COUNT(*) AS count FROM memberships")).rows[0].count);
  if (membershipCount === 0) {
    for (const membership of DEFAULT_STORE.memberships) {
      await pgPool.query(
        `INSERT INTO memberships (user_id, role, org_id, sandbox_ids, product_ids)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [membership.userId, membership.role, membership.orgId, JSON.stringify(membership.sandboxIds), JSON.stringify(membership.productIds)]
      );
    }
  }

  const connectorCount = Number((await pgPool.query("SELECT COUNT(*) AS count FROM connectors")).rows[0].count);
  if (connectorCount === 0) {
    for (const connector of DEFAULT_STORE.connectors) {
      await pgPool.query(
        `INSERT INTO connectors (id, type, scope, org_id, sandbox_id, status, last_sync_at, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          connector.id,
          connector.type,
          connector.scope,
          connector.orgId || null,
          connector.sandboxId || null,
          connector.status,
          connector.lastSyncAt,
          JSON.stringify(connector.details || {})
        ]
      );
    }
  }

  const configCount = Number((await pgPool.query("SELECT COUNT(*) AS count FROM factory_config WHERE config_key = 'factory'")).rows[0].count);
  if (configCount === 0) {
    await pgPool.query(
      `INSERT INTO factory_config (config_key, config_value)
       VALUES ('factory', $1::jsonb)`,
      [JSON.stringify(DEFAULT_STORE.factory.config)]
    );
  }
}

async function initializeStore() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (STORE_PROVIDER === "postgres") {
      if (!DATABASE_URL) {
        throw new Error("STORE_PROVIDER=postgres requires DATABASE_URL");
      }
      await initializePostgres();
      return;
    }

    ensureStoreFile();
  })();

  return initPromise;
}

function mapMembershipRow(row) {
  return {
    userId: row.user_id,
    role: row.role,
    orgId: row.org_id,
    sandboxIds: row.sandbox_ids || [],
    productIds: row.product_ids || []
  };
}

function mapConnectorRow(row) {
  return {
    id: row.id,
    type: row.type,
    scope: row.scope,
    orgId: row.org_id,
    sandboxId: row.sandbox_id,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    details: row.details || {}
  };
}

function mapCapabilityRow(row) {
  return {
    capabilityId: row.capability_id,
    ideaId: row.idea_id,
    orgId: row.org_id,
    sandboxId: row.sandbox_id,
    productId: row.product_id,
    title: row.title,
    description: row.description,
    stage: row.stage,
    status: row.status,
    history: row.history || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getMembership(userId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query("SELECT * FROM memberships WHERE user_id = $1 LIMIT 1", [userId]);
    return result.rows[0] ? mapMembershipRow(result.rows[0]) : null;
  }

  const store = readStoreFile();
  return store.memberships.find((membership) => membership.userId === userId) || null;
}

async function listMembershipsByOrg(orgId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query("SELECT * FROM memberships WHERE org_id = $1", [orgId]);
    return result.rows.map(mapMembershipRow);
  }

  const store = readStoreFile();
  return store.memberships.filter((membership) => membership.orgId === orgId);
}

async function upsertMembership(entry) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO memberships (user_id, role, org_id, sandbox_ids, product_ids)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET role = EXCLUDED.role,
                     org_id = EXCLUDED.org_id,
                     sandbox_ids = EXCLUDED.sandbox_ids,
                     product_ids = EXCLUDED.product_ids,
                     updated_at = NOW()
       RETURNING *`,
      [entry.userId, entry.role, entry.orgId, JSON.stringify(entry.sandboxIds || []), JSON.stringify(entry.productIds || [])]
    );
    return mapMembershipRow(result.rows[0]);
  }

  const store = readStoreFile();
  const idx = store.memberships.findIndex((membership) => membership.userId === entry.userId);
  if (idx === -1) {
    store.memberships.push(entry);
  } else {
    store.memberships[idx] = { ...store.memberships[idx], ...entry };
  }
  writeStoreFile(store);
  return store.memberships[idx === -1 ? store.memberships.length - 1 : idx];
}

async function listConnectors(orgId = null) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    if (!orgId) {
      const result = await pgPool.query("SELECT * FROM connectors");
      return result.rows.map(mapConnectorRow);
    }
    const result = await pgPool.query("SELECT * FROM connectors WHERE org_id = $1 OR scope = 'platform'", [orgId]);
    return result.rows.map(mapConnectorRow);
  }

  const store = readStoreFile();
  if (!orgId) return store.connectors;
  return store.connectors.filter((connector) => connector.orgId === orgId || connector.scope === "platform");
}

async function markConnectorSync(connectorId, status = "healthy") {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `UPDATE connectors
       SET status = $2,
           last_sync_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [connectorId, status]
    );
    return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
  }

  const store = readStoreFile();
  const connector = store.connectors.find((item) => item.id === connectorId);
  if (!connector) return null;
  connector.status = status;
  connector.lastSyncAt = new Date().toISOString();
  writeStoreFile(store);
  return connector;
}

async function upsertConnector(connector) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO connectors (id, type, scope, org_id, sandbox_id, status, last_sync_at, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id)
       DO UPDATE SET type = EXCLUDED.type,
                     scope = EXCLUDED.scope,
                     org_id = EXCLUDED.org_id,
                     sandbox_id = EXCLUDED.sandbox_id,
                     status = EXCLUDED.status,
                     last_sync_at = EXCLUDED.last_sync_at,
                     details = EXCLUDED.details,
                     updated_at = NOW()
       RETURNING *`,
      [
        connector.id,
        connector.type,
        connector.scope,
        connector.orgId || null,
        connector.sandboxId || null,
        connector.status || "healthy",
        connector.lastSyncAt || null,
        JSON.stringify(connector.details || {})
      ]
    );
    return mapConnectorRow(result.rows[0]);
  }

  const store = readStoreFile();
  const idx = store.connectors.findIndex((item) => item.id === connector.id);
  if (idx === -1) {
    store.connectors.push(connector);
  } else {
    store.connectors[idx] = { ...store.connectors[idx], ...connector };
  }
  writeStoreFile(store);
  return store.connectors[idx === -1 ? store.connectors.length - 1 : idx];
}

async function getGithubConnectorByOrg(orgId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT * FROM connectors
       WHERE org_id = $1 AND type IN ('github_app', 'github_pat')
       ORDER BY CASE WHEN type = 'github_app' THEN 0 ELSE 1 END
       LIMIT 1`,
      [orgId]
    );
    return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
  }

  const store = readStoreFile();
  const matches = store.connectors.filter((item) => item.orgId === orgId && ["github_app", "github_pat"].includes(item.type));
  matches.sort((a, b) => {
    const av = a.type === "github_app" ? 0 : 1;
    const bv = b.type === "github_app" ? 0 : 1;
    return av - bv;
  });
  return matches[0] || null;
}

async function createOrchestrationRun(run) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    await pgPool.query(
      `INSERT INTO orchestration_runs (run_id, capability_id, actor, from_stage, to_stage, agents, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [run.runId, run.capabilityId, run.actor, run.fromStage || null, run.toStage || null, JSON.stringify(run.agents || []), run.status]
    );
    return run;
  }

  const store = readStoreFile();
  store.orchestrationRuns.push(run);
  writeStoreFile(store);
  return run;
}

async function listOrchestrationRuns(capabilityId = null) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    if (!capabilityId) {
      const result = await pgPool.query("SELECT * FROM orchestration_runs ORDER BY created_at DESC");
      return result.rows.map((row) => ({
        runId: row.run_id,
        capabilityId: row.capability_id,
        actor: row.actor,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        agents: row.agents || [],
        status: row.status,
        timestamp: row.created_at
      }));
    }

    const result = await pgPool.query("SELECT * FROM orchestration_runs WHERE capability_id = $1 ORDER BY created_at DESC", [capabilityId]);
    return result.rows.map((row) => ({
      runId: row.run_id,
      capabilityId: row.capability_id,
      actor: row.actor,
      fromStage: row.from_stage,
      toStage: row.to_stage,
      agents: row.agents || [],
      status: row.status,
      timestamp: row.created_at
    }));
  }

  const store = readStoreFile();
  if (!capabilityId) return store.orchestrationRuns;
  return store.orchestrationRuns.filter((run) => run.capabilityId === capabilityId);
}

async function createFactoryIdea(idea) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_ideas (idea_id, org_id, sandbox_id, product_id, title, description, details, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        idea.ideaId,
        idea.orgId,
        idea.sandboxId,
        idea.productId,
        idea.title,
        idea.description,
        JSON.stringify(idea.details || {}),
        idea.status,
        idea.createdBy
      ]
    );
    return {
      ideaId: result.rows[0].idea_id,
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      productId: result.rows[0].product_id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      details: result.rows[0].details || {},
      status: result.rows[0].status,
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at
    };
  }

  const store = readStoreFile();
  store.factory.ideas.push(idea);
  writeStoreFile(store);
  return idea;
}

async function getFactoryIdea(ideaId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query("SELECT * FROM factory_ideas WHERE idea_id = $1 LIMIT 1", [ideaId]);
    if (!result.rows[0]) return null;
    return {
      ideaId: result.rows[0].idea_id,
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      productId: result.rows[0].product_id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      details: result.rows[0].details || {},
      status: result.rows[0].status,
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at
    };
  }

  const store = readStoreFile();
  return store.factory.ideas.find((idea) => idea.ideaId === ideaId) || null;
}

async function updateFactoryIdea(ideaId, updates = {}) {
  await initializeStore();
  const current = await getFactoryIdea(ideaId);
  if (!current) return null;

  const next = {
    title: updates.title != null ? String(updates.title) : String(current.title || ""),
    description: updates.description != null ? String(updates.description) : String(current.description || ""),
    details: updates.details && typeof updates.details === "object"
      ? updates.details
      : (current.details || {}),
    status: updates.status != null ? String(updates.status) : String(current.status || "new")
  };

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `UPDATE factory_ideas
       SET title = $2,
           description = $3,
           details = $4::jsonb,
           status = $5,
           updated_at = NOW()
       WHERE idea_id = $1
       RETURNING *`,
      [
        ideaId,
        next.title,
        next.description,
        JSON.stringify(next.details || {}),
        next.status
      ]
    );
    if (!result.rows[0]) return null;
    return {
      ideaId: result.rows[0].idea_id,
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      productId: result.rows[0].product_id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      details: result.rows[0].details || {},
      status: result.rows[0].status,
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    };
  }

  const store = readStoreFile();
  const idea = store.factory.ideas.find((item) => item.ideaId === ideaId);
  if (!idea) return null;
  idea.title = next.title;
  idea.description = next.description;
  idea.details = next.details;
  idea.status = next.status;
  idea.updatedAt = new Date().toISOString();
  writeStoreFile(store);
  return idea;
}

async function listFactoryIdeasByScope({ orgId, sandboxId, limit = 20 }) {
  await initializeStore();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT * FROM factory_ideas
       WHERE org_id = $1 AND sandbox_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [orgId, sandboxId, safeLimit]
    );
    return result.rows.map((row) => ({
      ideaId: row.idea_id,
      orgId: row.org_id,
      sandboxId: row.sandbox_id,
      productId: row.product_id,
      title: row.title,
      description: row.description,
      details: row.details || {},
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  }

  const store = readStoreFile();
  return store.factory.ideas
    .filter((idea) => idea.orgId === orgId && idea.sandboxId === sandboxId)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, safeLimit);
}

async function listFactoryIdeasByProductScope({
  orgId,
  sandboxId,
  productId,
  limit = 20,
  offset = 0
}) {
  await initializeStore();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Number(offset)) : 0;

  if (STORE_PROVIDER === "postgres") {
    const countResult = await pgPool.query(
      `SELECT COUNT(*) AS count
       FROM factory_ideas
       WHERE org_id = $1 AND sandbox_id = $2 AND product_id = $3`,
      [orgId, sandboxId, productId]
    );
    const result = await pgPool.query(
      `SELECT * FROM factory_ideas
       WHERE org_id = $1 AND sandbox_id = $2 AND product_id = $3
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
      [orgId, sandboxId, productId, safeLimit, safeOffset]
    );
    return {
      total: Number(countResult.rows[0]?.count || 0),
      ideas: result.rows.map((row) => ({
        ideaId: row.idea_id,
        orgId: row.org_id,
        sandboxId: row.sandbox_id,
        productId: row.product_id,
        title: row.title,
        description: row.description,
        details: row.details || {},
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at
      }))
    };
  }

  const store = readStoreFile();
  const all = (store.factory.ideas || [])
    .filter((idea) => idea.orgId === orgId && idea.sandboxId === sandboxId && idea.productId === productId)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  return {
    total: all.length,
    ideas: all.slice(safeOffset, safeOffset + safeLimit)
  };
}

async function updateFactoryIdeaStatus(ideaId, status) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `UPDATE factory_ideas
       SET status = $2, updated_at = NOW()
       WHERE idea_id = $1
       RETURNING *`,
      [ideaId, status]
    );
    if (!result.rows[0]) return null;
    return {
      ideaId: result.rows[0].idea_id,
      status: result.rows[0].status
    };
  }

  const store = readStoreFile();
  const idea = store.factory.ideas.find((item) => item.ideaId === ideaId);
  if (!idea) return null;
  idea.status = status;
  writeStoreFile(store);
  return idea;
}

async function upsertFactoryCapability(capability) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_capabilities
        (capability_id, idea_id, org_id, sandbox_id, product_id, title, description, stage, status, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (capability_id)
       DO UPDATE SET stage = EXCLUDED.stage,
                     status = EXCLUDED.status,
                     history = EXCLUDED.history,
                     title = EXCLUDED.title,
                     description = EXCLUDED.description,
                     updated_at = NOW()
       RETURNING *`,
      [
        capability.capabilityId,
        capability.ideaId,
        capability.orgId,
        capability.sandboxId,
        capability.productId,
        capability.title,
        capability.description,
        capability.stage,
        capability.status,
        JSON.stringify(capability.history || [])
      ]
    );
    return mapCapabilityRow(result.rows[0]);
  }

  const store = readStoreFile();
  const idx = store.factory.capabilities.findIndex((item) => item.capabilityId === capability.capabilityId);
  if (idx === -1) {
    store.factory.capabilities.push(capability);
  } else {
    store.factory.capabilities[idx] = { ...store.factory.capabilities[idx], ...capability };
  }
  writeStoreFile(store);
  return store.factory.capabilities[idx === -1 ? store.factory.capabilities.length - 1 : idx];
}

async function getFactoryCapability(capabilityId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query("SELECT * FROM factory_capabilities WHERE capability_id = $1 LIMIT 1", [capabilityId]);
    return result.rows[0] ? mapCapabilityRow(result.rows[0]) : null;
  }

  const store = readStoreFile();
  return store.factory.capabilities.find((item) => item.capabilityId === capabilityId) || null;
}

async function getFactoryCapabilityByIdea(ideaId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      "SELECT * FROM factory_capabilities WHERE idea_id = $1 ORDER BY created_at DESC LIMIT 1",
      [ideaId]
    );
    return result.rows[0] ? mapCapabilityRow(result.rows[0]) : null;
  }

  const store = readStoreFile();
  const matches = store.factory.capabilities
    .filter((item) => item.ideaId === ideaId)
    .sort((a, b) => {
      const at = new Date(a.createdAt || 0).getTime();
      const bt = new Date(b.createdAt || 0).getTime();
      return bt - at;
    });
  return matches[0] || null;
}

async function listFactoryCapabilitiesByScope({ orgId, sandboxId, limit = 30 }) {
  await initializeStore();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 30;

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT * FROM factory_capabilities
       WHERE org_id = $1 AND sandbox_id = $2
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $3`,
      [orgId, sandboxId, safeLimit]
    );
    return result.rows.map((row) => mapCapabilityRow(row));
  }

  const store = readStoreFile();
  return store.factory.capabilities
    .filter((item) => item.orgId === orgId && item.sandboxId === sandboxId)
    .sort((a, b) => {
      const aAt = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bAt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bAt - aAt;
    })
    .slice(0, safeLimit);
}

async function addFactoryArtifact(artifact) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    await pgPool.query(
      `INSERT INTO factory_artifacts (artifact_id, capability_id, artifact_type, version, content)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [artifact.artifactId, artifact.capabilityId, artifact.artifactType, artifact.version, JSON.stringify(artifact.content || {})]
    );
    return artifact;
  }

  const store = readStoreFile();
  store.factory.artifacts.push(artifact);
  writeStoreFile(store);
  return artifact;
}

async function listFactoryArtifacts(capabilityId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      "SELECT * FROM factory_artifacts WHERE capability_id = $1 ORDER BY created_at ASC",
      [capabilityId]
    );
    return result.rows.map((row) => ({
      artifactId: row.artifact_id,
      capabilityId: row.capability_id,
      artifactType: row.artifact_type,
      version: row.version,
      content: row.content,
      createdAt: row.created_at
    }));
  }

  const store = readStoreFile();
  return store.factory.artifacts.filter((item) => item.capabilityId === capabilityId);
}

async function createFactoryPullRequest(pr) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    await pgPool.query(
      `INSERT INTO factory_pull_requests (pr_id, capability_id, repo, branch, title, description, files, external_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (pr_id)
       DO UPDATE SET repo = EXCLUDED.repo,
                     branch = EXCLUDED.branch,
                     title = EXCLUDED.title,
                     description = EXCLUDED.description,
                     files = EXCLUDED.files,
                     external_url = EXCLUDED.external_url,
                     status = EXCLUDED.status`,
      [
        pr.prId,
        pr.capabilityId,
        pr.repo,
        pr.branch,
        pr.title,
        pr.description,
        JSON.stringify(pr.files || []),
        pr.externalUrl || null,
        pr.status
      ]
    );
    return pr;
  }

  const store = readStoreFile();
  const idx = store.factory.pullRequests.findIndex((item) => item.prId === pr.prId);
  if (idx === -1) {
    store.factory.pullRequests.push(pr);
  } else {
    store.factory.pullRequests[idx] = { ...store.factory.pullRequests[idx], ...pr };
  }
  writeStoreFile(store);
  return pr;
}

async function createFactoryStageDoc(doc) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_stage_docs
        (doc_id, capability_id, stage_key, version, content, attachments, diagram_source, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       RETURNING *`,
      [
        doc.docId,
        doc.capabilityId,
        doc.stageKey,
        doc.version,
        doc.content,
        JSON.stringify(doc.attachments || []),
        doc.diagramSource || null,
        doc.status || "draft",
        doc.createdBy || "unknown"
      ]
    );
    return {
      docId: result.rows[0].doc_id,
      capabilityId: result.rows[0].capability_id,
      stageKey: result.rows[0].stage_key,
      version: result.rows[0].version,
      content: result.rows[0].content,
      attachments: result.rows[0].attachments || [],
      diagramSource: result.rows[0].diagram_source || "",
      status: result.rows[0].status,
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at
    };
  }

  const store = readStoreFile();
  store.factory.stageDocs.push(doc);
  writeStoreFile(store);
  return doc;
}

async function listFactoryStageDocs(capabilityId, stageKey = null) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    if (stageKey) {
      const result = await pgPool.query(
        `SELECT * FROM factory_stage_docs
         WHERE capability_id = $1 AND stage_key = $2
         ORDER BY version DESC`,
        [capabilityId, stageKey]
      );
      return result.rows.map((row) => ({
        docId: row.doc_id,
        capabilityId: row.capability_id,
        stageKey: row.stage_key,
        version: row.version,
        content: row.content,
        attachments: row.attachments || [],
        diagramSource: row.diagram_source || "",
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at
      }));
    }

    const result = await pgPool.query(
      `SELECT * FROM factory_stage_docs
       WHERE capability_id = $1
       ORDER BY created_at DESC`,
      [capabilityId]
    );
    return result.rows.map((row) => ({
      docId: row.doc_id,
      capabilityId: row.capability_id,
      stageKey: row.stage_key,
      version: row.version,
      content: row.content,
      attachments: row.attachments || [],
      diagramSource: row.diagram_source || "",
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  }

  const store = readStoreFile();
  return store.factory.stageDocs
    .filter((item) => item.capabilityId === capabilityId && (!stageKey || item.stageKey === stageKey))
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
}

async function getLatestFactoryStageDoc(capabilityId, stageKey) {
  const docs = await listFactoryStageDocs(capabilityId, stageKey);
  return docs[0] || null;
}

async function getFactoryPullRequestByCapability(capabilityId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      "SELECT * FROM factory_pull_requests WHERE capability_id = $1 ORDER BY created_at DESC LIMIT 1",
      [capabilityId]
    );
    if (!result.rows[0]) return null;
    return {
      prId: result.rows[0].pr_id,
      capabilityId: result.rows[0].capability_id,
      repo: result.rows[0].repo,
      branch: result.rows[0].branch,
      title: result.rows[0].title,
      description: result.rows[0].description,
      files: result.rows[0].files || [],
      externalUrl: result.rows[0].external_url || null,
      status: result.rows[0].status,
      createdAt: result.rows[0].created_at
    };
  }

  const store = readStoreFile();
  return store.factory.pullRequests.find((item) => item.capabilityId === capabilityId) || null;
}

async function getFactoryConfig() {
  await initializeStore();

  const normalizeFactoryConfig = (config = {}) => ({
    repoMode: config.repoMode === "multi" ? "multi" : "single",
    codeRepos: Array.isArray(config.codeRepos) && config.codeRepos.length > 0
      ? config.codeRepos
      : DEFAULT_STORE.factory.config.codeRepos,
    ticketRepos: Array.isArray(config.ticketRepos) && config.ticketRepos.length > 0
      ? config.ticketRepos
      : DEFAULT_STORE.factory.config.ticketRepos,
    ticketLabels: Array.isArray(config.ticketLabels)
      ? config.ticketLabels
      : DEFAULT_STORE.factory.config.ticketLabels,
    ticketArea: config.ticketArea || DEFAULT_STORE.factory.config.ticketArea,
    branchPrefix: config.branchPrefix || DEFAULT_STORE.factory.config.branchPrefix
  });

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      "SELECT config_value FROM factory_config WHERE config_key = 'factory' LIMIT 1"
    );
    if (!result.rows[0]) return normalizeFactoryConfig(DEFAULT_STORE.factory.config);
    return normalizeFactoryConfig(result.rows[0].config_value || DEFAULT_STORE.factory.config);
  }

  const store = readStoreFile();
  return normalizeFactoryConfig(store.factory.config || DEFAULT_STORE.factory.config);
}

async function upsertFactoryConfig(config) {
  await initializeStore();

  const nextConfig = {
    repoMode: config.repoMode === "multi" ? "multi" : "single",
    codeRepos: Array.isArray(config.codeRepos) && config.codeRepos.length > 0
      ? config.codeRepos
      : DEFAULT_STORE.factory.config.codeRepos,
    ticketRepos: Array.isArray(config.ticketRepos) && config.ticketRepos.length > 0
      ? config.ticketRepos
      : DEFAULT_STORE.factory.config.ticketRepos,
    ticketLabels: Array.isArray(config.ticketLabels)
      ? config.ticketLabels
      : DEFAULT_STORE.factory.config.ticketLabels,
    ticketArea: config.ticketArea || DEFAULT_STORE.factory.config.ticketArea,
    branchPrefix: config.branchPrefix || DEFAULT_STORE.factory.config.branchPrefix
  };

  if (STORE_PROVIDER === "postgres") {
    await pgPool.query(
      `INSERT INTO factory_config (config_key, config_value)
       VALUES ('factory', $1::jsonb)
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [JSON.stringify(nextConfig)]
    );
    return nextConfig;
  }

  const store = readStoreFile();
  store.factory.config = nextConfig;
  writeStoreFile(store);
  return nextConfig;
}

async function getFactoryProductContext({ orgId, sandboxId, productId }) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT org_id, sandbox_id, product_id, context, updated_by, updated_at
       FROM factory_product_contexts
       WHERE org_id = $1 AND sandbox_id = $2 AND product_id = $3
       LIMIT 1`,
      [orgId, sandboxId, productId]
    );
    if (!result.rows[0]) return null;
    return {
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      productId: result.rows[0].product_id,
      context: result.rows[0].context || {},
      updatedBy: result.rows[0].updated_by,
      updatedAt: result.rows[0].updated_at
    };
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.productContexts)) store.factory.productContexts = [];
  return store.factory.productContexts.find((item) =>
    item.orgId === orgId && item.sandboxId === sandboxId && item.productId === productId
  ) || null;
}

async function upsertFactoryProductContext({ orgId, sandboxId, productId, context, updatedBy }) {
  await initializeStore();

  const entry = {
    orgId,
    sandboxId,
    productId,
    context: context || {},
    updatedBy: updatedBy || "unknown",
    updatedAt: new Date().toISOString()
  };

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_product_contexts (org_id, sandbox_id, product_id, context, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (org_id, sandbox_id, product_id)
       DO UPDATE SET context = EXCLUDED.context, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING org_id, sandbox_id, product_id, context, updated_by, updated_at`,
      [orgId, sandboxId, productId, JSON.stringify(context || {}), updatedBy || "unknown"]
    );
    return {
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      productId: result.rows[0].product_id,
      context: result.rows[0].context || {},
      updatedBy: result.rows[0].updated_by,
      updatedAt: result.rows[0].updated_at
    };
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.productContexts)) store.factory.productContexts = [];
  const idx = store.factory.productContexts.findIndex((item) =>
    item.orgId === orgId && item.sandboxId === sandboxId && item.productId === productId
  );
  if (idx === -1) {
    store.factory.productContexts.push(entry);
  } else {
    store.factory.productContexts[idx] = { ...store.factory.productContexts[idx], ...entry };
  }
  writeStoreFile(store);
  return idx === -1 ? entry : store.factory.productContexts[idx];
}

async function listFactoryProducts({ orgId, sandboxId }) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT org_id, sandbox_id, product_id, name, description, created_by, created_at, updated_at
       FROM factory_product_catalog
       WHERE org_id = $1 AND sandbox_id = $2
       ORDER BY created_at ASC`,
      [orgId, sandboxId]
    );
    return result.rows.map((row) => ({
      orgId: row.org_id,
      sandboxId: row.sandbox_id,
      id: row.product_id,
      name: row.name,
      description: row.description || "",
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.productCatalog)) store.factory.productCatalog = [];
  return store.factory.productCatalog
    .filter((item) => item.orgId === orgId && item.sandboxId === sandboxId)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
}

async function purgeFactoryProducts({ orgId = null, sandboxId = null } = {}) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    if (orgId && sandboxId) {
      await pgPool.query(
        "DELETE FROM factory_product_catalog WHERE org_id = $1 AND sandbox_id = $2",
        [orgId, sandboxId]
      );
      await pgPool.query(
        "DELETE FROM factory_product_contexts WHERE org_id = $1 AND sandbox_id = $2",
        [orgId, sandboxId]
      );
    } else {
      await pgPool.query("DELETE FROM factory_product_catalog");
      await pgPool.query("DELETE FROM factory_product_contexts");
    }
    return { purged: true, orgId: orgId || "*", sandboxId: sandboxId || "*" };
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.productCatalog)) store.factory.productCatalog = [];
  if (!Array.isArray(store.factory.productContexts)) store.factory.productContexts = [];
  if (orgId && sandboxId) {
    store.factory.productCatalog = store.factory.productCatalog
      .filter((item) => !(item.orgId === orgId && item.sandboxId === sandboxId));
    store.factory.productContexts = store.factory.productContexts
      .filter((item) => !(item.orgId === orgId && item.sandboxId === sandboxId));
  } else {
    store.factory.productCatalog = [];
    store.factory.productContexts = [];
  }
  writeStoreFile(store);
  return { purged: true, orgId: orgId || "*", sandboxId: sandboxId || "*" };
}

async function listFactorySandboxes(orgId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `SELECT org_id, sandbox_id, name, description, created_by, created_at, updated_at
       FROM factory_sandbox_catalog
       WHERE org_id = $1
       ORDER BY created_at ASC`,
      [orgId]
    );
    return result.rows.map((row) => ({
      orgId: row.org_id,
      id: row.sandbox_id,
      name: row.name,
      description: row.description || "",
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.sandboxCatalog)) store.factory.sandboxCatalog = [];
  return store.factory.sandboxCatalog
    .filter((item) => item.orgId === orgId)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
}

async function upsertFactorySandbox({ orgId, sandboxId, name, description = "", createdBy = "unknown" }) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_sandbox_catalog (org_id, sandbox_id, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id, sandbox_id)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()
       RETURNING org_id, sandbox_id, name, description, created_by, created_at, updated_at`,
      [orgId, sandboxId, name, description || "", createdBy]
    );
    return {
      orgId: result.rows[0].org_id,
      id: result.rows[0].sandbox_id,
      name: result.rows[0].name,
      description: result.rows[0].description || "",
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    };
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.sandboxCatalog)) store.factory.sandboxCatalog = [];
  const next = {
    orgId,
    id: sandboxId,
    name,
    description: description || "",
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const idx = store.factory.sandboxCatalog.findIndex((item) => item.orgId === orgId && item.id === sandboxId);
  if (idx === -1) {
    store.factory.sandboxCatalog.push(next);
  } else {
    store.factory.sandboxCatalog[idx] = {
      ...store.factory.sandboxCatalog[idx],
      name,
      description: description || "",
      updatedAt: new Date().toISOString()
    };
  }
  writeStoreFile(store);
  return idx === -1 ? next : store.factory.sandboxCatalog[idx];
}

async function upsertFactoryProduct({ orgId, sandboxId, productId, name, description = "", createdBy = "unknown" }) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      `INSERT INTO factory_product_catalog (org_id, sandbox_id, product_id, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, sandbox_id, product_id)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()
       RETURNING org_id, sandbox_id, product_id, name, description, created_by, created_at, updated_at`,
      [orgId, sandboxId, productId, name, description || "", createdBy]
    );
    return {
      orgId: result.rows[0].org_id,
      sandboxId: result.rows[0].sandbox_id,
      id: result.rows[0].product_id,
      name: result.rows[0].name,
      description: result.rows[0].description || "",
      createdBy: result.rows[0].created_by,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    };
  }

  const store = readStoreFile();
  if (!Array.isArray(store.factory.productCatalog)) store.factory.productCatalog = [];
  const next = {
    orgId,
    sandboxId,
    id: productId,
    name,
    description: description || "",
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const idx = store.factory.productCatalog.findIndex((item) =>
    item.orgId === orgId && item.sandboxId === sandboxId && item.id === productId
  );
  if (idx === -1) {
    store.factory.productCatalog.push(next);
  } else {
    store.factory.productCatalog[idx] = {
      ...store.factory.productCatalog[idx],
      name,
      description: description || "",
      updatedAt: new Date().toISOString()
    };
  }
  writeStoreFile(store);
  return idx === -1 ? next : store.factory.productCatalog[idx];
}

async function createFactoryTicket(ticket) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    await pgPool.query(
      `INSERT INTO factory_tickets (ticket_id, capability_id, repo, title, body, labels, status, external_url)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        ticket.ticketId,
        ticket.capabilityId,
        ticket.repo,
        ticket.title,
        ticket.body,
        JSON.stringify(ticket.labels || []),
        ticket.status,
        ticket.externalUrl || null
      ]
    );
    return ticket;
  }

  const store = readStoreFile();
  store.factory.tickets.push(ticket);
  writeStoreFile(store);
  return ticket;
}

async function listFactoryTickets(capabilityId) {
  await initializeStore();

  if (STORE_PROVIDER === "postgres") {
    const result = await pgPool.query(
      "SELECT * FROM factory_tickets WHERE capability_id = $1 ORDER BY created_at DESC",
      [capabilityId]
    );
    return result.rows.map((row) => ({
      ticketId: row.ticket_id,
      capabilityId: row.capability_id,
      repo: row.repo,
      title: row.title,
      body: row.body,
      labels: row.labels || [],
      status: row.status,
      externalUrl: row.external_url,
      createdAt: row.created_at
    }));
  }

  const store = readStoreFile();
  return store.factory.tickets.filter((item) => item.capabilityId === capabilityId);
}

module.exports = {
  initializeStore,
  getMembership,
  listMembershipsByOrg,
  upsertMembership,
  listConnectors,
  markConnectorSync,
  upsertConnector,
  getGithubConnectorByOrg,
  createOrchestrationRun,
  listOrchestrationRuns,
  createFactoryIdea,
  getFactoryIdea,
  updateFactoryIdea,
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
  upsertFactoryConfig,
  getFactoryProductContext,
  upsertFactoryProductContext,
  listFactorySandboxes,
  upsertFactorySandbox,
  listFactoryProducts,
  upsertFactoryProduct,
  purgeFactoryProducts,
  createFactoryTicket,
  listFactoryTickets
};
