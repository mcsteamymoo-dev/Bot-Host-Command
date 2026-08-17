import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const discordBotAccessTable = pgTable(
  "discord_bot_access",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    accessType: text("access_type").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    guildUserUnique: uniqueIndex("discord_bot_access_guild_user_unique").on(
      table.guildId,
      table.userId,
    ),
    guildTypeIndex: index("discord_bot_access_guild_type_idx").on(
      table.guildId,
      table.accessType,
    ),
  }),
);

export const discordBotLogsTable = pgTable(
  "discord_bot_logs",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    command: text("command").notNull(),
    details: text("details").notNull(),
    outcome: text("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    guildCreatedAtIndex: index("discord_bot_logs_guild_created_at_idx").on(
      table.guildId,
      table.createdAt,
    ),
  }),
);