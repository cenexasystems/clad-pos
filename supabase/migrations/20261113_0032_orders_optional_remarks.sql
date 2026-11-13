-- ====================================================================
-- Migration 0032: orders.remarks and orders.reference_number may be empty (NULL)
-- The POS sale function inserts NULL when the cashier leaves them blank, but migration 0011
-- made both columns NOT NULL, so on a database built from the migration files every sale failed
-- with: null value in column "remarks" violates not-null constraint.
-- Safe to run on a database where they are already nullable.
-- ====================================================================

ALTER TABLE public.orders ALTER COLUMN remarks DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN reference_number DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
