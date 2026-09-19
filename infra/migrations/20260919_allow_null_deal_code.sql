-- List-price settlements do not mint a discount code. Re-running this migration
-- is safe for both fresh and existing deployments.
alter table if exists deals
  alter column code drop not null;
