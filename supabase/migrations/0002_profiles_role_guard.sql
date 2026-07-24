-- Close a privilege-escalation hole: profiles_self_update (0001) lets a user
-- update their own row with no column restriction, so a customer could set
-- their own role to 'admin' via the API. Block role changes unless the
-- acting user is already an admin. Direct SQL (no JWT / auth.uid() is null,
-- e.g. the SQL Editor) is left alone so admin bootstrapping still works.

create or replace function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not is_admin() then
    raise exception 'not authorized to change role';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_prevent_role_escalation
  before update on profiles
  for each row execute function prevent_role_self_escalation();
