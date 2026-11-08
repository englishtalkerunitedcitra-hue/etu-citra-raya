"""Real PostgreSQL/Auth queue tests. Google acknowledgements are simulated here.
No Google/Sheet requests are made. Use only the disposable local test backend.
"""
import json,os,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit
s=json.loads(Path(os.environ['ETU_LOCAL_BACKEND_STATUS']).read_text());API=s['API_URL'];KEY=s['SERVICE_ROLE_KEY'];ANON=s['ANON_KEY']
assert urlsplit(API).hostname=='127.0.0.1'
def call(path,method='GET',body=None,token=KEY):
 req=Request(API+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'apikey':KEY if token==KEY else ANON,'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urlopen(req,timeout=10) as r:
   raw=r.read();return r.status,json.loads(raw) if raw else None
 except HTTPError as e:return e.code,json.loads(e.read())
def ok(result):
 code,data=result;assert 200<=code<300,(code,data);return data
run=uuid.uuid4().hex;email=run+'@example.test';password='Sheet-Test-'+run
user=ok(call('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True}))
ok(call('/rest/v1/staff_profiles?id=eq.'+user['id'],'PATCH',{'active':True}))
token=ok(call('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password},ANON))['access_token']
def sync_endpoint(jwt,job_token=None):
 headers={'apikey':ANON,'Authorization':'Bearer '+jwt,'Content-Type':'application/json'}
 if job_token:headers['x-job-token']=job_token
 req=Request(API+'/functions/v1/sheets-sync',data=b'{}',headers=headers)
 try:
  with urlopen(req,timeout=10) as r:return r.status,json.load(r)
 except HTTPError as e:return e.code,json.load(e)
assert sync_endpoint(ANON)[0]==401
assert sync_endpoint(token)[0]==403
ok(call('/rest/v1/staff_profiles?id=eq.'+user['id'],'PATCH',{'role':'admin'}))
code,body=sync_endpoint(token);assert code==503 and 'belum dikonfigurasi' in body['error']
ok(call('/rest/v1/staff_profiles?id=eq.'+user['id'],'PATCH',{'role':'staff'}))
assert sync_endpoint(KEY,'incorrect-job-token')[0]==401
assert sync_endpoint(KEY,s['SHEETS_JOB_TOKEN'])[0]==503
print('PASS: real sync endpoint rejects anonymous/staff and incorrect scheduler credentials; admin/scheduler with missing Google credentials fail closed without writing.')
lead=ok(call('/rest/v1/rpc/save_sales_lead','POST',{'p_request_id':str(uuid.uuid4()),'p_data':{'name':'Sheet queue test','program':'kid-talker'}},token))
jobs=ok(call('/rest/v1/sheet_sync_jobs?lead_id=eq.'+lead['id']));assert len(jobs)==2
assert call('/rest/v1/sheet_sync_jobs',token=token)[0]>=400
assert call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':str(uuid.uuid4())},token)[0]>=400
status=ok(call('/rest/v1/rpc/sheet_sync_status','POST',{},token));assert status['pending']==2 and not status['enabled']
first=ok(call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':str(uuid.uuid4())}));assert first['disabled']
config=ok(call('/rest/v1/sheet_sync_config'))[0]
try:
 ok(call('/rest/v1/sheet_sync_config?singleton=eq.true','PATCH',{'enabled':True}))
 worker=str(uuid.uuid4());batch=ok(call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':worker}))
 master=next(j for j in batch['jobs'] if j['kind']=='master' and j['entity_id']==lead['id'])
 other=ok(call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':str(uuid.uuid4())}));assert other['busy']
 updated=ok(call('/rest/v1/rpc/save_sales_lead','POST',{'p_request_id':str(uuid.uuid4()),'p_lead_id':lead['id'],'p_expected_version':1,'p_data':{'name':'Newer lead version','program':'kid-talker'}},token))
 ok(call('/rest/v1/rpc/finish_sheet_jobs','POST',{'p_token':worker,'p_results':[{'kind':'master','id':lead['id'],'version':1,'ok':True}]}))
 current=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+lead['id']))[0]
 assert current['row_number']==master['row_number'] and current['source_version']==2 and current['confirmed_version']==1
 assert ok(call('/rest/v1/rpc/sheet_sync_status','POST',{},token))['pending']==3
 worker=str(uuid.uuid4());batch=ok(call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':worker}))
 newest=next(j for j in batch['jobs'] if j['entity_id']==lead['id']);assert newest['payload']['name']=='Newer lead version'
 ok(call('/rest/v1/rpc/finish_sheet_jobs','POST',{'p_token':worker,'p_results':[{'kind':'master','id':lead['id'],'version':2,'ok':False,'error':'permission_denied','retry_after':120}]}))
 failed=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+lead['id']))[0];assert failed['confirmed_version']==1 and failed['error_code']=='permission_denied'
 # Failed delivery keeps current version pending; a later simulated provider acknowledgement clears it.
 ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+lead['id'],'PATCH',{'ready_at':'2000-01-01T00:00:00Z'}))
 worker=str(uuid.uuid4());batch=ok(call('/rest/v1/rpc/claim_sheet_jobs','POST',{'p_token':worker}))
 ok(call('/rest/v1/rpc/finish_sheet_jobs','POST',{'p_token':worker,'p_results':[{'kind':'master','id':lead['id'],'version':2,'ok':True}]}))
 done=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+lead['id']))[0];assert done['confirmed_version']==2 and done['error_code'] is None
 assert done['row_number']==master['row_number']
 print('PASS: real DB transactional enqueue/backfill, restricted worker RPCs, per-PIC status, exclusive lease, version-aware acknowledgements, stable row IDs, and failure/retry state. Google acknowledgements were simulated; live Sheet was not accessed.')
finally:ok(call('/rest/v1/sheet_sync_config?singleton=eq.true','PATCH',{'enabled':config['enabled']}))
