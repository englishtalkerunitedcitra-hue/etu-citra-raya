"""Exercise template fields through real local Auth/PostgREST and queue triggers.
Requires ETU_LOCAL_BACKEND_STATUS; refuses hosted backends. No production data.
"""
import json, os, uuid
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError
s=json.loads(Path(os.environ['ETU_LOCAL_BACKEND_STATUS']).read_text())
base=s['API_URL'];assert urlsplit(base).hostname=='127.0.0.1'
service=s['SERVICE_ROLE_KEY'];anon=s['ANON_KEY']
def call(path,data=None,key=anon,token=None,method=None):
 r=Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'apikey':key,'Authorization':'Bearer '+(token or key),'Content-Type':'application/json'},method=method)
 try:
  with urlopen(r,timeout=30) as f:raw=f.read();return f.status,json.loads(raw) if raw else None
 except HTTPError as e:return e.code,json.load(e)
def ok(r):assert r[0]<300,r;return r[1]
run=uuid.uuid4().hex;password='Dummy-'+run+'!'
def user(role):
 email=role+'-'+uuid.uuid4().hex+'@example.test';u=ok(call('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},service))
 ok(call('/rest/v1/staff_profiles?id=eq.'+u['id'],{'role':role,'active':True},service,method='PATCH'))
 t=ok(call('/auth/v1/token?grant_type=password',{'email':email,'password':password}))['access_token'];return u['id'],t
staff_id,staff=user('staff');_,admin=user('admin');_,other=user('staff')
details={'parent_name':'Dummy Parent','student_name':'Dummy Student','school':'Dummy School','age':'10','domicile':'Citra Raya','lead_source':'School Event','source_detail':'Dummy Event','temperature':'Warm','follow_up_count':'2','trial_attendance':'Hadir','recommended_level':'Dummy Level','recommended_schedule':'Saturday','decision_barrier':'Schedule','payment_status':'Payment 1','entered_on':'2026-11-12','legacy_lead_id':'DUMMY-001'}
payload={'p_request_id':str(uuid.uuid4()),'p_data':{'name':'Dummy Student','program':'kid-talker','sales_stage':'follow_up_after_trial','master_details':details},'p_activity':'Dummy follow-up'}
result=ok(call('/rest/v1/rpc/save_sales_lead',payload,token=staff));assert result['master_details']==details
assert ok(call('/rest/v1/rpc/save_sales_lead',payload,token=staff))==result
lead_id=result['id'];path='/rest/v1/sales_leads?id=eq.'+lead_id
assert ok(call(path,token=admin))[0]['master_details']==details
assert ok(call(path,token=other))==[]
assert call(path)[0]>=400
assert call(path,{'master_details':{}},token=staff,method='PATCH')[0]>=400
for bad in [{'age':'121'},{'entered_on':'2026-02-30'},{'unexpected':'x'},{'school':{'unsafe':'object'}},{'school':'x'*501},{'follow_up_count':'-1'}]:
 p={**payload,'p_request_id':str(uuid.uuid4()),'p_data':{**payload['p_data'],'master_details':bad}}
 assert call('/rest/v1/rpc/save_sales_lead',p,token=staff)[0]>=400,bad
# Partial detail edits merge, and older clients omitting details retain all values.
p={**payload,'p_request_id':str(uuid.uuid4()),'p_lead_id':lead_id,'p_expected_version':1,'p_data':{**payload['p_data'],'master_details':{'payment_status':'Lunas'}}}
r=ok(call('/rest/v1/rpc/save_sales_lead',p,token=staff));assert r['master_details']=={**details,'payment_status':'Lunas'}
assert call('/rest/v1/rpc/save_sales_lead',{**p,'p_request_id':str(uuid.uuid4())},token=staff)[0]==409
p['p_data'].pop('master_details');p.update(p_request_id=str(uuid.uuid4()),p_expected_version=2)
r=ok(call('/rest/v1/rpc/save_sales_lead',p,token=staff));assert r['master_details']['payment_status']=='Lunas'
queue=ok(call('/rest/v1/sheet_sync_jobs?kind=eq.master&entity_id=eq.'+lead_id,key=service))[0]
assert queue['payload']['master_details']==r['master_details'] and queue['source_version']==3
history=ok(call('/rest/v1/lead_activities?lead_id=eq.'+lead_id,token=admin));assert len(history)==3
assert any(x['changes']['after']['master_details'].get('payment_status')=='Lunas' for x in history)
print('PASS: complete template fields, independent admin read, PIC isolation, direct write rejection, input validation, idempotency, conflicts, partial/legacy updates, audit and transactional outbox.')
# Exercise real form serialization and independent admin session on a phone layout.
from playwright.sync_api import sync_playwright, expect
config=Path(__file__).resolve().parents[1]/'staff/config.js';original=config.read_bytes()
try:
 config.write_text('window.ETU_STAFF_CONFIG='+json.dumps({'supabaseUrl':base,'supabaseAnonKey':anon})+';\n')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  contexts=[]
  def page_for(token,width):
   context=browser.new_context(viewport={'width':width,'height':900});contexts.append(context)
   page=context.new_page();page.goto('http://127.0.0.1:8000/staff/')
   # Use the actual login UI, so session handling and RLS are exercised.
   import base64
   uid=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))['sub']
   profile=ok(call('/auth/v1/admin/users/'+uid,key=service))
   page.locator('#login-form input[name=email]').fill(profile['email'])
   page.locator('#login-form input[name=password]').fill(password);page.locator('#login-button').click()
   expect(page.locator('#dashboard')).to_be_visible(timeout=20000);return page
  sp=page_for(staff,390);ap=page_for(admin,1440)
  sp.locator('#add-lead').click();sp.locator('[name=name]').fill('Browser Master '+run)
  for key,value in details.items():sp.locator('[name=master_'+key+']').fill(value)
  sp.locator('[name=sales_stage]').select_option('placement_test_booked')
  sp.locator('[name=activity]').fill('Template browser dummy')
  assert sp.locator('#lead-dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
  sp.locator('#save-lead').click();expect(sp.locator('#lead-dialog')).not_to_be_visible(timeout=15000)
  ap.bring_to_front();ap.locator('#refresh').click();expect(ap.locator('#refresh')).to_be_enabled(timeout=15000);ap.locator('#filters input[name=search]').fill('Browser Master '+run);row=ap.locator('.lead-row').filter(has_text='Browser Master '+run)
  expect(row).to_be_visible(timeout=15000)
  browser_record=ok(call('/rest/v1/sales_leads?id=eq.'+row.get_attribute('data-lead-id'),key=service))[0]
  if browser_record.get('lead_code'):expect(row).to_contain_text(browser_record['lead_code'])
  row.get_by_role('button',name='Buka / follow-up').dispatch_event('click')
  if browser_record.get('lead_code'):expect(ap.locator('#lead-id')).to_contain_text(browser_record['lead_code'])
  for key,value in details.items():expect(ap.locator('[name=master_'+key+']')).to_have_value(value)
  expect(ap.locator('[name=sales_stage]')).to_have_value('placement_test_booked')
  sp.locator('.lead-row').filter(has_text='Browser Master '+run).get_by_role('button',name='Buka / follow-up').dispatch_event('click')
  preview=Path('/tmp/etu-master-preview');preview.mkdir(exist_ok=True)
  sp.screenshot(path=str(preview/'mobile.png'));ap.screenshot(path=str(preview/'admin.png'))
  browser.close()
 print('PASS: all template fields saved via real mobile form and reopened unchanged in independent admin browser; mobile dialog fits viewport.')
finally:config.write_bytes(original)
