import http from "node:http";
import crypto from "node:crypto";
import type { Client } from "discord.js";
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";
import { setGuildRepos } from "./store.js";

function makeAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = crypto.createSign("RSA-SHA256").update(data).sign(privateKey, "base64url");
  return `${data}.${sig}`;
}

async function fetchInstallationRepos(appId: string, privateKey: string, installationId: string): Promise<string[]> {
  const jwt = makeAppJWT(appId, privateKey);
  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Exchange JWT for installation access token
  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers },
  );
  if (!tokenRes.ok) {
    console.warn(`[callback] access_tokens failed: ${tokenRes.status}`);
    return [];
  }
  const { token } = await tokenRes.json() as { token: string };

  const res = await fetch(
    `https://api.github.com/installation/repositories?per_page=100`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
  );
  if (!res.ok) {
    console.warn(`[callback] repos fetch failed: ${res.status}`);
    return [];
  }
  const data = await res.json() as { repositories: { full_name: string }[] };
  return data.repositories.map((r) => r.full_name);
}

const SUCCESS_HTML = (_installationId: string, repos: string[]) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GitHub App Installed</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:#0c0c0e;
    color:#c9c9d4;
    font-family:"Inter",system-ui,sans-serif;
    font-size:16px;
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
    padding:24px;
  }
  .card{
    max-width:460px;
    width:100%;
    text-align:center;
  }
  .icon{
    width:52px;height:52px;
    background:rgba(74,222,128,.12);
    border:1px solid rgba(74,222,128,.25);
    border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    margin:0 auto 28px;
    font-size:22px;
  }
  h1{
    font-family:"Instrument Serif",Georgia,serif;
    font-size:2.25rem;
    font-weight:400;
    color:#f0f0f5;
    line-height:1.15;
    letter-spacing:-.01em;
    margin-bottom:14px;
  }
  .sub{
    color:#7e7e96;
    font-size:.9375rem;
    line-height:1.65;
    margin-bottom:32px;
  }
  .repos{
    background:#141418;
    border:1px solid #1e1e28;
    border-radius:10px;
    padding:16px 20px;
    margin-bottom:28px;
    text-align:left;
  }
  .repos-label{
    font-size:.75rem;
    font-weight:500;
    text-transform:uppercase;
    letter-spacing:.08em;
    color:#4a4a60;
    margin-bottom:10px;
  }
  .repos ul{list-style:none}
  .repos li{
    font-size:.875rem;
    color:#9090aa;
    padding:5px 0;
    border-bottom:1px solid #1a1a22;
    font-family:"SF Mono","Fira Code",monospace;
  }
  .repos li:last-child{border-bottom:none}
  .hint{
    font-size:.875rem;
    color:#4a4a60;
    line-height:1.6;
  }
  .hint strong{color:#7e7e96;font-weight:500}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>GitHub App installed</h1>
    <p class="sub">Your GitHub App has been connected successfully.</p>
    ${repos.length ? `<div class="repos"><div class="repos-label">${repos.length} repo${repos.length !== 1 ? "s" : ""} available</div><ul>${repos.map(r => `<li>${r}</li>`).join("")}</ul></div>` : ""}
    <p class="hint">Return to Discord and click <strong>Set Repository</strong> to pick one.</p>
  </div>
</body></html>`;

export function startCallbackServer(env: BotEnv, client: Client): void {
  const port = Number(process.env.CALLBACK_PORT ?? 3000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ status: "ok", uptime: Math.floor(process.uptime()) })
      );
      return;
    }

    if (req.method !== "GET" || url.pathname !== "/github/callback") {
      res.writeHead(404).end("Not found");
      return;
    }

    const installationId = url.searchParams.get("installation_id");
    const state = url.searchParams.get("state"); // format: guildId_userId

    if (!installationId || !state || !state.includes("_")) {
      res.writeHead(400).end("Missing or invalid parameters");
      return;
    }

    const sep = state.lastIndexOf("_");
    const guildId = state.slice(0, sep);
    const userId = state.slice(sep + 1);

    try {
      const postRes = await fetch(webhookUrl(env, "config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId, key: "GITHUB_APP_INSTALLATION_ID", value: installationId }),
      });

      if (!postRes.ok) {
        console.error(`[callback] Kestra config failed: ${postRes.status}`);
        res.writeHead(500).end("Failed to save installation ID");
        return;
      }

      console.log(`[callback] saved GITHUB_APP_INSTALLATION_ID=${installationId} guild=${guildId}`);

      // Fetch and cache repos for this installation
      let repos: string[] = [];
      if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
        repos = await fetchInstallationRepos(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, installationId);
        if (repos.length) setGuildRepos(guildId, repos);
        console.log(`[callback] cached ${repos.length} repos for guild=${guildId}`);
      }

      if (userId) {
        const repoHint = repos.length
          ? ` Go back to Discord and click **Set Repository** to pick from ${repos.length} repo(s).`
          : "";
        client.users.fetch(userId)
          .then(user => user.send(`✅ GitHub App installed!${repoHint}`))
          .catch(() => {});
      }

      res.writeHead(200, { "Content-Type": "text/html" }).end(SUCCESS_HTML(installationId, repos));
    } catch (err) {
      console.error("[callback]", err);
      res.writeHead(500).end("Internal error");
    }
  });

  server.listen(port, () => console.log(`[callback] listening on :${port}`));
}
