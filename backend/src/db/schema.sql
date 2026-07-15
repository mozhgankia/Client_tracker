-- Supabase (Postgres) schema for the multi-tenant real estate platform.
-- Designed to stay comfortably under the free-tier 500MB limit:
--   * no raw chat transcripts or media are stored here (only extracted fields)
--   * WhatsApp auth keys are the only "blob-shaped" data, and Baileys prunes old
--     pre-keys/sessions itself, so this table stays small per active session
--   * indexes are limited to columns actually queried by the backend

create extension if not exists "uuid-ossp";

-- One row per agent/tenant using the platform.
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- Buyer/tenant-side contacts, scoped to a tenant (user_id).
create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  phone text not null,
  type text,               -- residential | commercial
  subtype text,            -- presale | ready
  potential text,          -- high | medium | low
  status text,
  first_message_at date,
  last_follow_up_at date,
  created_at timestamptz not null default now()
);
create index if not exists customers_user_idx on customers(user_id);
create index if not exists customers_phone_idx on customers(phone);

-- Primary (developer) + secondary (owner-resale) listings, scoped to a tenant.
create table if not exists properties (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null,       -- primary | secondary
  sub_category text,            -- presale | ready | rent (secondary only)
  delivery_status text,         -- presale | ready (primary only)
  title text not null,
  location text,
  area_sqft numeric,
  price numeric,
  description text,
  owner_phone text,
  owner_contact_platform text,  -- whatsapp | telegram
  drive_folder_link text,
  developer_name text,
  priority int,
  created_at timestamptz not null default now()
);
create index if not exists properties_user_idx on properties(user_id);
create index if not exists properties_owner_phone_idx on properties(owner_phone);

-- One row per tenant's live WhatsApp connection. `auth_creds` holds the Baileys
-- credential blob; `auth_keys` holds the many small signal-protocol key
-- records (pre-keys, sessions, sender keys, app-state sync keys). Keeping
-- keys in their own JSONB column (rather than one row per key) avoids
-- unbounded row growth as Baileys rotates keys.
create table if not exists whatsapp_sessions (
  user_id uuid primary key references users(id) on delete cascade,
  auth_creds jsonb,
  auth_keys jsonb not null default '{}'::jsonb,
  connected boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Telegram: one MTProto (GramJS) session string per tenant, since GramJS
-- monitors the tenant's own account (groups/channels), not a bot.
create table if not exists telegram_sessions (
  user_id uuid primary key references users(id) on delete cascade,
  session_string text,
  updated_at timestamptz not null default now()
);

-- Leads extracted from Telegram (or WhatsApp) messages by the AI pipeline.
-- One row per distinct (phone/telegram id + property) combination, mirroring
-- the compound-key dedup already used for WhatsApp new-leads.
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null,           -- telegram | whatsapp
  source_chat_id text,
  sender_name text,
  phone text,
  telegram_id text,
  role text,                      -- owner | client | unknown
  request_type text,              -- buy | sell | rent | mortgage
  bedrooms int,
  area_sqft numeric,
  region text,
  listed_price numeric,
  parking boolean,
  raw_message text,
  status text not null default 'new', -- new | added | dismissed
  created_at timestamptz not null default now()
);
create index if not exists leads_user_idx on leads(user_id);
create index if not exists leads_phone_idx on leads(phone);
