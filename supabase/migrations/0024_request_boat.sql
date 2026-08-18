-- One door for asking for a boat, and it hands back the key to the trip.
--
-- The problem it solves: a booking's access_token is the whole key to that trip
-- — the fare, the messages, paying, tipping. The public insert policy lets
-- anyone create a booking but nobody read one back, so the app booked a trip
-- and then had no way to find it again. Everything past the booking screen was
-- unreachable: the payment tab, the captain thread, tips.
--
-- A function fixes that without widening anything. It returns the token of the
-- row it just created and nothing else — it cannot be asked about a trip it
-- didn't make. And because the caller passes only the fields a passenger is
-- entitled to set, there is no way to slip in a fare, a status or a boat.

create or replace function request_boat(
  p_contact_name  text,
  p_contact_phone text,
  p_pickup        text,
  p_destination   text,
  p_scheduled_at  timestamptz,
  p_return_at     timestamptz default null,
  p_passengers    int         default 1,
  p_trip_type     text        default 'One way',
  p_notes         text        default null,
  p_pickup_lat    double precision default null,
  p_pickup_lng    double precision default null,
  p_located_at    timestamptz default null
) returns uuid as $$
declare
  new_token uuid;
begin
  -- Said plainly, because a passenger reads these.
  if length(btrim(coalesce(p_contact_name, ''))) = 0 then
    raise exception 'We need a name so your captain knows who to look for.';
  end if;
  if length(btrim(coalesce(p_contact_phone, ''))) < 7 then
    raise exception 'We need a number we can reach you on.';
  end if;
  if length(btrim(coalesce(p_pickup, ''))) = 0
     or length(btrim(coalesce(p_destination, ''))) = 0 then
    raise exception 'Tell us where to pick you up and where you are going.';
  end if;
  if btrim(p_pickup) = btrim(p_destination) then
    raise exception 'Your pickup and destination are the same.';
  end if;
  if p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'Please choose a time in the future.';
  end if;
  if p_return_at is not null and p_return_at <= p_scheduled_at then
    raise exception 'Your return time is before you have set off.';
  end if;
  if coalesce(p_passengers, 0) < 1 or p_passengers > 50 then
    raise exception 'How many people are coming?';
  end if;

  -- Only the fields a passenger gets to choose. The fare, the tax rate, the
  -- status and the boat are all set by triggers or by dispatch, and there is
  -- deliberately no argument here that could reach them.
  insert into bookings (
    contact_name, contact_phone, pickup, destination, scheduled_at, return_at,
    passengers, trip_type, notes, pickup_lat, pickup_lng, located_at
  ) values (
    btrim(p_contact_name), btrim(p_contact_phone), p_pickup, p_destination,
    p_scheduled_at, p_return_at, p_passengers, p_trip_type,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_pickup_lat, p_pickup_lng, p_located_at
  )
  returning access_token into new_token;

  return new_token;
end;
$$ language plpgsql volatile security definer set search_path = public;

comment on function request_boat is
  'Creates a booking and returns its access token — the key to that one trip, and only the one it just made.';

revoke all on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                    int, text, text, double precision, double precision, timestamptz)
  from public;
grant execute on function request_boat(text, text, text, text, timestamptz, timestamptz,
                                       int, text, text, double precision, double precision, timestamptz)
  to anon, authenticated;
