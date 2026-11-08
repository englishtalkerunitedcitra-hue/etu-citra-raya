-- Durable, one-way delivery. Existing workbook tabs are never adopted implicitly.
create table public.sheet_sync_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  spreadsheet_id text not null,
  master_title text not null default 'ETU App - Master Prospek',
  activity_title text not null default 'ETU App - Log Aktivitas',
  check(master_title<>activity_title)
);
insert into public.sheet_sync_config(singleton,spreadsheet_id)
values(true,'1zi-DybtGZDHgWVEPt1xpGXWQgKixxIPQQPZg6nIsDHg');
create sequence public.sheet_master_rows start 2;
create sequence public.sheet_activity_rows start 2;
create table public.sheet_sync_jobs (
  kind text not null check(kind in ('master','activity')),
  entity_id uuid not null,
  lead_id uuid not null references public.sales_leads(id),
  row_number bigint not null check(row_number>=2),
  source_version integer not null,
  confirmed_version integer not null default 0,
  payload jsonb not null,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  ready_at timestamptz not null default now(),
  confirmed_at timestamptz,
  error_code text,
  primary key(kind,entity_id),
  unique(kind,row_number),
  check(confirmed_version<=source_version)
);
create index sheet_jobs_pending on public.sheet_sync_jobs(ready_at,updated_at) where confirmed_version<source_version;
create table public.sheet_sync_control (
  singleton boolean primary key default true check(singleton),
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz
);
insert into public.sheet_sync_control(singleton) values(true);

create function public.queue_sheet_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('master',new.id,new.id,coalesce((select row_number from public.sheet_sync_jobs where kind='master' and entity_id=new.id),nextval('public.sheet_master_rows')),new.version,
    to_jsonb(new)||jsonb_build_object(
      'pic_name',(select display_name from public.staff_profiles where id=new.pic_id),
      'created_by_name',(select display_name from public.staff_profiles where id=new.created_by),
      'updated_by_name',(select display_name from public.staff_profiles where id=new.updated_by)))
  on conflict(kind,entity_id) do update set source_version=excluded.source_version,payload=excluded.payload,
    updated_at=now(),ready_at=now(),error_code=null;
  return new;
end $$;
create trigger queue_lead_to_sheet after insert or update on public.sales_leads
for each row execute function public.queue_sheet_lead();
create function public.queue_sheet_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('activity',new.id,new.lead_id,nextval('public.sheet_activity_rows'),1,to_jsonb(new))
  on conflict do nothing;
  return new;
end $$;
create trigger queue_activity_to_sheet after insert on public.lead_activities
for each row execute function public.queue_sheet_activity();
-- Backfill existing DB data once; do not import or mutate existing Sheet rows.
insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
select 'master',l.id,l.id,nextval('public.sheet_master_rows'),l.version,to_jsonb(l)||jsonb_build_object(
  'pic_name',(select display_name from public.staff_profiles where id=l.pic_id),
  'created_by_name',(select display_name from public.staff_profiles where id=l.created_by),
  'updated_by_name',(select display_name from public.staff_profiles where id=l.updated_by))
from public.sales_leads l order by l.created_at,l.id;
insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
select 'activity',a.id,a.lead_id,nextval('public.sheet_activity_rows'),1,to_jsonb(a) from public.lead_activities a order by a.created_at,a.id;

alter table public.sheet_sync_config enable row level security;
alter table public.sheet_sync_jobs enable row level security;
alter table public.sheet_sync_control enable row level security;
revoke all on public.sheet_sync_config,public.sheet_sync_jobs,public.sheet_sync_control from public,anon,authenticated;
revoke all on sequence public.sheet_master_rows,public.sheet_activity_rows from public,anon,authenticated;
grant all on public.sheet_sync_config,public.sheet_sync_jobs,public.sheet_sync_control to service_role;
grant usage,select on sequence public.sheet_master_rows,public.sheet_activity_rows to service_role;

create function public.claim_sheet_jobs(p_token uuid,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare control public.sheet_sync_control; config public.sheet_sync_config; jobs jsonb;
begin
  if p_token is null or p_limit<1 or p_limit>25 then raise exception 'Invalid batch' using errcode='22023'; end if;
  select * into config from public.sheet_sync_config where singleton;
  if not config.enabled then return jsonb_build_object('disabled',true,'jobs','[]'::jsonb); end if;
  select * into control from public.sheet_sync_control where singleton for update;
  if control.lease_until>clock_timestamp() then return jsonb_build_object('busy',true,'jobs','[]'::jsonb); end if;
  update public.sheet_sync_control set lease_token=p_token,lease_until=clock_timestamp()+interval '180 seconds',last_attempt_at=now() where singleton;
  with picked as (
    select kind,entity_id from public.sheet_sync_jobs where confirmed_version<source_version and ready_at<=now()
    order by updated_at,kind,entity_id limit p_limit for update
  ), claimed as (
    update public.sheet_sync_jobs j set attempts=j.attempts+1 from picked p where j.kind=p.kind and j.entity_id=p.entity_id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into jobs from claimed;
  return jsonb_build_object('jobs',jobs,'config',to_jsonb(config),'token',p_token,
    'lease_until',clock_timestamp()+interval '180 seconds',
    'previously_synced',exists(select 1 from public.sheet_sync_jobs where confirmed_version>0));
end $$;

create function public.finish_sheet_jobs(p_token uuid,p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare control public.sheet_sync_control; item jsonb;
begin
  select * into control from public.sheet_sync_control where singleton for update;
  if control.lease_token is distinct from p_token or control.lease_until<clock_timestamp() then
    raise exception 'Worker lease expired' using errcode='PT409';
  end if;
  if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>25 then raise exception 'Invalid results'; end if;
  for item in select * from jsonb_array_elements(p_results) loop
    if (item->>'ok')::boolean then
      update public.sheet_sync_jobs set confirmed_version=greatest(confirmed_version,(item->>'version')::integer),
        confirmed_at=now(),error_code=null
      where kind=item->>'kind' and entity_id=(item->>'id')::uuid and source_version>=(item->>'version')::integer;
    else
      update public.sheet_sync_jobs set error_code=case when item->>'error' in ('auth_failed','permission_denied','destination_conflict','header_conflict','provider_unavailable','ack_mismatch','destination_missing') then item->>'error' else 'provider_unavailable' end,
        ready_at=now()+make_interval(secs=>greatest(least(3600,30*power(2,least(attempts,6)))::integer,least(86400,coalesce((item->>'retry_after')::integer,0))))
      where kind=item->>'kind' and entity_id=(item->>'id')::uuid and confirmed_version<(item->>'version')::integer;
    end if;
  end loop;
  update public.sheet_sync_control set lease_token=null,lease_until=null where singleton;
end $$;

create function public.sheet_sync_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_active() then raise exception 'Access denied' using errcode='42501'; end if;
  return (select jsonb_build_object('enabled',(select enabled from public.sheet_sync_config where singleton),
    'total',count(*),'pending',count(*) filter(where confirmed_version<source_version),
    'failed',count(*) filter(where confirmed_version<source_version and error_code is not null),
    'confirmed',count(*) filter(where confirmed_version=source_version),'last_confirmed_at',max(confirmed_at))
    from public.sheet_sync_jobs where public.can_read_lead(lead_id));
end $$;
revoke execute on function public.queue_sheet_lead(),public.queue_sheet_activity(),public.claim_sheet_jobs(uuid,integer),public.finish_sheet_jobs(uuid,jsonb),public.sheet_sync_status() from public,anon,authenticated;
grant execute on function public.claim_sheet_jobs(uuid,integer),public.finish_sheet_jobs(uuid,jsonb) to service_role;
grant execute on function public.sheet_sync_status() to authenticated;
