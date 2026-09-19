-- The Bazaar database schema
--
-- Scope:
--   * One store and one owner for the Hack the North demo.
--   * Supabase is used as PostgreSQL only. Owner authentication is handled by
--     the Bazaar server with CONSOLE_PASSWORD and a signed HTTP-only cookie.
--   * The fake Shopify-style storefront reads products and variants through
--     the Bazaar server.
--   * Products can optionally map to real Shopify products and variants. Only
--     mapped variants can be settled into a real Shopify Checkout.
--   * Successful and unsuccessful negotiations are retained as future
--     training data.
--   * All money values are integer cents. The demo currency is CAD.
--
-- Security boundary:
--   Browser clients never query these tables directly. The Bazaar server is
--   the only database client and uses SUPABASE_SERVICE_ROLE_KEY. Row Level
--   Security is enabled with no public policies.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Catalog for the fake storefront
-- ---------------------------------------------------------------------------

create table products (
  id text primary key,
  shopify_product_id text unique,
  source text not null default 'local'
    check (source in ('local', 'shopify')),
  handle text not null unique,
  title text not null,
  description text not null default '',
  product_type text not null,
  image_url text not null default '',
  is_add_on boolean not null default false,
  agent_facts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(agent_facts) = 'array'),
  active boolean not null default true,
  stocked_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table products is
  'Products displayed by the fake storefront and read by the Bazaar server.';
comment on column products.shopify_product_id is
  'Optional mapping to a real Shopify product. Null means local demo data only.';
comment on column products.agent_facts is
  'Safe product facts the agent may use as reasons. Never store cost or floor data here.';

create table variants (
  id text primary key,
  product_id text not null references products(id) on delete restrict,
  shopify_variant_id text unique,
  sku text,
  title text not null,
  size text,
  price_cents integer not null check (price_cents > 0),
  unit_cost_cents integer check (
    unit_cost_cents is null or unit_cost_cents >= 0
  ),
  inventory_quantity integer not null default 0
    check (inventory_quantity >= 0),
  currency text not null default 'CAD'
    check (currency = 'CAD'),
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table variants is
  'Sellable sizes and variations. Price, cost, and inventory belong to a variant.';
comment on column variants.shopify_variant_id is
  'Required for a real Shopify discount code and Checkout. Null means fake storefront only.';
comment on column variants.unit_cost_cents is
  'Owner-only cost in cents. A missing cost makes the variant unavailable for offers.';

create index variants_product_id_idx on variants(product_id);
create index variants_active_idx on variants(active);

-- ---------------------------------------------------------------------------
-- Append-only owner policy history
-- ---------------------------------------------------------------------------

create table policy_versions (
  id bigint generated always as identity primary key,
  floor_pct smallint not null check (floor_pct between 0 and 60),
  ask_owner boolean not null default true,
  paused boolean not null default false,
  change_reason text not null
    check (change_reason in ('seed', 'adopt', 'pause', 'resume')),
  created_at timestamptz not null default now()
);

comment on table policy_versions is
  'Append-only policy history. The newest row is the current policy.';
comment on column policy_versions.floor_pct is
  'Percentage over cost, for example 25 means cost plus 25 percent.';

create index policy_versions_created_at_idx
  on policy_versions(created_at desc);

-- Default demo policy from the product specification.
insert into policy_versions (floor_pct, ask_owner, paused, change_reason)
values (25, true, false, 'seed');

-- ---------------------------------------------------------------------------
-- Negotiation summaries and ordered event history
-- ---------------------------------------------------------------------------

create table negotiations (
  id text primary key,
  surface text not null
    check (surface in ('storefront', 'chatgpt')),
  shopper_id text not null,
  primary_product_id text references products(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'settled', 'walked', 'abandoned')),
  current_round smallint not null default 0
    check (current_round between 0 and 4),
  asked_owner boolean not null default false,
  backboard_thread_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table negotiations is
  'One summary row for every successful and unsuccessful negotiation.';
comment on column negotiations.status is
  'Blocked attempts are events, not terminal negotiation states.';

create index negotiations_shopper_id_idx on negotiations(shopper_id);
create index negotiations_status_idx on negotiations(status);
create index negotiations_started_at_idx on negotiations(started_at desc);

create table negotiation_events (
  id bigint generated always as identity primary key,
  negotiation_id text not null
    references negotiations(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  kind text not null
    check (
      kind in (
        'message',
        'decision',
        'offer_state',
        'approval',
        'blocked',
        'settlement'
      )
    ),
  actor text not null
    check (actor in ('shopper', 'agent', 'owner', 'system')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (negotiation_id, sequence_number)
);

comment on table negotiation_events is
  'Ordered event stream retained for audit, analytics, and future training.';
comment on column negotiation_events.payload is
  'A snapshot of the event at that time. Private cost, floor, menu, and reasoning data stay server-only.';

create index negotiation_events_negotiation_id_idx
  on negotiation_events(negotiation_id, sequence_number);
create index negotiation_events_kind_idx on negotiation_events(kind);
create index negotiation_events_created_at_idx
  on negotiation_events(created_at desc);

-- ---------------------------------------------------------------------------
-- Successful Shopify settlement ledger
-- ---------------------------------------------------------------------------

create table deals (
  id uuid primary key default gen_random_uuid(),
  negotiation_id text not null unique
    references negotiations(id) on delete restrict,
  offer_id text not null unique,
  policy_version_id bigint references policy_versions(id) on delete restrict,
  surface text not null
    check (surface in ('storefront', 'chatgpt')),
  items_json jsonb not null
    check (jsonb_typeof(items_json) = 'array'),
  list_total_cents integer not null check (list_total_cents >= 0),
  agreed_total_cents integer not null check (agreed_total_cents > 0),
  cost_cents integer not null check (cost_cents >= 0),
  floor_cents integer not null check (floor_cents >= 0),
  profit_cents integer generated always as
    (agreed_total_cents - cost_cents) stored,
  owner_approved boolean not null default false,
  approval_event_id bigint
    references negotiation_events(id) on delete restrict,
  discount_code text not null unique,
  checkout_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (agreed_total_cents <= list_total_cents),
  check (agreed_total_cents > cost_cents),
  check (agreed_total_cents >= floor_cents or owner_approved),
  check (not owner_approved or approval_event_id is not null)
);

comment on table deals is
  'One immutable financial audit row after a Shopify discount code is minted.';
comment on column deals.items_json is
  'Historical snapshot of variant IDs, titles, sizes, quantities, and list values.';

create index deals_created_at_idx on deals(created_at desc);

-- ---------------------------------------------------------------------------
-- Supabase access control
-- ---------------------------------------------------------------------------

alter table products enable row level security;
alter table variants enable row level security;
alter table policy_versions enable row level security;
alter table negotiations enable row level security;
alter table negotiation_events enable row level security;
alter table deals enable row level security;

-- No RLS policies are intentionally created. Browser roles have no direct
-- access. The server uses the Supabase service role for all database work.
revoke all on table products from anon, authenticated;
revoke all on table variants from anon, authenticated;
revoke all on table policy_versions from anon, authenticated;
revoke all on table negotiations from anon, authenticated;
revoke all on table negotiation_events from anon, authenticated;
revoke all on table deals from anon, authenticated;

grant all on table products to service_role;
grant all on table variants to service_role;
grant all on table policy_versions to service_role;
grant all on table negotiations to service_role;
grant all on table negotiation_events to service_role;
grant all on table deals to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
