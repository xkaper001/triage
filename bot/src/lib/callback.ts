import http from "node:http";
import type { Client } from "discord.js";
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";

const SUCCESS_HTML = (installationId: string) => `<!DOCTYPE html>
<html><head><title>GitHub App Installed</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1a1a2e;padding:0 20px}
  h1{color:#5865f2;font-size:2rem}
  code{background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:.9rem}
  p{color:#555;line-height:1.6}
</style></head>
<body>
  <h1>✅ GitHub App installed!</h1>
  <p>Installation ID <code>${installationId}</code> has been saved to your server.</p>
  <p>You can close this tab and return to Discord.</p>
</body></html>`;

export function startCallbackServer(env: BotEnv, client: Client): void {
  const port = Number(process.env.CALLBACK_PORT ?? 3000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

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

      if (userId) {
        client.users.fetch(userId)
          .then(user => user.send(`✅ GitHub App installed! Installation ID \`${installationId}\` saved — issues will now be filed as the Triage bot.`))
          .catch(() => {});
      }

      res.writeHead(200, { "Content-Type": "text/html" }).end(SUCCESS_HTML(installationId));
    } catch (err) {
      console.error("[callback]", err);
      res.writeHead(500).end("Internal error");
    }
  });

  server.listen(port, () => console.log(`[callback] listening on :${port}`));
}
