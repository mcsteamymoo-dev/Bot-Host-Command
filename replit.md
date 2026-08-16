# Discord Type Bot

An always-on Discord bot that registers a `/type` slash command and sends queued messages to a configured channel at a controlled pace.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secret: `DISCORD_BOT_TOKEN`
- Required shared variables: `DISCORD_CHANNEL_ID`, `DISCORD_GUILD_ID`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Discord bot runtime: `artifacts/api-server/src/discord-bot.ts`
- HTTP health endpoint: `artifacts/api-server/src/routes/health.ts`

## Architecture decisions

- The Discord bot runs alongside the existing API server so one hosted service keeps both processes alive.
- The `/type` command uses a FIFO queue and waits five seconds between successful sends.
- The bot token is read only from Replit Secrets; destination configuration stays in environment variables.

## Product

- `/type message:<text>` starts repeating one message every five seconds.
- `/type` without a message repeatedly cycles through the five sample messages from the provided script.
- `/stop` stops the active repeating sender.
- `/single message:<text> channel:<channel>` sends one message to the selected channel.
- Slash commands register to the configured guild when `DISCORD_GUILD_ID` is set, otherwise globally.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
