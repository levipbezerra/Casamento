-- CASAMENTO | Victória & Levi — banco independente da lista de presentes.
-- Dados pessoais NUNCA ficam no repositório público. Acesse só com autenticação.
-- Uso: SQL Editor de um projeto Supabase autorizado.
create schema if not exists wedding_private;

create table if not exists public.wedding_staff (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'door')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wedding_guests (
  id uuid primary key default gen_random_uuid(),
  legacy_number integer unique,
  name text not null check (length(btrim(name)) between 1 and 180),
  guest_type text not null default 'Convidado',
  list_ok boolean not null default false,
  invitation_status text not null default '',
  rsvp_status text not null default '',
  notes text not null default '',
  qr_token uuid not null unique default gen_random_uuid(),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wedding_guests_name_idx on public.wedding_guests(name);
create index if not exists wedding_guests_type_idx on public.wedding_guests(guest_type);

create table if not exists public.wedding_events (
  id bigint generated always as identity primary key,
  guest_id uuid not null references public.wedding_guests(id) on delete cascade,
  action text not null check (action in ('checked_in','reverted')),
  changed_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create or replace function wedding_private.has_role(required_role text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.wedding_staff s
    where s.email = lower(coalesce((select auth.jwt()->>'email'), ''))
      and s.active
      and (s.role = required_role or s.role = 'admin')
  );
$$;

create or replace function wedding_private.guest_change_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if old.checked_in_at is null and new.checked_in_at is not null then
    insert into public.wedding_events(guest_id, action, changed_by)
      values(new.id, 'checked_in', auth.uid());
  elsif old.checked_in_at is not null and new.checked_in_at is null then
    insert into public.wedding_events(guest_id, action, changed_by)
      values(new.id, 'reverted', auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists wedding_guests_audit on public.wedding_guests;
create trigger wedding_guests_audit before update on public.wedding_guests
for each row execute function wedding_private.guest_change_log();

alter table public.wedding_staff enable row level security;
alter table public.wedding_guests enable row level security;
alter table public.wedding_events enable row level security;

drop policy if exists wedding_staff_read on public.wedding_staff;
create policy wedding_staff_read on public.wedding_staff
for select to authenticated using (
  email = lower((select auth.jwt()->>'email'))
  or (select wedding_private.has_role('admin'))
);
drop policy if exists wedding_staff_admin_insert on public.wedding_staff;
create policy wedding_staff_admin_insert on public.wedding_staff
for insert to authenticated with check ((select wedding_private.has_role('admin')));
drop policy if exists wedding_staff_admin_update on public.wedding_staff;
create policy wedding_staff_admin_update on public.wedding_staff
for update to authenticated
using ((select wedding_private.has_role('admin')))
with check ((select wedding_private.has_role('admin')));
drop policy if exists wedding_staff_admin_delete on public.wedding_staff;
create policy wedding_staff_admin_delete on public.wedding_staff
for delete to authenticated using ((select wedding_private.has_role('admin')));

drop policy if exists wedding_guests_admin_read on public.wedding_guests;
create policy wedding_guests_admin_read on public.wedding_guests
for select to authenticated using ((select wedding_private.has_role('admin')));
drop policy if exists wedding_guests_admin_insert on public.wedding_guests;
create policy wedding_guests_admin_insert on public.wedding_guests
for insert to authenticated with check ((select wedding_private.has_role('admin')));
drop policy if exists wedding_guests_admin_update on public.wedding_guests;
create policy wedding_guests_admin_update on public.wedding_guests
for update to authenticated
using ((select wedding_private.has_role('admin')))
with check ((select wedding_private.has_role('admin')));
drop policy if exists wedding_guests_admin_delete on public.wedding_guests;
create policy wedding_guests_admin_delete on public.wedding_guests
for delete to authenticated using ((select wedding_private.has_role('admin')));

drop policy if exists wedding_events_admin_read on public.wedding_events;
create policy wedding_events_admin_read on public.wedding_events
for select to authenticated using ((select wedding_private.has_role('admin')));

-- Somente token opaco e login autorizado habilitam a leitura pontual na portaria.
create or replace function public.wedding_lookup_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_token text; g record;
begin
  if auth.uid() is null or not wedding_private.has_role('door') then
    raise exception 'Acesso à portaria não autorizado' using errcode='42501';
  end if;
  v_token := lower(btrim(p_token));
  if left(v_token,4) = 'w26:' then v_token := substr(v_token,5); end if;
  if v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select id, name, guest_type, checked_in_at
    into g from public.wedding_guests where qr_token = v_token::uuid;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status',case when g.checked_in_at is null then 'ready' else 'already' end,
    'id',g.id,'name',g.name,'guest_type',g.guest_type,'checked_in_at',g.checked_in_at);
end;
$$;

-- Transação com bloqueio de linha: impede dupla entrada em leituras simultâneas.
create or replace function public.wedding_confirm_entry(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_token text; g record; v_now timestamptz;
begin
  if auth.uid() is null or not wedding_private.has_role('door') then
    raise exception 'Acesso à portaria não autorizado' using errcode='42501';
  end if;
  v_token := lower(btrim(p_token));
  if left(v_token,4) = 'w26:' then v_token := substr(v_token,5); end if;
  if v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select id, name, guest_type, checked_in_at into g
    from public.wedding_guests where qr_token = v_token::uuid for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if g.checked_in_at is not null then
    return jsonb_build_object('status','already','name',g.name,'guest_type',g.guest_type,'checked_in_at',g.checked_in_at);
  end if;
  v_now := now();
  update public.wedding_guests
    set checked_in_at = v_now, checked_in_by = auth.uid()
    where id = g.id;
  return jsonb_build_object('status','checked_in','name',g.name,'guest_type',g.guest_type,'checked_in_at',v_now);
end;
$$;

create or replace function public.wedding_gate_stats()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_total integer; v_here integer;
begin
  if auth.uid() is null or not wedding_private.has_role('door') then
    raise exception 'Acesso à portaria não autorizado' using errcode='42501';
  end if;
  select count(*)::int, count(checked_in_at)::int into v_total, v_here from public.wedding_guests;
  return jsonb_build_object('total',v_total,'checked_in',v_here,'pending',v_total-v_here);
end;
$$;

-- Nunca permita que o perfil anônimo consulte nomes, QR Codes ou detalhes.
revoke all on public.wedding_staff, public.wedding_guests, public.wedding_events from anon, public;
grant select, insert, update, delete on public.wedding_staff to authenticated;
grant select, insert, update, delete on public.wedding_guests to authenticated;
grant select on public.wedding_events to authenticated;
revoke all on function public.wedding_lookup_qr(text) from public, anon;
revoke all on function public.wedding_confirm_entry(text) from public, anon;
revoke all on function public.wedding_gate_stats() from public, anon;
grant execute on function public.wedding_lookup_qr(text), public.wedding_confirm_entry(text), public.wedding_gate_stats() to authenticated;
revoke all on schema wedding_private from public, anon;
grant usage on schema wedding_private to authenticated;
revoke all on function wedding_private.has_role(text) from public, anon;
grant execute on function wedding_private.has_role(text) to authenticated;
revoke all on function wedding_private.guest_change_log() from public, anon;

-- BOOTSTRAP PRIVADO: não divulgar e-mail de administrador no GitHub público.
-- Após executar o schema, use APENAS no SQL Editor privado:
-- insert into public.wedding_staff(email, role, active)
-- values (lower('EMAIL_DO_ADMINISTRADOR@DOMINIO.COM'), 'admin', true)
-- on conflict (email) do nothing;

-- Validação após execução:
-- select count(*) from public.wedding_staff where role = 'admin';
-- select * from pg_policies where tablename like 'wedding_%';
