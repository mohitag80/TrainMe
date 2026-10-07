#!/usr/bin/env python3
"""
End-to-end check of the Profile page APIs (FR-PRF-01, v1.5) against a running stack.
  BASE_URL=https://localhost:8443 python3 src/deploy/compose/scripts/e2e-profile.py
Uses ravi@ and puts his name, units and time zone back at the end, so it is re-runnable.
"""
import base64, json, os, ssl, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get('BASE_URL', 'https://localhost:8443').rstrip('/')
PWD = os.environ.get('TEST_USER_PASSWORD', 'Passw0rd!')
CTX = ssl._create_unverified_context()
FAILS = []
# 1×1 white JPEG – the web app sends a 256 px JPEG; the API only checks type and size.
PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='


def token(user):
    body = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'trainme-cli', 'username': f'{user}@trainme.test', 'password': PWD}).encode()
    with urllib.request.urlopen(urllib.request.Request(f'{BASE}/auth/realms/trainme/protocol/openid-connect/token', body), context=CTX) as r:
        return json.load(r)['access_token']


def call(tok, method, path, body=None, headers=None, raw=False):
    req = urllib.request.Request(f'{BASE}/api/v1{path}', None if body is None else json.dumps(body).encode(), method=method,
                                 headers={'Authorization': f'Bearer {tok}', 'content-type': 'application/json', **(headers or {})})
    for wait in (0, 2, 5, 10, 20):  # Kong rate-limits bursts (429): back off and retry
        time.sleep(wait)
        try:
            with urllib.request.urlopen(req, context=CTX) as r:
                data = r.read()
                if raw:
                    return r.status, data, r.headers.get('content-type')
                return r.status, (json.loads(data) if data else None)
        except urllib.error.HTTPError as e:
            data = e.read()
            if e.code != 429:
                return (e.code, data, e.headers.get('content-type')) if raw else (e.code, json.loads(data) if data else None)
    return 429, None


def check(label, ok, detail=''):
    print(f"  {'✅' if ok else '❌'} {label}{'  – ' + str(detail) if detail and not ok else ''}")
    if not ok:
        FAILS.append(label)


print(f'Stack: {BASE}')
tok = token('ravi')
_, before = call(tok, 'GET', '/profiles/me')
put = lambda body: call(tok, 'PUT', '/profiles/me', body)

print('1. Personal details')
details = {'firstName': 'Ravi', 'middleName': 'Kumar', 'lastName': 'Sharma', 'mobile': '+91 98765 43210',
           'dateOfBirth': '1998-04-12', 'gender': 'MALE', 'heightCm': 178, 'weightKg': 72.5,
           'addressLine1': '12 MG Road', 'addressLine2': '', 'city': 'Bengaluru', 'state': 'Karnataka',
           'postalCode': '560001', 'country': 'India'}
st, p = put(details)
check('save all details', st == 200, p)
check('display name follows first + last name', p.get('displayName') == 'Ravi Sharma', p.get('displayName'))
check('blank optional field is stored as empty', p.get('addressLine2') is None, p.get('addressLine2'))
check('every field round-trips', all(p.get(k) == v for k, v in details.items() if v), {k: p.get(k) for k in details})
st, r = put({'mobile': '12-34'})
check('too-short mobile → 422', st == 422 and r['errors'][0]['pointer'] == '/body/mobile', r)
st, r = put({'mobile': 'call me'})
check('letters in mobile → 422', st == 422, r)
st, r = put({'dateOfBirth': '2999-01-01'})
check('future date of birth → 422', st == 422, r)
st, r = put({'firstName': ''})
check('empty first name → 422', st == 422, r)

print('2. Profile picture')
st, r, _ = call(tok, 'DELETE', '/profiles/me/avatar', raw=True)
st, r, _ = call(tok, 'GET', '/profiles/me/avatar', raw=True)
check('no picture → 404', st == 404, st)
st, p = call(tok, 'PUT', '/profiles/me/avatar', {'image': f'data:image/jpeg;base64,{PIXEL}'})
check('upload a picture', st == 200 and p['avatarUpdatedAt'], p)
st, data, ctype = call(tok, 'GET', '/profiles/me/avatar', raw=True)
check('download returns the same bytes as an image', st == 200 and ctype == 'image/jpeg' and data == base64.b64decode(PIXEL), (st, ctype))
big = base64.b64encode(b'\xff' * (151 * 1024)).decode()
st, r = call(tok, 'PUT', '/profiles/me/avatar', {'image': f'data:image/jpeg;base64,{big}'})
check('picture over 150 KB → 422', st == 422, r)
st, r = call(tok, 'PUT', '/profiles/me/avatar', {'image': 'data:text/html;base64,PGgxPg=='})
check('not an image → 422', st == 422, r)
st, p = call(tok, 'DELETE', '/profiles/me/avatar')
check('remove the picture', st == 200 and p['avatarUpdatedAt'] is None, p)

print('3. Settings (units and time zone)')
st, p = put({'timezone': 'Asia/Kolkata', 'unitPreset': 'IMPERIAL'})
check('switch to imperial + Kolkata', st == 200 and p['unitPreferences']['mass'] == 'IMPERIAL' and p['timezone'] == 'Asia/Kolkata', p)
check('stored height is not converted', p['heightCm'] == 178, p['heightCm'])

# Put Ravi back as the other scripts expect him.
put({'firstName': before.get('firstName') or 'Ravi', 'lastName': before.get('lastName') or 'Batter', 'displayName': before['displayName'],
     'unitPreferences': before['unitPreferences'], 'timezone': before['timezone']})
print()
print('All profile checks passed.' if not FAILS else f'{len(FAILS)} check(s) failed: {FAILS}')
sys.exit(1 if FAILS else 0)
