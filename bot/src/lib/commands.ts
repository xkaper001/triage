import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const EPH = { flags: MessageFlags.Ephemeral } as const;
import type { BotEnv } from "../types.js";
import { webhookUrl } from "../types.js";
import { getForumChannelId, setForumChannelId } from "./store.js";

function setupPanelData(guildId: string) {
  const forumId = getForumChannelId(guildId);
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Bot Configuration")
    .addFields({
      name: "Forum Channel",
      value: forumId ? `<#${forumId}> (\`${forumId}\`)` : "❌ Not set — click **Forum Channel** below",
      inline: false,
    })
    .setColor(forumId ? 0x57f287 : 0xfee75c)
    .setFooter({ text: "AI & GitHub credentials are stored securely in Kestra KV." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("setup:ai").setLabel("AI Provider").setStyle(ButtonStyle.Primary).setEmoji("🤖"),
    new ButtonBuilder().setCustomId("setup:github").setLabel("GitHub").setStyle(ButtonStyle.Primary).setEmoji("🐙"),
    new ButtonBuilder().setCustomId("setup:forum").setLabel("Forum Channel").setStyle(ButtonStyle.Secondary).setEmoji("💬"),
  );

  return { embeds: [embed], components: [row] };
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle("📖 Triage Bot — Commands")
    .setColor(0x5865f2)
    .addFields(
      { name: "/setup", value: "Open the configuration panel (AI provider, GitHub, forum channel)", inline: false },
      { name: "/repo [owner/repo]", value: "Set the default GitHub repository for issue filing", inline: false },
      { name: "/set-api-key", value: "Quickly update the OpenAI API key", inline: false },
      { name: "/set-baseurl [url]", value: "Update the OpenAI-compatible base URL", inline: false },
      { name: "/set-forum-channel #channel", value: "Set the forum channel to monitor for new posts", inline: false },
      { name: "/status", value: "Show the currently monitored forum channel", inline: false },
      { name: "/help", value: "Show this message", inline: false },
    )
    .setFooter({ text: "All commands require Administrator permission." });
}

async function postConfig(env: BotEnv, guildId: string, key: string, value: string): Promise<boolean> {
  const url = webhookUrl(env, "config");
  console.log(`[postConfig] POST ${url} key=${key} value=${value.slice(0, 8)}***`);
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
      console.log(`[postConfig] OK [${key}] status=${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`[postConfig] EXCEPTION [${key}]:`, err);
    return false;
  }
}

export async function handleCommand(interaction: ChatInputCommandInteraction, env: BotEnv): Promise<void> {
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[cmd] /${interaction.commandName} guild=${guildId} user=${interaction.user.id}`);

  switch (interaction.commandName) {
    case "setup":
      await interaction.reply({ ...setupPanelData(guildId), ...EPH });
      break;

    case "set-api-key": {
      const m = new ModalBuilder().setCustomId("api_key_modal").setTitle("Update API Key");
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("api_key").setLabel("OpenAI API Key")
            .setStyle(TextInputStyle.Short).setPlaceholder("sk-...")
            .setRequired(true).setMaxLength(500),
        ),
      );
      await interaction.showModal(m);
      break;
    }

    case "set-baseurl": {
      const url = interaction.options.getString("url");
      if (url) {
        const ok = await postConfig(env, guildId, "OPENAI_BASE_URL", url);
        await interaction.reply({ content: ok ? "✅ Base URL saved." : "⚠️ Failed to save.", ...EPH });
      } else {
        const m = new ModalBuilder().setCustomId("set_baseurl_modal").setTitle("Set Base URL");
        m.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("base_url").setLabel("OpenAI-compatible Base URL")
              .setStyle(TextInputStyle.Short).setPlaceholder("https://api.openai.com/v1")
              .setRequired(true).setMaxLength(500),
          ),
        );
        await interaction.showModal(m);
      }
      break;
    }

    case "repo": {
      const repo = interaction.options.getString("repo");
      if (repo) {
        const ok = await postConfig(env, guildId, "DEFAULT_REPO", repo);
        await interaction.reply({ content: ok ? `✅ Repo set to \`${repo}\`.` : "⚠️ Failed.", ...EPH });
      } else {
        const m = new ModalBuilder().setCustomId("repo_modal").setTitle("Set Repository");
        m.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("repo").setLabel("Repository (owner/repo)")
              .setStyle(TextInputStyle.Short).setPlaceholder("owner/repo")
              .setRequired(true).setMaxLength(200),
          ),
        );
        await interaction.showModal(m);
      }
      break;
    }

    case "set-forum-channel": {
      const channel = interaction.options.getChannel("channel", true);
      setForumChannelId(guildId, channel.id);
      await interaction.reply({ content: `✅ Forum channel set to <#${channel.id}> (\`${channel.id}\`).`, ...EPH });
      break;
    }

    case "status": {
      const forumChannelId = getForumChannelId(guildId);
      const content = forumChannelId
        ? `✅ Monitoring <#${forumChannelId}> (\`${forumChannelId}\`)`
        : "⚠️ No forum channel set. Use `/set-forum-channel` or open `/setup`.";
      await interaction.reply({ content, ...EPH });
      break;
    }

    case "help":
      await interaction.reply({ embeds: [helpEmbed()], ...EPH });
      break;

    default:
      await interaction.reply({ content: "Unknown command.", ...EPH });
  }
}

export async function handleButton(interaction: ButtonInteraction, env: BotEnv): Promise<void> {
  const { customId } = interaction;
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[button] ${customId} guild=${guildId} user=${interaction.user.id}`);

  if (customId === "setup:ai") {
    const m = new ModalBuilder().setCustomId("setup_ai_modal").setTitle("AI Provider Setup");
    m.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("api_key").setLabel("OpenAI API Key")
          .setStyle(TextInputStyle.Short).setPlaceholder("sk-...")
          .setRequired(true).setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("base_url").setLabel("Base URL")
          .setStyle(TextInputStyle.Short).setPlaceholder("https://api.openai.com/v1")
          .setRequired(true).setMaxLength(500),
      ),
    );
    await interaction.showModal(m);
    return;
  }

  if (customId === "setup:github") {
    const m = new ModalBuilder().setCustomId("setup_github_modal").setTitle("GitHub Setup");
    m.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("repo").setLabel("Repository (owner/repo)")
          .setStyle(TextInputStyle.Short).setPlaceholder("owner/repo")
          .setRequired(true).setMaxLength(200),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("github_token").setLabel("GitHub Token (optional)")
          .setStyle(TextInputStyle.Short).setPlaceholder("ghp_...")
          .setRequired(false).setMaxLength(500),
      ),
    );
    await interaction.showModal(m);
    return;
  }

  if (customId === "setup:forum") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId("setup:forum_select")
      .setPlaceholder("Select the forum channel to monitor")
      .setChannelTypes(ChannelType.GuildForum);
    const selectRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("setup:back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [], components: [selectRow, backRow] });
    return;
  }

  if (customId === "setup:back") {
    await interaction.update(setupPanelData(guildId));
    return;
  }

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

export async function handleSelectMenu(
  interaction: ChannelSelectMenuInteraction,
  env: BotEnv,
): Promise<void> {
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[selectmenu] ${interaction.customId} guild=${guildId} user=${interaction.user.id}`);

  if (interaction.customId === "setup:forum_select") {
    const channel = interaction.channels.first();
    if (!channel) {
      await interaction.update({ embeds: [], components: [] });
      return;
    }
    setForumChannelId(guildId, channel.id);
    await interaction.update(setupPanelData(guildId));
  }
}

export async function handleModal(interaction: ModalSubmitInteraction, env: BotEnv): Promise<void> {
  const guildId = interaction.guildId ?? "unknown";
  console.log(`[modal] ${interaction.customId} guild=${guildId} user=${interaction.user.id}`);
  const get = (id: string) => interaction.fields.getTextInputValue(id);

  switch (interaction.customId) {
    case "setup_ai_modal": {
      const results = await Promise.all([
        postConfig(env, guildId, "OPENAI_API_KEY", get("api_key")),
        postConfig(env, guildId, "OPENAI_BASE_URL", get("base_url")),
      ]);
      const ok = results.every(Boolean);
      await interaction.reply({ content: ok ? "✅ AI provider configured." : "⚠️ Some values failed — check bot logs.", ...EPH });
      break;
    }

    case "setup_github_modal": {
      const repo = get("repo");
      const token = get("github_token");
      const saves: Array<Promise<boolean>> = [postConfig(env, guildId, "DEFAULT_REPO", repo)];
      if (token) saves.push(postConfig(env, guildId, "GITHUB_TOKEN", token));
      const results = await Promise.all(saves);
      const ok = results.every(Boolean);
      await interaction.reply({ content: ok ? "✅ GitHub configured." : "⚠️ Failed to save — check bot logs.", ...EPH });
      break;
    }

    case "api_key_modal": {
      const ok = await postConfig(env, guildId, "OPENAI_API_KEY", get("api_key"));
      await interaction.reply({ content: ok ? "✅ API key saved." : "⚠️ Failed — check bot logs.", ...EPH });
      break;
    }

    case "set_baseurl_modal": {
      const ok = await postConfig(env, guildId, "OPENAI_BASE_URL", get("base_url"));
      await interaction.reply({ content: ok ? "✅ Base URL saved." : "⚠️ Failed.", ...EPH });
      break;
    }

    case "repo_modal": {
      const ok = await postConfig(env, guildId, "DEFAULT_REPO", get("repo"));
      await interaction.reply({ content: ok ? "✅ Repo saved." : "⚠️ Failed.", ...EPH });
      break;
    }

    default:
      await interaction.reply({ content: "Unknown modal.", ...EPH });
  }
}
