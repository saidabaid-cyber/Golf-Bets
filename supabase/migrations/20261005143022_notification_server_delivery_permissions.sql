-- Controlled DEV apply only: existing canonical participant-notification emitter.
-- No new tables, columns, events, audience policies or client capabilities.
-- Recipient preferences are read before deterministic INSERT ... DO NOTHING.
begin;
grant select (user_id, event_type, in_app)
  on public.notification_preferences_v2 to service_role;
grant insert (id, recipient_id, event_type, resource_type, resource_id)
  on public.notification_events_v2 to service_role;
-- PostgreSQL requires the conflict-target columns to be readable for DO NOTHING.
grant select (id, recipient_id) on public.notification_events_v2 to service_role;
commit;
-- Rollback of only these capabilities (does not delete existing notifications):
-- revoke select (user_id, event_type, in_app) on public.notification_preferences_v2 from service_role;
-- revoke insert (id, recipient_id, event_type, resource_type, resource_id) on public.notification_events_v2 from service_role;
-- revoke select (id, recipient_id) on public.notification_events_v2 from service_role;
