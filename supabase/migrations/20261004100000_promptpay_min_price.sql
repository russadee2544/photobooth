-- Stripe's minimum charge for THB is 10.00 (docs.stripe.com/currencies), so
-- offers may start at 1000 satang instead of the earlier 2000 guess.
alter table public.booth_pass_offers drop constraint booth_pass_offers_price_minor_check;
alter table public.booth_pass_offers add constraint booth_pass_offers_price_minor_check
  check (price_minor >= 1000);
