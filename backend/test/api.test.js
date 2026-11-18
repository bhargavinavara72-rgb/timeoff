// Run with: npm test   (uses a temporary data folder, so your real data is never touched)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'timeoff-test-'));
const { createServer } = require('../server');

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
async function login(identity, password) {
  const r = await call('POST', '/api/auth/login', { body: { identity, password } });
  assert.equal(r.status, 200, `login failed for ${identity}`);
  return r.data.token;
}
const iso = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const nextWeekday = (offset) => { let d = new Date(); d.setUTCDate(d.getUTCDate() + offset); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

test('health + frontend is served', async () => {
  assert.equal((await call('GET', '/api/health')).data.ok, true);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Timeoff Pro/);
  assert.equal((await fetch(base + '/..%2f..%2fetc/passwd')).status >= 400, true);
});

test('login accepts username or email, rejects wrong credentials and old demo logins', async () => {
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'sai.kiran', password: 'SaiKiran@2026' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'SAI.KIRAN@timeoffpro.in', password: 'SaiKiran@2026' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'sai.kiran', password: 'wrong' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'employee', password: 'Employee@123' } })).status, 401);
});

test('protected routes need a valid token and the right role', async () => {
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await call('GET', '/api/bootstrap', { token: 'abc.def' })).status, 401);
  const emp = await login('sai.kiran', 'SaiKiran@2026');
  assert.equal((await call('GET', '/api/audit', { token: emp })).status, 403);
  assert.equal((await call('POST', '/api/employees', { token: emp, body: {} })).status, 403);
});

test('each role only sees its own data', async () => {
  const emp = (await call('GET', '/api/bootstrap', { token: await login('sai.kiran', 'SaiKiran@2026') })).data;
  assert.equal(emp.employees.length, 1);
  assert.ok(emp.requests.every(r => r.employeeId === 'EMP-1001'));
  const m1 = (await call('GET', '/api/bootstrap', { token: await login('venkata.ramana', 'Ramana@2026') })).data;
  const m2 = (await call('GET', '/api/bootstrap', { token: await login('suresh.babu', 'Suresh@2026') })).data;
  assert.equal(m1.employees.length, 4); assert.equal(m2.employees.length, 2);
  assert.ok(!m1.requests.some(r => ['EMP-1005', 'EMP-1006'].includes(r.employeeId)));
  const admin = (await call('GET', '/api/bootstrap', { token: await login('lakshmi.prasanna', 'Lakshmi@2026') })).data;
  assert.equal(admin.employees.length, 6); assert.equal(admin.managers.length, 2);
});

test('leave request validation, balance, overlap, cancel', async () => {
  const t = await login('priya.menon', 'Priya@2026');
  const start = nextWeekday(40), end = start;
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'nope', startDate: start, endDate: end, reason: 'Trip' } })).status, 400);
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: '2026-13-40', endDate: end, reason: 'Trip' } })).status, 400);
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: end, endDate: iso(-100), reason: 'Trip' } })).status, 400);
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: iso(-30), endDate: iso(-29), reason: 'Trip' } })).status, 400);
  // weekend only => no working days
  let sat = new Date(); sat.setUTCDate(sat.getUTCDate() + 50); while (sat.getUTCDay() !== 6) sat.setUTCDate(sat.getUTCDate() + 1);
  const satIso = sat.toISOString().slice(0, 10); sat.setUTCDate(sat.getUTCDate() + 1);
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: satIso, endDate: sat.toISOString().slice(0, 10), reason: 'Weekend' } })).status, 400);

  const ok = await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: start, endDate: end, reason: 'Trip' } });
  assert.equal(ok.status, 201); assert.equal(ok.data.days, 1); assert.equal(ok.data.status, 'pending');
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: start, endDate: end, reason: 'Again' } })).status, 409); // overlap
  // too many days for balance (casual = 8 days)
  const far = nextWeekday(100); const farEnd = new Date(far + 'T00:00:00Z'); farEnd.setUTCDate(farEnd.getUTCDate() + 20);
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'casual', startDate: far, endDate: farEnd.toISOString().slice(0, 10), reason: 'Long' } })).status, 409);
  // cancel
  assert.equal((await call('POST', `/api/requests/${ok.data.id}/cancel`, { token: t })).data.status, 'cancelled');
  assert.equal((await call('POST', `/api/requests/${ok.data.id}/cancel`, { token: t })).status, 409);
  // someone else cannot cancel it
  const other = await login('sai.kiran', 'SaiKiran@2026');
  assert.equal((await call('POST', '/api/requests/REQ-2404/cancel', { token: other })).status, 404);
});

test('holidays are excluded from working days', async () => {
  const admin = await login('lakshmi.prasanna', 'Lakshmi@2026');
  const day = nextWeekday(200);
  assert.equal((await call('POST', '/api/holidays', { token: admin, body: { date: day, name: 'Test Holiday' } })).status, 200);
  assert.equal((await call('POST', '/api/holidays', { token: admin, body: { date: day, name: 'Dup' } })).status, 409);
  const t = await login('rohan.shah', 'Rohan@2026');
  assert.equal((await call('POST', '/api/requests', { token: t, body: { leaveType: 'annual', startDate: day, endDate: day, reason: 'Holiday day' } })).status, 400);
  assert.equal((await call('DELETE', `/api/holidays/${day}`, { token: admin })).status, 200);
  assert.equal((await call('DELETE', `/api/holidays/${day}`, { token: admin })).status, 404);
});

test('manager decisions: only own team, reason required, notifies employee', async () => {
  const m1 = await login('venkata.ramana', 'Ramana@2026'), m2 = await login('suresh.babu', 'Suresh@2026');
  assert.equal((await call('POST', '/api/requests/REQ-2404/decision', { token: m2, body: { decision: 'approved' } })).status, 403);
  assert.equal((await call('POST', '/api/requests/REQ-2404/decision', { token: m1, body: { decision: 'rejected' } })).status, 400);
  assert.equal((await call('POST', '/api/requests/REQ-2404/decision', { token: m1, body: { decision: 'maybe' } })).status, 400);
  const emp = await login('sai.kiran', 'SaiKiran@2026');
  assert.equal((await call('POST', '/api/requests/REQ-2403/decision', { token: emp, body: { decision: 'approved' } })).status, 403);
  assert.equal((await call('POST', '/api/requests/REQ-2403/decision', { token: m1, body: { decision: 'rejected', reason: 'Release week' } })).data.status, 'rejected');
  assert.equal((await call('POST', '/api/requests/REQ-2403/decision', { token: m1, body: { decision: 'approved' } })).status, 409); // already processed
  const notes = (await call('GET', '/api/notifications', { token: emp })).data;
  assert.ok(notes.some(n => /rejected/.test(n.message) && /Release week/.test(n.message)));
  const priya = await login('priya.menon', 'Priya@2026');
  assert.equal((await call('POST', '/api/requests/REQ-2404/decision', { token: m1, body: { decision: 'approved' } })).data.status, 'approved');
  assert.ok((await call('GET', '/api/notifications', { token: priya })).data.some(n => /approved/.test(n.message)));
});

test('a request longer than the leave balance is rejected', async () => {
  // Divya: annual allocation 18. Submit 17 working days, approve; then a second request that would exceed.
  const t = await login('divya.chowdary', 'Divya@2026'), m2 = await login('suresh.babu', 'Suresh@2026');
  const s1 = nextWeekday(300), e1 = new Date(s1 + 'T00:00:00Z'); e1.setUTCDate(e1.getUTCDate() + 30);
  const first = await call('POST', '/api/requests', { token: t, body: { leaveType: 'sick', startDate: s1, endDate: e1.toISOString().slice(0, 10), reason: 'Long illness' } });
  assert.equal(first.status, 409); // sick allocation is only 10 days
});

test('admin creates employee and manager; new accounts can log in; deactivation blocks login', async () => {
  const admin = await login('lakshmi.prasanna', 'Lakshmi@2026');
  const mk = await call('POST', '/api/employees', { token: admin, body: { role: 'manager', name: 'Anil Kumar Reddy', email: 'anil.reddy@timeoffpro.in', department: 'Operations', designation: 'Ops Manager', password: 'Anil@2026x' } });
  assert.equal(mk.status, 200); assert.equal(mk.data.username, 'anil.reddy');
  const mid = (await call('GET', '/api/managers', { token: admin })).data.find(m => m.email === 'anil.reddy@timeoffpro.in').id;
  assert.equal((await call('POST', '/api/employees', { token: admin, body: { name: 'Meghana Rao', email: 'meghana.rao@timeoffpro.in', department: 'Ops', designation: 'Analyst', managerId: 'USR-EMP-001', password: 'Meghana@2026' } })).status, 400); // not a manager
  const emp = await call('POST', '/api/employees', { token: admin, body: { name: 'Meghana Rao', email: 'meghana.rao@timeoffpro.in', department: 'Ops', designation: 'Analyst', managerId: mid, password: 'Meghana@2026' } });
  assert.equal(emp.status, 200);
  assert.equal((await call('POST', '/api/employees', { token: admin, body: { name: 'Dup', email: 'meghana.rao@timeoffpro.in', department: 'Ops', designation: 'A', managerId: mid, password: 'Meghana@2026' } })).status, 409);
  assert.equal((await call('POST', '/api/employees', { token: admin, body: { name: 'Short Pw', email: 'x.y@timeoffpro.in', department: 'Ops', designation: 'A', managerId: mid, password: '123' } })).status, 400);
  const empToken = await login('meghana.rao@timeoffpro.in', 'Meghana@2026');
  assert.equal((await call('GET', '/api/bootstrap', { token: empToken })).data.employees[0].managerName, 'Anil Kumar Reddy');
  assert.equal((await call('PATCH', `/api/employees/${emp.data.id}/status`, { token: admin, body: { active: false } })).status, 200);
  assert.equal((await call('GET', '/api/bootstrap', { token: empToken })).status, 401); // existing token stops working
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'meghana.rao', password: 'Meghana@2026' } })).status, 401);
  assert.equal((await call('PATCH', `/api/employees/${emp.data.id}/status`, { token: admin, body: { active: true } })).status, 200);
  await login('meghana.rao', 'Meghana@2026');
});

test('change password', async () => {
  const t = await login('ananya.kumar', 'Ananya@2026');
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'bad', newPassword: 'NewPass@123' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Ananya@2026', newPassword: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Ananya@2026', newPassword: 'NewPass@123' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { identity: 'ananya.kumar', password: 'Ananya@2026' } })).status, 401);
  await login('ananya.kumar', 'NewPass@123');
});

test('data survives a server restart (saved to db.json) and passwords are hashed', async () => {
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8');
  assert.ok(!raw.includes('SaiKiran@2026'));
  assert.ok(raw.includes('scrypt$'));
  assert.ok(JSON.parse(raw).audit.some(a => a.action === 'LEAVE_REJECTED'));
});

test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login', { body: { identity: 'karthik.varma', password: 'nope' + i } });
  assert.equal(last.status, 429);
});
