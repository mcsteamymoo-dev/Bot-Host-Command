import {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getCommandLogs,
  getUserAccess,
  listAccessRules,
  recordCommandLog,
  removeAccessRule,
  setAccessRule,
  type AccessType,
} from "./discord-data";
import { logger } from "./lib/logger";

const DEFAULT_MESSAGE_INTERVAL_MS = 5_000;
const DEFAULT_TYPE_MESSAGES = [
  "Message 1",
  "Message 2",
  "Message 3",
  "Message 4",
  "Message 5",
];

const RANDOM_REPLY_OPENERS = [
  "I have arrived",
  "Signal received",
  "You summoned me",
  "Ping acknowledged",
  "I am listening",
  "Message acquired",
];

const RANDOM_REPLY_MIDDLES = [
  "with maximum enthusiasm",
  "from my tiny corner of the internet",
  "through the digital fog",
  "with absolutely no context",
  "and the processors are pleased",
  "while pretending to be mysterious",
];

const RANDOM_REPLY_ENDINGS = [
  "What is the mission?",
  "Proceed.",
  "Make it count.",
  "I will allow it.",
  "This seems important.",
  "Excellent timing.",
];

function randomChoice(values: string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? values[0]!;
}

function generateRandomReply(): string {
  return `${randomChoice(RANDOM_REPLY_OPENERS)} ${randomChoice(RANDOM_REPLY_MIDDLES)}. ${randomChoice(RANDOM_REPLY_ENDINGS)}`;
}

function describeMessage(message: string): string {
  return JSON.stringify(message.length > 400 ? `${message.slice(0, 397)}...` : message);
}

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
  channelId: string,
): Promise<void> {
  const content = alreadyRunning
    ? "Typing is already running. Use /stop before starting it again."
    : `Typing started in <#${channelId}> with ${messageCount} message${messageCount === 1 ? "" : "s"}. It will repeat every 5 seconds. Use /stop to stop it.`;

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

export async function startDiscordBot(): Promise<void> {
  const token = requiredEnvironment("DISCORD_BOT_TOKEN");
  const intervalMs = configuredInterval();
  let typingPromise: Promise<void> | undefined;
  let stopRequested = false;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  const typeCommand = new SlashCommandBuilder()
    .setName("type")
    .setDescription("Start sending a message every 5 seconds")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel where messages should be sent")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
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

  const singleCommand = new SlashCommandBuilder()
    .setName("single")
    .setDescription("Send one message to a specified channel")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to send")
        .setMaxLength(2_000)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel where the message should be sent")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    );

  const dmCommand = new SlashCommandBuilder()
    .setName("dm")
    .setDescription("Send one direct message to a user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user who should receive the message")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to send")
        .setMaxLength(2_000)
        .setRequired(true),
    );

  const whitelistCommand = new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage members who can use the bot")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Allow a member to use the bot")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to whitelist")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a member from the whitelist")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to remove")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Show whitelisted members"),
    );

  const blacklistCommand = new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage members blocked from using the bot")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Block a member from using the bot")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to blacklist")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a member from the blacklist")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member to unblock")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Show blacklisted members"),
    );

  const logsCommand = new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Show recent bot usage for this server")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of recent entries to show")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false),
    );

  const startTyping = (messages: string[], targetChannelId: string): boolean => {
    if (typingPromise) {
      return false;
    }

    stopRequested = false;
    typingPromise = (async () => {
      try {
        const channel = await client.channels.fetch(targetChannelId);

        if (!channel?.isTextBased() || !("send" in channel)) {
          throw new Error(
            `Discord channel ${targetChannelId} was not found or is not a sendable text channel.`,
          );
        }

        let messageIndex = 0;

        while (!stopRequested) {
          const message = messages[messageIndex] ?? messages[0];

          try {
            await channel.send(message);
            logger.info({ channelId: targetChannelId }, "Discord repeating message sent");
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
                { err: error, channelId: targetChannelId },
                "Discord typing stopped because the channel is unavailable or forbidden",
              );
              return;
            }

            logger.error(
              { err: error, channelId: targetChannelId },
              "Discord repeating message failed; retrying after a delay",
            );
            await sleep(retryDelay(error));
            continue;
          }

          messageIndex = (messageIndex + 1) % messages.length;
          await sleep(intervalMs);
        }
      } catch (error) {
        logger.error(
          { err: error, channelId: targetChannelId },
          "Discord typing stopped unexpectedly",
        );
      } finally {
        typingPromise = undefined;
        stopRequested = false;
        logger.info(
          { channelId: targetChannelId },
          "Discord repeating messages stopped",
        );
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

  const auditInteraction = async (
    interaction: ChatInputCommandInteraction,
    command: string,
    details: string,
    outcome: string,
  ): Promise<void> => {
    try {
      await recordCommandLog({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        username: interaction.user.tag,
        command,
        details,
        outcome,
      });
    } catch (error) {
      logger.error(
        { err: error, command, userId: interaction.user.id },
        "Discord command audit log failed",
      );
    }
  };

  const denyInteraction = async (
    interaction: ChatInputCommandInteraction,
    reason: string,
  ): Promise<void> => {
    await auditInteraction(
      interaction,
      interaction.commandName,
      `reason=${reason}`,
      "denied",
    );
    await interaction.reply({ content: reason, ephemeral: true });
  };

  const canUseBot = async (
    interaction: ChatInputCommandInteraction,
  ): Promise<boolean> => {
    if (!interaction.guildId) {
      await denyInteraction(
        interaction,
        "Bot commands can only be used inside a server.",
      );
      return false;
    }

    const isAdministrator =
      interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ??
      false;
    const isAdministrationCommand = ["whitelist", "blacklist", "logs"].includes(
      interaction.commandName,
    );

    if (isAdministrationCommand && !isAdministrator) {
      await denyInteraction(
        interaction,
        "Only server administrators can use this command.",
      );
      return false;
    }

    if (isAdministrator || isAdministrationCommand) {
      return true;
    }

    try {
      const access = await getUserAccess(
        interaction.guildId,
        interaction.user.id,
      );

      if (access === "blacklist") {
        await denyInteraction(
          interaction,
          "You are blacklisted from using this bot.",
        );
        return false;
      }

      if (access !== "whitelist") {
        await denyInteraction(
          interaction,
          "You are not authorized to use this bot. Ask a server administrator to whitelist you.",
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        { err: error, userId: interaction.user.id },
        "Discord command access check failed",
      );
      await denyInteraction(
        interaction,
        "I couldn't verify your bot access right now. Please try again.",
      );
      return false;
    }
  };

  const manageAccess = async (
    interaction: ChatInputCommandInteraction,
    accessType: AccessType,
  ): Promise<void> => {
    const subcommand = interaction.options.getSubcommand();
    const actionName = `${accessType} ${subcommand}`;

    if (subcommand === "list") {
      const rules = await listAccessRules(interaction.guildId!, accessType);
      const label = accessType === "whitelist" ? "whitelisted" : "blacklisted";
      const content =
        rules.length === 0
          ? `No users are currently ${label}.`
          : rules
              .map((rule) => `<@${rule.userId}> (${rule.username})`)
              .join("\n");

      await auditInteraction(
        interaction,
        actionName,
        `count=${rules.length}`,
        "success",
      );
      await interaction.reply({
        content: `**${accessType === "whitelist" ? "Whitelist" : "Blacklist"}**\n${content}`,
        ephemeral: true,
      });
      return;
    }

    const user = interaction.options.getUser("user", true);

    if (subcommand === "add") {
      await setAccessRule({
        guildId: interaction.guildId!,
        userId: user.id,
        username: user.tag,
        accessType,
        updatedByUserId: interaction.user.id,
      });
      await auditInteraction(
        interaction,
        actionName,
        `target=${user.id} (${user.tag})`,
        "success",
      );
      await interaction.reply({
        content:
          accessType === "whitelist"
            ? `${user} can now use the bot in this server.`
            : `${user} is now blocked from using the bot in this server.`,
        ephemeral: true,
      });
      return;
    }

    await removeAccessRule({
      guildId: interaction.guildId!,
      userId: user.id,
      accessType,
    });
    await auditInteraction(
      interaction,
      actionName,
      `target=${user.id} (${user.tag})`,
      "success",
    );
    await interaction.reply({
      content:
        accessType === "whitelist"
          ? `${user} was removed from the whitelist.`
          : `${user} was removed from the blacklist.`,
      ephemeral: true,
    });
  };

  const showLogs = async (
    interaction: ChatInputCommandInteraction,
  ): Promise<void> => {
    const limit = interaction.options.getInteger("limit") ?? 10;
    await auditInteraction(interaction, "logs", `limit=${limit}`, "success");

    const rows = await getCommandLogs(interaction.guildId!, limit);
    if (rows.length === 0) {
      await interaction.reply({
        content: "No bot usage has been logged for this server yet.",
        ephemeral: true,
      });
      return;
    }

    const lines = rows.map((row) => {
      const timestamp = row.createdAt.toISOString().replace("T", " ").slice(0, 19);
      const channel = row.channelId ? `<#${row.channelId}>` : "no channel";
      const details = row.details.replaceAll("`", "'");
      return `${timestamp} — <@${row.userId}> — \`/${row.command}\` — ${channel} — ${row.outcome} — ${details}`;
    });
    const fullContent = `**Recent bot usage**\n${lines.join("\n")}`;
    const content =
      fullContent.length > 1_900
        ? `${fullContent.slice(0, 1_897)}...`
        : fullContent;

    await interaction.reply({ content, ephemeral: true });
  };

  const registerCommands = async (): Promise<void> => {
    if (!client.user) {
      throw new Error("Discord client is not ready while registering commands.");
    }

    const rest = new REST({ version: "10" }).setToken(token);
    const route = Routes.applicationCommands(client.user.id);

    await rest.put(route, {
      body: [
        typeCommand.toJSON(),
        stopCommand.toJSON(),
        singleCommand.toJSON(),
        dmCommand.toJSON(),
        whitelistCommand.toJSON(),
        blacklistCommand.toJSON(),
        logsCommand.toJSON(),
      ],
    });

    logger.info(
      { registrationScope: "global" },
      "Discord slash commands registered",
    );
  };

  client.once(Events.ClientReady, async (readyClient) => {
    readyClient.user.setPresence({
      activities: [
        {
          name: "currently esexing @cfq",
          type: ActivityType.Playing,
        },
      ],
      status: "online",
    });

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

    if (!(await canUseBot(interaction))) {
      return;
    }

    if (interaction.commandName === "type") {
      const requestedMessage = interaction.options.getString("message");
      const targetChannel = interaction.options.getChannel("channel", true);
      const messages = requestedMessage
        ? [requestedMessage]
        : DEFAULT_TYPE_MESSAGES;

      if (!("send" in targetChannel) || typeof targetChannel.send !== "function") {
        await interaction.reply({
          content: "That channel cannot receive automated messages.",
          ephemeral: true,
        });
        return;
      }

      const alreadyRunning = !startTyping(messages, targetChannel.id);

      await auditInteraction(
        interaction,
        "type",
        `channel=${targetChannel.id}; messages=${messages
          .map(describeMessage)
          .join(", ")}`,
        alreadyRunning ? "already-running" : "started",
      );
      await replyToTypeCommand(
        interaction,
        messages.length,
        alreadyRunning,
        targetChannel.id,
      );
      return;
    }

    if (interaction.commandName === "stop") {
      const wasRunning = stopTyping();
      const content = wasRunning
        ? "Typing stopped. No more repeating messages will be sent."
        : "Typing is not currently running.";

      await auditInteraction(
        interaction,
        "stop",
        `wasRunning=${wasRunning}`,
        "success",
      );
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "single") {
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel", true);

      if (!("send" in channel) || typeof channel.send !== "function") {
        await interaction.reply({
          content: "That channel cannot receive messages.",
          ephemeral: true,
        });
        return;
      }

      try {
        await channel.send(message);
        await auditInteraction(
          interaction,
          "single",
          `channel=${channel.id}; message=${describeMessage(message)}`,
          "sent",
        );
        await interaction.reply({
          content: `Message sent to <#${channel.id}>.`,
          ephemeral: true,
        });
        logger.info({ channelId: channel.id }, "Discord single message sent");
      } catch (error) {
        await auditInteraction(
          interaction,
          "single",
          `channel=${channel.id}; message=${describeMessage(message)}`,
          "failed",
        );
        logger.error(
          { err: error, channelId: channel.id },
          "Discord single message failed",
        );

        await interaction.reply({
          content:
            "I couldn't send that message. Check that I can view and send messages in the selected channel.",
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.commandName === "dm") {
      const recipient = interaction.options.getUser("user", true);
      const message = interaction.options.getString("message", true);

      try {
        await recipient.send(message);
        await auditInteraction(
          interaction,
          "dm",
          `recipient=${recipient.id} (${recipient.tag}); message=${describeMessage(message)}`,
          "sent",
        );
        await interaction.reply({
          content: `Direct message sent to ${recipient}.`,
          ephemeral: true,
        });
        logger.info({ recipientId: recipient.id }, "Discord direct message sent");
      } catch (error) {
        await auditInteraction(
          interaction,
          "dm",
          `recipient=${recipient.id} (${recipient.tag}); message=${describeMessage(message)}`,
          "failed",
        );
        logger.error(
          { err: error, recipientId: recipient.id },
          "Discord direct message failed",
        );

        await interaction.reply({
          content:
            "I couldn't send that direct message. The user may have DMs disabled or may have blocked the bot.",
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.commandName === "whitelist") {
      await manageAccess(interaction, "whitelist");
      return;
    }

    if (interaction.commandName === "blacklist") {
      await manageAccess(interaction, "blacklist");
      return;
    }

    if (interaction.commandName === "logs") {
      await showLogs(interaction);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !client.user || !message.guildId) {
      return;
    }

    const wasMentioned = message.mentions.users.has(client.user.id);
    let wasRepliedTo = false;

    if (message.reference?.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        wasRepliedTo = referencedMessage.author.id === client.user.id;
      } catch (error) {
        logger.warn(
          { err: error, messageId: message.id },
          "Could not inspect referenced Discord message",
        );
      }
    }

    if (!wasMentioned && !wasRepliedTo) {
      return;
    }

    try {
      const isAdministrator =
        message.member?.permissions.has(PermissionsBitField.Flags.Administrator) ??
        false;
      const access = isAdministrator
        ? "administrator"
        : await getUserAccess(message.guildId, message.author.id);

      if (!isAdministrator && access !== "whitelist") {
        await recordCommandLog({
          guildId: message.guildId,
          channelId: message.channelId,
          userId: message.author.id,
          username: message.author.tag,
          command: "auto-reply",
          details: `trigger=${wasMentioned ? "mention" : "reply"}`,
          outcome: "denied",
        });
        return;
      }

      const response = generateRandomReply();
      await message.reply({
        content: response,
        allowedMentions: { repliedUser: false },
      });
      await recordCommandLog({
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
        username: message.author.tag,
        command: "auto-reply",
        details: `trigger=${wasMentioned ? "mention" : "reply"}; response=${describeMessage(response)}`,
        outcome: "sent",
      });
      logger.info({ messageId: message.id }, "Discord automatic mention reply sent");
    } catch (error) {
      logger.error(
        { err: error, messageId: message.id },
        "Discord automatic mention reply failed",
      );
    }
  });

  await client.login(token);
}