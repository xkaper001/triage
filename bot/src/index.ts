import "dotenv/config";
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { loadEnv, webhookUrl } from "./types.js";
import { loadConfig } from "./lib/store.js";
import { handleThreadCreate } from "./lib/relay.js";
import { handleReactionAdd } from "./lib/reaction.js";
import { handleCommand, handleButton, handleModal, handleSelectMenu, welcomeEmbed } from "./lib/commands.js";

const env = loadEnv();
console.log("[startup] env loaded:", {
  KESTRA_CLOUD_URL: env.KESTRA_CLOUD_URL,
  KESTRA_NAMESPACE: env.KESTRA_NAMESPACE,
  KESTRA_TRIAGE_WEBHOOK_KEY: env.KESTRA_TRIAGE_WEBHOOK_KEY,
  KESTRA_ALERT_WEBHOOK_KEY: env.KESTRA_ALERT_WEBHOOK_KEY,
  KESTRA_CONFIG_WEBHOOK_KEY: env.KESTRA_CONFIG_WEBHOOK_KEY,
  DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN ? "SET" : "MISSING",
});
console.log("[startup] webhook URLs:");
console.log("  triage:", webhookUrl(env, "triage"));
console.log("  alert: ", webhookUrl(env, "alert"));
console.log("  config:", webhookUrl(env, "config"));
loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,       // Privileged — enable in Dev Portal
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Ready — ${c.user.tag}`);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[GuildCreate] Joined guild=${guild.id} name=${guild.name}`);
  try {
    const channel = guild.systemChannel
      ?? guild.channels.cache
          .filter(c => c.isTextBased() && c.permissionsFor(guild.members.me!)?.has("SendMessages") === true)
          .first();
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [welcomeEmbed()] });
    }
  } catch (err) {
    console.error("[GuildCreate] Failed to send welcome message:", err);
  }
});

client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (!newlyCreated) return;
  try {
    await handleThreadCreate(thread, env);
  } catch (err) {
    console.error("ThreadCreate error:", err);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReactionAdd(reaction, user, env);
  } catch (err) {
    console.error("ReactionAdd error:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const type = interaction.isChatInputCommand() ? "command"
    : interaction.isButton() ? "button"
    : interaction.isModalSubmit() ? "modal"
    : interaction.isChannelSelectMenu() ? "channel_select"
    : "other";
  console.log(`[interaction] type=${type} guild=${interaction.guildId} user=${interaction.user?.id}`);
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction, env);
    else if (interaction.isButton()) await handleButton(interaction, env);
    else if (interaction.isModalSubmit()) await handleModal(interaction, env);
    else if (interaction.isChannelSelectMenu()) await handleSelectMenu(interaction, env);
    else console.log(`[interaction] unhandled type=${type}`);
  } catch (err) {
    console.error(`[interaction] UNHANDLED ERROR type=${type}:`, err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An error occurred.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);
