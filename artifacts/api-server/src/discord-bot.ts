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
  messageCount: number,
  alreadyRunning: boolean,
): Promise<void> {
  const content = alreadyRunning
    ? "Typing is already running. Use /stop before starting it again."
    : `Typing started with ${messageCount} message${messageCount === 1 ? "" : "s"}. It will repeat every 5 seconds. Use /stop to stop it.`;

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
  let typingPromise: Promise<void> | undefined;
  let stopRequested = false;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const typeCommand = new SlashCommandBuilder()
    .setName("type")
    .setDescription("Start sending a message every 5 seconds")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to repeat (defaults to the sample sequence)")
        .setMaxLength(2_000)
        .setRequired(false),
    );

  const stopCommand = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the repeating messages");

  const startTyping = (messages: string[]): boolean => {
    if (typingPromise) {
      return false;
    }

    stopRequested = false;
    typingPromise = (async () => {
      try {
        const channel = await client.channels.fetch(channelId);

        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(
            `Discord channel ${channelId} was not found or is not a sendable text channel.`,
          );
        }

        let messageIndex = 0;

        while (!stopRequested) {
          const message = messages[messageIndex] ?? messages[0];

          try {
            await channel.send(message);
            logger.info({ channelId }, "Discord repeating message sent");
          } catch (error) {
            const status =
              typeof error === "object" &&
              error !== null &&
              "status" in error &&
              typeof error.status === "number"
                ? error.status
                : undefined;

            if (status === 403 || status === 404) {
              logger.error(
                { err: error, channelId },
                "Discord typing stopped because the channel is unavailable or forbidden",
              );
              return;
            }

            logger.error(
              { err: error, channelId },
              "Discord repeating message failed; retrying after a delay",
            );
            await sleep(retryDelay(error));
            continue;
          }

          messageIndex = (messageIndex + 1) % messages.length;
          await sleep(intervalMs);
        }
      } catch (error) {
        logger.error({ err: error, channelId }, "Discord typing stopped unexpectedly");
      } finally {
        typingPromise = undefined;
        stopRequested = false;
        logger.info({ channelId }, "Discord repeating messages stopped");
      }
    })();

    return true;
  };

  const stopTyping = (): boolean => {
    if (!typingPromise) {
      return false;
    }

    stopRequested = true;
    return true;
  };

  const registerCommands = async (): Promise<void> => {
    if (!client.user) {
      throw new Error("Discord client is not ready while registering commands.");
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
      ? Routes.applicationGuildCommands(client.user.id, guildId)
      : Routes.applicationCommands(client.user.id);

    await rest.put(route, {
      body: [typeCommand.toJSON(), stopCommand.toJSON()],
    });

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
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "type") {
      const requestedMessage = interaction.options.getString("message");
      const messages = requestedMessage
        ? [requestedMessage]
        : DEFAULT_TYPE_MESSAGES;
      const alreadyRunning = !startTyping(messages);

      await replyToTypeCommand(interaction, messages.length, alreadyRunning);
      return;
    }

    if (interaction.commandName === "stop") {
      const wasRunning = stopTyping();
      const content = wasRunning
        ? "Typing stopped. No more repeating messages will be sent."
        : "Typing is not currently running.";

      await interaction.reply({ content, ephemeral: true });
    }
  });

  await client.login(token);
}