# Prisma Migrations

This folder holds the **version-controlled migration history** that makes schema
changes safe and repeatable in production (the container entrypoint runs
`prisma migrate deploy` on boot).

The project currently bootstraps the schema with `prisma db push` (dev-only, no
history). To move to real migrations, **baseline** the existing database once.

## One-time baseline (existing database created with `db push`)

Run from the repository root. These create an initial migration that matches the
current schema and mark it as already-applied, so `migrate deploy` is a no-op on
your existing database but works on fresh ones.

```powershell
# 1. Create the initial migration folder + SQL from the current schema
#    (Prisma writes migration.sql; the folder name is the migration id).
npx prisma migrate diff `
  --from-empty `
  --to-schema-datamodel packages/server/prisma/schema.prisma `
  --script > packages/server/prisma/migrations/0_init/migration.sql

# 2. Tell Prisma that 0_init is already applied to your existing database.
npx prisma migrate resolve --applied 0_init `
  --schema packages/server/prisma/schema.prisma
```

> On macOS/Linux use `\` line continuations (or a single line) instead of the
> PowerShell backtick. Create the `0_init` directory first if your shell does not
> create it from the redirection.

## Day-to-day workflow (after baselining)

```powershell
# Change schema.prisma, then create + apply a migration in dev:
npm run db:migrate --workspace=packages/server -- --name describe_change

# Inspect pending/applied migrations:
npm run db:migrate:status --workspace=packages/server

# Production / container: apply committed migrations (no dev prompts):
npm run db:deploy --workspace=packages/server
```

## Rules

- **Never edit an applied migration.** Create a new one instead.
- Commit the entire `migrations/` folder to git.
- The container entrypoint runs `migrate deploy` automatically on boot unless
  `SKIP_MIGRATIONS=true` (set that when you run migrations from CI/a one-off job).
- `prisma migrate deploy` only applies migrations; it never resets or prompts,
  which is what you want against production data.
