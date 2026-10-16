-- ShiftCentral schema
-- Run in the Supabase SQL editor on the shiftcentral project.
-- Safe to re-run. Additive on top of the Day 2 plants/invites tables.
-- Do not put the service role key in the app. This file uses auth.uid() and RLS.

create extension if not exists pgcrypto;

-- ---------- tables ----------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city text,
  tagline text,
  is_listed boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.organizations add column if not exists city text;
alter table public.organizations add column if not exists tagline text;
alter table public.organizations add column if not exists is_listed boolean not null default true;
alter table public.organizations add column if not exists created_by uuid;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'supervisor', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'supervisor', 'member')),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- operators (plant roster)
create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  crew text,
  role text not null default 'member' check (role in ('admin', 'supervisor', 'member')),
  created_at timestamptz not null default now()
);
alter table public.operators add column if not exists role text not null default 'member';
alter table public.operators enable row level security;
drop policy if exists operators_read on public.operators;
create policy operators_read on public.operators for select using (public.is_org_member(org_id));
drop policy if exists operators_write on public.operators;
create policy operators_write on public.operators for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rotation_patterns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sequence text not null,
  start_date date,
  days integer default 365,
  created_at timestamptz not null default now()
);

-- In case the table already exists without these columns
alter table public.rotation_patterns add column if not exists start_date date;
alter table public.rotation_patterns add column if not exists days integer default 365;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  crew_id uuid references public.crews(id) on delete set null,
  area_id uuid references public.areas(id) on delete set null,
  work_date date not null,
  shift_type text not null check (shift_type in ('day', 'night', 'off', 'ot')),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

alter table public.shifts add column if not exists source text not null default 'manual';

create unique index if not exists shifts_org_user_date_idx
  on public.shifts (org_id, user_id, work_date);

create table if not exists public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists overtime_org_date_idx on public.overtime_entries (org_id, work_date desc);
create index if not exists forum_threads_org_idx on public.forum_threads (org_id, created_at desc);
create index if not exists forum_posts_thread_idx on public.forum_posts (thread_id, created_at);

-- ---------- helpers ----------

create or replace function public.is_org_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = target
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, 'plant')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.create_plant(plant_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
  base text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if length(trim(plant_name)) < 2 then
    raise exception 'Plant name is too short';
  end if;
  base := public.slugify(plant_name);
  if base = '' then base := 'plant'; end if;
  insert into public.organizations (name, slug, created_by, is_listed, tagline)
  values (
    trim(plant_name),
    base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4),
    auth.uid(),
    true,
    'Rotating shifts, overtime, and crew messages.'
  )
  returning * into new_org;
  insert into public.org_members (org_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner');
  return new_org;
end;
$$;

create or replace function public.accept_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites;
  me text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into inv from public.invites where id = invite_id and accepted_at is null;
  if inv.id is null then
    raise exception 'Invite not found';
  end if;
  select email into me from auth.users where id = auth.uid();
  if lower(me) <> lower(inv.email) then
    raise exception 'This invite is for a different email';
  end if;
  insert into public.org_members (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;
  update public.invites set accepted_at = now() where id = inv.id;
end;
$$;

create or replace function public.approve_access_request(request_id uuid, member_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.access_requests;
begin
  select * into req from public.access_requests where id = request_id and status = 'pending';
  if req.id is null then
    raise exception 'Request not found';
  end if;
  if not public.is_org_admin(req.org_id) then
    raise exception 'Admin only';
  end if;
  if member_role not in ('admin', 'supervisor', 'member') then
    member_role := 'member';
  end if;
  insert into public.org_members (org_id, user_id, role)
  values (req.org_id, req.user_id, member_role)
  on conflict (org_id, user_id) do nothing;
  update public.access_requests set status = 'approved' where id = req.id;
end;
$$;

grant execute on function public.create_plant(text) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.approve_access_request(uuid, text) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- ---------- RLS ----------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.invites enable row level security;
alter table public.access_requests enable row level security;
alter table public.crews enable row level security;
alter table public.areas enable row level security;
alter table public.rotation_patterns enable row level security;
alter table public.shifts enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;

drop policy if exists orgs_read on public.organizations;
create policy orgs_read on public.organizations
  for select using (is_listed = true or public.is_org_member(id) or created_by = auth.uid());

drop policy if exists orgs_update on public.organizations;
create policy orgs_update on public.organizations
  for update using (public.is_org_admin(id));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.org_members me
      join public.org_members them on them.org_id = me.org_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists members_read on public.org_members;
create policy members_read on public.org_members
  for select using (public.is_org_member(org_id) or user_id = auth.uid());

drop policy if exists members_admin_write on public.org_members;
create policy members_admin_write on public.org_members
  for all using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites
  for all using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists invites_mine on public.invites;
create policy invites_mine on public.invites
  for select using (
    lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

drop policy if exists requests_insert on public.access_requests;
create policy requests_insert on public.access_requests
  for insert with check (user_id = auth.uid());

drop policy if exists requests_read on public.access_requests;
create policy requests_read on public.access_requests
  for select using (user_id = auth.uid() or public.is_org_admin(org_id));

drop policy if exists requests_admin on public.access_requests;
create policy requests_admin on public.access_requests
  for update using (public.is_org_admin(org_id));

drop policy if exists crews_read on public.crews;
create policy crews_read on public.crews for select using (public.is_org_member(org_id));
drop policy if exists crews_write on public.crews;
create policy crews_write on public.crews for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select using (public.is_org_member(org_id));
drop policy if exists areas_write on public.areas;
create policy areas_write on public.areas for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists patterns_read on public.rotation_patterns;
create policy patterns_read on public.rotation_patterns for select using (public.is_org_member(org_id));
drop policy if exists patterns_write on public.rotation_patterns;
create policy patterns_write on public.rotation_patterns for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts for select using (public.is_org_member(org_id));
drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists ot_read on public.overtime_entries;
create policy ot_read on public.overtime_entries
  for select using (public.is_org_member(org_id));
drop policy if exists ot_insert on public.overtime_entries;
create policy ot_insert on public.overtime_entries
  for insert with check (public.is_org_member(org_id) and user_id = auth.uid());
drop policy if exists ot_update on public.overtime_entries;
create policy ot_update on public.overtime_entries
  for update using (public.is_org_admin(org_id));

drop policy if exists threads_read on public.forum_threads;
create policy threads_read on public.forum_threads for select using (public.is_org_member(org_id));
drop policy if exists threads_insert on public.forum_threads;
create policy threads_insert on public.forum_threads
  for insert with check (public.is_org_member(org_id) and author_id = auth.uid());

drop policy if exists posts_read on public.forum_posts;
create policy posts_read on public.forum_posts for select using (public.is_org_member(org_id));
drop policy if exists posts_insert on public.forum_posts;
create policy posts_insert on public.forum_posts
  for insert with check (public.is_org_member(org_id) and author_id = auth.uid());

-- plant chat
create table if not exists public.plant_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null default 'main',
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.plant_messages enable row level security;
drop policy if exists plant_messages_read on public.plant_messages;
create policy plant_messages_read on public.plant_messages for select using (public.is_org_member(org_id));
drop policy if exists plant_messages_insert on public.plant_messages;
create policy plant_messages_insert on public.plant_messages for insert with check (public.is_org_member(org_id));
drop policy if exists plant_messages_delete on public.plant_messages;
create policy plant_messages_delete on public.plant_messages for delete using (public.is_org_admin(org_id) or author_id = auth.uid());

-- vacation
create table if not exists public.vacation_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'denied')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.vacation_requests enable row level security;
drop policy if exists vacation_read on public.vacation_requests;
create policy vacation_read on public.vacation_requests for select using (public.is_org_member(org_id));
drop policy if exists vacation_insert on public.vacation_requests;
create policy vacation_insert on public.vacation_requests for insert with check (public.is_org_member(org_id));
drop policy if exists vacation_update on public.vacation_requests;
create policy vacation_update on public.vacation_requests for update using (public.is_org_admin(org_id));
drop policy if exists vacation_delete on public.vacation_requests;
create policy vacation_delete on public.vacation_requests for delete using (public.is_org_admin(org_id) or created_by = auth.uid());

alter table public.overtime_entries add column if not exists operator_name text;
alter table public.overtime_entries add column if not exists note text;
drop policy if exists ot_delete on public.overtime_entries;
create policy ot_delete on public.overtime_entries for delete using (public.is_org_admin(org_id) or user_id = auth.uid());
