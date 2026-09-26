-- One private family per installation. Apply once to a new Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 100),
  introduction text not null default '' check (length(introduction) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);
create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  birth_date date check (birth_date <= current_date),
  birth_place text not null default '' check (length(birth_place) <= 160),
  tribe text not null default '' check (length(tribe) <= 100),
  occupation text not null default '' check (length(occupation) <= 160),
  biography text not null default '' check (length(biography) <= 1000),
  deceased boolean not null default false,
  death_date date check (death_date <= current_date),
  death_place text not null default '' check (length(death_place) <= 160),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (death_date is null or birth_date is null or death_date >= birth_date),
  check (deceased or (death_date is null and death_place = ''))
);
create index people_name on public.people(name_key);
create table public.profile_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  reason text not null check (length(reason) between 5 and 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index one_pending_claim_per_account on public.profile_claims(user_id) where status = 'pending';
create unique index one_profile_per_account on public.profile_claims(user_id) where status = 'approved';
create unique index one_account_per_profile on public.profile_claims(person_id) where status = 'approved';
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.people(id),
  to_id uuid not null references public.people(id),
  kind text not null check (kind in ('parent','partner')),
  parent_type text check (parent_type in ('biological','adoptive','step','unspecified')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_id <> to_id),
  check ((kind = 'parent' and parent_type is not null) or (kind = 'partner' and parent_type is null)),
  check (kind <> 'partner' or from_id < to_id),
  unique (from_id, to_id, kind)
);
create table public.person_sensitive (
  person_id uuid primary key references public.people(id) on delete cascade,
  cause_of_death text not null check (length(cause_of_death) <= 500),
  source_note text not null check (length(source_note) between 5 and 300),
  updated_at timestamptz not null default now()
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target uuid,
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now()
);
create table private.rate_limits (user_id uuid primary key references auth.users(id) on delete cascade, window_start timestamptz not null, attempts integer not null);

create function private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where user_id = auth.uid() and status = 'approved');
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false) and exists(
    select 1 from public.memberships where user_id = auth.uid() and status = 'approved' and role = 'admin');
$$;
create function private.require_member() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member() then raise exception 'An administrator must approve your account first.' using errcode = '42501'; end if;
end; $$;
create function private.require_admin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Administrator access with two-step verification is required.' using errcode = '42501'; end if;
end; $$;

alter table public.memberships enable row level security;
alter table public.people enable row level security;
alter table public.profile_claims enable row level security;
alter table public.relationships enable row level security;
alter table public.person_sensitive enable row level security;
alter table public.audit_log enable row level security;
alter table private.rate_limits enable row level security;
revoke all on public.memberships, public.people, public.profile_claims, public.relationships, public.person_sensitive, public.audit_log from anon, authenticated;
grant select on public.memberships, public.people, public.profile_claims, public.relationships, public.person_sensitive, public.audit_log to authenticated;
create policy membership_read on public.memberships for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy people_read on public.people for select to authenticated using ((select private.is_member()));
create policy claims_read on public.profile_claims for select to authenticated using ((user_id = (select auth.uid()) and (select private.is_member())) or (select private.is_admin()));
create policy edges_read on public.relationships for select to authenticated using ((select private.is_member()) and (status = 'approved' or created_by = (select auth.uid()) or (select private.is_admin())));
create policy sensitive_read on public.person_sensitive for select to authenticated using ((select private.is_admin()));
create policy audit_read on public.audit_log for select to authenticated using ((select private.is_admin()));

-- Exposed RPC is security-invoker. Privileged implementation lives outside API schemas.
-- Each write is one transaction, with serialized mutation checks for this small MVP.
create function private.umuzi(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target uuid;
  other uuid;
  result jsonb;
  me public.memberships;
  claim public.profile_claims;
  edge public.relationships;
  person public.people;
  name_value text;
  name_key_value text;
  desired_status text;
  desired_role text;
  rate_count integer;
begin
  if actor is null or not exists(select 1 from auth.users where id = actor and email_confirmed_at is not null) then
    raise exception 'Verify your email before continuing.' using errcode = '42501';
  end if;
  if p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 12000 then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  select * into me from public.memberships where user_id = actor;
  if p_action = 'snapshot' then
    result := jsonb_build_object('membership', case when me.user_id is null then null else to_jsonb(me) end);
    if not private.is_member() then return result; end if;
    return result || jsonb_build_object(
      'people', (select coalesce(jsonb_agg(to_jsonb(p) - 'created_by' - 'name_key' order by p.name), '[]') from public.people p),
      'relationships', (select coalesce(jsonb_agg(r), '[]') from public.relationships r where status = 'approved' or created_by = actor or private.is_admin()),
      'claims', (select coalesce(jsonb_agg(c), '[]') from public.profile_claims c where user_id = actor or private.is_admin()),
      'members', (select coalesce(jsonb_agg(m order by m.created_at), '[]') from public.memberships m where private.is_admin()),
      'sensitive', (select coalesce(jsonb_agg(s), '[]') from public.person_sensitive s where private.is_admin()),
      'audit', (select coalesce(jsonb_agg(a), '[]') from (select * from public.audit_log where private.is_admin() order by created_at desc limit 50) a),
      'admin_verified', private.is_admin());
  end if;

  perform pg_advisory_xact_lock(hashtextextended('umuzi-mutations', 0));
  insert into private.rate_limits values (actor, now(), 1)
    on conflict (user_id) do update set
      attempts = case when private.rate_limits.window_start < now() - interval '1 hour' then 1 else private.rate_limits.attempts + 1 end,
      window_start = case when private.rate_limits.window_start < now() - interval '1 hour' then now() else private.rate_limits.window_start end
    returning attempts into rate_count;
  if rate_count > 60 then raise exception 'Too many changes. Please try again later.'; end if;

  if p_action = 'request_access' then
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or jsonb_typeof(p_payload->'introduction') is distinct from 'string' then raise exception 'Please enter your name and introduction.'; end if;
    insert into public.memberships(user_id, display_name, introduction)
      values (actor, btrim(p_payload->>'name'), btrim(p_payload->>'introduction')) on conflict (user_id) do nothing;
    target := actor;
  else
    perform private.require_member();
    if p_action = 'save_person' then
      if exists(select 1 from jsonb_each(p_payload) f where
        (f.key in ('birth_place','tribe','occupation','biography','death_place','distinct_reason') and jsonb_typeof(f.value) <> 'string')
        or (f.key in ('birth_date','death_date') and jsonb_typeof(f.value) not in ('string','null'))
        or (f.key = 'deceased' and jsonb_typeof(f.value) <> 'boolean')) then
        raise exception 'Profile fields must contain text, dates, and a true/false deceased flag.' using errcode = '22023';
      end if;
      target := nullif(p_payload->>'id', '')::uuid;
      if target is not null then
        select * into person from public.people where id = target for update;
        if not found then raise exception 'Person not found.'; end if;
        if not private.is_admin() and not exists(select 1 from public.profile_claims where user_id = actor and person_id = target and status = 'approved') then
          raise exception 'You can edit only your approved claimed profile.' using errcode = '42501';
        end if;
        if person.updated_at <> (p_payload->>'updated_at')::timestamptz or p_payload->>'updated_at' is null then
          raise exception 'This profile changed. Refresh before editing again.';
        end if;
      end if;
      if jsonb_typeof(p_payload->'name') is distinct from 'string' then raise exception 'A name is required.'; end if;
      name_value := btrim(p_payload->>'name');
      name_key_value := lower(regexp_replace(name_value, '\s+', ' ', 'g'));
      if (target is null or person.name_key <> name_key_value) and exists(select 1 from public.people where name_key = name_key_value and id <> coalesce(target, '00000000-0000-0000-0000-000000000000'::uuid)) then
        if not private.is_admin() or length(btrim(coalesce(p_payload->>'distinct_reason',''))) not between 10 and 300 then
          raise exception 'A person with this name already exists. Reuse that profile, or ask an administrator to confirm a different person.' using errcode = '23505';
        end if;
      end if;
      if target is null then
        insert into public.people(name, created_by) values (name_value, actor) returning id into target;
      end if;
      update public.people set name = name_value,
        birth_date = nullif(p_payload->>'birth_date','')::date,
        birth_place = btrim(coalesce(p_payload->>'birth_place','')),
        tribe = btrim(coalesce(p_payload->>'tribe','')),
        occupation = btrim(coalesce(p_payload->>'occupation','')),
        biography = btrim(coalesce(p_payload->>'biography','')),
        deceased = coalesce((p_payload->>'deceased')::boolean, false),
        death_date = nullif(p_payload->>'death_date','')::date,
        death_place = btrim(coalesce(p_payload->>'death_place','')),
        updated_at = clock_timestamp() where id = target;
      if length(coalesce(p_payload->>'distinct_reason','')) > 0 then
        insert into public.audit_log(actor,action,target,note) values(actor,'confirmed_distinct_person',target,left(p_payload->>'distinct_reason',300));
      end if;
    elsif p_action = 'claim_profile' then
      target := (p_payload->>'person_id')::uuid;
      if not exists(select 1 from public.people where id = target and not deceased) then raise exception 'Only a living person can be claimed.'; end if;
      if exists(select 1 from public.profile_claims where status = 'approved' and (user_id = actor or person_id = target)) then raise exception 'This account or profile is already linked.'; end if;
      insert into public.profile_claims(user_id,person_id,reason) values(actor,target,btrim(p_payload->>'reason')) returning id into target;
    elsif p_action = 'review_claim' then
      perform private.require_admin();
      target := (p_payload->>'id')::uuid;
      desired_status := p_payload->>'status';
      select * into claim from public.profile_claims where id = target for update;
      if not found or (claim.status <> 'pending' and not (claim.status = 'approved' and desired_status = 'revoked')) then raise exception 'This claim is no longer awaiting that decision.'; end if;
      if desired_status is null or desired_status not in ('approved','rejected','revoked') or (desired_status = 'revoked' and claim.status <> 'approved') then raise exception 'Invalid claim decision.'; end if;
      if desired_status = 'approved' then
        if not exists(select 1 from public.memberships where user_id = claim.user_id and status = 'approved') then raise exception 'Approve the account first.'; end if;
        if exists(select 1 from public.people where id = claim.person_id and deceased) then raise exception 'A deceased profile cannot be claimed.'; end if;
      end if;
      update public.profile_claims set status = desired_status, reviewed_by = actor where id = target;
      if desired_status = 'approved' then
        update public.profile_claims set status = 'rejected', reviewed_by = actor where id <> target and status = 'pending' and (person_id = claim.person_id or user_id = claim.user_id);
      end if;
    elsif p_action = 'propose_relationship' then
      target := (p_payload->>'from_id')::uuid;
      other := (p_payload->>'to_id')::uuid;
      if p_payload->>'kind' = 'partner' and target > other then select other,target into target,other; end if;
      insert into public.relationships(from_id,to_id,kind,parent_type,created_by)
        values(target,other,p_payload->>'kind',case when p_payload->>'kind' = 'parent' then coalesce(p_payload->>'parent_type','unspecified') end,actor)
        returning id into target;
    elsif p_action = 'review_relationship' then
      perform private.require_admin();
      target := (p_payload->>'id')::uuid;
      desired_status := p_payload->>'status';
      if desired_status is null or desired_status not in ('approved','rejected') then raise exception 'Invalid relationship decision.'; end if;
      select * into edge from public.relationships where id = target for update;
      if not found then raise exception 'Relationship not found.'; end if;
      if desired_status = 'approved' and edge.kind = 'parent' and exists(
        with recursive descendants(id) as (
          select edge.to_id union
          select r.to_id from public.relationships r join descendants d on r.from_id = d.id
          where r.kind = 'parent' and r.status = 'approved' and r.id <> edge.id
        ) select 1 from descendants where id = edge.from_id
      ) then raise exception 'This connection would create an ancestry loop.'; end if;
      update public.relationships set status = desired_status where id = target;
    elsif p_action = 'update_membership' then
      perform private.require_admin();
      target := (p_payload->>'user_id')::uuid;
      desired_status := p_payload->>'status';
      desired_role := p_payload->>'role';
      if target = actor then raise exception 'Another administrator must change your own access.'; end if;
      if desired_status is null or desired_role is null then raise exception 'Status and role are required.'; end if;
      update public.memberships set status = desired_status, role = desired_role where user_id = target;
      if not found then raise exception 'Account not found.'; end if;
    elsif p_action = 'save_sensitive' then
      perform private.require_admin();
      target := (p_payload->>'person_id')::uuid;
      if not exists(select 1 from public.people where id = target and deceased) then raise exception 'Sensitive death information requires a deceased profile.'; end if;
      if btrim(coalesce(p_payload->>'cause_of_death','')) = '' then
        delete from public.person_sensitive where person_id = target;
      else
        insert into public.person_sensitive(person_id,cause_of_death,source_note)
          values(target,btrim(p_payload->>'cause_of_death'),btrim(p_payload->>'source_note'))
          on conflict (person_id) do update set cause_of_death = excluded.cause_of_death, source_note = excluded.source_note, updated_at = now();
      end if;
    else
      raise exception 'Unknown action.' using errcode = '22023';
    end if;
  end if;
  insert into public.audit_log(actor,action,target) values(actor,p_action,target);
  return jsonb_build_object('id',target);
end;
$$;
create function public.umuzi(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.umuzi(p_action,p_payload); $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(), private.is_admin(), private.umuzi(text,jsonb) to authenticated;
revoke all on function public.umuzi(text,jsonb) from public, anon;
grant execute on function public.umuzi(text,jsonb) to authenticated;
-- Stop new functions from silently inheriting PostgreSQL's PUBLIC EXECUTE default.
alter default privileges in schema private revoke execute on functions from public;
notify pgrst, 'reload schema';
commit;
