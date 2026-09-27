-- Run in the Supabase SQL editor AFTER signing in and requesting access.
-- Replace the placeholder with your own admin-provisioned, confirmed auth.users UUID.
-- Never let the first public registrant automatically become administrator.
begin;
do $$
declare owner_id uuid := 'REPLACE_WITH_YOUR_AUTH_USER_UUID';
begin
  if not exists (select 1 from auth.users where id = owner_id and email_confirmed_at is not null) then
    raise exception 'The selected Auth account must be confirmed.';
  end if;
  if not exists (select 1 from public.memberships where user_id = owner_id) then
    raise exception 'Sign in and request membership in Umuzi first.';
  end if;
  update public.memberships set status = 'approved', role = 'admin' where user_id = owner_id;
  insert into public.audit_log(actor, action, target) values(owner_id, 'bootstrap_admin', owner_id);
end $$;
commit;
