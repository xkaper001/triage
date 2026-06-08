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

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/repositories?per_page=100`,
    { headers },
  );
  if (!res.ok) {
    console.warn(`[callback] repos fetch failed: ${res.status}`);
    return [];
  }
  const data = await res.json() as { repositories: { full_name: string }[] };
  return data.repositories.map((r) => r.full_name);
}

const SUCCESS_HTML = (installationId: string, repos: string[]) => `<!DOCTYPE html>
<html><head><title>GitHub App Installed</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1a1a2e;padding:0 20px}
  h1{color:#5865f2;font-size:2rem}
  code{background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:.9rem}
  p{color:#555;line-height:1.6}
  ul{text-align:left;display:inline-block;margin:0 auto}
</style></head>
<body>
  <h1>✅ GitHub App installed!</h1>
  <p>Installation ID <code>${installationId}</code> saved.</p>
  ${repos.length ? `<p>Repos available in Discord:<br><ul>${repos.map(r => `<li><code>${r}</code></li>`).join("")}</ul></p>` : ""}
  <p>Return to Discord and click <strong>Set Repository</strong> to pick one.</p>
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
