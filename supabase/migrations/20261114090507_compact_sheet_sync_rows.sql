-- Allocate sheet rows transactionally. PostgreSQL sequences can leave gaps after
-- rolled-back saves and deleted test data; stable row assignments still live in jobs.
create or replace function public.queue_sheet_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assigned_row bigint;
begin
  select row_number into assigned_row from public.sheet_sync_jobs
    where kind='master' and entity_id=new.id;
  if assigned_row is null then
    perform pg_advisory_xact_lock(20261114, 1);
    select coalesce(max(row_number), 1) + 1 into assigned_row
      from public.sheet_sync_jobs where kind='master';
  end if;
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('master',new.id,new.id,assigned_row,new.version,
    to_jsonb(new)||jsonb_build_object(
      'pic_name',(select display_name from public.staff_profiles where id=new.pic_id),
      'created_by_name',(select display_name from public.staff_profiles where id=new.created_by),
      'updated_by_name',(select display_name from public.staff_profiles where id=new.updated_by)))
  on conflict(kind,entity_id) do update set source_version=excluded.source_version,payload=excluded.payload,
    updated_at=now(),ready_at=now(),error_code=null;
  return new;
end $$;

create or replace function public.queue_sheet_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assigned_row bigint;
begin
  perform pg_advisory_xact_lock(20261114, 2);
  select coalesce(max(row_number), 1) + 1 into assigned_row
    from public.sheet_sync_jobs where kind='activity';
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('activity',new.id,new.lead_id,assigned_row,1,to_jsonb(new))
  on conflict do nothing;
  return new;
end $$;
