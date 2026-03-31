# erc20.build

ERC-20 token creation tool. Turborepo monorepo with Next.js 14 App Router.

## Monorepo Structure

```
erc20-build/
├── turbo.json             # Turborepo task config
├── pnpm-workspace.yaml    # pnpm workspace definition
├── apps/
│   └── web/               # Next.js 14 App Router
├── packages/
│   ├── db/                # Drizzle ORM schema + Neon Postgres connection
│   └── shared/            # Shared TypeScript types and utilities
```

## Commands

All builds go through Turborepo. Use `pnpm turbo` or the root scripts.

```bash
pnpm install                              # Install all dependencies
pnpm turbo build                          # Build everything (turbo-cached)
pnpm turbo dev                            # Run all apps in dev mode
pnpm turbo type-check                     # Type-check everything
pnpm turbo lint                           # Lint everything
pnpm --filter @erc20-build/web dev        # Run web only
pnpm --filter @erc20-build/db db:generate # Generate migration SQL from schema changes
pnpm --filter @erc20-build/db db:migrate  # Apply migrations (CI only for prod)
```

## Coding Conventions

- **TypeScript strict mode** — no `any`, proper types everywhere
- **ESM modules** in all packages — use `.js` extension on relative imports (Next.js is the exception)
- **Named exports** preferred (except Next.js pages/layouts which use default)
- **File naming**: `kebab-case.ts` for files, `PascalCase` for React components
- **Import paths**: `@/` alias in `apps/web`, direct imports in packages (no barrel files)
- **DB columns**: `snake_case` in Drizzle schema — e.g. `user_id`, `created_at`
- **TypeScript**: `camelCase` for variables/types — Drizzle maps automatically via `.$inferSelect`
- **JSONB column keys**: `camelCase` (consumed as TypeScript objects)
- **Env vars**: `SCREAMING_SNAKE_CASE`
- **Drizzle types**: always use `.$inferSelect` / `.$inferInsert` — never write manual type interfaces for DB rows

## Workflow: Spec-Driven Development

For non-trivial changes, **write a spec before writing code**. Get Gareth's approval on the spec, then implement.

### When to write a spec

Write a spec when the change involves any of: new features, schema changes, new integrations, architectural changes, multi-file refactors, or anything with non-obvious design decisions.

Skip the spec for: typo fixes, one-line config changes, simple bug fixes with an obvious cause, copy changes, and dependency updates.

When in doubt, write the spec. It's faster to delete a short spec than to rewrite a bad implementation.

### Spec format

Lightweight markdown in the appropriate `docs/` subdirectory:

| Type | Location | Example |
|---|---|---|
| Feature specs | `docs/features/<name>.md` | `docs/features/token-deploy.md` |
| Integration specs | `docs/integrations/<name>.md` | `docs/integrations/wagmi.md` |
| Architecture decisions | `docs/decisions/<NNN>-<name>.md` | `docs/decisions/001-monorepo-structure.md` |

A spec should include: **Overview** (what and why), **Implementation Plan** (how — files to change, approach), **Edge Cases**, **Testing Requirements**, and **Scope** (in/out).

### Process

1. Write the spec and present it for approval
2. Wait for Gareth's explicit approval before implementing
3. Implement according to the spec
4. Update `docs/README.md` index if you added a new doc

## Hard Rules

- **Never run `db:migrate` against the prod DATABASE_URL** — CI does that automatically on merge to `main`
- **Never use `db:push`** — always `db:generate` + `db:migrate` against a Neon branch
- **Always show generated migration SQL** to Gareth before committing — it's the last review gate
- For destructive schema changes (column drops), explicitly flag: "This drops column X with live data"
