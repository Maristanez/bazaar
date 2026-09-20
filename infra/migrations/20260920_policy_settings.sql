-- Owner settings beyond the floor (SPEC §4.4.1): discount cap, max rounds, lowball cutoff, tone, firm-price products.
-- Until this is applied the server keeps settings in memory and retries policy reads and writes without the column.
alter table policies add column if not exists settings jsonb not null default '{}'::jsonb;
