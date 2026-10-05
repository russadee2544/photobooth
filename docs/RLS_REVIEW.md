# RLS review (2026-10-05)

Reviewed from the repository migrations only: the Supabase MCP connector was refused
read access to the live project, so the live state may differ. Run the checks at the
bottom against production before relying on this.

## Closed by `20261005100000_close_legacy_anon_access.sql`
| Table | Problem | Fix |
|---|---|---|
| `kiosk_sessions` | anon could read every customer's photo URLs and update any row | insert-only for clients, insert validated (mode, URL prefix, length); admin counts via `kiosk_session_counts()` |
| `redeem_usage` | anon insert/select policies | all client access removed |
| `redeem_codes` | already revoked in `20260811104603`; policies left over | policies dropped, revoke repeated |

## Applied to production 2026-10-05 (verified with the anon key)
Migrations 20261005090000, 20261005100000, 20261005110000 were pushed with the Supabase CLI.
- anon can no longer read kiosk_sessions (42501) and cannot list the 'photobooth' bucket (the "Allow public reads" policy was dropped; public photo URLs still return 200).
- anon can still call kiosk_session_counts() (returns 9 redeem / 23 event at the time).

## Still open (not fixed here)
1. **Public bucket 'photobooth' accepts anonymous uploads** (policy "Allow public uploads", INSERT only; there is no UPDATE/DELETE policy so existing files cannot be overwritten). Anyone with the public anon key can upload junk files. Proper fix: send photos through an Edge Function (ticket like 'session-gif') into the private bucket and drop the anon insert policy. Not done yet.
2. **`custom_themes`**: anon select + insert (admin theme builder uses the anon key). Anyone can
   add theme rows. Fix needs the admin theme save to go through an admin-capability Edge Function.
3. **`transactions` and `debts`** are open to anon for all operations (`20260806064633`). They belong to
   a separate cafe-finance app sharing this database, so they were left alone. Anyone with the anon key
   (public in `shared.js`) can read and edit that data. Move that app to its own project or add auth.
4. `layout_sizes`: select-only for anon already; the admin save in `shared.js` (POST) fails by design.

## Checks to run on production
```sql
-- tables with anon/authenticated privileges
select table_name, grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated') group by 1,2 order by 1;
-- policies on storage objects
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
```
