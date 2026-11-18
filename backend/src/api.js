const crypto = require('crypto');
const dbm = require('./db');
const auth = require('./auth');
const D = require('./dates');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'You do not have access to this action.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email, role: u.role });
const str = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw bad(`${label} must be ${min}-${max} characters.`);
  return s;
};

// ---------- helpers that work on the in-memory database ----------
function audit(user, action, details) {
  const db = dbm.get();
  db.audit.unshift({ id: uid('LOG'), actor: user?.id || 'SYSTEM', actorName: user?.name || 'System', role: user?.role || 'system', action, details, timestamp: new Date().toISOString() });
  db.audit = db.audit.slice(0, 500);
}
function notify(recipientId, message, relatedId = null) {
  const db = dbm.get();
  db.notifications.unshift({ id: uid('NOT'), recipientId, message, relatedId, createdAt: new Date().toISOString(), read: false });
  db.notifications = db.notifications.slice(0, 1000);
}
const typeOf = (id) => dbm.get().leaveTypes.find(t => t.id === id);
const holidaySet = () => new Set(dbm.get().holidays.map(h => h.date));
const employeeOfUser = (user) => dbm.get().employees.find(e => e.userId === user.id);
const usedDays = (empId, typeId) => dbm.get().requests.filter(r => r.employeeId === empId && r.leaveType === typeId && r.status === 'approved').reduce((n, r) => n + Number(r.days), 0);
const pendingDays = (empId, typeId) => dbm.get().requests.filter(r => r.employeeId === empId && r.leaveType === typeId && r.status === 'pending').reduce((n, r) => n + Number(r.days), 0);

function scopedEmployees(user) {
  const db = dbm.get();
  let list = db.employees;
  if (user.role === 'employee') list = list.filter(e => e.userId === user.id);
  else if (user.role === 'manager') list = list.filter(e => e.managerId === user.id);
  return list.map(e => ({ ...e, managerName: db.users.find(u => u.id === e.managerId)?.name || null }));
}
function scopedRequests(user) {
  const db = dbm.get();
  if (user.role === 'admin') return db.requests;
  const ids = new Set(scopedEmployees(user).map(e => e.id));
  return db.requests.filter(r => ids.has(r.employeeId));
}
const activeManagers = () => dbm.get().users.filter(u => u.role === 'manager' && u.active).map(u => ({ id: u.id, name: u.name, email: u.email }));

// ---------- login rate limit (per IP) ----------
const attempts = new Map();
const MAX_FAILS = 10, WINDOW_MS = 15 * 60 * 1000;
function checkRate(ip) {
  const a = attempts.get(ip);
  if (a && a.resetAt > Date.now() && a.count >= MAX_FAILS) throw new HttpError(429, 'Too many failed attempts. Please wait a few minutes and try again.');
}
function recordFail(ip) {
  const a = attempts.get(ip);
  if (!a || a.resetAt <= Date.now()) attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else a.count++;
}

// ---------- handlers ----------
const handlers = {
  health: () => ({ ok: true, time: new Date().toISOString() }),

  login({ body, ip }) {
    checkRate(ip);
    const identity = String(body.identity || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = dbm.get().users.find(u => u.email.toLowerCase() === identity || u.username.toLowerCase() === identity);
    const ok = user ? auth.verifyPassword(password, user.passwordHash) : (auth.verifyPassword(password, 'scrypt$00$00'), false);
    if (!user || !ok || !user.active) { recordFail(ip); throw new HttpError(401, "We couldn't verify those credentials. Please try again."); }
    attempts.delete(ip);
    audit(user, 'LOGIN', `${user.name} signed in.`);
    return { token: auth.signToken({ sub: user.id, role: user.role }), user: publicUser(user) };
  },
  logout({ user }) { audit(user, 'LOGOUT', `${user.name} signed out.`); return { ok: true }; },
  me({ user }) { return { user: publicUser(user) }; },
  changePassword({ user, body }) {
    const current = String(body.currentPassword || ''), next = String(body.newPassword || '');
    if (!auth.verifyPassword(current, user.passwordHash)) throw bad('Your current password is not correct.');
    if (next.length < 8 || next.length > 128) throw bad('New password must be 8-128 characters.');
    if (next === current) throw bad('New password must be different from the current one.');
    user.passwordHash = auth.hashPassword(next);
    audit(user, 'PASSWORD_CHANGED', `${user.name} changed their password.`);
    return { ok: true };
  },

  // One call that returns everything the signed-in role needs to draw its dashboard.
  bootstrap({ user }) {
    const db = dbm.get();
    return {
      user: publicUser(user),
      leaveTypes: db.leaveTypes,
      holidays: db.holidays,
      employees: scopedEmployees(user),
      requests: scopedRequests(user),
      notifications: db.notifications.filter(n => n.recipientId === user.id).slice(0, 50),
      managers: user.role === 'admin' ? activeManagers() : [],
      audit: user.role === 'admin' ? db.audit.slice(0, 50) : []
    };
  },
  leaveTypes: () => dbm.get().leaveTypes,
  holidays: () => dbm.get().holidays,
  employees: ({ user }) => scopedEmployees(user),
  requests: ({ user, query }) => scopedRequests(user).filter(r => !query.status || r.status === query.status),
  notifications: ({ user }) => dbm.get().notifications.filter(n => n.recipientId === user.id).slice(0, 50),
  markNotificationsRead({ user }) { dbm.get().notifications.forEach(n => { if (n.recipientId === user.id) n.read = true; }); return { ok: true }; },
  managers: () => activeManagers(),
  auditLog: () => dbm.get().audit.slice(0, 200),

  // ----- employee: leave requests -----
  createRequest({ user, body }) {
    const db = dbm.get();
    const emp = employeeOfUser(user);
    if (!emp || emp.active === false) throw forbidden('No active employee profile is linked to this account.');
    const type = typeOf(body.leaveType);
    if (!type) throw bad('Please choose a valid leave category.');
    const { startDate, endDate } = body;
    if (!D.isValidDate(startDate) || !D.isValidDate(endDate)) throw bad('Please provide valid start and end dates.');
    if (startDate > endDate) throw bad('The end date cannot be before the start date.');
    if (startDate < D.todayISO(-1)) throw bad('Leave cannot start in the past.');
    if (D.daysBetween(startDate, endDate) > 120) throw bad('A single request cannot be longer than 120 days.');
    const reason = str(body.reason, 3, 500, 'Reason');
    const days = D.workingDays(startDate, endDate, holidaySet());
    if (!days) throw bad('Please choose a date range containing working days.');
    const candidate = { startDate, endDate };
    if (db.requests.some(r => r.employeeId === emp.id && ['pending', 'approved'].includes(r.status) && D.overlap(candidate, r))) throw conflict('This request overlaps with one of your existing active requests.');
    if (type.paid) {
      const available = Math.max(0, type.allocation - usedDays(emp.id, type.id) - pendingDays(emp.id, type.id));
      if (days > available) throw conflict(`Not enough balance. Available: ${available} day(s) (including pending requests).`);
    }
    const request = { id: `REQ-${db.counters.request++}`, employeeId: emp.id, employeeName: emp.name, leaveType: type.id, startDate, endDate, days, reason, status: 'pending', submittedAt: D.todayISO(), managerId: emp.managerId };
    db.requests.unshift(request);
    notify(emp.managerId, `${emp.name} submitted a ${type.name} request for ${days} working day(s).`, request.id);
    audit(user, 'LEAVE_SUBMITTED', `Submitted ${type.name} request ${request.id} for ${days} day(s).`);
    return request;
  },
  cancelRequest({ user, params }) {
    const emp = employeeOfUser(user);
    const req = dbm.get().requests.find(r => r.id === params.id);
    if (!req || !emp || req.employeeId !== emp.id) throw notFound('Request not found.');
    if (req.status !== 'pending') throw conflict('Only pending requests can be cancelled.');
    req.status = 'cancelled'; req.cancelledAt = new Date().toISOString();
    notify(req.managerId, `${emp.name} cancelled a ${typeOf(req.leaveType)?.name || req.leaveType} request.`, req.id);
    audit(user, 'LEAVE_CANCELLED', `Cancelled request ${req.id}.`);
    return req;
  },

  // ----- manager: decisions -----
  decideRequest({ user, params, body }) {
    const db = dbm.get();
    const req = db.requests.find(r => r.id === params.id);
    if (!req) throw notFound('Request not found.');
    const emp = db.employees.find(e => e.id === req.employeeId);
    if (!emp || emp.managerId !== user.id) throw forbidden('This request does not belong to your team.');
    if (req.status !== 'pending') throw conflict('This request has already been processed.');
    const decision = body.decision;
    if (!['approved', 'rejected'].includes(decision)) throw bad('Decision must be "approved" or "rejected".');
    let reason = '';
    if (decision === 'rejected') reason = str(body.reason, 1, 300, 'Rejection reason');
    if (decision === 'approved') {
      const type = typeOf(req.leaveType);
      if (type?.paid && usedDays(emp.id, type.id) + Number(req.days) > type.allocation) throw conflict(`Cannot approve: only ${Math.max(0, type.allocation - usedDays(emp.id, type.id))} day(s) of balance left.`);
      if (db.requests.some(r => r.id !== req.id && r.employeeId === emp.id && r.status === 'approved' && D.overlap(req, r))) throw conflict('Cannot approve: overlaps an already approved leave.');
    }
    req.status = decision; req.reviewedBy = user.id; req.reviewedAt = new Date().toISOString();
    if (decision === 'rejected') req.rejectionReason = reason;
    const name = typeOf(req.leaveType)?.name || req.leaveType;
    notify(emp.userId, `Your ${name} request (${req.startDate} to ${req.endDate}) was ${decision}.${reason ? ` Manager note: ${reason}` : ''}`, req.id);
    audit(user, decision === 'approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', `${decision} request ${req.id} for ${req.employeeName}.${reason ? ` Reason: ${reason}` : ''}`);
    return req;
  },

  // ----- admin: people & policy -----
  createEmployee({ user, body }) {
    const db = dbm.get();
    const role = body.role === 'manager' ? 'manager' : 'employee';
    const name = str(body.name, 2, 100, 'Name');
    const email = str(body.email, 5, 120, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email address.');
    const department = str(body.department, 1, 100, 'Department');
    const designation = str(body.designation, 1, 100, 'Designation');
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) throw bad('Temporary password must contain 8-128 characters.');
    if (db.users.some(u => u.email.toLowerCase() === email)) throw conflict('An account with this email already exists.');
    const username = email.split('@')[0].replace(/[^a-z0-9._-]/g, '');
    if (!username || db.users.some(u => u.username === username)) throw conflict('Username already exists. Use a different work email.');
    let managerId = null;
    if (role === 'employee') {
      managerId = body.managerId;
      if (!db.users.some(u => u.id === managerId && u.role === 'manager' && u.active)) throw bad('Please choose a valid reporting manager.');
    }
    const newUser = { id: uid('USR'), name, username, email, passwordHash: auth.hashPassword(password), role, active: true, department, designation };
    db.users.push(newUser);
    if (role === 'manager') {
      audit(user, 'MANAGER_CREATED', `Created manager account for ${name}.`);
      return { username, role, id: newUser.id };
    }
    const employee = { id: `EMP-${db.counters.employee++}`, userId: newUser.id, name, email, department, designation, managerId, joiningDate: D.todayISO(), active: true };
    db.employees.push(employee);
    notify(managerId, `A new team member, ${name}, has been added to your team.`);
    audit(user, 'EMPLOYEE_CREATED', `Created ${name} (${employee.id}) and assigned a manager.`);
    return { username, role, id: employee.id };
  },
  setEmployeeStatus({ user, params, body }) {
    const db = dbm.get();
    const emp = db.employees.find(e => e.id === params.id);
    if (!emp) throw notFound('Employee not found.');
    if (typeof body.active !== 'boolean') throw bad('"active" must be true or false.');
    emp.active = body.active;
    const account = db.users.find(u => u.id === emp.userId);
    if (account) account.active = body.active;
    audit(user, body.active ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED', `${body.active ? 'Activated' : 'Deactivated'} ${emp.name} (${emp.id}).`);
    return emp;
  },
  addHoliday({ user, body }) {
    const db = dbm.get();
    if (!D.isValidDate(body.date)) throw bad('Please provide a valid date.');
    const name = str(body.name, 1, 80, 'Holiday name');
    if (db.holidays.some(h => h.date === body.date)) throw conflict('A holiday already exists on that date.');
    const holiday = { date: body.date, name };
    db.holidays.push(holiday);
    audit(user, 'HOLIDAY_ADDED', `Added holiday ${name} (${body.date}).`);
    return holiday;
  },
  removeHoliday({ user, params }) {
    const db = dbm.get();
    if (!db.holidays.some(h => h.date === params.date)) throw notFound('Holiday not found.');
    db.holidays = db.holidays.filter(h => h.date !== params.date);
    audit(user, 'HOLIDAY_REMOVED', `Removed holiday ${params.date}.`);
    return { ok: true };
  }
};

// ---------- route table: [method, path, allowed roles (null = public, 'any' = signed in), handler] ----------
const ANY = 'any';
const routes = [
  ['GET', '/api/health', null, handlers.health],
  ['POST', '/api/auth/login', null, handlers.login],
  ['POST', '/api/auth/logout', ANY, handlers.logout],
  ['GET', '/api/auth/me', ANY, handlers.me],
  ['POST', '/api/auth/change-password', ANY, handlers.changePassword],
  ['GET', '/api/bootstrap', ANY, handlers.bootstrap],
  ['GET', '/api/leave-types', ANY, handlers.leaveTypes],
  ['GET', '/api/holidays', ANY, handlers.holidays],
  ['POST', '/api/holidays', ['admin'], handlers.addHoliday],
  ['DELETE', '/api/holidays/:date', ['admin'], handlers.removeHoliday],
  ['GET', '/api/employees', ANY, handlers.employees],
  ['POST', '/api/employees', ['admin'], handlers.createEmployee],
  ['PATCH', '/api/employees/:id/status', ['admin'], handlers.setEmployeeStatus],
  ['GET', '/api/managers', ['admin'], handlers.managers],
  ['GET', '/api/requests', ANY, handlers.requests],
  ['POST', '/api/requests', ['employee'], handlers.createRequest],
  ['POST', '/api/requests/:id/cancel', ['employee'], handlers.cancelRequest],
  ['POST', '/api/requests/:id/decision', ['manager'], handlers.decideRequest],
  ['GET', '/api/notifications', ANY, handlers.notifications],
  ['POST', '/api/notifications/read', ANY, handlers.markNotificationsRead],
  ['GET', '/api/audit', ['admin'], handlers.auditLog]
].map(([method, pattern, roles, handler]) => {
  const names = [];
  const regex = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  return { method, regex, names, roles, handler };
});

// Returns { status, body } for an API request.
function dispatch({ method, pathname, query, body, token, ip }) {
  try {
    const pathMatches = routes.filter(r => r.regex.test(pathname));
    if (!pathMatches.length) throw notFound('Unknown API endpoint.');
    const route = pathMatches.find(r => r.method === method);
    if (!route) throw new HttpError(405, 'Method not allowed.');
    const params = {};
    const m = pathname.match(route.regex);
    route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });

    let user = null;
    if (route.roles) {
      const payload = auth.verifyToken(token);
      user = payload && dbm.get().users.find(u => u.id === payload.sub);
      if (!user || !user.active) throw new HttpError(401, 'Please sign in again.');
      if (route.roles !== ANY && !route.roles.includes(user.role)) throw forbidden();
    }
    const result = route.handler({ user, body, params, query, ip });
    if (method !== 'GET') dbm.save();
    return { status: method === 'POST' && pathname === '/api/requests' ? 201 : 200, body: result };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    console.error(err);
    return { status: 500, body: { error: 'Internal server error.' } };
  }
}

module.exports = { dispatch };
