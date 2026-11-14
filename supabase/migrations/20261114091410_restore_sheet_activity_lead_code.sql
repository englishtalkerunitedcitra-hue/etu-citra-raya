-- Preserve the human-readable lead code added by migration 202611120002.
create or replace function public.queue_sheet_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assigned_row bigint;
begin
  perform pg_advisory_xact_lock(20261114, 2);
  select coalesce(max(row_number), 1) + 1 into assigned_row
    from public.sheet_sync_jobs where kind='activity';
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('activity',new.id,new.lead_id,assigned_row,1,
    to_jsonb(new)||jsonb_build_object('lead_code',
      (select lead_code from public.sales_leads where id=new.lead_id)))
  on conflict do nothing;
  return new;
end $$;
