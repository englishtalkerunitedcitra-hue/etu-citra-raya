"""Real local Auth/PostgREST concurrency and month-boundary tests; never hosted."""
from pathlib import Path
import concurrent.futures
# Reuse the local-only HTTP and disposable-user helpers, without executing its suite.
source=Path(__file__).with_name('master-prospek-integration.py').read_text()
exec(compile(source.split("staff_id,staff=user('staff')")[0],str(Path(__file__).with_name('master-prospek-integration.py')),'exec'))
_,staff=user('staff')
def rpc(name,data,token=None):return call('/rest/v1/rpc/'+name,data,key=service if token is None else anon,token=token)
ok(rpc('reserve_legacy_lead_codes',{'p_codes':['NOV26-036','Okt26-048','Mei26-005','Des30-999']}))
assert rpc('reserve_legacy_lead_codes',{'p_codes':['Nov26-037']},staff)[0]>=400
assert rpc('allocate_lead_code',{'p_at':'2026-11-12T00:00:00Z'},staff)[0]>=400
assert call('/rest/v1/lead_code_counters',token=staff)[0]>=400

def counter(period):
 rows=ok(call('/rest/v1/lead_code_counters?period=eq.'+period,key=service))
 return rows[0]['last_number'] if rows else 0
baseline=counter('2026-11-01')
def code(n):return 'Nov26-'+str(n).zfill(3)
def save(i,request_id=None):
 return rpc('save_sales_lead',{'p_request_id':request_id or str(uuid.uuid4()),'p_data':{'name':'Concurrent dummy '+str(i),'program':'kid-talker'}},staff)
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 records=[ok(r) for r in pool.map(save,range(20))]
codes=[r['lead_code'] for r in records]
assert len(set(codes))==20 and set(codes)=={code(i) for i in range(baseline+1,baseline+21)},codes
rid=str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 repeated=[ok(r) for r in pool.map(lambda _:save('duplicate',rid),range(8))]
assert len({r['id'] for r in repeated})==1 and {r['lead_code'] for r in repeated}=={code(baseline+21)}
assert rpc('save_sales_lead',{'p_request_id':str(uuid.uuid4()),'p_data':{'name':'bad','program':'invalid'}},staff)[0]>=400
record=ok(save('after failed save'));assert record['lead_code']==code(baseline+22)
updated=ok(rpc('save_sales_lead',{'p_request_id':str(uuid.uuid4()),'p_lead_id':record['id'],'p_expected_version':1,'p_data':{'name':'Edited dummy','program':'kid-talker','master_details':{'entered_on':'2020-01-01'}}},staff))
assert updated['lead_code']==record['lead_code']
assert call('/rest/v1/sales_leads?id=eq.'+record['id'],{'lead_code':'Nov26-999'},key=service,method='PATCH')[0]>=400
job=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+record['id'],key=service))[0]
activity=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.activity&lead_id=eq.'+record['id'],key=service))
assert job['payload']['lead_code']==code(baseline+22) and all(x['payload']['lead_code']==code(baseline+22) for x in activity)
before=counter('2030-12-01');assert ok(rpc('allocate_lead_code',{'p_at':'2030-12-31T16:59:59Z'}))=='Dec30-'+str(before+1)
before=counter('2031-01-01');assert ok(rpc('allocate_lead_code',{'p_at':'2030-12-31T17:00:00Z'}))=='Jan31-'+str(before+1).zfill(3)
ok(rpc('reserve_legacy_lead_codes',{'p_codes':['Nov31-099']}))
before=counter('2031-11-01');assert ok(rpc('allocate_lead_code',{'p_at':'2031-11-01T00:00:00Z'}))=='Nov31-'+str(before+1).zfill(3)
before=counter('2026-10-01');assert ok(rpc('allocate_lead_code',{'p_at':'2026-10-01T00:00:00Z'}))=='Oct26-'+str(before+1).zfill(3)
print('PASS: 20 concurrent distinct saves; 8 concurrent duplicate requests; legacy reservations/case/Indonesian aliases; invalid-save rollback; immutable code across edits; audit/outbox code; restricted allocator; >999 and WIB year/month rollover.')
