"""Real local Supabase/Auth/RLS + independent browser sessions. Never targets production.
Run npm run backend:start, serve the repository on 127.0.0.1:8000, then this script.
"""
import concurrent.futures
import json
import html
import time
import os
from pathlib import Path
import re
import subprocess
import uuid
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
CLI=ROOT/'node_modules/.bin/supabase'
status=json.loads(Path(os.environ['ETU_LOCAL_BACKEND_STATUS']).read_text()) if os.environ.get('ETU_LOCAL_BACKEND_STATUS') else json.loads(subprocess.check_output([str(CLI),'status','-o','json'],cwd=ROOT,stderr=subprocess.DEVNULL))
API=status['API_URL'];ANON=status['ANON_KEY'];SERVICE=status['SERVICE_ROLE_KEY']
assert urlsplit(API).hostname=='127.0.0.1', 'Tests must only run on local Supabase'
BASE='http://127.0.0.1:8000'
PASSWORD='LocalTest-'+uuid.uuid4().hex+'!'
RUN=uuid.uuid4().hex[:10]


def api(path,method='GET',body=None,token=None,service=False):
    key=SERVICE if service else ANON
    headers={'apikey':key,'Authorization':'Bearer '+(token or key),'Content-Type':'application/json'}
    request=Request(API+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    try:
        with urlopen(request,timeout=30) as response:
            raw=response.read();return response.status,json.loads(raw) if raw else None
    except HTTPError as error:
        raw=error.read()
        try:body=json.loads(raw)
        except ValueError:body={'error':'non-JSON error'}
        return error.code,body


def okay(result):
    code,data=result
    assert 200<=code<300, (code,data)
    return data


def login(email):return okay(api('/auth/v1/token?grant_type=password','POST',{'email':email,'password':PASSWORD}))['access_token']


def profile_for(email):
    rows=okay(api('/rest/v1/staff_profiles?'+urlencode({'email':'eq.'+email,'select':'*'}),service=True))
    assert len(rows)==1
    return rows[0]


# Local service bootstrap only: production first-admin bootstrap is documented separately.
admin_email=f'admin-{RUN}@example.test'
admin=okay(api('/auth/v1/admin/users','POST',{'email':admin_email,'password':PASSWORD,'email_confirm':True,'user_metadata':{'display_name':'Admin Uji'}},service=True))
okay(api('/rest/v1/staff_profiles?id=eq.'+admin['id'],'PATCH',{'role':'admin','active':True},service=True))
admin_token=login(admin_email)
# The deployed Edge Function must enforce the same JWT and DB admin rules used in production.
staff_email=f'staff-{RUN}@example.test'
invite=okay(api('/functions/v1/staff-admin','POST',{'action':'invite','email':staff_email,'display_name':'Staf Uji'},token=admin_token))
assert invite.get('ok'), invite
staff=profile_for(staff_email)
assert staff['active'] and staff['role']=='staff'
if os.environ.get('ETU_LOCAL_BACKEND_STATUS'):
    # Open the actual local email invitation in a fresh browser and set the staff password.
    deadline=time.monotonic()+20
    invitation_url=None
    while not invitation_url and time.monotonic()<deadline:
        with urlopen('http://127.0.0.1:55425/api/v1/messages',timeout=5) as response:mailbox=json.load(response)
        for mail in mailbox.get('messages',[]):
            if not any(recipient.get('Address')==staff_email for recipient in mail.get('To',[])):continue
            with urlopen('http://127.0.0.1:55425/api/v1/message/'+mail['ID'],timeout=5) as response:message=json.load(response)
            candidates=re.findall(r'https?://[^\s\"<>]+',html.unescape(message.get('HTML','')+' '+message.get('Text','')))
            invitation_url=next((url for url in candidates if url.startswith(API+'/auth/v1/verify?')),None)
        if not invitation_url:time.sleep(.5)
    assert invitation_url, 'Invitation email was not captured locally'
    cfg=ROOT/'staff/config.js';original_cfg=cfg.read_bytes()
    cfg.write_text('window.ETU_STAFF_CONFIG='+json.dumps({'supabaseUrl':API,'supabaseAnonKey':ANON})+';\n')
    try:
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            page=browser.new_page()
            page.goto(invitation_url,wait_until='domcontentloaded')
            expect(page.locator('#password-panel')).to_be_visible(timeout=15000)
            page.locator('#password-form input[name=password]').fill(PASSWORD)
            page.locator('#password-form input[name=confirm]').fill(PASSWORD)
            page.locator('#password-form button').click()
            expect(page.locator('#dashboard')).to_be_visible(timeout=15000)
            browser.close()
        print('PASS: actual invitation email opens in a fresh browser; staff sets a password and enters dashboard.')
    finally:cfg.write_bytes(original_cfg)
else:
    okay(api('/auth/v1/admin/users/'+staff['id'],'PUT',{'password':PASSWORD,'email_confirm':True},service=True))
staff_token=login(staff_email)
print('PASS: admin-only Edge invitation creates an active staff account; real Auth password login.')

# No public signups, even with a forged role in user metadata.
code,_=api('/auth/v1/signup','POST',{'email':f'public-{RUN}@example.test','password':PASSWORD,'data':{'role':'admin'}})
assert code>=400,code
code,_=api('/rest/v1/sales_leads')
assert code in (401,403),code
code,_=api('/functions/v1/staff-admin','POST',{'action':'invite','email':'blocked@example.test','display_name':'Blocked'},token=staff_token)
assert code==403,code
code,_=api('/rest/v1/rpc/admin_set_staff_access','POST',{'p_target':staff['id'],'p_role':'admin','p_active':True},token=staff_token)
assert code>=400,code
code,_=api('/rest/v1/staff_profiles?id=eq.'+staff['id'],'PATCH',{'role':'admin'},token=staff_token)
assert code>=400,code
print('PASS: public signup, anonymous direct data access, staff invitations, and client role escalation are denied.')

payload={'p_request_id':str(uuid.uuid4()),'p_data':{'name':f'Lead API {RUN}','program':'kid-talker','pic_id':staff['id'],'next_action':'Konfirmasi trial','follow_up_on':'2026-11-08','sales_stage':'trial','response':'considering','priority':'high','flow_step':'experience'},'p_activity':'Follow-up awal'}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(lambda _:okay(api('/rest/v1/rpc/save_sales_lead','POST',payload,token=staff_token)),range(2)))
assert results[0]['id']==results[1]['id']
lead=results[0]
logs=okay(api('/rest/v1/lead_activities?lead_id=eq.'+lead['id'],token=admin_token))
assert len(logs)==1
visible=okay(api('/rest/v1/sales_leads?id=eq.'+lead['id'],token=admin_token));assert visible[0]['name']==payload['p_data']['name']
code,_=api('/rest/v1/sales_leads','POST',payload['p_data'],token=staff_token);assert code>=400
changed={**payload,'p_data':{**payload['p_data'],'name':'Altered retry'}}
code,_=api('/rest/v1/rpc/save_sales_lead','POST',changed,token=staff_token);assert code>=400
update={**payload,'p_request_id':str(uuid.uuid4()),'p_lead_id':lead['id'],'p_expected_version':1,'p_activity':'Update kedua'}
new=okay(api('/rest/v1/rpc/save_sales_lead','POST',update,token=staff_token));assert new['version']==2
update['p_request_id']=str(uuid.uuid4())
code,data=api('/rest/v1/rpc/save_sales_lead','POST',update,token=staff_token);assert code>=400 and data.get('code')=='PT409'
print('PASS: shared persistence, concurrent duplicate-save protection, append-only audit, rejected direct writes, and stale-version protection.')

# Another authenticated staff member may not view or write this PIC's lead or logs.
other_email=f'other-{RUN}@example.test'
other=okay(api('/auth/v1/admin/users','POST',{'email':other_email,'password':PASSWORD,'email_confirm':True},service=True))
okay(api('/rest/v1/staff_profiles?id=eq.'+other['id'],'PATCH',{'active':True},service=True))
other_token=login(other_email)
assert okay(api('/rest/v1/sales_leads?id=eq.'+lead['id'],token=other_token))==[]
assert okay(api('/rest/v1/lead_activities?lead_id=eq.'+lead['id'],token=other_token))==[]
code,_=api('/rest/v1/rpc/save_sales_lead','POST',{**update,'p_request_id':str(uuid.uuid4()),'p_expected_version':2},token=other_token);assert code>=400
code,_=api('/rest/v1/rpc/save_sales_lead','POST',{**payload,'p_request_id':str(uuid.uuid4()),'p_data':{**payload['p_data'],'pic_id':admin['id']}},token=staff_token);assert code>=400
okay(api('/rest/v1/rpc/set_daily_top3','POST',{'p_day':'2026-11-08','p_leads':[lead['id']]},token=staff_token))
assert okay(api('/rest/v1/daily_top_picks',token=other_token))==[]
code,_=api('/rest/v1/rpc/set_daily_top3','POST',{'p_day':'2026-11-08','p_leads':[lead['id']]*4},token=staff_token);assert code>=400
print('PASS: cross-PIC isolation, protected activity history, PIC assignment limits, and private Top 3 enforcement.')

config_path=ROOT/'staff/config.js';original=config_path.read_bytes()
# Temporary local-only public anon config is always restored, including on failure.
config_path.write_text('window.ETU_STAFF_CONFIG='+json.dumps({'supabaseUrl':API,'supabaseAnonKey':ANON})+';\n')
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        staff_context=browser.new_context(viewport={'width':390,'height':844})
        admin_context=browser.new_context(viewport={'width':1440,'height':1000})
        errors=[]
        def enter(context,email):
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(BASE+'/staff/',wait_until='domcontentloaded')
            page.locator('#login-form input[name=email]').fill(email)
            page.locator('#login-form input[name=password]').fill(PASSWORD)
            page.locator('#login-button').click()
            expect(page.locator('#dashboard')).to_be_visible(timeout=20000)
            return page
        sp=enter(staff_context,staff_email);ap=enter(admin_context,admin_email)
        expect(sp.locator('#admin-section')).to_be_hidden();expect(ap.locator('#admin-section')).to_be_visible()
        sp.locator('#add-lead').click();sp.locator('#lead-form input[name=name]').fill('Prospek Browser '+RUN)
        sp.locator('#lead-form select[name=program]').select_option('kid-talker')
        sp.locator('#lead-form input[name=next_action]').fill('Hubungi orang tua besok')
        sp.locator('#lead-form textarea[name=activity]').fill('Percakapan awal: ingin jadwal sore.')
        sp.locator('#save-lead').click();expect(sp.locator('#lead-dialog')).not_to_be_visible(timeout=15000)
        ap.locator('#refresh').click();expect(ap.locator('#lead-list')).to_contain_text('Prospek Browser '+RUN,timeout=15000)
        row=ap.locator('.lead-row').filter(has_text='Prospek Browser '+RUN);browser_id=row.get_attribute('data-lead-id');assert browser_id
        row.get_by_role('button',name='Buka / follow-up').click();expect(ap.locator('#history')).to_contain_text('Percakapan awal: ingin jadwal sore.')
        ap.locator('#close-editor').click()
        sp.locator('.lead-row').filter(has_text='Prospek Browser '+RUN).locator('.pin').click();expect(sp.locator('#top3')).to_contain_text('Prospek Browser '+RUN)
        ap.locator('#filters input[name=search]').fill('Prospek Browser '+RUN)
        assert sp.evaluate('document.documentElement.scrollWidth<=innerWidth')
        Path('/tmp/etu-staff-preview').mkdir(exist_ok=True)
        sp.screenshot(path='/tmp/etu-staff-preview/mobile.png',full_page=True)
        ap.screenshot(path='/tmp/etu-staff-preview/admin.png',full_page=True)
        ap.locator('#sync-sheet').click()
        expect(ap.locator('#notice')).to_contain_text('Google service account belum dikonfigurasi',timeout=10000)
        assert 'terkonfirmasi' not in ap.locator('#sheet-status').inner_text()
        # Independent third browser: customer remains entirely unauthenticated.
        public=browser.new_context();cp=public.new_page();captured=[]
        def intercept(route):captured.append(route.request.url);route.fulfill(status=200,content_type='text/html',body='<title>Intercepted</title>')
        public.route('https://wa.me/**',intercept)
        cp.goto(BASE+'/trial/?program=kid-talker',wait_until='domcontentloaded')
        expect(cp.locator('#program')).to_have_value('kid-talker')
        for name,value in [('parent','Dummy Parent'),('student','Dummy Child'),('age','9'),('phone','081234567890')]:cp.locator('#'+name).fill(value)
        cp.locator('#schedule').select_option(index=1);cp.locator('#agree').check();cp.locator('#trial-form button').click();cp.wait_for_url('https://wa.me/**')
        assert 'Program: Kid Talker' in parse_qs(urlsplit(captured[0]).query)['text'][0]
        assert not errors,errors
        print('PASS: real staff mobile saves lead; admin on separate browser sees same Lead ID and history; personal Top 3; customer booking without login; no WhatsApp message sent or JS errors.')
        # Disabling staff is enforced by DB despite already-issued JWT/browser session.
        okay(api('/functions/v1/staff-admin','POST',{'action':'access','id':staff['id'],'role':'staff','active':False},token=admin_token))
        assert okay(api('/rest/v1/sales_leads',token=staff_token))==[]
        code,_=api('/rest/v1/rpc/save_sales_lead','POST',{**payload,'p_request_id':str(uuid.uuid4())},token=staff_token);assert code>=400
        sp.locator('#refresh').click();expect(sp.locator('#dashboard')).not_to_be_visible(timeout=15000)
        print('PASS: admin revocation immediately rejects stale-token writes, hides DB rows, and clears the staff dashboard.')
        browser.close()
finally:
    config_path.write_bytes(original)
print('Local integration complete. Dummy records exist only in the disposable local backend.')
