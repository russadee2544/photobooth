-- Packages (2 prints 19 THB, 5 prints 35 THB, unlimited) print ONE slip per print, not two.
begin;

alter table public.booth_packages drop constraint if exists booth_packages_check;
alter table public.booth_packages add constraint booth_packages_prints_per_set_check check (
  (booth_kind = 'receipt' and prints_per_set in (1, 2))
  or (booth_kind = 'photo' and prints_per_set > 0)
);

update public.booth_packages set prints_per_set = 1, updated_at = now() where booth_kind = 'receipt';

-- Codes already made (not yet used up) follow the new rule too.
update public.redeem_print_passes set copies_per_print = 1 where copies_per_print <> 1;

commit;
