-- The link a finished trip is given to review us on Google.
--
-- In app_settings rather than in the code, for the same reason as the VAT
-- rate: the passenger app is most of the business, and a link compiled into
-- it could only be set or changed by shipping to two app stores and waiting
-- for review. The trip page and the app both read it; blank = no review card.
--
-- Filled in once the Google Business Profile exists ("Ask for reviews" gives
-- a g.page/r/… link):
--   update app_settings set google_review_url = 'https://g.page/r/…/review';

alter table app_settings
  add column if not exists google_review_url text;

alter table app_settings drop constraint if exists app_settings_review_url_https;
alter table app_settings add constraint app_settings_review_url_https
  check (google_review_url is null or google_review_url ~ '^https://');

comment on column app_settings.google_review_url is
  'Where riders are sent to review us on Google after a trip. Null = the review card is not shown.';
