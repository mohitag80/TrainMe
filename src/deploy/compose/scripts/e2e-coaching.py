#!/usr/bin/env python3
"""
End-to-end check of trainers and coaching (docs/12 §8) against a running stack.
  BASE_URL=https://localhost:8443 python3 src/deploy/compose/scripts/e2e-coaching.py
Trainee: meera@. Trainers: coach@ (T1), coach2@ (T2), coach3@ (T3). admin@ checks that technical accounts never coach. Re-runnable: it ends old connections first
and names its sessions "Coaching test …" (suffixes are added automatically).
"""
import datetime as dt, json, os, ssl, sys, time, urllib.error, urllib.parse, urllib.request, uuid

BASE = os.environ.get('BASE_URL', 'https://localhost:8443').rstrip('/')
PWD = os.environ.get('TEST_USER_PASSWORD', 'Passw0rd!')
CTX = ssl._create_unverified_context()
FAILS = []


def token(user):
    body = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'trainme-cli', 'username': f'{user}@trainme.test', 'password': PWD}).encode()
    with urllib.request.urlopen(urllib.request.Request(f'{BASE}/auth/realms/trainme/protocol/openid-connect/token', body), context=CTX) as r:
        return json.load(r)['access_token']


class User:
    def __init__(self, name):
        self.name, self.tok = name, token(name)
        self.id = self.call('GET', '/profiles/me')[1]['id']

    def call(self, method, path, body=None):
        req = urllib.request.Request(f'{BASE}/api/v1{path}', None if body is None else json.dumps(body).encode(), method=method,
                                     headers={'Authorization': f'Bearer {self.tok}', 'content-type': 'application/json'})
        for wait in (0, 2, 5, 10, 20):  # Kong rate-limits bursts (429): back off and retry
            time.sleep(wait)
            try:
                with urllib.request.urlopen(req, context=CTX) as r:
                    txt = r.read().decode()
                    return r.status, (json.loads(txt) if txt else None)
            except urllib.error.HTTPError as e:
                txt = e.read().decode()
                if e.code != 429:
                    return e.code, (json.loads(txt) if txt else None)
        return 429, None


def check(label, ok, detail=''):
    print(f"  {'✅' if ok else '❌'} {label}{'  – ' + str(detail) if detail and not ok else ''}")
    if not ok:
        FAILS.append(label)


def ball(seq, accurate):
    return {'clientEntryId': str(uuid.uuid4()), 'activity': 'cricket.fast.delivery', 'seq': seq,
            'recordedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'values': {'yorker_attempted': False, 'seam_attempted': True, 'seam_accurate': accurate, 'bouncer_attempted': False,
                       'swing_attempted': False, 'slower_ball_attempted': False, 'no_ball': False, 'wide': False, 'target_hit': False,
                       'round_the_wicket': False}}


def start(trainee, tracker, trainer=None, name='Coaching test'):
    body = {'clientSessionId': str(uuid.uuid4()), 'trackerId': tracker['id'], 'name': name, 'onNameConflict': 'SUFFIX',
            'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'timezone': 'Asia/Kolkata', 'source': 'WEB'}
    if trainer:
        body['trainerId'] = trainer.id
    return trainee.call('POST', '/sessions', body)


def batch(user, s, entries, seq=1):
    return user.call('POST', f"/sessions/{s['id']}/entries:batch", {'batchSeq': seq, 'schemaVersion': s['schemaVersion'], 'entries': entries})


print(f'Stack: {BASE}')
meera, t1, t2, t3, ravi, admin = (User(n) for n in ('meera', 'coach', 'coach2', 'coach3', 'ravi', 'admin'))
trainers = [t1, t2, t3]

print('1. Trainers register (self-service)')
for t in trainers:
    st, r = t.call('PUT', '/profiles/me/trainer', {'isTrainer': True, 'bio': f'{t.name} – test trainer', 'specialties': ['Fast bowling', 'Fitness']})
    check(f'{t.name} is a trainer', st == 200 and r['isTrainer'], r)
st, r = admin.call('PUT', '/profiles/me/trainer', {'isTrainer': True})
check('admin (technical account) cannot become a trainer (403)', st == 403, r)
st, r = admin.call('POST', '/profiles/connections', {'trainerId': t1.id})
check('admin cannot take part in coaching (403)', st == 403, r)
check('admin profile says canCoach=false', admin.call('GET', '/profiles/me')[1]['canCoach'] is False)
st, r = meera.call('GET', '/profiles/trainers?q=fast')
check('trainee finds the 3 trainers by specialty', st == 200 and {t.id for t in trainers} <= {x['id'] for x in r['items']}, r)

print('2. Connect (clean start: end old connections)')
for u in (meera, *trainers):
    _, c = u.call('GET', '/profiles/connections')
    for x in c['asTrainee'] + c['asTrainer']:
        if x['otherId'] in {meera.id, *(t.id for t in trainers)}:
            u.call('DELETE', f"/profiles/connections/{x['id']}")
st, r = meera.call('POST', '/profiles/connections', {'trainerId': t1.id})
check('trainee requests T1 → PENDING', st == 201 and r['status'] == 'PENDING', r)
st, r2 = meera.call('POST', f"/profiles/connections/{r['id']}/accept")
check('requester cannot accept own request (403)', st == 403, r2)
st, r2 = t1.call('POST', f"/profiles/connections/{r['id']}/accept")
check('T1 accepts → ACTIVE', st == 200 and r2['status'] == 'ACTIVE', r2)
st, r = t2.call('POST', '/profiles/connections', {'traineeEmail': 'meera@trainme.test'})
check('T2 invites trainee by e-mail', st == 201, r)
st, r2 = meera.call('POST', f"/profiles/connections/{r['id']}/accept")
check('trainee accepts T2', st == 200 and r2['status'] == 'ACTIVE', r2)
st, r = meera.call('POST', '/profiles/connections', {'trainerId': t3.id})
t3.call('POST', f"/profiles/connections/{r['id']}/accept")
st, r = ravi.call('POST', '/profiles/connections', {'traineeEmail': 'meera@trainme.test'})
check('a non-trainer cannot invite (403)', st == 403, r)
_, c = meera.call('GET', '/profiles/connections')
check('trainee has 3 active trainers', sorted(x['status'] for x in c['asTrainee'] if x['otherId'] in {t.id for t in trainers}) == ['ACTIVE'] * 3, c)

_, trs = meera.call('GET', '/trackers')
tracker = next(t for t in trs['items'] if t['status'] == 'ACTIVE' and (t.get('templateCode') or '').startswith('cricket.fast_bowler'))

print('3. Session with a trainer – both record')
st, r = start(meera, tracker, ravi)
check('trainer not connected → 422', st == 422, r)
st, s1 = start(meera, tracker, t1)
check('session with T1 started', st == 201 and s1['trainerId'] == t1.id, s1)
st, live = t1.call('GET', '/sessions/coaching?status=IN_PROGRESS')
check('T1 sees it under Live now', any(x['id'] == s1['id'] for x in live['items']), live)
mine = [ball(1, True), ball(2, False), ball(3, True)]
st, r = batch(meera, s1, mine)
check('trainee logs 3 balls', st == 200 and not r['rejected'], r)
theirs = [ball(4, True), ball(5, True)]
st, r = batch(t1, s1, theirs, seq=1)
check('T1 logs 2 balls in the same session', st == 200 and not r['rejected'], r)
st, full = meera.call('GET', f"/sessions/{s1['id']}?include=entries")
by_t1 = [e for e in full['entries'] if e['recordedBy'] == t1.id]
check('trainee sees 5 entries, 2 recorded by T1', len(full['entries']) == 5 and len(by_t1) == 2, len(full['entries']))
check('entries still belong to the trainee', full['userId'] == meera.id)
st, r = t1.call('GET', f"/sessions/{s1['id']}/schema")
check('T1 reads the pinned schema', st == 200 and r['schemaVersion'] == s1['schemaVersion'], st)
st, r = meera.call('POST', f"/sessions/{s1['id']}/complete", {'endedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'entryCount': 3, 'clientEntryIds': [e['clientEntryId'] for e in mine]})
check('trainee completes with only her own entry ids', st == 200 and r['status'] == 'COMPLETED' and r['entryCount'] == 5, r)

print('4. Sessions with T2 and T3, plus a solo one')
st, s2 = start(meera, tracker, t2)
batch(meera, s2, [ball(1, False), ball(2, False)])
meera.call('POST', f"/sessions/{s2['id']}/complete", {'endedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'entryCount': 2})
st, s3 = start(meera, tracker, t3)
batch(meera, s3, [ball(1, True)])
meera.call('POST', f"/sessions/{s3['id']}/complete", {'endedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'entryCount': 1})

print('5. Isolation between trainers (FR-COA-08)')
st, _ = t1.call('GET', f"/sessions/{s2['id']}")
check("T1 cannot open T2's session (404)", st == 404, st)
st, _ = t2.call('GET', f"/sessions/{s1['id']}?include=entries")
check("T2 cannot open T1's session (404)", st == 404, st)
st, _ = t1.call('POST', f"/sessions/{s2['id']}/entries:batch", {'batchSeq': 9, 'schemaVersion': s2['schemaVersion'], 'entries': [ball(9, True)]})
check("T1 cannot record into T2's session (404)", st == 404, st)
_, hist = t1.call('GET', f'/sessions/coaching?traineeId={meera.id}')
check('T1 history lists only T1 sessions', hist['items'] and all(x['trainerId'] == t1.id for x in hist['items']), [x['trainerId'] for x in hist['items']])
time.sleep(4)  # analytics consumes record.session.completed asynchronously
today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date().isoformat()
q = f"traineeId={meera.id}&trackerId={tracker['id']}&activity=cricket.fast.delivery&metric=seam_accuracy&granularity=DAY&from={today}&to={today}"
_, ser1 = t1.call('GET', f'/analytics/coaching/series?{q}')
_, ser2 = t2.call('GET', f'/analytics/coaching/series?{q}')
p1 = (ser1['points'] or [{}])[-1]
p2 = (ser2['points'] or [{}])[-1]
# T1's sessions today: all "Coaching test" sessions with T1 (this run: 4 of 5 seam balls accurate).
check("T1 chart counts only T1's sessions", p1.get('den', 0) >= 5 and p1.get('sessionCount', 0) >= 1, p1)
check("T2 chart counts only T2's sessions (0 accurate)", p2.get('num') == 0 and p2.get('den', 0) >= 2, p2)
_, trk = t1.call('GET', f'/analytics/coaching/trainees/{meera.id}/trackers')
check('T1 sees the trainee tracker with metrics', trk['items'] and any(m['key'] == 'seam_accuracy' for a in trk['items'][0]['activities'] for m in a['metrics']), trk)

print('6. Feedback (FR-COA-09)')
st, f1 = t1.call('POST', f"/sessions/{s1['id']}/feedback", {'body': 'Good rhythm – keep the wrist behind the ball.'})
check('T1 writes a session note', st == 201, f1)
st, f2 = t1.call('POST', f"/sessions/{s1['id']}/feedback", {'body': 'Ball 2: front foot landed too wide.', 'clientEntryId': mine[1]['clientEntryId']})
check('T1 comments on one ball', st == 201 and f2['clientEntryId'] == mine[1]['clientEntryId'], f2)
st, r = meera.call('GET', f"/sessions/{s1['id']}/feedback")
check('trainee reads both', st == 200 and len(r['items']) >= 2, r)
st, r = meera.call('POST', f"/sessions/{s1['id']}/feedback", {'body': 'me too'})
check('trainee cannot write feedback (403)', st == 403, r)
st, r = t2.call('GET', f"/sessions/{s1['id']}/feedback")
check("T2 cannot read T1's feedback (404)", st == 404, r)
time.sleep(3)
_, inbox = meera.call('GET', '/notifications?limit=10')
check('trainee notified about feedback', any(n['template'] == 'coaching-feedback' for n in inbox['items']), [n['template'] for n in inbox['items']])
_, inbox = t1.call('GET', '/notifications?limit=20')
check('T1 notified about the live session', any(n['template'] == 'coaching-live-session' for n in inbox['items']), [n['template'] for n in inbox['items']])

print('7. Disconnect (FR-COA-10)')
st, s4 = start(meera, tracker, t1, name='Coaching test – disconnect')
_, c = meera.call('GET', '/profiles/connections')
cid = next(x['id'] for x in c['asTrainee'] if x['otherId'] == t1.id)
st, _ = meera.call('DELETE', f'/profiles/connections/{cid}')
check('trainee disconnects T1', st == 204, st)
st, r = batch(t1, s4, [ball(1, True)])
check('T1 can no longer record (403)', st == 403, r)
st, _ = t1.call('GET', f"/sessions/{s1['id']}?include=entries")
check('T1 keeps read access to past sessions', st == 200, st)
st, r = start(meera, tracker, t1)
check('T1 cannot be chosen for a new session (422)', st == 422, r)
meera.call('POST', f"/sessions/{s4['id']}/discard")

print('8. Coach or trainee, never both (v1.5)')
role = lambda u: u.call('GET', '/profiles/me')[1].get('coachingRole')
check('trainee profile says TRAINEE', role(meera) == 'TRAINEE', role(meera))
check('trainer profile says TRAINER', role(t1) == 'TRAINER', role(t1))
check('admin profile says TECHNICAL', role(admin) == 'TECHNICAL', role(admin))
st, r = meera.call('PUT', '/profiles/me/trainer', {'isTrainer': True})
check('a trainee cannot become a coach (409)', st == 409 and r['type'].endswith('/trainee-cannot-coach'), r)
st, r = t1.call('POST', '/profiles/connections', {'trainerId': t2.id})
check('a coach cannot request a trainer (403)', st == 403, r)
st, r = t2.call('POST', '/profiles/connections', {'traineeEmail': 'coach@trainme.test'})
check('a coach cannot be invited as a trainee (403)', st == 403, r)
st, r = t2.call('PUT', '/profiles/me/trainer', {'isTrainer': False})
check('a coach with trainees cannot stop coaching (409)', st == 409 and r['type'].endswith('/coach-has-trainees'), r)
st, r = t2.call('GET', '/profiles/me')
check('…and is still a trainer', r['isTrainer'] is True, r)

print()
print('All coaching checks passed.' if not FAILS else f'{len(FAILS)} check(s) failed: {FAILS}')
sys.exit(1 if FAILS else 0)
