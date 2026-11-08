"""Resource-light, real Auth/PostgREST/PostgreSQL test stack; not a production server.
All containers are official upstream images, labeled, and bound to loopback.
Ctrl-C stops only containers created by this script. Requires Docker + npm Deno 2.5.6.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen,build_opener,HTTPRedirectHandler

ROOT=Path(__file__).resolve().parents[1]
TMP=Path('/tmp/etu-staff-local');TMP.mkdir(mode=0o700,exist_ok=True)
NAMES=['etu-staff-test-db','etu-staff-test-auth','etu-staff-test-rest','etu-staff-test-mail']
LABEL='com.etu.staff-test=yes'
NET='etu-staff-test'
created=[];edge=None

def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def quiet(args,**kwargs):return run(args,stdout=subprocess.DEVNULL,**kwargs)
def envfile(name,values):
    path=TMP/name;path.write_text('\n'.join(f'{key}={value}' for key,value in values.items())+'\n');path.chmod(0o600);return str(path)
def container(name,image,env,ports):
    args=['docker','run','-d','--name',name,'--label',LABEL,'--network',NET,'--env-file',env]
    for mapping in ports:args+=['-p','127.0.0.1:'+mapping]
    args.append(image);quiet(args);created.append(name)
def wait_http(url,seconds=90):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            with urlopen(url,timeout=2) as response:
                if response.status<500:return
        except (OSError,HTTPError):pass
        time.sleep(.5)
    raise RuntimeError('Service not ready: '+url)
def token(role,secret):
    def encode(data):return base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).decode().rstrip('=')
    body=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'role':role,'iss':'supabase','iat':int(time.time()),'exp':int(time.time())+86400})
    return body+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=build_opener(NoRedirect)
class Gateway(BaseHTTPRequestHandler):
    def log_message(self,*args):pass # Never log tokens, contact fields or auth requests.
    def do_OPTIONS(self):
        self.send_response(204);self.cors();self.end_headers()
    def cors(self):
        origin=self.headers.get('Origin')
        if origin=='http://127.0.0.1:8000':self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,prefer,range,range-unit,x-supabase-api-version,accept-profile,content-profile')
        self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Expose-Headers','content-range');self.send_header('Cache-Control','no-store')
    def proxy(self):
        if self.path.startswith('/auth/v1/'):
            target='http://127.0.0.1:55499/'+self.path[len('/auth/v1/'):]
        elif self.path.startswith('/rest/v1/'):
            target='http://127.0.0.1:55433/'+self.path[len('/rest/v1/'):]
        elif self.path.startswith('/functions/v1/staff-admin'):
            target='http://127.0.0.1:55481/'
        else:
            self.send_error(404);return
        body=self.rfile.read(int(self.headers.get('Content-Length',0))) if self.headers.get('Content-Length') else None
        headers={k:v for k,v in self.headers.items() if k.lower() in ['authorization','content-type','apikey','prefer','range','range-unit','origin','x-client-info','x-supabase-api-version','accept-profile','content-profile']}
        try:response=opener.open(Request(target,data=body,headers=headers,method=self.command),timeout=30)
        except HTTPError as error:response=error
        except URLError:
            self.send_error(502);return
        data=response.read();self.send_response(response.status);self.cors()
        for key in ['Content-Type','Content-Range','Location']:
            if response.headers.get(key):self.send_header(key,response.headers[key])
        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    do_GET=proxy;do_POST=proxy;do_PUT=proxy;do_PATCH=proxy;do_DELETE=proxy

try:
    for name in NAMES:
        if subprocess.run(['docker','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
            raise RuntimeError('Existing test container; stop the prior test stack first: '+name)
    if subprocess.run(['docker','network','inspect',NET],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        quiet(['docker','network','create','--label',LABEL,NET])
    secret=secrets.token_urlsafe(40);password=secrets.token_hex(20)
    container(NAMES[0],'postgres:17.6-bookworm',envfile('db.env',{'POSTGRES_PASSWORD':password}),['55432:5432'])
    deadline=time.monotonic()+60
    while subprocess.run(['docker','exec',NAMES[0],'pg_isready','-h','127.0.0.1','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        if time.monotonic()>deadline:raise RuntimeError('PostgreSQL not ready')
        time.sleep(.5)
    bootstrap=f"""
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login password '{password}';
grant anon,authenticated,service_role to authenticator;
create role supabase_auth_admin login password '{password}';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path=auth;
grant usage on schema auth to anon,authenticated,service_role;
grant usage on schema public to anon,authenticated,service_role;
"""
    run(['docker','exec','-i',NAMES[0],'psql','-U','postgres','-v','ON_ERROR_STOP=1'],input=bootstrap.encode(),stdout=subprocess.DEVNULL)
    container(NAMES[3],'axllent/mailpit:v1.27.0',envfile('mail.env',{}),['55425:8025'])
    container(NAMES[1],'supabase/gotrue:v2.180.0',envfile('auth.env',{
        'GOTRUE_API_HOST':'0.0.0.0','GOTRUE_API_PORT':'9999','API_EXTERNAL_URL':'http://127.0.0.1:54321',
        'GOTRUE_SITE_URL':'http://127.0.0.1:8000/staff/','GOTRUE_URI_ALLOW_LIST':'http://127.0.0.1:8000/staff/',
        'GOTRUE_DB_DRIVER':'postgres','GOTRUE_DB_DATABASE_URL':f'postgres://supabase_auth_admin:{password}@{NAMES[0]}:5432/postgres?search_path=auth',
        'GOTRUE_DB_NAMESPACE':'auth','GOTRUE_JWT_SECRET':secret,'GOTRUE_JWT_AUD':'authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated',
        'GOTRUE_JWT_ADMIN_ROLES':'service_role','GOTRUE_JWT_EXP':'3600','GOTRUE_DISABLE_SIGNUP':'true',
        'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED':'false','GOTRUE_PASSWORD_MIN_LENGTH':'12',
        'GOTRUE_SMTP_HOST':NAMES[3],'GOTRUE_SMTP_PORT':'1025','GOTRUE_SMTP_ADMIN_EMAIL':'noreply@etu.example','GOTRUE_SMTP_SENDER_NAME':'ETU local test',
        'GOTRUE_MAILER_AUTOCONFIRM':'false','GOTRUE_SMTP_MAX_FREQUENCY':'1s','GOTRUE_RATE_LIMIT_EMAIL_SENT':'100',
        'GOTRUE_MAILER_URLPATHS_INVITE':'/auth/v1/verify','GOTRUE_MAILER_URLPATHS_RECOVERY':'/auth/v1/verify',
    }),['55499:9999'])
    wait_http('http://127.0.0.1:55499/health')
    uid_sql="""create or replace function auth.uid() returns uuid language sql stable as $$
select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;"""
    run(['docker','exec','-i',NAMES[0],'psql','-U','postgres','-v','ON_ERROR_STOP=1'],input=uid_sql.encode(),stdout=subprocess.DEVNULL)
    migration=(ROOT/'supabase/migrations/202611080001_staff_monitoring.sql').read_bytes()
    run(['docker','exec','-i',NAMES[0],'psql','-U','postgres','-v','ON_ERROR_STOP=1'],input=migration,stdout=subprocess.DEVNULL)
    container(NAMES[2],'postgrest/postgrest:v12.2.12',envfile('rest.env',{
        'PGRST_DB_URI':f'postgres://authenticator:{password}@{NAMES[0]}:5432/postgres','PGRST_DB_SCHEMAS':'public',
        'PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,'PGRST_SERVER_PORT':'3000','PGRST_DB_MAX_ROWS':'1000',
    }),['55433:3000'])
    anon=token('anon',secret);service=token('service_role',secret)
    info={'API_URL':'http://127.0.0.1:54321','ANON_KEY':anon,'SERVICE_ROLE_KEY':service}
    (TMP/'status.json').write_text(json.dumps(info));(TMP/'status.json').chmod(0o600)
    server=ThreadingHTTPServer(('127.0.0.1',54321),Gateway);threading.Thread(target=server.serve_forever,daemon=True).start()
    edge_env={**os.environ,'SUPABASE_URL':info['API_URL'],'SUPABASE_ANON_KEY':anon,'SUPABASE_SERVICE_ROLE_KEY':service,
      'STAFF_ALLOWED_ORIGINS':'http://127.0.0.1:8000','STAFF_REDIRECT_URL':'http://127.0.0.1:8000/staff/','STAFF_LOCAL_PORT':'55481'}
    edge_log=open(TMP/'edge.log','w')
    edge=subprocess.Popen(['npm','--cache','/tmp/etu-npm-cache','exec','--yes','--package=deno@2.5.6','--','deno','run','--allow-env','--allow-net',str(ROOT/'supabase/functions/staff-admin/index.ts')],cwd=ROOT,env=edge_env,stdout=edge_log,stderr=edge_log,start_new_session=True)
    # An unauthenticated request to the real function should be rejected with 401.
    deadline=time.monotonic()+30
    while True:
        try:
            with urlopen(Request('http://127.0.0.1:55481/',data=b'{}',headers={'Content-Type':'application/json'}),timeout=2) as response:pass
        except HTTPError as error:
            if error.code==401:break
        except OSError:pass
        if time.monotonic()>deadline:raise RuntimeError('Local Edge Function not ready; inspect /tmp/etu-staff-local/edge.log')
        time.sleep(.5)
    print('Local PostgreSQL 17 + Supabase Auth + PostgREST + exact admin function are ready.',flush=True)
    print('Run ETU_LOCAL_BACKEND_STATUS=/tmp/etu-staff-local/status.json npm run test:integration',flush=True)
    while True:time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    if edge:
        os.killpg(edge.pid,signal.SIGTERM)
    for name in reversed(created):subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
