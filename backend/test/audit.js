const http = require('http');
const BASE = 'http://127.0.0.1:3001';
function req(method, p, body, token) {
  return new Promise((res) => {
    const d = body ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json' };
    if (d) h['Content-Length'] = Buffer.byteLength(d);
    if (token) h['Authorization'] = `Bearer ${token}`;
    const r = http.request(BASE + p, { method, headers: h }, (x) => {
      let b = ''; x.on('data', c => b += c);
      x.on('end', () => { try { res({ status: x.statusCode, body: JSON.parse(b) }); } catch { res({ status: x.statusCode, body: b.slice(0,150) }); } });
    });
    r.on('error', () => res({ status: 0, body: null }));
    if (d) r.write(d); r.end();
  });
}
const F = [];
const vuln = (sev, name, detail) => { F.push({sev,name,detail}); console.log(`  ${sev==='CRIT'?'🔴':sev==='HIGH'?'🟠':'🟡'} [${sev}] ${name}\n       ${detail}`); };
const ok = (name) => console.log(`  ✅ ${name}`);

(async () => {
  const nurse = (await req('POST','/api/auth/login',{email:'nurse@wellsim.com',password:'password123'})).body.token;
  const patient = (await req('POST','/api/auth/login',{email:'patient@wellsim.com',password:'password123'})).body.token;

  console.log('\n── A. Role escalation via self-registration ────────');
  const selfDoc = await req('POST','/api/auth/register',{name:'Fake Doctor',email:`hax${Date.now()}@x.com`,password:'password123',role:'doctor'});
  if (selfDoc.body.success) {
    const tok = selfDoc.body.token;
    const up = await req('POST','/api/device/audio',{device_id:'X',patient_id:'p1',type:'lung',audio_base64:'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='.repeat(3)});
    const rev = await req('POST','/api/analysis/p1/lung/review',{action:'confirm'},tok);
    vuln('CRIT','Anyone can self-register as a doctor',
      `POST /api/auth/register with role:"doctor" succeeded, no verification. Review endpoint then returned ${rev.status}.`);
  } else ok('doctor self-registration blocked');

  console.log('\n── B. Patient account reading other patients ───────');
  const all = await req('GET','/api/patients',null,patient);
  if (all.status === 200 && Array.isArray(all.body.patients)) {
    vuln('CRIT','Patient role can list EVERY patient record',
      `GET /api/patients returned ${all.body.patients.length} records incl. ${all.body.patients.map(p=>p.name).slice(0,3).join(', ')}. PDPA breach.`);
  } else ok('patient cannot list all patients');

  const other = await req('GET','/api/patients/p2',null,patient);
  if (other.status === 200) vuln('CRIT','Patient can read any record by ID (IDOR)', `GET /api/patients/p2 → 200, name=${other.body.patient?.name}`);
  else ok('cross-patient read blocked');

  const del = await req('DELETE','/api/patients/p3',null,patient);
  if (del.status === 200) vuln('CRIT','Patient account can DELETE patient records', 'DELETE /api/patients/p3 → 200');
  else ok('patient cannot delete records');

  const anal = await req('GET','/api/analysis/p1',null,patient);
  if (anal.status === 200) vuln('HIGH','Patient can read another patient\'s AI analyses', 'GET /api/analysis/p1 → 200');
  else ok('cross-patient analysis read blocked');

  console.log('\n── C. Unauthenticated device endpoints ─────────────');
  const cmd = await req('POST','/api/device/command',{device_id:'ESP32-INMP441-A',command:'record',patient_id:'p1',type:'lung'});
  if (cmd.status === 200) vuln('HIGH','Anyone can command the device to record',
    'POST /api/device/command needs no auth — remote attacker can make the stethoscope record a patient.');
  else ok('device command requires auth');

  const aud = await req('POST','/api/device/audio',{device_id:'X',patient_id:'p1',type:'lung',audio_base64:'A'.repeat(200)});
  if (aud.status !== 401) vuln('HIGH','Anyone can attach audio to any patient',
    `POST /api/device/audio needs no auth → ${aud.status}. Lets an attacker plant recordings into a medical record.`);
  else ok('audio upload requires auth');

  const delA = await req('DELETE','/api/device/audio/p1/lung');
  if (delA.status !== 401) vuln('HIGH','Unauthenticated audio delete', `→ ${delA.status}`);
  else ok('audio delete requires auth');

  console.log('\n── D. Token forgery ────────────────────────────────');
  const crypto = require('crypto');
  const payload = Buffer.from(JSON.stringify({userId:'u999',email:'x@x',role:'doctor',name:'Forged',iat:Date.now(),exp:Date.now()+1e7})).toString('base64url');
  const sig = crypto.createHmac('sha256','wellsim-secret-key-2026').update(payload).digest('base64url');
  const forged = await req('GET','/api/patients',null,`${payload}.${sig}`);
  if (forged.status === 200) vuln('CRIT','Default token secret is hardcoded in the repo',
    'A token signed with the fallback secret "wellsim-secret-key-2026" was accepted. Anyone with the source can mint a doctor token.');
  else ok('forged token rejected');

  console.log('\n── E. Password storage ─────────────────────────────');
  // Log in with a legacy account, then inspect how the hash is stored.
  await req('POST','/api/auth/login',{email:'nurse@wellsim.com',password:'password123'});
  await req('POST','/api/auth/login',{email:'doctor@wellsim.com',password:'password123'});
  let dbRaw = null;
  try { dbRaw = JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'../data/db.json'),'utf8')); } catch {}
  if (dbRaw) {
    const a = dbRaw.users.find(u=>u.email==='nurse@wellsim.com')?.password || '';
    const b = dbRaw.users.find(u=>u.email==='doctor@wellsim.com')?.password || '';
    if (!a.startsWith('scrypt$')) vuln('HIGH','Passwords not stored with scrypt', `stored as: ${a.slice(0,20)}…`);
    else ok('passwords stored with scrypt + per-user salt');
    if (a && b && a === b) vuln('HIGH','Identical passwords produce identical hashes','salt is not per-user');
    else ok('identical passwords hash differently (per-user salt)');
  } else console.log('  ⓘ could not read db.json to inspect hashes');

  const burst = [];
  for (let i=0;i<12;i++) burst.push(await req('POST','/api/auth/login',{email:'nobody@x.com',password:'g'}));
  if (!burst.some(r=>r.status===429)) vuln('HIGH','No rate limit on login','12 rapid attempts all accepted — credential stuffing is free');
  else ok('login rate-limited (429 after repeated failures)');

  console.log('\n── F. Input validation ─────────────────────────────');
  const neg = await req('PUT','/api/patients/p1/vitals',{spo2:-500,heartRate:99999},nurse);
  if (neg.status === 200) vuln('MED','Vitals accept physiologically impossible values',
    `spo2:-500, heartRate:99999 stored without complaint → risk score computed from nonsense.`);
  else ok('vitals range-checked');

  const longName = await req('POST','/api/patients',{name:'A'.repeat(100000)},nurse);
  if (longName.status === 201) vuln('MED','No length cap on text fields', '100k-character patient name accepted.');
  else ok('field length capped');

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${F.filter(f=>f.sev==='CRIT').length} critical · ${F.filter(f=>f.sev==='HIGH').length} high · ${F.filter(f=>f.sev==='MED').length} medium`);
  console.log(`${'═'.repeat(56)}\n`);
})();
