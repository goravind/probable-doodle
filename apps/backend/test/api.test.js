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
        autoPipeline: false,
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
        details: {
          problemStatement: "Manual PR flow can fail",
          userPersona: "Org admin",
          businessGoal: "Ship build output through PR",
          acceptanceCriteria: ["PR metadata is persisted"]
        },
        autoPipeline: false,
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
  }, {
    env: {
      FACTORY_LOCAL_PR_ONLY: "1",
      GITHUB_TOKEN: null,
      GITHUB_APP_ID: null,
      GITHUB_APP_SLUG: null,
      GITHUB_APP_PRIVATE_KEY: null
    }
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
        const configRes = await fetch(`${baseUrl}/api/v1/factory/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            repoMode: "single",
            codeRepos: ["goravind/probable-doodle"],
            ticketRepos: ["goravind/probable-doodle"],
            ticketLabels: ["type:feature"],
            ticketArea: "product-factory",
            branchPrefix: "capability"
          })
        });
        assert.equal(configRes.status, 200);

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
            details: {
              problemStatement: "PR creation still fails silently",
              userPersona: "Product engineer",
              businessGoal: "Surface actionable failures",
              acceptanceCriteria: ["No silent failures", "Retry path visible"],
              constraints: "GitHub auth and permissions",
              nonGoals: "Local draft-only mode"
            },
            autoPipeline: true,
            enforceGithubPr: true
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

test("idea creation enforces GitHub PR creation and persists URL/number metadata", async () => {
  const nativeFetch = global.fetch;
  const githubCalls = [];
  global.fetch = async (url, options = {}) => {
    const str = String(url);
    if (str.startsWith("https://api.github.com/")) {
      const method = String(options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(String(options.body)) : null;
      githubCalls.push({ method, url: str, body });

      if (str.endsWith("/repos/goravind/probable-doodle") && method === "GET") {
        return new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/git/ref/heads/main") && method === "GET") {
        return new Response(JSON.stringify({ object: { sha: "abc123" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if ((str.includes("/git/ref/heads/capability/") || str.includes("/git/ref/heads/capability%2F")) && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.endsWith("/git/refs") && method === "POST") {
        return new Response(JSON.stringify({ ref: body?.ref || "refs/heads/capability/test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/contents/") && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.includes("/contents/") && method === "PUT") {
        return new Response(JSON.stringify({ content: { path: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/pulls?state=open&head=") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls") && method === "POST") {
        return new Response(JSON.stringify({ html_url: "https://github.com/goravind/probable-doodle/pull/4242", number: 4242 }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled mock: ${method} ${str}` }), {
        status: 500,
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
              productVision: "PR success test context",
              primaryUsers: "Sales operations",
              successMetrics: "Ship faster"
            }
          })
        });
        assert.equal(contextRes.status, 200);
        const configRes = await fetch(`${baseUrl}/api/v1/factory/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            repoMode: "single",
            codeRepos: ["goravind/probable-doodle"],
            ticketRepos: ["goravind/probable-doodle"],
            ticketLabels: ["type:feature"],
            ticketArea: "product-factory",
            branchPrefix: "capability"
          })
        });
        assert.equal(configRes.status, 200);

        const createRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin",
            "x-correlation-id": "corr-pr-success-001"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            title: "Create real PR from idea",
            description: "Ensure branch, commit, and PR are created",
            details: {
              problemStatement: "Manual PR creation is inconsistent",
              userPersona: "Engineering manager",
              businessGoal: "Reliable idea-to-pr flow",
              acceptanceCriteria: ["PR URL must be returned", "PR number must be persisted"],
              constraints: "GitHub auth required",
              nonGoals: "No local draft-only mode"
            },
            autoPipeline: true,
            enforceGithubPr: true
          })
        });
        assert.equal(createRes.status, 200);
        const created = await createRes.json();
        assert.equal(created.triagePr?.pr?.externalUrl, "https://github.com/goravind/probable-doodle/pull/4242");
        assert.equal(created.triagePr?.pr?.prNumber, 4242);

        const capId = created?.triagePr?.capability?.capabilityId;
        assert.ok(capId);
        const detailRes = await fetch(`${baseUrl}/api/v1/factory/capabilities/${capId}`, {
          headers: { "x-user-id": "ava-admin" }
        });
        assert.equal(detailRes.status, 200);
        const detail = await detailRes.json();
        assert.equal(detail?.pr?.externalUrl, "https://github.com/goravind/probable-doodle/pull/4242");
        assert.equal(detail?.pr?.prNumber, 4242);

        assert.ok(githubCalls.some((call) => call.method === "POST" && call.url.includes("/git/refs")));
        assert.ok(githubCalls.some((call) => call.method === "PUT" && call.url.includes("/idea.md")));
        assert.ok(githubCalls.some((call) => call.method === "PUT" && call.url.includes("/triage.md")));
        assert.ok(githubCalls.some((call) => call.method === "PUT" && call.url.includes("/metadata.json")));
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-token-for-success"
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});

test("run-to-pr enforces GitHub PR mode and returns actionable failure payload", async () => {
  // Repro script (pre-fix this returned 200 with local draft PR metadata):
  // 1. POST /api/v1/factory/product-context
  // 2. POST /api/v1/factory/ideas (autoPipeline=false)
  // 3. POST /api/v1/factory/ideas/:ideaId/run-to-pr with enforceGithubPr=true
  // 4. Verify API returns 502 + reason + correlationId (not silent success)
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
            productVision: "Run-to-PR enforce test",
            primaryUsers: "Org admins",
            successMetrics: "Only real GitHub PRs"
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
          title: "Run-to-PR enforce test idea",
          description: "Repro endpoint should fail if GitHub PR cannot be created",
          details: {
            problemStatement: "Run-to-pr should not silently pass without a GitHub PR",
            userPersona: "Engineering manager",
            businessGoal: "Reliable PR gate",
            acceptanceCriteria: ["Fail loudly with reason and actions"]
          },
          autoPipeline: false
        })
      });
      assert.equal(ideaRes.status, 200);
      const ideaPayload = await ideaRes.json();

      const runRes = await fetch(`${baseUrl}/api/v1/factory/ideas/${ideaPayload.idea.ideaId}/run-to-pr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "ava-admin",
          "x-correlation-id": "corr-run-to-pr-enforce-001"
        },
        body: JSON.stringify({
          capabilityTitle: "Run-to-PR enforce capability",
          enforceGithubPr: true
        })
      });
      assert.equal(runRes.status, 502);
      const runPayload = await runRes.json();
      assert.match(String(runPayload.error || ""), /PR creation failed/i);
      assert.match(String(runPayload.reason || ""), /GitHub PR creation is required but unavailable/i);
      assert.equal(runPayload.correlationId, "corr-run-to-pr-enforce-001");
      assert.ok(Array.isArray(runPayload.actions));
      assert.ok(runPayload.actions.includes("reconnect-github"));
    },
    {
      env: {
        FACTORY_LOCAL_PR_ONLY: "1",
        GITHUB_TOKEN: null
      }
    }
  );
});

test("run-to-pr with enforceGithubPr calls GitHub and persists PR metadata", async () => {
  const nativeFetch = global.fetch;
  const githubCalls = [];
  global.fetch = async (url, options = {}) => {
    const str = String(url);
    if (str.startsWith("https://api.github.com/")) {
      const method = String(options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(String(options.body)) : null;
      githubCalls.push({ method, url: str, body });

      if (str.endsWith("/repos/goravind/probable-doodle") && method === "GET") {
        return new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/git/ref/heads/main") && method === "GET") {
        return new Response(JSON.stringify({ object: { sha: "abc123" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if ((str.includes("/git/ref/heads/capability/") || str.includes("/git/ref/heads/capability%2F")) && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.endsWith("/git/refs") && method === "POST") {
        return new Response(JSON.stringify({ ref: body?.ref || "refs/heads/capability/test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/contents/") && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.includes("/contents/") && method === "PUT") {
        return new Response(JSON.stringify({ content: { path: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls?state=open&head=goravind%3Acapability%2Fcrm%2Fcap-run-to-pr")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/pulls?state=open&head=") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls") && method === "POST") {
        return new Response(JSON.stringify({ html_url: "https://github.com/goravind/probable-doodle/pull/5252", number: 5252 }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled mock: ${method} ${str}` }), {
        status: 500,
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
              productVision: "Run-to-pr GitHub success test",
              primaryUsers: "Org admins",
              successMetrics: "PR URL + number persisted"
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
            title: "Run-to-pr success idea",
            description: "Should open real GitHub PR",
            details: {
              problemStatement: "Need deterministic PR creation",
              userPersona: "Tech lead",
              businessGoal: "Open PR with URL + number",
              acceptanceCriteria: ["PR URL returned", "PR number returned"]
            },
            autoPipeline: false
          })
        });
        assert.equal(ideaRes.status, 200);
        const ideaPayload = await ideaRes.json();

        const runRes = await fetch(`${baseUrl}/api/v1/factory/ideas/${ideaPayload.idea.ideaId}/run-to-pr`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin",
            "x-correlation-id": "corr-run-to-pr-success-001"
          },
          body: JSON.stringify({
            capabilityTitle: "Run-to-pr success capability",
            enforceGithubPr: true
          })
        });
        assert.equal(runRes.status, 200);
        const runPayload = await runRes.json();
        assert.equal(runPayload.correlationId, "corr-run-to-pr-success-001");
        assert.equal(runPayload.pr?.externalUrl, "https://github.com/goravind/probable-doodle/pull/5252");
        assert.equal(runPayload.pr?.prNumber, 5252);

        const capId = runPayload?.capability?.capabilityId;
        assert.ok(capId);
        const detailRes = await fetch(`${baseUrl}/api/v1/factory/capabilities/${capId}`, {
          headers: { "x-user-id": "ava-admin" }
        });
        assert.equal(detailRes.status, 200);
        const detail = await detailRes.json();
        assert.equal(detail?.pr?.externalUrl, "https://github.com/goravind/probable-doodle/pull/5252");
        assert.equal(detail?.pr?.prNumber, 5252);

        assert.ok(githubCalls.some((call) => call.method === "POST" && call.url.includes("/git/refs")));
        assert.ok(githubCalls.some((call) => call.method === "PUT" && call.url.includes("/contents/src/features/")));
        assert.ok(githubCalls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-run-to-pr-success-token"
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});

test("triage approve progresses stage when GitHub blocks self-approval", async () => {
  // Repro script (pre-fix this failed with 400 and stage stayed triage):
  // 1. Create idea with autoPipeline=true + enforceGithubPr=true
  // 2. POST stage approve for triage
  // 3. Mock GitHub review API 422 "cannot approve own pull request"
  // 4. Expect stage transition to continue with explicit fallback metadata
  const nativeFetch = global.fetch;
  let prCreated = false;
  const githubCalls = [];
  global.fetch = async (url, options = {}) => {
    const str = String(url);
    if (str.startsWith("https://api.github.com/")) {
      const method = String(options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(String(options.body)) : null;
      githubCalls.push({ method, url: str, body });

      if (str.endsWith("/repos/goravind/probable-doodle") && method === "GET") {
        return new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/git/ref/heads/main") && method === "GET") {
        return new Response(JSON.stringify({ object: { sha: "abc123" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if ((str.includes("/git/ref/heads/capability/") || str.includes("/git/ref/heads/capability%2F")) && method === "GET") {
        return new Response(JSON.stringify({ ref: "refs/heads/capability/crm/cap-test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/git/refs") && method === "POST") {
        return new Response(JSON.stringify({ ref: body?.ref || "refs/heads/capability/test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/contents/") && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.includes("/contents/") && method === "PUT") {
        return new Response(JSON.stringify({ content: { path: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/pulls?state=open&head=") && method === "GET") {
        return new Response(JSON.stringify(prCreated ? [{ html_url: "https://github.com/goravind/probable-doodle/pull/6262", number: 6262 }] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls") && method === "POST") {
        prCreated = true;
        return new Response(JSON.stringify({ html_url: "https://github.com/goravind/probable-doodle/pull/6262", number: 6262 }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls/6262/reviews") && method === "POST") {
        return new Response(JSON.stringify({ message: "Review Can not approve your own pull request" }), {
          status: 422,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls/6262/reviews") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled mock: ${method} ${str}` }), {
        status: 500,
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
              productVision: "Stage approval fallback test",
              primaryUsers: "Org admins",
              successMetrics: "Unblock next stage"
            }
          })
        });
        assert.equal(contextRes.status, 200);

        const configRes = await fetch(`${baseUrl}/api/v1/factory/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            repoMode: "single",
            codeRepos: ["goravind/probable-doodle"],
            ticketRepos: ["goravind/probable-doodle"],
            ticketLabels: ["type:feature"],
            ticketArea: "product-factory",
            branchPrefix: "capability"
          })
        });
        assert.equal(configRes.status, 200);

        const createRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            title: "Approval fallback idea",
            description: "Needs stage approval fallback when self-approval is blocked",
            details: {
              problemStatement: "UI approval can fail with own-PR restriction",
              userPersona: "Org admin",
              businessGoal: "Allow stage progression with explicit fallback state",
              acceptanceCriteria: ["No silent failure", "Stage advances to spec"]
            },
            autoPipeline: true,
            enforceGithubPr: true
          })
        });
        assert.equal(createRes.status, 200);
        const created = await createRes.json();
        const capabilityId = created?.triagePr?.capability?.capabilityId;
        assert.ok(capabilityId);

        const approveRes = await fetch(
          `${baseUrl}/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}/stages/triage/approve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-user-id": "ava-admin",
              "x-correlation-id": "corr-approve-self-001"
            },
            body: JSON.stringify({
              note: "Approve from integration test"
            })
          }
        );
        assert.equal(approveRes.status, 200);
        const approved = await approveRes.json();
        assert.equal(approved?.capability?.stage, "spec");
        assert.equal(approved?.githubApproval?.mode, "local-self-approval-fallback");
        assert.equal(approved?.correlationId, "corr-approve-self-001");
        assert.match(String(approved?.githubApproval?.error || ""), /own pull request/i);

        const detailRes = await fetch(`${baseUrl}/api/v1/factory/capabilities/${encodeURIComponent(capabilityId)}`, {
          headers: { "x-user-id": "ava-admin" }
        });
        assert.equal(detailRes.status, 200);
        const detail = await detailRes.json();
        assert.equal(detail?.capability?.stage, "spec");

        assert.ok(githubCalls.some((call) => call.method === "POST" && call.url.endsWith("/pulls/6262/reviews")));
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-approval-fallback-token"
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});

test("triage PR idea markdown includes enrichment context and source provenance", async () => {
  // Repro script (pre-fix PR idea.md lacked source-idea provenance and context grounding details):
  // 1. Create seed idea (source idea)
  // 2. Create second idea with details.metadata.sourceIdeas=[seed]
  // 3. Enable autoPipeline/enforceGithubPr
  // 4. Verify committed idea.md includes source ideas and context sections
  const nativeFetch = global.fetch;
  const githubIdeaMarkdowns = [];
  global.fetch = async (url, options = {}) => {
    const str = String(url);
    if (str.startsWith("https://api.github.com/")) {
      const method = String(options.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(String(options.body)) : null;
      if (str.endsWith("/repos/goravind/probable-doodle") && method === "GET") {
        return new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/git/ref/heads/main") && method === "GET") {
        return new Response(JSON.stringify({ object: { sha: "abc123" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if ((str.includes("/git/ref/heads/capability/") || str.includes("/git/ref/heads/capability%2F")) && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.endsWith("/git/refs") && method === "POST") {
        return new Response(JSON.stringify({ ref: body?.ref || "refs/heads/capability/test" }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/contents/") && method === "GET") {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (str.includes("/contents/") && method === "PUT") {
        const safePath = str.split("/contents/")[1]?.split("?")[0] || "";
        const filePath = decodeURIComponent(safePath);
        if (filePath.endsWith("/idea.md") && body?.content) {
          githubIdeaMarkdowns.push(Buffer.from(String(body.content), "base64").toString("utf8"));
        }
        return new Response(JSON.stringify({ content: { path: filePath || "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.includes("/pulls?state=open&head=") && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (str.endsWith("/pulls") && method === "POST") {
        return new Response(JSON.stringify({ html_url: "https://github.com/goravind/probable-doodle/pull/7373", number: 7373 }), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled mock: ${method} ${str}` }), {
        status: 500,
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
              productVision: "Enrichment markdown depth test",
              primaryUsers: "Marketing operations",
              successMetrics: "Higher PR artifact quality"
            }
          })
        });
        assert.equal(contextRes.status, 200);

        const configRes = await fetch(`${baseUrl}/api/v1/factory/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            repoMode: "single",
            codeRepos: ["goravind/probable-doodle"],
            ticketRepos: ["goravind/probable-doodle"],
            ticketLabels: ["type:feature"],
            ticketArea: "product-factory",
            branchPrefix: "capability"
          })
        });
        assert.equal(configRes.status, 200);

        const seedRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            title: "Existing semantic profile idea",
            description: "Seed source idea for provenance",
            autoPipeline: false
          })
        });
        assert.equal(seedRes.status, 200);
        const seed = await seedRes.json();

        const createRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": "ava-admin"
          },
          body: JSON.stringify({
            orgId: "acme-health",
            sandboxId: "production",
            productId: "crm",
            title: "Context-aware semantic profile v2",
            description: "Use existing ideas to enrich new draft and PR docs",
            details: {
              problemStatement: "New ideas repeat existing scope",
              userPersona: "RevOps manager",
              businessGoal: "Generate richer, non-duplicative PR docs",
              acceptanceCriteria: ["Source ideas are cited", "Differentiation is explicit"],
              metadata: {
                sourceIdeas: [seed?.idea?.ideaId]
              }
            },
            autoPipeline: true,
            enforceGithubPr: true
          })
        });
        assert.equal(createRes.status, 200);
        const created = await createRes.json();
        assert.equal(created?.triagePr?.pr?.prNumber, 7373);
        assert.ok(githubIdeaMarkdowns.length >= 1);
        const finalIdeaMd = githubIdeaMarkdowns[githubIdeaMarkdowns.length - 1];
        assert.match(finalIdeaMd, /## Source Ideas & Provenance/);
        assert.match(finalIdeaMd, /## Related Context Snapshot/);
        assert.match(finalIdeaMd, new RegExp(seed?.idea?.ideaId));
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-enrichment-richness-token"
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});

test("github installations returns actionable error for invalid GitHub App private key", async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/connectors/github/installations`, {
        headers: {
          "x-user-id": "ava-admin"
        }
      });
      assert.equal(response.status, 502);
      const payload = await response.json();
      assert.match(String(payload.error || ""), /Unable to list GitHub App installations/i);
      assert.match(String(payload.reason || ""), /Invalid GITHUB_APP_PRIVATE_KEY format/i);
      assert.ok(Array.isArray(payload.actions));
      assert.ok(payload.actions.includes("fix-github-app-key"));
    },
    {
      env: {
        FACTORY_LOCAL_PR_ONLY: "0",
        GITHUB_APP_ID: "123456",
        GITHUB_APP_SLUG: "probable-doodle",
        GITHUB_APP_PRIVATE_KEY: "not-a-valid-private-key",
        GITHUB_APP_STATE_SECRET: "test-secret"
      }
    }
  );
});

test("ai chat enrich still succeeds when GitHub scope-context retrieval fails", async () => {
  const nativeFetch = global.fetch;
  global.fetch = async (url, options) => {
    const str = String(url);
    if (str.startsWith("https://api.github.com/")) {
      return new Response(JSON.stringify({ message: "mock github failure" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    return nativeFetch(url, options);
  };

  try {
    await withServer(
      async (baseUrl) => {
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
            headline: "Resilient enrichment",
            description: "Should not crash when GitHub app key is invalid",
            messages: [
              {
                role: "user",
                content: "Refine this idea with explicit KPI and scope.",
                images: []
              }
            ]
          })
        });
        assert.equal(enrichRes.status, 200);
        const payload = await enrichRes.json();
        assert.ok(payload?.draft);
        assert.ok(payload?.assistant?.content);
      },
      {
        env: {
          FACTORY_LOCAL_PR_ONLY: "0",
          GITHUB_TOKEN: "fake-token-for-scope-context",
          GITHUB_APP_ID: null,
          GITHUB_APP_SLUG: null,
          GITHUB_APP_PRIVATE_KEY: null,
          GITHUB_APP_STATE_SECRET: null
        }
      }
    );
  } finally {
    global.fetch = nativeFetch;
  }
});

test("similar ideas endpoint returns ranked ideas and enrichment uses related ideas context", async () => {
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
          productVision: "Related ideas test context",
          primaryUsers: "Marketing operations",
          successMetrics: "Avoid duplicate ideas"
        }
      })
    });
    assert.equal(contextRes.status, 200);

    const seedARes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        title: "Semantic profile for lead scoring",
        description: "Build semantic profile and avoid duplicates",
        details: {
          problemStatement: "Duplicate lead-scoring ideas",
          userPersona: "RevOps",
          businessGoal: "Reduce duplicate ideation",
          acceptanceCriteria: ["Similarity retrieval enabled"]
        },
        autoPipeline: false
      })
    });
    assert.equal(seedARes.status, 200);
    const seedA = await seedARes.json();

    const seedBRes = await fetch(`${baseUrl}/api/v1/factory/ideas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "ava-admin"
      },
      body: JSON.stringify({
        orgId: "acme-health",
        sandboxId: "production",
        productId: "crm",
        title: "Persona-aware lead routing",
        description: "Use similar ideas context for lead routing",
        details: {
          problemStatement: "Routing logic not persona-aware",
          userPersona: "Marketing manager",
          businessGoal: "Increase conversion quality",
          acceptanceCriteria: ["Persona tags included"]
        },
        autoPipeline: false
      })
    });
    assert.equal(seedBRes.status, 200);

    const similarRes = await fetch(
      `${baseUrl}/api/ideas/similar?orgId=acme-health&sandboxId=production&productArea=crm&query=semantic%20lead%20profile&limit=5`,
      { headers: { "x-user-id": "ava-admin" } }
    );
    assert.equal(similarRes.status, 200);
    const similar = await similarRes.json();
    assert.ok(Array.isArray(similar.ideas));
    assert.ok(similar.ideas.length >= 1);

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
        headline: "New semantic idea",
        description: "Reuse related ideas",
        details: {
          metadata: {
            sourceIdeas: [seedA.idea.ideaId]
          }
        },
        relatedIdeasContext: {
          query: "semantic lead profile",
          sourceIdeaIds: [seedA.idea.ideaId],
          ideas: similar.ideas.slice(0, 2)
        },
        messages: [
          {
            role: "user",
            content: "Create a differentiated idea using related context",
            images: []
          }
        ]
      })
    });
    assert.equal(enrichRes.status, 200);
    const enrich = await enrichRes.json();
    assert.ok(enrich?.draft?.conversationContextUsed);
    assert.ok((enrich.draft.conversationContextUsed.relatedIdeaCount || 0) >= 1);
    assert.ok(Array.isArray(enrich.draft.conversationContextUsed.sourceIdeaIds));
    assert.ok(enrich.draft.conversationContextUsed.sourceIdeaIds.includes(seedA.idea.ideaId));
  });
});
