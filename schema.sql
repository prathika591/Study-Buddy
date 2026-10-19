-- Study Buddy database
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Every table is protected by Row Level Security: a signed-in user can only see and change their own rows.

-- ---------- Subjects (courses) ----------
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  code        text check (char_length(code) <= 30),
  color       text,
  created_at  timestamptz not null default now()
);

-- ---------- Weekly timetable ----------
create table if not exists public.slots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  day         smallint not null check (day between 0 and 6),          -- 0 = Sunday
  start_time  text not null check (start_time ~ '^\d{2}:\d{2}$'),     -- "09:00"
  end_time    text not null check (end_time ~ '^\d{2}:\d{2}$'),
  created_at  timestamptz not null default now()
);

-- ---------- Class notes ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id  uuid references public.subjects(id) on delete set null,
  source      text not null check (source in ('recording','audio','pdf','photo','text')),
  title       text not null default 'Untitled',
  status      text not null default 'processing' check (status in ('processing','ready','error')),
  error       text,
  notes       text not null default '',
  transcript  text not null default '',
  minutes     integer not null default 0,
  file_name   text,
  thumbs      jsonb not null default '[]',
  flashcards  jsonb,
  quiz        jsonb,
  scores      jsonb not null default '[]',
  share_id    text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notes_user_created on public.notes (user_id, created_at desc);

-- ---------- Chats and messages ----------
create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chat_id     uuid not null references public.chats(id) on delete cascade,
  role        text not null check (role in ('user','model')),
  text        text not null,
  sources     jsonb not null default '[]',
  refs        jsonb not null default '[]',
  is_error    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists messages_chat_created on public.messages (chat_id, created_at);

-- ---------- Daily usage (protects your free Gemini quota) ----------
create table if not exists public.usage (
  user_id   uuid not null references auth.users(id) on delete cascade,
  day       date not null default current_date,
  requests  integer not null default 0,
  primary key (user_id, day)
);

-- ---------- Row Level Security ----------
alter table public.subjects enable row level security;
alter table public.slots    enable row level security;
alter table public.notes    enable row level security;
alter table public.chats    enable row level security;
alter table public.messages enable row level security;
alter table public.usage    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['subjects','slots','notes','chats','messages'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists "read own usage" on public.usage;
create policy "read own usage" on public.usage for select to authenticated using (user_id = auth.uid());
-- No insert/update policy on usage: only the server (service role) can change it.

-- Keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes for each row execute function public.touch_updated_at();
drop trigger if exists chats_touch on public.chats;
create trigger chats_touch before update on public.chats for each row execute function public.touch_updated_at();

-- ---------- Server-only: count a request and check the daily limit ----------
create or replace function public.bump_usage(p_user uuid, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.usage (user_id, day, requests) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set requests = public.usage.requests + 1
  returning requests into n;
  return n <= p_limit;
end $$;
revoke all on function public.bump_usage(uuid, integer) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, integer) to service_role;

-- ---------- Public read of one shared note (by its secret link id) ----------
create or replace function public.get_shared_note(sid text)
returns table (title text, notes text, transcript text, source text, minutes integer, created_at timestamptz, subject text, subject_code text)
language sql security definer set search_path = public stable as $$
  select n.title, n.notes, n.transcript, n.source, n.minutes, n.created_at, s.name, s.code
  from public.notes n left join public.subjects s on s.id = n.subject_id
  where n.share_id = sid and n.status = 'ready' and char_length(sid) >= 10
  limit 1;
$$;
grant execute on function public.get_shared_note(text) to anon, authenticated;
