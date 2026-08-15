-- Put the fare in the box for dispatch instead of making them work it out.
--
-- The customer already sees a price on the website before they request, but the
-- booking is deliberately inserted without one — letting the public set their
-- own fare would be an obvious hole. So the price list is applied here, on the
-- way in, where the customer can't reach it. Dispatch can still type over it;
-- this only fills an empty box, never overwrites a number someone chose.

-- Same pairing rule the website and app use: match a published route to the
-- pickup/destination in either direction, since a route is priced the same
-- coming back as going out.
create or replace function quote_fare(
  p_pickup      text,
  p_destination text,
  p_passengers  int,
  p_trip_type   text
) returns int as $$
  select s.price_cents
         * greatest(coalesce(p_passengers, 1), 1)
         * case when p_trip_type = 'Round trip' then 2 else 1 end
  from services s
  where s.category = 'route'
    and s.is_active
    and s.price_cents is not null
    and s.from_point is not null
    and s.to_point is not null
    and (
      (    (p_pickup      ilike '%' || s.from_point || '%' or s.from_point ilike '%' || p_pickup      || '%')
       and (p_destination ilike '%' || s.to_point   || '%' or s.to_point   ilike '%' || p_destination || '%'))
      or
      (    (p_destination ilike '%' || s.from_point || '%' or s.from_point ilike '%' || p_destination || '%')
       and (p_pickup      ilike '%' || s.to_point   || '%' or s.to_point   ilike '%' || p_pickup      || '%'))
    )
  order by s.sort
  limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function fill_booking_fare() returns trigger as $$
begin
  if new.quoted_price_cents is null then
    new.quoted_price_cents :=
      quote_fare(new.pickup, new.destination, new.passengers, new.trip_type);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists bookings_autoquote on bookings;
create trigger bookings_autoquote
  before insert on bookings
  for each row execute function fill_booking_fare();

-- Requests already sitting on the board were taken before this existed.
update bookings
set quoted_price_cents = quote_fare(pickup, destination, passengers, trip_type)
where quoted_price_cents is null
  and status not in ('completed', 'cancelled');
