import { and, desc, eq } from "drizzle-orm";
import {
  db,
  discordBotAccessTable,
  discordBotLogsTable,
} from "@workspace/db";

export type AccessType = "whitelist" | "blacklist";

export type CommandLogInput = {
  guildId: string | null;
  channelId: string | null;
  userId: string;
  username: string;
  command: string;
  details: string;
  outcome: string;
};

export async function recordCommandLog(input: CommandLogInput): Promise<void> {
  await db.insert(discordBotLogsTable).values(input);
}

export async function getCommandLogs(guildId: string, limit: number) {
  return db
    .select()
    .from(discordBotLogsTable)
    .where(eq(discordBotLogsTable.guildId, guildId))
    .orderBy(desc(discordBotLogsTable.createdAt))
    .limit(limit);
}

export async function setAccessRule(input: {
  guildId: string;
  userId: string;
  username: string;
  accessType: AccessType;
  updatedByUserId: string;
}): Promise<void> {
  await db
    .insert(discordBotAccessTable)
    .values(input)
    .onConflictDoUpdate({
      target: [discordBotAccessTable.guildId, discordBotAccessTable.userId],
      set: {
        username: input.username,
        accessType: input.accessType,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      },
    });
}

export async function removeAccessRule(input: {
  guildId: string;
  userId: string;
  accessType: AccessType;
}): Promise<void> {
  await db
    .delete(discordBotAccessTable)
    .where(
      and(
        eq(discordBotAccessTable.guildId, input.guildId),
        eq(discordBotAccessTable.userId, input.userId),
        eq(discordBotAccessTable.accessType, input.accessType),
      ),
    );
}

export async function listAccessRules(
  guildId: string,
  accessType: AccessType,
) {
  return db
    .select()
    .from(discordBotAccessTable)
    .where(
      and(
        eq(discordBotAccessTable.guildId, guildId),
        eq(discordBotAccessTable.accessType, accessType),
      ),
    )
    .orderBy(desc(discordBotAccessTable.updatedAt));
}

export async function getUserAccess(
  guildId: string,
  userId: string,
): Promise<AccessType | null> {
  const rows = await db
    .select({ accessType: discordBotAccessTable.accessType })
    .from(discordBotAccessTable)
    .where(
      and(
        eq(discordBotAccessTable.guildId, guildId),
        eq(discordBotAccessTable.userId, userId),
      ),
    )
    .limit(1);

  const accessType = rows[0]?.accessType;
  return accessType === "whitelist" || accessType === "blacklist"
    ? accessType
    : null;
}