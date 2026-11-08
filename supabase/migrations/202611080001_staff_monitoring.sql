-- Shared Master Prospek + append-only Log Aktivitas. No client-side role trust.
create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  email text not null,
  role text not null default 'staff' check (role in ('staff','admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create function public.on_staff_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff_profiles(id, display_name, email)
  values(new.id, coalesce(nullif(left(new.raw_user_meta_data->>'display_name',100),''),split_part(new.email,'@',1)),new.email);
  return new;
end $$;
create trigger staff_user_created after insert on auth.users
for each row execute function public.on_staff_user_created();
-- Migration also covers users already present; all remain inactive until explicitly enabled.
insert into public.staff_profiles(id,display_name,email)
select id,split_part(email,'@',1),email from auth.users where email is not null on conflict do nothing;

create function public.staff_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_profiles where id=auth.uid() and active)
$$;
create function public.staff_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_profiles where id=auth.uid() and active and role='admin')
$$;

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 1 and 150),
  phone text not null default '' check(length(phone)<=40),
  program text not null check(program in ('small-talker','kid-talker','junior-talker','senior-talker','adult-talker','undecided')),
  pic_id uuid not null references public.staff_profiles(id),
  flow_step text not null default 'connect' check(flow_step in ('connect','explore','educate','experience','closing','care')),
  sales_stage text not null default 'new' check(sales_stage in ('new','contacted','trial','trial_attended','registered','lost')),
  response text not null default 'unknown' check(response in ('unknown','no_response','considering','interested','not_interested','follow_up_needed')),
  priority text not null default 'medium' check(priority in ('high','medium','low')),
  dormant boolean not null default false,
  last_contact_at timestamptz,
  next_action text not null default '' check(length(next_action)<=1000),
  follow_up_on date,
  trial_at timestamptz,
  registered_on date,
  notes text not null default '' check(length(notes)<=6000),
  created_by uuid not null references public.staff_profiles(id),
  updated_by uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index sales_leads_pic on public.sales_leads(pic_id);
create index sales_leads_followup on public.sales_leads(follow_up_on);
create index sales_leads_stage on public.sales_leads(sales_stage);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id),
  actor_id uuid not null references public.staff_profiles(id),
  actor_name text not null,
  action text not null check(action in ('created','updated')),
  note text not null default '' check(length(note)<=6000),
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index activities_lead_time on public.lead_activities(lead_id,created_at desc);
create table public.lead_save_requests (
  actor_id uuid not null references public.staff_profiles(id),
  request_id uuid not null,
  payload jsonb not null,
  lead_id uuid not null references public.sales_leads(id),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
create table public.daily_top_picks (
  user_id uuid not null references public.staff_profiles(id),
  day date not null,
  slot integer not null check(slot between 1 and 3),
  lead_id uuid not null references public.sales_leads(id),
  primary key(user_id,day,slot),
  unique(user_id,day,lead_id)
);

create function public.can_read_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_active() and exists(select 1 from public.sales_leads where id=p_lead and (pic_id=auth.uid() or public.staff_admin()))
$$;

alter table public.staff_profiles enable row level security;
alter table public.sales_leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_save_requests enable row level security;
alter table public.daily_top_picks enable row level security;
create policy profiles_read on public.staff_profiles for select to authenticated using(id=auth.uid() or public.staff_admin());
create policy leads_read on public.sales_leads for select to authenticated using(public.staff_active() and (pic_id=auth.uid() or public.staff_admin()));
create policy activities_read on public.lead_activities for select to authenticated using(public.can_read_lead(lead_id));
create policy picks_read on public.daily_top_picks for select to authenticated using(user_id=auth.uid() and public.can_read_lead(lead_id));
revoke all on public.staff_profiles,public.sales_leads,public.lead_activities,public.lead_save_requests,public.daily_top_picks from anon,authenticated;
grant select on public.staff_profiles,public.sales_leads,public.lead_activities,public.daily_top_picks to authenticated;
grant all on public.staff_profiles,public.sales_leads,public.lead_activities,public.lead_save_requests,public.daily_top_picks to service_role;

create function public.staff_directory() returns table(id uuid,display_name text,role text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.display_name,p.role from public.staff_profiles p where p.active and public.staff_active() order by p.display_name
$$;

create function public.save_sales_lead(p_request_id uuid,p_data jsonb,p_lead_id uuid default null,p_expected_version integer default null,p_activity text default '')
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
    where key not in ('name','phone','program','pic_id','flow_step','sales_stage','response','priority','dormant','last_contact_at','next_action','follow_up_on','trial_at','registered_on','notes')
  ) then raise exception 'Unexpected or oversized lead fields' using errcode='22023'; end if;
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
  new_row.notes := coalesce(p_data->>'notes','');
  new_row.created_by := case when is_new then actor else old_row.created_by end;
  new_row.updated_by := actor;
  new_row.created_at := case when is_new then now() else old_row.created_at end;
  new_row.updated_at := now();new_row.version := case when is_new then 1 else old_row.version+1 end;
  if is_new then
    insert into public.sales_leads select new_row.*;
  else
    update public.sales_leads set
      name=new_row.name,phone=new_row.phone,program=new_row.program,pic_id=new_row.pic_id,
      flow_step=new_row.flow_step,sales_stage=new_row.sales_stage,response=new_row.response,priority=new_row.priority,dormant=new_row.dormant,
      last_contact_at=new_row.last_contact_at,next_action=new_row.next_action,follow_up_on=new_row.follow_up_on,
      trial_at=new_row.trial_at,registered_on=new_row.registered_on,notes=new_row.notes,
      updated_by=actor,updated_at=new_row.updated_at,version=new_row.version where id=new_row.id;
  end if;
  insert into public.lead_activities(lead_id,actor_id,actor_name,action,note,changes)
  values(new_row.id,actor,(select display_name from public.staff_profiles where id=actor),case when is_new then 'created' else 'updated' end,p_activity,
    jsonb_build_object('before',case when is_new then null else to_jsonb(old_row) end,'after',to_jsonb(new_row)));
  insert into public.lead_save_requests(actor_id,request_id,payload,lead_id,result)
  values(actor,p_request_id,payload,new_row.id,to_jsonb(new_row));
  return to_jsonb(new_row);
end $$;

create function public.set_daily_top3(p_day date,p_leads uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer; item uuid;
begin
  if not public.staff_active() then raise exception 'Access denied' using errcode='42501'; end if;
  if p_day is null or p_leads is null or cardinality(p_leads)>3 then raise exception 'Maximum three leads' using errcode='22023'; end if;
  if cardinality(p_leads)<>(select count(distinct x) from unnest(p_leads) x) then raise exception 'Duplicate lead' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_day::text,1));
  foreach item in array p_leads loop
    if not public.can_read_lead(item) then raise exception 'Access denied' using errcode='42501'; end if;
  end loop;
  delete from public.daily_top_picks where user_id=auth.uid() and day=p_day;
  n:=0;
  foreach item in array p_leads loop
    n:=n+1; insert into public.daily_top_picks(user_id,day,slot,lead_id) values(auth.uid(),p_day,n,item);
  end loop;
end $$;

-- Used by the Edge Function after it validates the calling admin; client role flags are ignored.
create function public.admin_set_staff_access(p_target uuid,p_role text,p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.staff_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(81480321);
  if p_role not in ('admin','staff') or p_role is null or p_active is null then raise exception 'Invalid role' using errcode='22023'; end if;
  if not exists(select 1 from public.staff_profiles where id=p_target) then raise exception 'Staff not found' using errcode='22023'; end if;
  if (not p_active or p_role<>'admin') and exists(select 1 from public.staff_profiles where id=p_target and active and role='admin')
     and (select count(*) from public.staff_profiles where active and role='admin')<=1 then
    raise exception 'At least one active admin must remain' using errcode='22023';
  end if;
  update public.staff_profiles set role=p_role,active=p_active where id=p_target;
end $$;

-- Revoke PostgreSQL's implicit PUBLIC execute privilege, including helper/trigger functions.
revoke execute on function public.on_staff_user_created() from public,anon,authenticated;
revoke execute on function public.staff_active(), public.staff_admin(), public.can_read_lead(uuid), public.staff_directory(),
 public.save_sales_lead(uuid,jsonb,uuid,integer,text),public.set_daily_top3(date,uuid[]),public.admin_set_staff_access(uuid,text,boolean) from public,anon;
grant execute on function public.staff_active(),public.staff_admin(),public.can_read_lead(uuid),public.staff_directory(),
 public.save_sales_lead(uuid,jsonb,uuid,integer,text),public.set_daily_top3(date,uuid[]),public.admin_set_staff_access(uuid,text,boolean) to authenticated;
