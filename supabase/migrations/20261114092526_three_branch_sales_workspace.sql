-- Three ETU branches share one CRM and one application-owned Master export.
-- Existing Citra Raya leads and staff keep their current branch.
alter table public.staff_profiles add column branch_code text not null default 'citra_raya'
  check(branch_code in ('taman_royal','citra_raya','palem_semi'));
alter table public.sales_leads add column branch_code text not null default 'citra_raya'
  check(branch_code in ('taman_royal','citra_raya','palem_semi'));
create index sales_leads_branch_stage on public.sales_leads(branch_code,sales_stage);

create or replace function public.can_read_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.staff_active() and exists(
    select 1 from public.sales_leads l where l.id=p_lead and
      (public.staff_admin() or (l.pic_id=auth.uid() and l.branch_code=
        (select p.branch_code from public.staff_profiles p where p.id=auth.uid() and p.active)))
  )
$$;
drop policy leads_read on public.sales_leads;
create policy leads_read on public.sales_leads for select to authenticated
using(public.staff_active() and (public.staff_admin() or
  (pic_id=auth.uid() and branch_code=(select p.branch_code from public.staff_profiles p where p.id=auth.uid() and p.active))));

create or replace function public.staff_directory() returns table(id uuid,display_name text,role text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.display_name,p.role from public.staff_profiles p
  where p.active and public.staff_active() and
    (public.staff_admin() or p.branch_code=(select branch_code from public.staff_profiles where id=auth.uid()))
  order by p.display_name
$$;
create function public.staff_directory_v2() returns table(id uuid,display_name text,role text,branch_code text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.display_name,p.role,p.branch_code from public.staff_profiles p
  where p.active and public.staff_active() and
    (public.staff_admin() or p.branch_code=(select branch_code from public.staff_profiles where id=auth.uid()))
  order by p.display_name
$$;
revoke execute on function public.staff_directory_v2() from public,anon;
grant execute on function public.staff_directory_v2() to authenticated;

create function public.admin_set_staff_branch(p_target uuid,p_branch text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.staff_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_branch not in ('taman_royal','citra_raya','palem_semi') then raise exception 'Invalid branch' using errcode='22023'; end if;
  if not exists(select 1 from public.staff_profiles where id=p_target) then raise exception 'Staff not found' using errcode='22023'; end if;
  if exists(select 1 from public.sales_leads where pic_id=p_target and branch_code<>p_branch) then
    raise exception 'Reassign existing leads before moving staff branch' using errcode='22023';
  end if;
  update public.staff_profiles set branch_code=p_branch where id=p_target;
end $$;
revoke execute on function public.admin_set_staff_branch(uuid,text) from public,anon;
grant execute on function public.admin_set_staff_branch(uuid,text) to authenticated;

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
    where key not in ('name','phone','program','pic_id','flow_step','sales_stage','response','priority','dormant','last_contact_at','next_action','follow_up_on','trial_at','registered_on','notes','master_details','branch_code')
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
  new_row.branch_code := coalesce(nullif(p_data->>'branch_code',''),case when is_new then (select branch_code from public.staff_profiles where id=actor) else old_row.branch_code end);
  if new_row.branch_code not in ('taman_royal','citra_raya','palem_semi') then raise exception 'Invalid branch' using errcode='22023'; end if;
  if not public.staff_admin() and new_row.branch_code<>(select branch_code from public.staff_profiles where id=actor) then raise exception 'Wrong staff branch' using errcode='42501'; end if;
  if not exists(select 1 from public.staff_profiles where id=assigned and active and (role='admin' or branch_code=new_row.branch_code)) then raise exception 'PIC must belong to the branch' using errcode='22023'; end if;
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
      name=new_row.name,phone=new_row.phone,program=new_row.program,pic_id=new_row.pic_id,branch_code=new_row.branch_code,
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
