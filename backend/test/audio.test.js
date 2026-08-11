const http = require('http');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:3001';
const UPLOADS = path.join(__dirname, '../uploads');

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf.slice(0, 200) }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
const check = (n, c, d='') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const files = () => fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : [];

(async () => {
  const src = fs.readFileSync(require('path').join(__dirname,'validate.js'), 'utf8');
  eval(src.slice(src.indexOf('const SR = 8000;'), src.indexOf('// ─── Test Runner')));

  const doc = await req('POST', '/api/auth/login', { email: 'doctor@wellsim.com', password: 'password123' });
  const nurse = await req('POST', '/api/auth/login', { email: 'nurse@wellsim.com', password: 'password123' });
  const docTok = doc.body.token, nurseTok = nurse.body.token;

  console.log('\n── Upload a file ───────────────────────────────────');
  const before = files().length;
  const wav = toWav(addCrackles(normalBreathing(10), 6));
  const up = await req('POST', '/api/device/audio', {
    device_id: 'FILE-UPLOAD', patient_id: 'p3', type: 'lung',
    duration: '0:10', audio_base64: wav.toString('base64'), mime_type: 'audio/wav',
  }, nurseTok);
  check('upload accepted', up.body.success, JSON.stringify(up.body).slice(0,150));
  check('file written to disk', files().length === before + 1, `${before} → ${files().length}`);
  check('screened on arrival', !!up.body.analysis);
  console.log(`     label=${up.body.analysis?.label} triage=${up.body.analysis?.triage?.level}`);
  const storedFile = files().find(f => f.includes('FILE-UPLOAD'));
  check('filename tagged with source', !!storedFile, files().join(','));

  console.log('\n── Reject junk uploads ─────────────────────────────');
  const anonUp = await req('POST', '/api/device/audio', {
    device_id: 'X', patient_id: 'p3', type: 'lung', audio_base64: 'A'.repeat(200), mime_type: 'audio/wav' });
  check('unauthenticated upload blocked', anonUp.status === 401, `got ${anonUp.status}`);
  const tiny = await req('POST', '/api/device/audio', {
    device_id: 'X', patient_id: 'p3', type: 'lung', audio_base64: 'AAAA', mime_type: 'audio/wav' }, nurseTok);
  check('too-short base64 rejected', tiny.status === 400, `got ${tiny.status}`);
  const noB64 = await req('POST', '/api/device/audio', { device_id: 'X', patient_id: 'p3', type: 'lung' }, nurseTok);
  check('missing audio rejected', noB64.status === 400);

  console.log('\n── Doctor signs it off ─────────────────────────────');
  const rev = await req('POST', '/api/analysis/p3/lung/review',
    { action: 'confirm', note: 'Crackles present.' }, docTok);
  check('review recorded', rev.body.success);
  check('status confirmed', rev.body.review?.status === 'confirmed');

  console.log('\n── Delete ──────────────────────────────────────────');
  const anon = await req('DELETE', '/api/device/audio/p3/lung');
  check('anonymous delete blocked (401)', anon.status === 401, `got ${anon.status}`);

  const badType = await req('DELETE', '/api/device/audio/p3/brain', null, nurseTok);
  check('invalid type rejected', badType.status === 400, `got ${badType.status}`);

  const del = await req('DELETE', '/api/device/audio/p3/lung', null, nurseTok);
  check('nurse can delete a recording', del.body.success, JSON.stringify(del.body).slice(0,150));
  check('file removed from disk', del.body.fileRemoved === true);
  check('file really gone', !files().includes(storedFile), files().join(','));
  check('warns that a signed review was destroyed', del.body.hadReview === true);
  check('message mentions the review', /review/i.test(del.body.message || ''), del.body.message);

  const after = await req('GET', '/api/analysis/p3', null, docTok);
  check('analysis dropped with the audio', !after.body.analyses?.lung, JSON.stringify(after.body.analyses||{}).slice(0,80));

  const pat = await req('GET', '/api/patients/p3', null, docTok);
  check('audioLogs cleared', pat.body.patient?.audioLogs?.lung?.available === false);
  check('risk recomputed from vitals', /vitals/i.test(pat.body.patient?.riskSource || ''), pat.body.patient?.riskSource);

  const again = await req('DELETE', '/api/device/audio/p3/lung', null, nurseTok);
  check('deleting twice gives 404', again.status === 404, `got ${again.status}`);

  const ghost = await req('DELETE', '/api/device/audio/pXX/lung', null, nurseTok);
  check('unknown patient gives 404', ghost.status === 404);

  console.log('\n── Path traversal ──────────────────────────────────');
  const trav = await req('DELETE', '/api/device/audio/..%2F..%2Fetc/lung', null, nurseTok);
  check('traversal in patient id rejected', trav.status === 404 || trav.status === 400, `got ${trav.status}`);
  // `../../` from the uploads directory reaches the backend root. This
  // asserted `/tmp/wsz/server.js`, a path nothing ever creates, so it
  // failed on every platform and proved nothing either way.
  check('server.js still on disk', fs.existsSync(path.join(UPLOADS, '../server.js')));

  console.log(`\n${'═'.repeat(52)}\n  PASSED: ${pass}   FAILED: ${fail}\n${'═'.repeat(52)}\n`);
  process.exit(fail ? 1 : 0);
})();
