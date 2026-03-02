create table if not exists public.internal_chat_rooms (
  room_key text primary key,
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  check (user_a <> user_b),
  check (user_a::text < user_b::text)
);

create index if not exists idx_internal_chat_rooms_user_a on public.internal_chat_rooms(user_a);
create index if not exists idx_internal_chat_rooms_user_b on public.internal_chat_rooms(user_b);

alter table public.internal_chat_rooms enable row level security;

drop policy if exists "internal_chat_rooms_select_participant" on public.internal_chat_rooms;
create policy "internal_chat_rooms_select_participant"
on public.internal_chat_rooms
for select
to authenticated
using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "internal_chat_rooms_insert_participant" on public.internal_chat_rooms;
create policy "internal_chat_rooms_insert_participant"
on public.internal_chat_rooms
for insert
to authenticated
with check (
  auth.uid() = created_by
  and (auth.uid() = user_a or auth.uid() = user_b)
);

drop policy if exists "internal_chat_select_authenticated" on public.internal_chat_messages;
drop policy if exists "internal_chat_insert_own_user" on public.internal_chat_messages;

create policy "internal_chat_select_room_participant"
on public.internal_chat_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.internal_chat_rooms room
    where room.room_key = internal_chat_messages.room_key
      and (auth.uid() = room.user_a or auth.uid() = room.user_b)
  )
);

create policy "internal_chat_insert_room_participant"
on public.internal_chat_messages
for insert
to authenticated
with check (
  auth.uid() = sender_user_id
  and exists (
    select 1
    from public.internal_chat_rooms room
    where room.room_key = internal_chat_messages.room_key
      and (auth.uid() = room.user_a or auth.uid() = room.user_b)
  )
);
