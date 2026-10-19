-- B.A.S.E – Supabase-Schema
-- Im Supabase-Dashboard: SQL Editor -> New query -> alles einfügen -> Run.
-- Mehrfaches Ausführen ist unschädlich (idempotent).
-- Jede Zeile gehört einem Benutzer (user_id); Row Level Security erlaubt nur den Zugriff auf eigene Zeilen.

create table if not exists public.base_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  goal       text,
  notes      jsonb not null default '{}'::jsonb,   -- Monatsnotizen {YYYYMM: text}
  rec_skip   jsonb not null default '{}'::jsonb,   -- übersprungene wiederkehrende Buchungen
  moves      jsonb not null default '[]'::jsonb,   -- Verschiebe-Verlauf
  payees     jsonb not null default '[]'::jsonb,
  pins       jsonb not null default '[]'::jsonb,   -- angeheftete Kategorien
  i18n       int,
  rev        bigint not null default 0,            -- Zeitstempel der letzten Änderung (Konfliktabgleich)
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null default '',
  pos int not null default 0,
  extra jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.category_groups (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null default '',
  pos int not null default 0,
  extra jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.categories (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  group_id text not null,
  name text not null default '',
  emoji text,
  target numeric(14,2) not null default 0,
  tt text,                    -- Zieltyp: aside / refill / by
  due jsonb,                  -- Fälligkeit
  snooze jsonb,
  note text,
  hidden boolean not null default false,
  pos int not null default 0,
  extra jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  account_id text,
  tx_date date not null,
  payee text not null default '',
  category_id text,           -- leer = Inflow / Ready to Assign
  memo text not null default '',
  outflow numeric(14,2) not null default 0,
  inflow numeric(14,2) not null default 0,
  cleared boolean not null default false,
  xf text,                    -- Gegenbuchung bei Überweisungen
  sg text,                    -- Split-Gruppe
  extra jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.assignments (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,           -- "kategorieId|YYYYMM"
  category_id text not null,
  ym text not null,
  amount numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.recurring (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists transactions_date_idx on public.transactions (user_id, tx_date);
create index if not exists transactions_cat_idx  on public.transactions (user_id, category_id);
create index if not exists transactions_acc_idx  on public.transactions (user_id, account_id);
create index if not exists assignments_ym_idx    on public.assignments  (user_id, ym);
create index if not exists categories_grp_idx    on public.categories   (user_id, group_id);

-- Row Level Security: jeder sieht und ändert nur seine eigenen Zeilen
do $$
declare t text;
begin
  foreach t in array array['base_settings','accounts','category_groups','categories','transactions','assignments','recurring'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s_own" on public.%1$I', t);
    execute format('create policy "%1$s_own" on public.%1$I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Live-Sync zwischen Geräten (Realtime auf base_settings)
do $$
begin
  alter publication supabase_realtime add table public.base_settings;
exception when duplicate_object then null;
end $$;
