-- Human-readable IDs are independent of stable UUID relationships.
-- Existing leads keep their current identifiers; only new inserts allocate codes.
alter table public.sales_leads add column lead_code text unique
  check (lead_code ~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[0-9]{2}-[0-9]{3,}$');
create table public.lead_code_counters (
  period date primary key check (extract(day from period)=1),
  last_number bigint not null check (last_number>=0)
);
create table public.lead_code_reservations (
  period date not null references public.lead_code_counters(period),
  number bigint not null check (number>0),
  primary key(period,number)
);
alter table public.lead_code_counters enable row level security;
alter table public.lead_code_reservations enable row level security;
revoke all on public.lead_code_counters,public.lead_code_reservations from public,anon,authenticated;
grant all on public.lead_code_counters,public.lead_code_reservations to service_role;

create function public.reserve_legacy_lead_codes(p_codes text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare item text; parts text[]; m integer; period_value date; n bigint; total integer:=0;
begin
  if p_codes is null or cardinality(p_codes)>10000 then raise exception 'Invalid code batch'; end if;
  foreach item in array p_codes loop
    parts:=regexp_match(trim(item),'^([A-Za-z]{3})([0-9]{2})-([0-9]+)$');
    if parts is null then raise exception 'Invalid legacy lead code'; end if;
    m:=array_position(array['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],upper(parts[1]));
    if upper(parts[1])='MEI' then m:=5; end if;
    if upper(parts[1])='OKT' then m:=10; end if;
    if upper(parts[1])='DES' then m:=12; end if;
    n:=parts[3]::bigint;
    if m is null or n<1 then raise exception 'Invalid legacy lead code'; end if;
    period_value:=make_date(2000+parts[2]::integer,m,1);
    insert into public.lead_code_counters(period,last_number) values(period_value,n)
      on conflict(period) do update set last_number=greatest(lead_code_counters.last_number,excluded.last_number);
    insert into public.lead_code_reservations(period,number) values(period_value,n) on conflict do nothing;
    total:=total+1;
  end loop;
  return total;
end $$;
revoke all on function public.reserve_legacy_lead_codes(text[]) from public,anon,authenticated;
grant execute on function public.reserve_legacy_lead_codes(text[]) to service_role;

create function public.allocate_lead_code(p_at timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare period_value date:=date_trunc('month',p_at at time zone 'Asia/Jakarta')::date;
 n bigint; result text;
begin
  if p_at is null then raise exception 'Timestamp required'; end if;
  loop
    insert into public.lead_code_counters(period,last_number) values(period_value,1)
      on conflict(period) do update set last_number=lead_code_counters.last_number+1
      returning last_number into n;
    insert into public.lead_code_reservations(period,number) values(period_value,n) on conflict do nothing;
    exit when found;
  end loop;
  result:=(array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from period_value)::integer]
    ||to_char(period_value,'YY')||'-'||case when n<1000 then lpad(n::text,3,'0') else n::text end;
  return result;
end $$;
revoke all on function public.allocate_lead_code(timestamptz) from public,anon,authenticated;
grant execute on function public.allocate_lead_code(timestamptz) to service_role;

create function public.assign_lead_code() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.lead_code is not null then raise exception 'Lead code is server assigned'; end if;
    new.lead_code:=public.allocate_lead_code(new.created_at);
  elsif new.lead_code is distinct from old.lead_code then
    raise exception 'Lead code is immutable';
  end if;
  return new;
end $$;
revoke all on function public.assign_lead_code() from public,anon,authenticated;
create trigger assign_lead_code before insert or update on public.sales_leads
for each row execute function public.assign_lead_code();

create or replace function public.save_sales_lead(p_request_id uuid,p_data jsonb,p_lead_id uuid default null,p_expected_version integer default null,p_activity text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); old_row public.sales_leads; new_row public.sales_leads;
  saved public.lead_save_requests; assigned uuid; payload jsonb;
  is_new boolean := p_lead_id is null;
begin
  if not public.staff_active() then raise exception 'Access denied' using errcode='42501'; end if;
  if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' or p_activity is null or length(p_activity)>6000 then
    raise exception 'Invalid save request' using errcode='22023';
  end if;
  if octet_length(p_data::text)>24000 or exists (
    select 1 from jsonb_object_keys(p_data) as k(key)
    where key not in ('name','phone','program','pic_id','flow_step','sales_stage','response','priority','dormant','last_contact_at','next_action','follow_up_on','trial_at','registered_on','notes','master_details')
  ) then raise exception 'Unexpected or oversized lead fields' using errcode='22023'; end if;

  if p_data ? 'master_details' then
    if jsonb_typeof(p_data->'master_details') <> 'object' then
      raise exception 'Invalid Master Prospek fields' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_each(p_data->'master_details') e
      where e.key not in ('entered_on','parent_name','student_name','school','age','domicile','lead_source','source_detail','temperature','follow_up_count','trial_attendance','recommended_level','recommended_schedule','decision_barrier','payment_status','legacy_lead_id') or jsonb_typeof(e.value)<>'string' or length(e.value #>> '{}')>500) then
      raise exception 'Unexpected Master Prospek field or value' using errcode='22023';
    end if;
    if coalesce(p_data->'master_details'->>'age','')<>'' and
       (p_data->'master_details'->>'age') !~ '^(0|[1-9][0-9]?|1[01][0-9]|120)$' then
      raise exception 'Invalid age' using errcode='22023';
    end if;
    if coalesce(p_data->'master_details'->>'follow_up_count','')<>'' and
       (p_data->'master_details'->>'follow_up_count') !~ '^(0|[1-9][0-9]{0,4}|100000)$' then
      raise exception 'Invalid follow-up count' using errcode='22023';
    end if;
    if coalesce(p_data->'master_details'->>'entered_on','')<>'' then
      if (p_data->'master_details'->>'entered_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Invalid entered date' using errcode='22023';
      end if;
      perform (p_data->'master_details'->>'entered_on')::date;
    end if;
  end if;
  payload := jsonb_build_object('data',p_data,'lead',p_lead_id,'version',p_expected_version,'activity',p_activity);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  select * into saved from public.lead_save_requests where actor_id=actor and request_id=p_request_id;
  if found then
    if saved.payload<>payload then raise exception 'Request ID reused with different data' using errcode='22023'; end if;
    if not public.can_read_lead(saved.lead_id) then raise exception 'Access denied' using errcode='42501'; end if;
    return saved.result;
  end if;
  if not is_new then
    select * into old_row from public.sales_leads where id=p_lead_id for update;
    if not found or not public.can_read_lead(p_lead_id) then raise exception 'Access denied' using errcode='42501'; end if;
    if p_expected_version is null or old_row.version<>p_expected_version then
      raise exception 'Lead changed in another session. Reload before saving.' using errcode='PT409';
    end if;
  end if;
  assigned := coalesce(nullif(p_data->>'pic_id','')::uuid,case when is_new then actor else old_row.pic_id end);
  if assigned<>actor and not public.staff_admin() then raise exception 'Only admin can assign another PIC' using errcode='42501'; end if;
  if not exists(select 1 from public.staff_profiles where id=assigned and active) then raise exception 'PIC is inactive' using errcode='22023'; end if;
  new_row.id := coalesce(p_lead_id,gen_random_uuid());
  new_row.lead_code := case when is_new then null else old_row.lead_code end;
  new_row.name := trim(p_data->>'name');
  new_row.phone := coalesce(trim(p_data->>'phone'),'');
  new_row.program := p_data->>'program'; new_row.pic_id := assigned;
  new_row.flow_step := coalesce(p_data->>'flow_step','connect');
  new_row.sales_stage := coalesce(p_data->>'sales_stage','new');
  new_row.response := coalesce(p_data->>'response','unknown');
  new_row.priority := coalesce(p_data->>'priority','medium');
  new_row.dormant := coalesce((p_data->>'dormant')::boolean,false);
  new_row.last_contact_at := nullif(p_data->>'last_contact_at','')::timestamptz;
  new_row.next_action := coalesce(trim(p_data->>'next_action'),'');
  new_row.follow_up_on := nullif(p_data->>'follow_up_on','')::date;
  new_row.trial_at := nullif(p_data->>'trial_at','')::timestamptz;
  new_row.registered_on := nullif(p_data->>'registered_on','')::date;
  new_row.master_details := coalesce(case when not is_new then old_row.master_details end,'{}'::jsonb) || coalesce(p_data->'master_details','{}'::jsonb);
  new_row.notes := coalesce(p_data->>'notes','');
  new_row.created_by := case when is_new then actor else old_row.created_by end;
  new_row.updated_by := actor;
  new_row.created_at := case when is_new then now() else old_row.created_at end;
  new_row.updated_at := now();new_row.version := case when is_new then 1 else old_row.version+1 end;
  if is_new then
    insert into public.sales_leads select new_row.* returning * into new_row;
  else
    update public.sales_leads set
      name=new_row.name,phone=new_row.phone,program=new_row.program,pic_id=new_row.pic_id,
      flow_step=new_row.flow_step,sales_stage=new_row.sales_stage,response=new_row.response,priority=new_row.priority,dormant=new_row.dormant,
      last_contact_at=new_row.last_contact_at,next_action=new_row.next_action,follow_up_on=new_row.follow_up_on,
      trial_at=new_row.trial_at,registered_on=new_row.registered_on,notes=new_row.notes,master_details=new_row.master_details,
      updated_by=actor,updated_at=new_row.updated_at,version=new_row.version where id=new_row.id;
  end if;
  insert into public.lead_activities(lead_id,actor_id,actor_name,action,note,changes)
  values(new_row.id,actor,(select display_name from public.staff_profiles where id=actor),case when is_new then 'created' else 'updated' end,p_activity,
    jsonb_build_object('before',case when is_new then null else to_jsonb(old_row) end,'after',to_jsonb(new_row)));
  insert into public.lead_save_requests(actor_id,request_id,payload,lead_id,result)
  values(actor,p_request_id,payload,new_row.id,to_jsonb(new_row));
  return to_jsonb(new_row);
end $$;

create or replace function public.queue_sheet_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sheet_sync_jobs(kind,entity_id,lead_id,row_number,source_version,payload)
  values('activity',new.id,new.lead_id,nextval('public.sheet_activity_rows'),1,to_jsonb(new)||jsonb_build_object('lead_code',(select lead_code from public.sales_leads where id=new.lead_id)))
  on conflict do nothing;
  return new;
end $$;
