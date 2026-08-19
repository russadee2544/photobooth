# Photobooth Milestone 0 — Baseline Inventory

Captured: 2026-08-11 (Asia/Bangkok)  
Approved plan: `PLAN.md`  
Source repository inspected read-only: `C:\ED TECH\photobooth`  
Writable Codex workspace: `C:\ED  TECH\photobooth`

## Workspace gate

The source repository and writable workspace are different directories (one space versus two spaces in `ED TECH`). No source mutation may start until the actual repository is opened/granted as a writable workspace, or the owner explicitly authorizes a repository migration.

## Git baseline

- Branch: `master`
- HEAD: `021c4c1b6a11bc5ee66ecb30bad72ea1398abac5`
- Remote: `https://github.com/russadee2544/photobooth.git`
- Repository was already dirty before implementation began
- Tracked `node_modules/**` files: 199

Recent commits:

- `021c4c1` — Phase 1 MVP: redeem/filter/58mm/24-hour deletion
- `0312f8e` — branding sync and local custom themes
- `3381022` — PWA assets/service worker
- `dba936a` — camera resolution/zoom
- `e10b960` — Vercel permission fix

## Existing tracked modifications

- `capture.html`
- `home.html`
- `layout.html`
- `package-lock.json`
- `package.json`
- `public/sw.js`
- `retake.html`
- `shared.css`
- Multiple tracked files under `node_modules/**`

The working-tree diff is approximately 2,746 insertions and 288 deletions across 18 tracked files. These changes belong to the user and must be preserved.

## Existing untracked files/directories

- `opencode.json`
- `postcss.config.js`
- `public/dither-worker.js`
- `public/fonts/`
- `supabase/`
- `tailwind.config.js`

## Reproducibility fingerprints

- `package.json`: `A849E95E30174256926384E6BE72DF407058351205EE1236A1414A0680D3AF39`
- `package-lock.json`: `C7532344C656B56A40DB0343C57CF341582EE59358701EA5A6D8AF0456728257`
- `supabase/migrations/001_redeem_admin_rpc.sql`: `B5EF649BF3C2056C061278512B2180E1F11346F14B55C1CC0625B40D21D602F3`

## Supabase baseline

- Supabase project reference observed in the legacy client: `zualrdvvlcoexqrbedhl`
- Repository contains only `supabase/migrations/001_redeem_admin_rpc.sql`
- No `supabase/config.toml`, `.mcp.json`, or local environment file was found
- Supabase CLI is not installed or not on PATH
- Anonymous OpenAPI schema discovery is disabled; the endpoint requires a `service_role` key
- No service-role key was requested or exposed

Legacy runtime references data objects absent from repository migrations:

- `kiosk_sessions`
- `layout_sizes`
- `custom_themes`
- Storage bucket `photobooth`

Legacy security exposure requiring cutover:

- Browser calls privileged RPCs with an anon key
- Legacy migration grants `SECURITY DEFINER` functions to `anon`
- Default Admin PIN seed is `1234`
- Client returns a public Storage object URL
- Client performs direct REST writes to operational tables

## Tooling gate

Before database mutation:

1. Install/configure a current Supabase CLI or authenticated Supabase MCP connection.
2. Export remote tables, columns, constraints, indexes, RLS policies, grants, function overloads, cron jobs, Storage buckets/policies, and Edge Function inventory.
3. Reconcile the remote export with repository migrations.
4. Perform all schema work on a local/test project first; never apply the replacement schema directly to production.

## Confirmed current-documentation constraints

- Edge Functions require a valid Supabase JWT by default; custom device proof-of-possession endpoints must explicitly disable platform JWT verification and authenticate inside the handler.
- Grants determine whether Data API objects are reachable; RLS determines which rows are reachable. Both must be configured.
- Existing projects may grant new public-schema objects/functions broadly by default, so default privileges and every function overload must be audited and revoked explicitly.
- Service-role/secret keys must never be placed in the browser or Android JavaScript bundle.
