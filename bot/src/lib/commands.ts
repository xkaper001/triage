import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const EPH = { flags: MessageFlags.Ephemeral } as const;
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";
import { getForumChannelId, setForumChannelId } from "./store.js";

function modal(
  customId: string,
  title: string,
  fields: Array<{ id: string; label: string; placeholder?: string }>
): ModalBuilder {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const f of fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(500)
      .setRequired(true);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return m;
}

async function postConfig(
  env: BotEnv,
  guildId: string,
  key: string,
  value: string
): Promise<boolean> {
  const url = webhookUrl(env, "config");
  const body = { guild_id: guildId, key, value: value.slice(0, 8) + "***" };
  console.log(`[postConfig] POST ${url}`);
  console.log(`[postConfig] body: ${JSON.stringify(body)}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guild_id: guildId, key, value }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[postConfig] FAILED [${key}] status=${res.status} body=${text}`);
    } else {
      console.log(`[postConfig] OK [${key}] status=${res.status} body=${text}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`[postConfig] EXCEPTION [${key}]:`, err);
    return false;
  }
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  env: BotEnv
): Promise<void> {
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[cmd] /${interaction.commandName} guild=${guildId} user=${interaction.user.id}`);

  switch (interaction.commandName) {
    case "setup":
      await interaction.showModal(
        modal("setup_modal", "Bot Setup", [
          { id: "api_key",       label: "OpenAI API Key",          placeholder: "sk-..." },
          { id: "base_url",      label: "OpenAI Base URL",         placeholder: "https://api.openai.com/v1" },
          { id: "repo",          label: "Default Repo (OWNER/REPO)", placeholder: "owner/repo" },
          { id: "github_token",  label: "GitHub Token",            placeholder: "ghp_..." },
          { id: "admin_channel", label: "Admin Channel ID",        placeholder: "1234567890" },
        ])
      );
      break;

    case "set-api-key":
      await interaction.showModal(
        modal("set_api_key_modal", "Set OpenAI API Key", [
          { id: "api_key", label: "OpenAI API Key", placeholder: "sk-..." },
        ])
      );
      break;

    case "set-baseurl": {
      const url = interaction.options.getString("url");
      if (url) {
        const ok = await postConfig(env, guildId, "OPENAI_BASE_URL", url);
        await interaction.reply({ content: ok ? "Base URL saved." : "Failed to save.", ...EPH });
      } else {
        await interaction.showModal(
          modal("set_baseurl_modal", "Set OpenAI Base URL", [
            { id: "base_url", label: "OpenAI Base URL", placeholder: "https://api.openai.com/v1" },
          ])
        );
      }
      break;
    }

    case "set-repo": {
      const repo = interaction.options.getString("repo");
      if (repo) {
        const ok = await postConfig(env, guildId, "DEFAULT_REPO", repo);
        await interaction.reply({ content: ok ? "Repo saved." : "Failed to save.", ...EPH });
      } else {
        await interaction.showModal(
          modal("set_repo_modal", "Set Default Repo", [
            { id: "repo", label: "Default Repo (OWNER/REPO)", placeholder: "owner/repo" },
          ])
        );
      }
      break;
    }

    case "set-forum-channel": {
      const channel = interaction.options.getChannel("channel", true);
      setForumChannelId(guildId, channel.id);
      await interaction.reply({
        content: `Forum channel set to <#${channel.id}> (\`${channel.id}\`).`,
        ...EPH,
      });
      break;
    }

    case "status": {
      const forumChannelId = getForumChannelId(guildId);
      const content = forumChannelId
        ? `✅ Monitoring <#${forumChannelId}> (\`${forumChannelId}\`)`
        : "⚠️ No forum channel set. Run /set-forum-channel.";
      await interaction.reply({ content, ...EPH });
      break;
    }

    default:
      await interaction.reply({ content: "Unknown command.", ...EPH });
  }
}

export async function handleModal(
  interaction: ModalSubmitInteraction,
  env: BotEnv
): Promise<void> {
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[modal] ${interaction.customId} guild=${guildId} user=${interaction.user.id}`);
  const get = (id: string) => interaction.fields.getTextInputValue(id);

  switch (interaction.customId) {
    case "setup_modal": {
      const results = await Promise.all([
        postConfig(env, guildId, "OPENAI_API_KEY",    get("api_key")),
        postConfig(env, guildId, "OPENAI_BASE_URL",   get("base_url")),
        postConfig(env, guildId, "DEFAULT_REPO",      get("repo")),
        postConfig(env, guildId, "GITHUB_TOKEN",      get("github_token")),
        postConfig(env, guildId, "ADMIN_CHANNEL_ID",  get("admin_channel")),
      ]);
      const ok = results.every(Boolean);
      await interaction.reply({
        content: ok ? "✅ Setup complete." : "⚠️ Some values failed to save. Check logs.",
        ...EPH,
      });
      break;
    }
    case "set_api_key_modal": {
      console.log(`[modal] set_api_key_modal: sending to Kestra config webhook`);
      const ok = await postConfig(env, guildId, "OPENAI_API_KEY", get("api_key"));
      console.log(`[modal] set_api_key_modal: result=${ok}`);
      await interaction.reply({ content: ok ? "API key saved." : "Failed — check bot logs.", ...EPH });
      break;
    }
    case "set_baseurl_modal": {
      const ok = await postConfig(env, guildId, "OPENAI_BASE_URL", get("base_url"));
      await interaction.reply({ content: ok ? "Base URL saved." : "Failed.", ...EPH });
      break;
    }
    case "set_repo_modal": {
      const ok = await postConfig(env, guildId, "DEFAULT_REPO", get("repo"));
      await interaction.reply({ content: ok ? "Repo saved." : "Failed.", ...EPH });
      break;
    }
    default:
      await interaction.reply({ content: "Unknown modal.", ...EPH });
  }
}

export async function handleButton(
  interaction: ButtonInteraction,
  env: BotEnv
): Promise<void> {
  const customId = interaction.customId;
  const guildId = interaction.guildId ?? "unknown";

  if (customId.startsWith("approve_issue:")) {
    const issueKey = customId.slice("approve_issue:".length);

    fetch(webhookUrl(env, "alert"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        issue_key: issueKey,
        guild_id: guildId,
        approver_id: interaction.user.id,
        approver_name: interaction.user.username,
        interaction_token: interaction.token,
      }),
    }).catch((err) => console.error("Kestra approve failed:", err));

    await interaction.reply({ content: "Approval sent to Kestra.", ...EPH });
    return;
  }

  if (customId.startsWith("reject_issue:")) {
    await interaction.reply({ content: "Issue rejected.", ...EPH });
    return;
  }

  await interaction.reply({ content: "Unknown button.", ...EPH });
}
