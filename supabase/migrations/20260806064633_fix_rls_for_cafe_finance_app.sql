-- The cafe dashboard ships with a hardcoded anon key and no auth (single-owner personal tool).
-- RLS was enabled without any policies, so every anon request was denied and all
-- transaction/debt writes silently failed. Grant Data API access and create permissive
-- policies matching the app's existing client-side architecture.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debts TO anon, authenticated;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_app_all_transactions" ON public.transactions;
CREATE POLICY "finance_app_all_transactions"
  ON public.transactions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "finance_app_all_debts" ON public.debts;
CREATE POLICY "finance_app_all_debts"
  ON public.debts
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);;
