const { getGithubConnectorByOrg } = require("./store");
const { hasGithubAppConfig, getInstallationAccessToken } = require("./github_app_auth");

const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const FACTORY_LOCAL_PR_ONLY = process.env.FACTORY_LOCAL_PR_ONLY !== "0";

function nowIso() {
  return new Date().toISOString();
}

function ghLog(event, data = {}) {
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

function hasGithubToken() {
  return Boolean(GITHUB_TOKEN);
}

function parseRepo(repo) {
  const [owner, name] = (repo || "").split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/name`);
  }
  return { owner, name };
}

function parsePrNumberFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(/\/pull\/([0-9]+)/);
  return match ? Number(match[1]) : null;
}

async function resolveGithubAuth({ orgId = null } = {}) {
  if (FACTORY_LOCAL_PR_ONLY) {
    return { mode: "draft", token: "" };
  }
  if (GITHUB_TOKEN) {
    return { mode: "token", token: GITHUB_TOKEN };
  }

  if (orgId) {
    const connector = await getGithubConnectorByOrg(orgId);
    if (connector?.type === "github_pat" && connector?.details?.token) {
      return {
        mode: "github_pat",
        token: connector.details.token
      };
    }

    if (hasGithubAppConfig()) {
      const installationId = connector?.details?.installationId;
      if (installationId) {
        const access = await getInstallationAccessToken(installationId);
        return {
          mode: "github_app",
          token: access.token,
          installationId,
          expiresAt: access.expiresAt
        };
      }
    }
  }

  return { mode: "draft", token: "" };
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function githubRequest(path, token, options = {}) {
  ghLog("github.request.start", {
    path,
    method: options.method || "GET"
  });
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    ghLog("github.request.failed", {
      path,
      method: options.method || "GET",
      status: response.status,
      error: text.slice(0, 240)
    });
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function githubRequestAllow404(path, token, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {})
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function ensureBranch(owner, name, branch, token) {
  const repoData = await githubRequest(`/repos/${owner}/${name}`, token);
  const base = repoData.default_branch || "main";

  const existing = await githubRequestAllow404(
    `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`,
    token
  );
  if (existing) return { base, branch };

  const baseRef = await githubRequest(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(base)}`, token);
  const baseSha = baseRef.object.sha;
  await githubRequest(`/repos/${owner}/${name}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: baseSha
    })
  });
  return { base, branch };
}

async function upsertFile(owner, name, branch, path, content, token, message = null) {
  const safePath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const existing = await githubRequestAllow404(`/repos/${owner}/${name}/contents/${safePath}?ref=${encodeURIComponent(branch)}`, token);

  await githubRequest(`/repos/${owner}/${name}/contents/${safePath}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message: message || `sync ${path}`,
      content: Buffer.from(content || "").toString("base64"),
      branch,
      sha: existing ? existing.sha : undefined
    })
  });
}

async function ensurePullRequest(owner, name, branch, base, title, description, token) {
  const openPrs = await githubRequest(`/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, token);
  if (Array.isArray(openPrs) && openPrs.length > 0) {
    return openPrs[0];
  }
  return githubRequest(`/repos/${owner}/${name}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: branch,
      base,
      body: description
    })
  });
}

async function createGithubIssue(repo, title, body, labels = [], orgId = null) {
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    return {
      mode: "draft",
      repo,
      title,
      body,
      labels,
      url: null
    };
  }

  const { owner, name } = parseRepo(repo);
  const issue = await githubRequest(`/repos/${owner}/${name}/issues`, auth.token, {
    method: "POST",
    body: JSON.stringify({ title, body, labels })
  });

  return {
    mode: "github",
    repo,
    title,
    body,
    labels,
    url: issue.html_url,
    issueNumber: issue.number
  };
}

async function createGithubPullRequest({ repo, branch, title, description, files, orgId = null }) {
  ghLog("github.pr.create.start", { repo, branch, fileCount: Array.isArray(files) ? files.length : 0, orgId: orgId || null });
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    ghLog("github.pr.create.draft_mode", { repo, branch });
    return {
      mode: "draft",
      repo,
      branch,
      title,
      description,
      files,
      url: null
    };
  }

  const { owner, name } = parseRepo(repo);

  const repoData = await githubRequest(`/repos/${owner}/${name}`, auth.token);
  const base = repoData.default_branch || "main";

  const baseRef = await githubRequest(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(base)}`, auth.token);
  const baseSha = baseRef.object.sha;
  let resolvedBranch = branch;
  try {
    await githubRequest(`/repos/${owner}/${name}/git/refs`, auth.token, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${resolvedBranch}`,
        sha: baseSha
      })
    });
  } catch (error) {
    if (!String(error.message || "").includes("422")) throw error;
    resolvedBranch = `${branch}-${Date.now()}`;
    await githubRequest(`/repos/${owner}/${name}/git/refs`, auth.token, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${resolvedBranch}`,
        sha: baseSha
      })
    });
  }

  for (const file of files) {
    const content = `// generated by Product Factory\nexport const capability = \"${title}\";\n`;
    const safePath = file.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    await githubRequest(`/repos/${owner}/${name}/contents/${safePath}`, auth.token, {
      method: "PUT",
      body: JSON.stringify({
        message: `add ${file}`,
        content: Buffer.from(content).toString("base64"),
        branch: resolvedBranch
      })
    });
  }

  const pr = await githubRequest(`/repos/${owner}/${name}/pulls`, auth.token, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: resolvedBranch,
      base,
      body: description
    })
  });

  ghLog("github.pr.create.success", {
    repo,
    branch: resolvedBranch,
    prNumber: pr.number,
    url: pr.html_url || null
  });

  return {
    mode: "github",
    repo,
    branch: resolvedBranch,
    title,
    description,
    files,
    url: pr.html_url,
    prNumber: pr.number
  };
}

async function syncDocsToPullRequest({ repo, branch, title, description, files, orgId = null }) {
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    return {
      mode: "draft",
      repo,
      branch,
      title,
      description,
      files,
      url: null
    };
  }

  const { owner, name } = parseRepo(repo);
  const branchInfo = await ensureBranch(owner, name, branch, auth.token);

  for (const file of files || []) {
    await upsertFile(owner, name, branchInfo.branch, file.path, file.content, auth.token, file.message || null);
  }

  const pr = await ensurePullRequest(
    owner,
    name,
    branchInfo.branch,
    branchInfo.base,
    title,
    description,
    auth.token
  );

  return {
    mode: "github",
    repo,
    branch: branchInfo.branch,
    title,
    description,
    files: files || [],
    url: pr.html_url,
    prNumber: pr.number
  };
}

async function readGithubDocsFromBranch({ repo, branch, paths = [], orgId = null }) {
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    return {
      mode: "draft",
      repo,
      branch,
      files: {}
    };
  }

  const { owner, name } = parseRepo(repo);
  const out = {};
  for (const rawPath of paths) {
    const filePath = String(rawPath || "").trim();
    if (!filePath) continue;
    const safePath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    const ref = encodeURIComponent(branch);
    const payload = await githubRequestAllow404(`/repos/${owner}/${name}/contents/${safePath}?ref=${ref}`, auth.token);
    if (!payload || Array.isArray(payload) || !payload.content) continue;
    const decoded = Buffer.from(String(payload.content).replace(/\n/g, ""), "base64").toString("utf8");
    out[filePath] = decoded;
  }

  return {
    mode: "github",
    repo,
    branch,
    files: out
  };
}

async function readGithubDocsByPrefix({
  repo,
  branch = "main",
  prefix = "",
  orgId = null,
  maxFiles = 24
}) {
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    return {
      mode: "draft",
      repo,
      branch,
      prefix,
      files: {}
    };
  }

  try {
    const { owner, name } = parseRepo(repo);
    const normalizedPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
    const tree = await githubRequestAllow404(
      `/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      auth.token
    );
    if (!tree || !Array.isArray(tree.tree)) {
      return {
        mode: "github",
        repo,
        branch,
        prefix: normalizedPrefix,
        files: {}
      };
    }

    const docs = tree.tree
      .filter((item) => item && item.type === "blob" && typeof item.path === "string")
      .filter((item) => item.path.startsWith(`${normalizedPrefix}/`))
      .filter((item) => /\.(md|mmd|txt)$/i.test(item.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, Math.max(1, Math.min(80, Number(maxFiles) || 24)));

    const out = {};
    for (const file of docs) {
      const safePath = file.path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
      const ref = encodeURIComponent(branch);
      const payload = await githubRequestAllow404(`/repos/${owner}/${name}/contents/${safePath}?ref=${ref}`, auth.token);
      if (!payload || Array.isArray(payload) || !payload.content) continue;
      out[file.path] = Buffer.from(String(payload.content).replace(/\n/g, ""), "base64").toString("utf8");
    }

    return {
      mode: "github",
      repo,
      branch,
      prefix: normalizedPrefix,
      files: out
    };
  } catch (error) {
    return {
      mode: "github-error",
      repo,
      branch,
      prefix,
      files: {},
      error: String(error?.message || error)
    };
  }
}

async function approveGithubPullRequest({ repo, prNumber, body = "Approved by Product Factory workflow gate.", orgId = null }) {
  const auth = await resolveGithubAuth({ orgId });
  if (!auth.token) {
    return {
      mode: "draft",
      repo,
      prNumber,
      state: "APPROVED",
      url: null
    };
  }

  const { owner, name } = parseRepo(repo);
  let review = null;
  try {
    review = await githubRequest(`/repos/${owner}/${name}/pulls/${prNumber}/reviews`, auth.token, {
      method: "POST",
      body: JSON.stringify({
        event: "APPROVE",
        body
      })
    });
  } catch (error) {
    const message = String(error?.message || error || "GitHub approval failed");
    return {
      mode: "github-error",
      repo,
      prNumber,
      state: "APPROVAL_FAILED",
      url: null,
      error: message,
      nonFatal: true
    };
  }

  return {
    mode: "github",
    repo,
    prNumber,
    state: review.state,
    url: review.html_url || null
  };
}

module.exports = {
  hasGithubToken,
  createGithubIssue,
  createGithubPullRequest,
  syncDocsToPullRequest,
  readGithubDocsFromBranch,
  readGithubDocsByPrefix,
  approveGithubPullRequest,
  parsePrNumberFromUrl,
  resolveGithubAuth
};
