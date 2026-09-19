-- The Bazaar — Supabase schema
--
-- Authority: docs/SPEC.md §5.2 and docs/ARCHITECTURE.md §8.1.
--
-- Three tables, append-only. Everything else — the product mirror from
-- Shopify, negotiations, live offers, pending approvals, the Console feed —
-- lives in the server's memory behind the same `db.ts` interface and is lost
-- on restart, by design (ARCHITECTURE §8.2). Seed products are read from
-- `infra/seed/products.json`, not from here.
--
-- Trust boundary (SPEC §5.2; AGENTS.md invariants 3 and 6):
--   * The browser never queries these tables. Its bundle carries the anon key
--     and nothing else, and the anon key can do nothing except sign in.
--   * The owner signs in as a Supabase Auth user. The Console sends that
--     Bearer token to the Bazaar server, which verifies it and performs every
--     read and write itself with SUPABASE_SERVICE_ROLE_KEY (server only).
--   * Row Level Security is ON for every table with no public policies, so a
--     leaked anon or authenticated token reaches nothing.
--
-- Money is integer cents throughout, and the `deals` columns mirror the
-- `Deal` type in packages/contracts column for column.
--
-- Re-runnable: every statement is guarded and both seeds are idempotent, so
-- pasting this file twice is harmless. To reset instead, uncomment the drop
-- below — it destroys every recorded deal.

begin;

-- drop table if exists deals, policies, merchants cascade;

-- ---------------------------------------------------------------------------
-- merchants — one row for the demo store
-- ---------------------------------------------------------------------------

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid unique references auth.users(id) on delete restrict,
  shop_domain text not null
);

comment on column merchants.owner_user_id is
  'The Supabase Auth user allowed to reach the Console. Null until the owner user is created in the dashboard — see the end of this file.';

-- ---------------------------------------------------------------------------
-- policies — append-only owner policy history
-- ---------------------------------------------------------------------------

create table if not exists policies (
  -- `id` is the one column beyond SPEC §5.2's list: the table needs a primary
  -- key, and it breaks the tie when two rows share `updated_at`.
  id bigint generated always as identity primary key,
  merchant_id uuid not null references merchants(id) on delete restrict,
  floor_pct numeric(5,2) not null check (floor_pct >= 0 and floor_pct <= 60),
  ask_owner boolean not null default true,
  paused boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table policies is
  'Append-only. Adopt and PAUSE each insert a new row; the latest row is the live policy and the rest is history. Never UPDATE a row here.';
comment on column policies.floor_pct is
  'Percent over cost, matching the Console floor slider (cost + 0-60%, SPEC §4.4).';

create index if not exists policies_latest_idx
  on policies (merchant_id, updated_at desc, id desc);

-- ---------------------------------------------------------------------------
-- deals — one immutable row per minted Shopify discount code
-- ---------------------------------------------------------------------------

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete restrict,
  offer_id text not null unique,
  surface text not null check (surface in ('storefront', 'chatgpt')),
  items_json jsonb not null check (jsonb_typeof(items_json) = 'array'),
  list_total integer not null check (list_total >= 0),
  agreed_total integer not null check (agreed_total > 0),
  cost integer not null check (cost >= 0),
  floor integer not null check (floor >= 0),
  profit integer generated always as (agreed_total - cost) stored,
  owner_approved boolean not null default false,
  code text not null unique,
  created_at timestamptz not null default now(),

  -- AGENTS.md invariant 2, enforced by the database rather than trusted from
  -- the pipeline: every minted deal is above cost, and below the owner's
  -- floor only with an owner approval on record.
  check (agreed_total > cost),
  check (agreed_total >= floor or owner_approved)
);

comment on table deals is
  'The record of settlements. Written once, after the code is minted; never updated.';
comment on column deals.cost is
  'Cost in cents as the Auditor saw it, so the §7 verifier can recount breaches without trusting the pipeline.';
comment on column deals.floor is
  'Floor in cents as the Auditor saw it. Same reason as `cost`.';
comment on column deals.profit is
  'Generated from agreed_total - cost, so it can never drift. `db.ts` must OMIT this column on insert — Postgres rejects a written value.';
comment on column deals.offer_id is
  'Unique: one deal per offer, so an expired-offer replay cannot mint twice.';
comment on column deals.code is
  'Unique: a minted Shopify code is recorded against exactly one deal.';

create index if not exists deals_merchant_created_idx
  on deals (merchant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access control — RLS on, no public policies (SPEC §5.2)
-- ---------------------------------------------------------------------------

alter table merchants enable row level security;
alter table policies  enable row level security;
alter table deals     enable row level security;

-- No policies are created, deliberately: no browser role reaches any row.
revoke all on table merchants, policies, deals from anon, authenticated;
grant all on table merchants, policies, deals to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

-- One store, one instance (SPEC §5). The id is fixed so the server can hold
-- it as a constant instead of looking it up on every write.
insert into merchants (id, shop_domain)
values ('00000000-0000-4000-8000-000000000001', 'trailhead-co.myshopify.com')
on conflict (id) do nothing;

-- Opening policy: floor 25%, ask-owner on, not paused (SPEC Appendix A).
insert into policies (merchant_id, floor_pct, ask_owner, paused)
select '00000000-0000-4000-8000-000000000001', 25, true, false
where not exists (select 1 from policies);

commit;

-- ---------------------------------------------------------------------------
-- After this file, in the dashboard: create the owner user (Auth settings →
-- email confirmation OFF), then run these two with the real values.
-- ---------------------------------------------------------------------------
-- update merchants set owner_user_id = '<the auth user uuid>'
--   where id = '00000000-0000-4000-8000-000000000001';
-- update merchants set shop_domain = '<your-store>.myshopify.com'
--   where id = '00000000-0000-4000-8000-000000000001';
