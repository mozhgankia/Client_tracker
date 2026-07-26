-- Supabase (Postgres) schema for the multi-tenant real estate platform.
-- Designed to stay comfortably under the free-tier 500MB limit:
--   * no raw chat transcripts or media are stored here (only extracted fields)
--   * WhatsApp auth keys are the only "blob-shaped" data, and Baileys prunes old
--     pre-keys/sessions itself, so this table stays small per active session
--   * indexes are limited to columns actually queried by the backend

-- gen_random_uuid() در Postgres 13+ (و Supabase) به‌صورت درون‌ساخت موجود است و به هیچ افزونه‌ای نیاز ندارد.

-- One row per agent/tenant using the platform.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text,
  created_at timestamptz not null default now()
);
-- User-uploaded profile picture, stored as a small downscaled data URL (the
-- frontend shrinks it to ~160px before upload, so this stays a few KB).
alter table users add column if not exists avatar_url text;

-- Buyer/tenant-side contacts, scoped to a tenant (user_id).
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  phone text not null,
  type text,               -- residential | commercial
  subtype text,            -- presale | ready
  potential text,          -- high | medium | low
  status text,
  notes text,              -- free-text interest/responsiveness notes
  first_message_at date,
  last_follow_up_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_user_idx on customers(user_id);
create index if not exists customers_phone_idx on customers(phone);

-- Primary (developer) + secondary (owner-resale) listings, scoped to a tenant.
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  id uuid primary key default gen_random_uuid(),
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
  -- Set once a lead is turned into a real record from the dashboard, so it's
  -- never accidentally added twice and the UI can link back to the result.
  converted_customer_id uuid references customers(id) on delete set null,
  converted_property_id uuid references properties(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_idx on leads(user_id);
create index if not exists leads_phone_idx on leads(phone);
create index if not exists leads_status_idx on leads(status);

-- Where the lead came from: 'direct' = a personal 1:1 chat (buyer/owner keyword
-- classification applies), 'group' = a colleague group / A2A market (personal
-- keyword classification is NOT applied; these feed the A2A board instead).
-- `add column if not exists` so existing databases get it too.
alter table leads add column if not exists context text not null default 'direct';
create index if not exists leads_context_idx on leads(context);

-- Per-tenant classification settings. The intelligent classifier uses these
-- editable keyword lists to decide, without an AI call, whether a contact is
-- an owner (listing/selling) or a client (buying/renting). Empty lists mean
-- "fall back to the app defaults" (see backend/src/db/settings.js).
create table if not exists user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  owner_keywords text[] not null default '{}',
  client_keywords text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Inbox chats: one row per Telegram/WhatsApp conversation the account has, so
-- the "Inbox" mirrors the messenger's own chat list (NOT filtered to real
-- estate). The AI just labels each chat's `role` (owner/client/unknown) so the
-- "clients only" filter works; chats are never hidden for lacking keywords.
-- `role_source` = 'manual' means the user overrode the AI label.
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null,                 -- telegram | whatsapp
  chat_id text not null,                -- messenger's dialog/chat id
  context text not null default 'direct',
  chat_type text,                       -- private | group | channel
  name text,
  phone text,
  telegram_id text,
  last_message text,
  last_message_at timestamptz,
  unread integer not null default 0,
  role text not null default 'unknown', -- owner | client | colleague | unknown
  role_source text not null default 'ai',
  -- Real-Estate AI Engine state (see backend/src/engine/realEstateEngine.js):
  -- `signals` = the contact's accumulated weighted intent scores
  --   {client, owner, colleague, messages}; `confidence` = 0..100 for the
  --   current label; `needs_review` = confidence below the lock threshold;
  --   `extracted` = merged structured values {region, price, area_sqft,
  --   bedrooms, request_type, property_type}.
  signals jsonb not null default '{}'::jsonb,
  confidence integer not null default 0,
  needs_review boolean not null default false,
  extracted jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chats_user_source_chat_uidx on chats(user_id, source, chat_id);
create index if not exists chats_user_source_idx on chats(user_id, source);
-- for databases that created `chats` before these columns existed:
alter table chats add column if not exists chat_type text;
alter table chats add column if not exists unread integer not null default 0;
alter table chats add column if not exists signals jsonb not null default '{}'::jsonb;
alter table chats add column if not exists confidence integer not null default 0;
alter table chats add column if not exists needs_review boolean not null default false;
alter table chats add column if not exists extracted jsonb not null default '{}'::jsonb;

-- Single-use password-reset tokens (emailed to the user). Rows are deleted on
-- use and ignored once expired.
create table if not exists password_resets (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets(user_id);

-- Force Supabase's API layer (PostgREST) to reload its schema cache, so the
-- newly-created tables are visible immediately. Without this you can hit
-- "Could not find the table 'public.users' in the schema cache" for a short
-- while after creating tables. This is a harmless no-op on a plain Postgres
-- that isn't running PostgREST.
notify pgrst, 'reload schema';
