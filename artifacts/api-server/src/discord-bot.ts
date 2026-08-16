import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { logger } from "./lib/logger";

const DEFAULT_MESSAGE_INTERVAL_MS = 5_000;
const DEFAULT_TYPE_MESSAGES = [
  "Message 1",
  "Message 2",
  "Message 3",
  "Message 4",
  "Message 5",
];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

function configuredInterval(): number {
  const configured = Number(process.env["DISCORD_MESSAGE_INTERVAL_MS"]);

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MESSAGE_INTERVAL_MS;
  }

  return configured;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "retryAfter" in error &&
    typeof error.retryAfter === "number" &&
    Number.isFinite(error.retryAfter)
  ) {
    return Math.max(1_000, error.retryAfter);
  }

  return 10_000;
}

async function replyToTypeCommand(
  interaction: ChatInputCommandInteraction,
  queuedCount: number,
): Promise<void> {
  const content =
    queuedCount === 1
      ? "Queued 1 message. It will be sent to the configured channel."
      : `Queued ${queuedCount} messages. They will be sent every 5 seconds.`;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

export async function startDiscordBot(): Promise<void> {
  const token = requiredEnvironment("DISCORD_BOT_TOKEN");
  const channelId = requiredEnvironment("DISCORD_CHANNEL_ID");
  const guildId = process.env["DISCORD_GUILD_ID"]?.trim();
  const intervalMs = configuredInterval();
  const queue: string[] = [];
  let workerPromise: Promise<void> | undefined;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const typeCommand = new SlashCommandBuilder()
    .setName("type")
    .setDescription("Queue a message for the bot to send")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to send")
        .setMaxLength(2_000)
        .setRequired(false),
    );

  const sendQueuedMessages = async (): Promise<void> => {
    const channel = await client.channels.fetch(channelId);

    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(
        `Discord channel ${channelId} was not found or is not a sendable text channel.`,
      );
    }

    while (queue.length > 0) {
      const message = queue.shift();

      if (!message) {
        continue;
      }

      try {
        await channel.send(message);
        logger.info({ channelId, queueLength: queue.length }, "Discord message sent");
      } catch (error) {
        queue.unshift(message);
        logger.error(
          { err: error, channelId },
          "Discord message failed; retrying after a delay",
        );
        await sleep(retryDelay(error));
        continue;
      }

      if (queue.length > 0) {
        await sleep(intervalMs);
      }
    }
  };

  const queueMessages = (messages: string[]): void => {
    queue.push(...messages);

    if (!workerPromise) {
      workerPromise = sendQueuedMessages().finally(() => {
        workerPromise = undefined;

        if (queue.length > 0) {
          queueMessages([]);
        }
      });
    }
  };

  const registerCommands = async (): Promise<void> => {
    if (!client.user) {
      throw new Error("Discord client is not ready while registering commands.");
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
      ? Routes.applicationGuildCommands(client.user.id, guildId)
      : Routes.applicationCommands(client.user.id);

    await rest.put(route, { body: [typeCommand.toJSON()] });

    logger.info(
      { registrationScope: guildId ? "guild" : "global" },
      "Discord slash commands registered",
    );
  };

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ user: readyClient.user.tag }, "Discord bot logged in");

    try {
      await registerCommands();
    } catch (error) {
      logger.error({ err: error }, "Discord slash command registration failed");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "type") {
      return;
    }

    const requestedMessage = interaction.options.getString("message");
    const messages = requestedMessage ? [requestedMessage] : DEFAULT_TYPE_MESSAGES;

    queueMessages(messages);
    await replyToTypeCommand(interaction, messages.length);
  });

  await client.login(token);
}