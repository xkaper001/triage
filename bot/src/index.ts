import "dotenv/config";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { loadEnv } from "./types.js";
import { loadConfig } from "./lib/store.js";
import { handleThreadCreate } from "./lib/relay.js";
import { handleReactionAdd } from "./lib/reaction.js";
import { handleCommand, handleButton, handleModal } from "./lib/commands.js";

const env = loadEnv();
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
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction, env);
    else if (interaction.isButton()) await handleButton(interaction, env);
    else if (interaction.isModalSubmit()) await handleModal(interaction, env);
  } catch (err) {
    console.error("InteractionCreate error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);
