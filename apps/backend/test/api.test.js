const test = require("node:test");
const assert = require("node:assert/strict");

function clearBackendModuleCache() {
  Object.keys(require.cache)
    .filter((key) => key.includes("/apps/backend/src/"))
    .forEach((key) => {
      delete require.cache[key];
    });
}

async function withServer(run, options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : null;
  const previousEnv = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      previousEnv[key] = process.env[key];
      if (value == null) delete process.env[key];
      else process.env[key] = String(value);
    }
    clearBackendModuleCache();
  }

  const { createServer } = require("../src/server");
  const { server } = createServer();

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (env) {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      clearBackendModuleCache();
    }
  }
}

test("health endpoint returns ok", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "probable-toodle-backend");
  });
});

test("platform dashboard exposes platform operations metrics", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/platform/dashboard?persona=platform_admin`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.ok(payload.platformHealth.workflowSuccessRate);
    assert.ok(Array.isArray(payload.services));
    assert.ok(payload.services.length > 0);
  });
});

test("organization member management enforces org admin role", async () => {
  await withServer(async (baseUrl) => {
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/organizations/acme-health/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "nina-user"
      },
      body: JSON.stringify({
        userId: "demo-user",
        role: "enterprise_user",
        sandboxIds: ["production"],
        productIds: ["crm"]
      })
    });
    assert.equal(forbiddenRes.status, 403);

    const adminRes = await fetch(`${baseUrl}/api/v1/organizations/acme-health/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        userId: "demo-user",
        role: "enterprise_user",
        sandboxIds: ["production"],
        productIds: ["crm"]
      })
    });
    assert.equal(adminRes.status, 200);
    const payload = await adminRes.json();
    assert.equal(payload.member.userId, "demo-user");
  });
});

test("pipeline endpoint returns product capabilities", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/organizations/acme-health/sandboxes/production/products/crm/pipeline?persona=enterprise_user`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.product.id, "crm");
    assert.ok(payload.capabilities.some((capability) => capability.id === "CRM-100"));
  });
});

test("metrics endpoint emits prometheus text", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/v1/health`);
    await fetch(`${baseUrl}/api/v1/monitoring/summary?persona=organization_admin`);

    const response = await fetch(`${baseUrl}/metrics`);
    assert.equal(response.status, 200);

    const text = await response.text();
    assert.match(text, /probable_doodle_http_requests_total/);
    assert.match(text, /probable_doodle_persona_requests_total\{persona="(organization_admin|platform_admin)"\}/);
  });
});

test("semantic search returns capability matches", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/semantic/search?q=lead%20scoring%20api&limit=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.ok(payload.count >= 1);
    assert.ok(payload.results.some((result) => result.capabilityId === "CRM-101"));
  });
});

test("capability state transition persists and returns event history", async () => {
  await withServer(async (baseUrl) => {
    const beforeResponse = await fetch(`${baseUrl}/api/v1/capabilities/CRM-101/state`);
    assert.equal(beforeResponse.status, 200);
    const beforePayload = await beforeResponse.json();
    assert.ok(beforePayload.state.stage);

    const transitionResponse = await fetch(`${baseUrl}/api/v1/capabilities/CRM-101/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nextStage: "uat",
        actor: "qa-agent",
        note: "Quality checks passed"
      })
    });

    assert.equal(transitionResponse.status, 200);
    const transitionPayload = await transitionResponse.json();
    assert.equal(transitionPayload.state.stage, "uat");
    assert.ok(transitionPayload.events.length >= 1);
    assert.equal(transitionPayload.event.actor, "qa-agent");
  });
});

test("capability agents endpoint returns composed agents", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/capabilities/CRM-101/agents`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.capabilityId, "CRM-101");
    assert.ok(payload.agents.some((agent) => agent.id === "pipeline-agent"));
  });
});

test("orchestrate endpoint creates capability runs", async () => {
  await withServer(async (baseUrl) => {
    const orchestrateResponse = await fetch(`${baseUrl}/api/v1/capabilities/CRM-101/orchestrate`, {
      method: "POST",
      headers: {
        "x-user-id": "platform-root"
      }
    });
    assert.equal(orchestrateResponse.status, 200);
    const orchestratePayload = await orchestrateResponse.json();
    assert.equal(orchestratePayload.run.capabilityId, "CRM-101");

    const runsResponse = await fetch(`${baseUrl}/api/v1/capabilities/CRM-101/runs`);
    assert.equal(runsResponse.status, 200);
    const runsPayload = await runsResponse.json();
    assert.ok(runsPayload.runs.length >= 1);
  });
});

test("ai draft includes product context and existing idea corpus metadata", async () => {
  await withServer(async (baseUrl) => {
    const contextRes = await fetch(`${baseUrl}/api/v1/factory/product-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        context: {
          productVision: "Unified CRM operating system",
          primaryUsers: "Org admins and sales managers",
          successMetrics: "Win rate and response time"
        }
      })
    });
    assert.equal(contextRes.status, 200);

    const ideaRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        title: "Seed idea for context",
        description: "Created to populate idea corpus",
        enforceGithubPr: false
      })
    });
    assert.equal(ideaRes.status, 200);

    const draftRes = await fetch(`${baseUrl}/api/v1/factory/ideas/ai-draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        intent: "Generate a next idea based on existing product context"
      })
    });
    assert.equal(draftRes.status, 200);
    const draftPayload = await draftRes.json();
    assert.ok(draftPayload?.draft);
    assert.ok(draftPayload.draft.contextUsed);
    assert.ok((draftPayload.draft.contextUsed.productIdeaCount || 0) >= 1);
  });
});

test("ai chat enrich accepts multimodal chat messages", async () => {
  await withServer(async (baseUrl) => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yx8tWkAAAAASUVORK5CYII=";
    const response = await fetch(`${baseUrl}/api/v1/factory/ideas/ai-chat-enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        headline: "Visual workflow idea",
        description: "Use image context and chat to enrich",
        messages: [
          {
            role: "user",
            content: "Use this sketch to refine the employee experience flow.",
            images: [imageDataUrl]
          }
        ]
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload?.draft);
    assert.ok(payload?.assistant?.content);
  });
});

test("factory idea to PR flow works end-to-end", async () => {
  await withServer(async (baseUrl) => {
    const contextRes = await fetch(`${baseUrl}/api/v1/factory/product-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        context: {
          productVision: "Enterprise CRM productivity platform",
          primaryUsers: "Org admins and RevOps",
          successMetrics: "Lead conversion and cycle time"
        }
      })
    });
    assert.equal(contextRes.status, 200);

    const createIdeaRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        title: "Hello World capability",
        description: "Simple capability from idea to PR",
        enforceGithubPr: false
      })
    });
    assert.equal(createIdeaRes.status, 200);
    const createIdeaPayload = await createIdeaRes.json();
    assert.ok(createIdeaPayload.idea.ideaId.startsWith("IDEA-"));

    const runRes = await fetch(`${baseUrl}/api/v1/factory/ideas/${createIdeaPayload.idea.ideaId}/run-to-pr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        capabilityTitle: "Hello World capability implementation"
      })
    });
    assert.equal(runRes.status, 200);
    const runPayload = await runRes.json();
    assert.ok(runPayload.capability.capabilityId.startsWith("CAP-"));
    assert.equal(runPayload.capability.stage, "pr-created");
    assert.ok(runPayload.pr.prId.startsWith("PR-"));
    assert.ok(runPayload.pr.files.length > 0);

    const detailRes = await fetch(`${baseUrl}/api/v1/factory/capabilities/${runPayload.capability.capabilityId}`, {
      headers: {
        "x-user-id": "ava-admin"
      }
    });
    assert.equal(detailRes.status, 200);
    const detailPayload = await detailRes.json();
    assert.equal(detailPayload.capability.stage, "pr-created");
    assert.ok(detailPayload.artifacts.length >= 3);
  });
});

test("ai chat enrichment persists idea artifact and increments version", async () => {
  // Repro script (pre-fix this test failed because enrichment was not persisted):
  // 1. POST /api/v1/factory/product-context
  // 2. POST /api/v1/factory/ideas (autoPipeline=false)
  // 3. POST /api/v1/factory/ideas/ai-chat-enrich with ideaId
  // 4. GET /api/v1/factory/ideas and verify title/description/version changed for ideaId
  await withServer(async (baseUrl) => {
    const contextRes = await fetch(`${baseUrl}/api/v1/factory/product-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        context: {
          productVision: "Improve CRM outcomes with AI-assisted workflows",
          primaryUsers: "Sales operations",
          successMetrics: "Increase conversion by 5%",
          constraints: "SOC2 and audit logging",
          integrationLandscape: "HubSpot + Salesforce",
          competitiveNotes: "Need stronger semantic profile targeting"
        }
      })
    });
    assert.equal(contextRes.status, 200);

    const createIdeaRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        title: "Initial idea title",
        description: "Initial idea description",
        autoPipeline: false
      })
    });
    assert.equal(createIdeaRes.status, 200);
    const createIdeaPayload = await createIdeaRes.json();
    const ideaId = createIdeaPayload.idea.ideaId;
    assert.ok(ideaId.startsWith("IDEA-"));

    const enrichRes = await fetch(`${baseUrl}/api/v1/factory/ideas/ai-chat-enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        ideaId,
        headline: "Enriched idea title",
        description: "Enriched idea description",
        messages: [
          {
            role: "user",
            content: "Make this idea measurable with KPI baseline and explicit constraints.",
            images: []
          }
        ]
      })
    });
    assert.equal(enrichRes.status, 200);
    const enrichPayload = await enrichRes.json();
    assert.ok(enrichPayload.artifact);
    assert.equal(enrichPayload.artifact.ideaId, ideaId);
    assert.ok(Number(enrichPayload.artifact.version) >= 1);

    const listRes = await fetch(
      `${baseUrl}/api/v1/factory/ideas?orgId=acme-health&sandboxId=production&productId=crm&page=1&pageSize=50`,
      {
        headers: {
          "x-user-id": "ava-admin"
        }
      }
    );
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    const persisted = (listPayload.ideas || []).find((item) => item.ideaId === ideaId);
    assert.ok(persisted);
    assert.equal(persisted.title, enrichPayload.draft.title);
    assert.equal(persisted.description, enrichPayload.draft.description);
    assert.equal(Number(persisted?.details?._ideaArtifactVersion || 0), Number(enrichPayload.artifact.version));
  });
});

test("idea creation returns actionable PR failure payload when GitHub sync fails", async () => {
  // Repro script (pre-fix this failed silently in UI/backend):
  // 1. Mock GitHub API to return 401
  // 2. POST /api/v1/factory/product-context
  // 3. POST /api/v1/factory/ideas with autoPipeline=true
  // 4. Verify API returns 502 with correlationId + actions instead of silent failure
  const nativeFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.github.com/")) {
      return new Response(JSON.stringify({ message: "bad credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    return nativeFetch(url, options);
  };

  try {
    await withServer(
      async (baseUrl) => {
        const contextRes = await fetch(`${baseUrl}/api/v1/factory/product-context`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            context: {
              productVision: "PR failure test context",
              primaryUsers: "Sales operations",
              successMetrics: "Ship faster",
              constraints: "Audit logs",
              integrationLandscape: "GitHub",
              competitiveNotes: "N/A"
            }
          })
        });
        assert.equal(contextRes.status, 200);

        const response = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            title: "Trigger PR failure",
            description: "Trigger PR creation failure via mocked GitHub 401",
            autoPipeline: true
          })
        });

        assert.equal(response.status, 502);
        const payload = await response.json();
        assert.match(String(payload.error || ""), /PR creation failed/i);
        assert.match(String(payload.reason || ""), /GitHub API error 401/i);
        assert.ok(payload.correlationId);
        assert.ok(Array.isArray(payload.actions));
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-token-for-test"
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});
