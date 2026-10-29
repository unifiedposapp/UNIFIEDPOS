# Prisma Migrations

This folder holds the **version-controlled migration history** that makes schema
changes safe and repeatable in production (the container entrypoint runs
`prisma migrate deploy` on boot).

There are ten migrations, from `20260907000000_init` to
`20261028130000_platform_billing`. They have been applied in order to an empty
PostgreSQL database and the result diffs empty against `schema.prisma`, so a fresh
volume reaches the current schema with `migrate deploy` alone — no baseline step,
no `db push`.

`prisma db push` remains a fast local loop, but a database built that way has no
history and will not match a deployed one. Prefer `db:migrate` in development so
this folder keeps describing the database.

## Checking for drift

Run from `packages/server`. An empty migration means the migrations and the schema
agree; anything else is a schema change that was never turned into a migration.

```powershell
npx prisma migrate diff --from-url $env:DATABASE_URL `
  --to-schema-datamodel prisma/schema.prisma --script
```

## Encoding

Migration files **must be UTF-8**. A `migration.sql` saved as UTF-16LE makes
`migrate deploy` stop with P3015 ("could not find the migration file"), which looks
like a missing file rather than a bad encoding.

## Day-to-day workflow

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
