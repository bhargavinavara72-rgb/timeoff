(async () => {
  const role = document.body.dataset.role;
  const $ = (id) => document.getElementById(id);
  const API = (window.TIMEOFF_API_BASE || '').replace(/\/$/, '') + '/api';
  const TOKEN_KEY = 'elms_token_v2';
  const loginPage = '../../index.html#login';
  const route = { employee: "../../pages/employee/dashboard.html", manager: "../../pages/manager/dashboard.html", admin: "../../pages/admin/dashboard.html" };
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Every request to the backend goes through here. A 401 sends the person back to the login page.
  async function api(path, method = 'GET', body) {
    let res;
    try {
      res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new Error('Cannot reach the server. Please check that the backend is running.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); window.location.replace(loginPage); throw new Error(data.error || 'Please sign in again.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  if (!localStorage.getItem(TOKEN_KEY)) { window.location.replace(loginPage); return; }
  // Local copy of the data the backend returned for this role. refresh() reloads it after every change.
  let S = { leaveTypes: [], holidays: [], employees: [], requests: [], notifications: [], managers: [], audit: [] };
  let currentUser = null;
  async function refresh() { const data = await api('/bootstrap'); currentUser = data.user; S = data; }
  try { await refresh(); }
  catch (err) {
    if (localStorage.getItem(TOKEN_KEY)) document.body.insertAdjacentHTML('afterbegin', `<div style="padding:16px;background:#fdeceb;color:#8a2c25;font:600 14px sans-serif">${String(err.message).replace(/[<>&]/g, '')}</div>`);
    return;
  }
  if (currentUser.role !== role) { window.location.replace(route[currentUser.role] || '../../index.html'); return; }

  const employees = () => S.employees;
  const requests = () => S.requests;
  const leaveTypes = () => S.leaveTypes;
  const notifications = () => S.notifications;
  const employeeRecord = () => employees().find(e => e.userId === currentUser.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isoToday = localISO(today);
  const fmtDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
  const initials = (name) => (name || 'TP').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const typeName = (key) => leaveTypes().find(t => t.id === key)?.name || key;
  const toast = (message) => { const el = $('toast'); if (!el) return; el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); };
  const visibleEmployees = () => role === 'manager' ? employees().filter(e => e.active !== false) : employees();
  const visibleRequests = () => { const teamIds = visibleEmployees().map(e => e.id); return role === 'manager' ? requests().filter(r => teamIds.includes(r.employeeId)) : requests(); };
  const getUsed = (employeeId, typeId) => requests().filter(r => r.employeeId === employeeId && r.leaveType === typeId && r.status === 'approved').reduce((sum, r) => sum + Number(r.days || 0), 0);
  const getBalance = (employeeId, typeId) => { const type = leaveTypes().find(t => t.id === typeId); if (!type || !type.paid) return null; return Math.max(0, Number(type.allocation) - getUsed(employeeId, typeId)); };
  const totalPaidRemaining = (employeeId) => leaveTypes().filter(t => t.paid).reduce((sum, t) => sum + (getBalance(employeeId, t.id) || 0), 0);
  const statusHTML = (status) => `<span class="status ${escapeHTML(status)}">${escapeHTML(status)}</span>`;
  const overlap = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;
  const workingDays = (start, end) => {
    if (!start || !end || start > end) return 0;
    const holidays = new Set(S.holidays.map(h => h.date));
    let count = 0; const cursor = new Date(`${start}T12:00:00`); const last = new Date(`${end}T12:00:00`);
    while (cursor <= last) { const day = cursor.getDay(); const iso = localISO(cursor); if (day !== 0 && day !== 6 && !holidays.has(iso)) count++; cursor.setDate(cursor.getDate() + 1); }
    return count;
  };
  const showBaseProfile = () => {
    document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = currentUser.name);
    document.querySelectorAll('[data-user-initials]').forEach(el => el.textContent = initials(currentUser.name));
    document.querySelectorAll('[data-first-name]').forEach(el => el.textContent = currentUser.name.split(' ')[0]);
    document.querySelectorAll('[data-current-date]').forEach(el => el.textContent = today.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', () => {
      api('/auth/logout', 'POST').catch(() => {}).finally(() => { localStorage.removeItem(TOKEN_KEY); window.location.href = '../../index.html'; });
    }));
    addPasswordChange();
    document.querySelectorAll('[data-scroll]').forEach(el => el.addEventListener('click', () => document.getElementById(el.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));
    const unread = notifications().filter(n => n.recipientId === currentUser.id && !n.read).length;
    const dot = document.querySelector('[data-notification-dot]'); if (dot) dot.style.display = unread ? 'block' : 'none';
  };
  const renderNotifications = () => {
    const container = $('notificationList'); if (!container) return;
    const list = notifications().filter(n => n.recipientId === currentUser.id).slice(0, 6);
    container.innerHTML = list.length ? list.map(n => `<div class="notice"><span class="notice-mark">${n.read ? '✓' : '•'}</span><div><p>${escapeHTML(n.message)}</p><small>${new Date(n.createdAt).toLocaleString()}</small></div></div>`).join('') : '<div class="empty-state">You are all caught up.</div>';
    if (notifications().some(n => !n.read)) { api('/notifications/read', 'POST').catch(() => {}); notifications().forEach(n => { n.read = true; }); }
    const dot = document.querySelector('[data-notification-dot]'); if (dot) dot.style.display = 'none';
  };

  function renderEmployee() {
    const profile = employeeRecord(); if (!profile) { toast('No employee profile is linked to this account.'); return; }
    const own = requests().filter(r => r.employeeId === profile.id).sort((a,b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    $('stat-available').textContent = totalPaidRemaining(profile.id);
    $('stat-used').textContent = requests().filter(r => r.employeeId === profile.id && r.status === 'approved').reduce((n,r) => n + Number(r.days || 0), 0);
    $('stat-pending').textContent = own.filter(r => r.status === 'pending').length;
    $('stat-approved').textContent = own.filter(r => r.status === 'approved').length;
    $('leaveType').innerHTML = leaveTypes().map(t => `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join('');
    $('balanceList').innerHTML = leaveTypes().map(t => {
      if (!t.paid) return `<div><div class="balance-item-head"><span>${escapeHTML(t.name)}</span><b>Tracked separately</b></div><div class="progress"><span style="width:0%"></span></div></div>`;
      const used = getUsed(profile.id, t.id), remaining = getBalance(profile.id, t.id), pct = t.allocation ? Math.min(100, used / t.allocation * 100) : 0;
      return `<div><div class="balance-item-head"><span>${escapeHTML(t.name)}</span><b>${remaining} / ${t.allocation} days left</b></div><div class="progress"><span style="width:${pct}%"></span></div></div>`;
    }).join('');
    $('requestCount').textContent = `${own.length} total requests`;
    $('employeeRequests').innerHTML = own.length ? own.map(r => `<tr><td>${escapeHTML(typeName(r.leaveType))}</td><td>${shortDate(r.startDate)} – ${shortDate(r.endDate)}</td><td>${r.days}</td><td>${fmtDate(r.submittedAt)}</td><td>${statusHTML(r.status)}</td><td>${r.status === 'pending' ? `<button class="secondary-btn" data-cancel="${r.id}">Cancel</button>` : `<span class="muted">${r.status === 'rejected' ? escapeHTML(r.rejectionReason || 'See manager') : '—'}</span>`}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No leave requests yet.</div></td></tr>';
    const upcoming = own.filter(r => r.status === 'approved' && r.endDate >= isoToday).sort((a,b) => a.startDate.localeCompare(b.startDate)).slice(0,5);
    $('employeeCalendar').innerHTML = upcoming.length ? upcoming.map(r => `<div class="calendar-row"><div class="calendar-date"><b>${new Date(`${r.startDate}T12:00:00`).getDate()}</b><small>${new Date(`${r.startDate}T12:00:00`).toLocaleDateString('en-IN',{month:'short'}).toUpperCase()}</small></div><div class="calendar-detail"><b>${escapeHTML(typeName(r.leaveType))} · ${r.days} day(s)</b><small>${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}</small></div><span class="status approved">Approved</span></div>`).join('') : '<div class="empty-state">No upcoming approved leave.</div>';
    renderNotifications();
    $('employeeRequests').querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', () => cancelOwnRequest(btn.dataset.cancel)));
  }
  async function cancelOwnRequest(requestId) {
    if (!confirm('Cancel this pending leave request?')) return;
    try { await api(`/requests/${requestId}/cancel`, 'POST'); await refresh(); renderEmployee(); toast('Your request was cancelled.'); }
    catch (err) { toast(err.message); }
  }
  async function submitLeave(event) {
    event.preventDefault(); const typeId = $('leaveType').value;
    const start = $('startDate').value, end = $('endDate').value, reason = $('leaveReason').value.trim();
    const msg = $('leaveFormMessage'); msg.style.color = '#a64f48';
    if (!start || !end || start > end || !workingDays(start, end)) { msg.textContent = 'Please choose a valid date range containing working days.'; return; }
    try {
      await api('/requests', 'POST', { leaveType: typeId, startDate: start, endDate: end, reason });
      await refresh();
      $('leaveForm').reset(); $('leaveDays').value = 'Select dates'; msg.style.color = '#648061'; msg.textContent = 'Request submitted to your manager.';
      renderEmployee(); toast('Leave request submitted.');
    } catch (err) { msg.textContent = err.message; }
  }

  function renderManager() {
    const team = visibleEmployees(); const teamIds = team.map(e => e.id);
    const teamRequests = visibleRequests(); const pending = teamRequests.filter(r => r.status === 'pending');
    const activeToday = teamRequests.filter(r => r.status === 'approved' && r.startDate <= isoToday && r.endDate >= isoToday);
    const pendingOverlapIds = new Set();
    pending.forEach((a,i) => pending.slice(i+1).forEach(b => { if (a.employeeId !== b.employeeId && overlap(a,b)) { pendingOverlapIds.add(a.id); pendingOverlapIds.add(b.id); } }));
    $('stat-team').textContent = team.length; $('stat-pending').textContent = pending.length; $('stat-away').textContent = new Set(activeToday.map(r => r.employeeId)).size; $('stat-overlap').textContent = pendingOverlapIds.size;
    $('pendingCount').textContent = `${pending.length} pending`;
    $('managerPending').innerHTML = pending.length ? pending.map(r => {
      const employee = team.find(e => e.id === r.employeeId); const balance = getBalance(r.employeeId, r.leaveType);
      return `<tr><td><div class="person-cell"><span class="table-avatar">${initials(r.employeeName)}</span><div><b>${escapeHTML(r.employeeName)}</b><small>${escapeHTML(employee?.department || '')}</small></div></div></td><td>${escapeHTML(typeName(r.leaveType))}</td><td>${shortDate(r.startDate)} – ${shortDate(r.endDate)}</td><td>${r.days}</td><td>${balance === null ? '—' : `${balance} days`}</td><td>${fmtDate(r.submittedAt)}</td><td><div class="action-group"><button class="primary-btn" data-approve="${r.id}">Approve</button><button class="danger-btn" data-reject="${r.id}">Reject</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="7"><div class="empty-state">There are no requests waiting for your decision.</div></td></tr>';
    const upcoming = teamRequests.filter(r => r.status === 'approved' && r.endDate >= isoToday).sort((a,b) => a.startDate.localeCompare(b.startDate)).slice(0,7);
    $('managerCalendar').innerHTML = upcoming.length ? upcoming.map(r => `<div class="calendar-row"><div class="calendar-date"><b>${new Date(`${r.startDate}T12:00:00`).getDate()}</b><small>${new Date(`${r.startDate}T12:00:00`).toLocaleDateString('en-IN',{month:'short'}).toUpperCase()}</small></div><div class="calendar-detail"><b>${escapeHTML(r.employeeName)} · ${escapeHTML(typeName(r.leaveType))}</b><small>${fmtDate(r.startDate)} – ${fmtDate(r.endDate)} · ${r.days} day(s)</small></div></div>`).join('') : '<div class="empty-state">No upcoming approved team leave.</div>';
    $('teamCount').textContent = `${team.length} team members`;
    $('managerTeam').innerHTML = team.map(e => {
      const approvedDays = teamRequests.filter(r => r.employeeId === e.id && r.status === 'approved').reduce((n,r) => n + Number(r.days || 0), 0);
      const pendingCount = teamRequests.filter(r => r.employeeId === e.id && r.status === 'pending').length;
      return `<tr><td><div class="person-cell"><span class="table-avatar">${initials(e.name)}</span><div><b>${escapeHTML(e.name)}</b><small>${escapeHTML(e.email)}</small></div></div></td><td>${escapeHTML(e.department)}</td><td>${escapeHTML(e.designation)}</td><td>${approvedDays}</td><td>${pendingCount}</td></tr>`;
    }).join('');
    const totals = leaveTypes().map(t => ({ name:t.name, days:teamRequests.filter(r=>r.leaveType===t.id && r.status==='approved').reduce((n,r)=>n+Number(r.days||0),0) }));
    const max = Math.max(1, ...totals.map(x=>x.days));
    $('teamReportBars').innerHTML = totals.map(x => `<div class="bar-row"><span>${escapeHTML(x.name)}</span><div class="bar-track"><span style="width:${x.days/max*100}%"></span></div><b>${x.days}</b></div>`).join('');
    renderNotifications();
    $('managerPending').querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => decideRequest(btn.dataset.approve, 'approved')));
    $('managerPending').querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => openReject(btn.dataset.reject)));
  }
  let rejectingId = null;
  async function decideRequest(requestId, decision, reason = '') {
    try { await api(`/requests/${requestId}/decision`, 'POST', { decision, reason }); toast(`Request ${decision}.`); }
    catch (err) { toast(err.message); }
    try { await refresh(); } catch {}
    closeReject(); renderManager();
  }
  function openReject(requestId) { rejectingId = requestId; $('rejectModal').classList.add('open'); $('rejectionReason').value = ''; $('rejectionReason').focus(); }
  function closeReject() { rejectingId = null; $('rejectModal').classList.remove('open'); }

  function renderAdmin() {
    const staff = employees(); const allRequests = requests(); const pending = allRequests.filter(r => r.status === 'pending');
    const todayAway = allRequests.filter(r => r.status === 'approved' && r.startDate <= isoToday && r.endDate >= isoToday);
    $('stat-employees').textContent = staff.filter(e => e.active !== false).length;
    $('stat-managers').textContent = S.managers.length;
    $('stat-pending').textContent = pending.length; $('stat-away').textContent = new Set(todayAway.map(r => r.employeeId)).size;
    $('employeeCount').textContent = `${staff.length} employee records`;
    const managerUsers = S.managers;
    $('newManager').innerHTML = managerUsers.map(m => `<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
    $('adminEmployees').innerHTML = staff.map(e => {
      const manager = { name: e.managerName };
      return `<tr><td><div class="person-cell"><span class="table-avatar">${initials(e.name)}</span><div><b>${escapeHTML(e.name)}</b><small>${escapeHTML(e.email)}</small></div></div></td><td>${escapeHTML(e.department)}</td><td>${escapeHTML(e.designation)}</td><td>${escapeHTML(manager?.name || 'Unassigned')}</td><td>${e.active === false ? '<span class="status cancelled">Inactive</span>' : '<span class="status approved">Active</span>'}</td><td><button class="secondary-btn" data-toggle="${e.id}">${e.active === false ? 'Activate' : 'Deactivate'}</button></td></tr>`;
    }).join('');
    $('adminEmployees').querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => toggleEmployee(btn.dataset.toggle)));
    renderHolidays();
    renderAdminRequests();
    const counts = ['pending','approved','rejected','cancelled'].map(s => ({name:s, count:allRequests.filter(r=>r.status===s).length}));
    const max = Math.max(1, ...counts.map(x=>x.count));
    $('adminReportBars').innerHTML = counts.map(x => `<div class="bar-row"><span style="text-transform:capitalize">${x.name}</span><div class="bar-track"><span style="width:${x.count/max*100}%"></span></div><b>${x.count}</b></div>`).join('');
    $('adminInsights').innerHTML = `<div class="notice"><span class="notice-mark">✓</span><p>${staff.filter(e=>e.active!==false).length} active employee profiles are currently recorded.<small>Employee directory status</small></p></div><div class="notice"><span class="notice-mark">⌛</span><p>${pending.length} requests are waiting for manager decisions.<small>Approval workflow status</small></p></div>`;
    const auditItems = S.audit.slice(0, 9);
    $('auditList').innerHTML = auditItems.length ? auditItems.map(item => `<div class="audit-line"><i class="audit-dot"></i><div><b>${escapeHTML(item.action.replaceAll('_',' '))}</b><p>${escapeHTML(item.actorName || item.actor)} · ${escapeHTML(item.details)}</p></div><time>${new Date(item.timestamp).toLocaleDateString()}</time></div>`).join('') : '<div class="empty-state">No audit activity recorded.</div>';
    renderNotifications();
  }
  function renderAdminRequests() {
    const status = $('adminStatusFilter')?.value || 'all';
    const list = requests().filter(r => status === 'all' || r.status === status).sort((a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||''));
    $('adminRequests').innerHTML = list.length ? list.map(r => `<tr><td>${escapeHTML(r.employeeName)}</td><td>${escapeHTML(typeName(r.leaveType))}</td><td>${shortDate(r.startDate)} – ${shortDate(r.endDate)}</td><td>${r.days}</td><td>${statusHTML(r.status)}</td><td>${escapeHTML(r.rejectionReason || '—')}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No requests match this filter.</div></td></tr>';
  }
  async function toggleEmployee(empId) {
    const emp = employees().find(e => e.id === empId); if (!emp) return;
    const makeActive = emp.active === false;
    if (!confirm(`${makeActive ? 'Activate' : 'Deactivate'} ${emp.name}'s account?`)) return;
    try { await api(`/employees/${empId}/status`, 'PATCH', { active: makeActive }); await refresh(); renderAdmin(); toast(`${emp.name} ${makeActive ? 'activated' : 'deactivated'}.`); }
    catch (err) { toast(err.message); }
  }
  function renderHolidays() {
    const box = $('holidayList'); if (!box) return;
    const list = S.holidays.slice().sort((a, b) => a.date.localeCompare(b.date));
    box.innerHTML = list.length ? list.map(h => `<div class="calendar-row"><div class="calendar-date"><b>${new Date(`${h.date}T12:00:00`).getDate()}</b><small>${new Date(`${h.date}T12:00:00`).toLocaleDateString('en-IN',{month:'short'}).toUpperCase()}</small></div><div class="calendar-detail"><b>${escapeHTML(h.name)}</b><small>${fmtDate(h.date)}</small></div><button class="secondary-btn" data-remove-holiday="${escapeHTML(h.date)}">Remove</button></div>`).join('') : '<div class="empty-state">No holidays configured.</div>';
    box.querySelectorAll('[data-remove-holiday]').forEach(btn => btn.addEventListener('click', async () => {
      try { await api(`/holidays/${btn.dataset.removeHoliday}`, 'DELETE'); await refresh(); renderAdmin(); toast('Holiday removed.'); }
      catch (err) { toast(err.message); }
    }));
  }
  async function addHoliday(event) {
    event.preventDefault(); const date = $('holidayDate').value, name = $('holidayName').value.trim(); if (!date || !name) return;
    try { await api('/holidays', 'POST', { date, name }); await refresh(); $('holidayForm').reset(); renderAdmin(); toast('Holiday added.'); }
    catch (err) { toast(err.message); }
  }
  async function createEmployee(event) {
    event.preventDefault(); const msg = $('employeeFormMessage');
    const newRole = $('newRole')?.value || 'employee';
    const payload = { role: newRole, name: $('newName').value.trim(), email: $('newEmail').value.trim().toLowerCase(), department: $('newDepartment').value.trim(), designation: $('newDesignation').value.trim(), managerId: $('newManager').value, password: $('newPassword').value };
    msg.style.color = '#a64f48';
    try {
      const result = await api('/employees', 'POST', payload);
      await refresh(); $('employeeForm').reset();
      msg.style.color = '#648061'; msg.textContent = `${newRole === 'manager' ? 'Manager' : 'Employee'} created. Login username: ${result.username}`;
      renderAdmin(); toast(`${newRole === 'manager' ? 'Manager' : 'Employee'} account created.`);
    } catch (err) { msg.textContent = err.message; }
  }

  // Small "Change password" dialog, added to the sidebar of every dashboard.
  function addPasswordChange() {
    const bottom = document.querySelector('.sidebar-bottom'); if (!bottom || $('pwModal')) return;
    const btn = document.createElement('button'); btn.className = 'logout-link'; btn.type = 'button'; btn.innerHTML = '🔑 <span>Change password</span>';
    bottom.insertBefore(btn, bottom.querySelector('[data-logout]'));
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="pwModal"><div class="modal"><h3>Change password</h3><div class="field"><label for="pwCurrent">Current password</label><input id="pwCurrent" type="password" autocomplete="current-password"></div><div class="field"><label for="pwNew">New password (min 8 characters)</label><input id="pwNew" type="password" autocomplete="new-password"></div><p class="inline-message" id="pwMessage" style="margin-top:10px"></p><div class="modal-actions"><button class="secondary-btn" type="button" id="pwCancel">Cancel</button><button class="primary-btn" type="button" id="pwSave">Update password</button></div></div></div>`);
    const modal = $('pwModal'); const close = () => modal.classList.remove('open');
    btn.addEventListener('click', () => { $('pwCurrent').value = ''; $('pwNew').value = ''; $('pwMessage').textContent = ''; modal.classList.add('open'); $('pwCurrent').focus(); });
    $('pwCancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    $('pwSave').addEventListener('click', async () => {
      const msg = $('pwMessage'); msg.style.color = '#a64f48';
      try { await api('/auth/change-password', 'POST', { currentPassword: $('pwCurrent').value, newPassword: $('pwNew').value }); close(); toast('Password updated.'); }
      catch (err) { msg.textContent = err.message; }
    });
  }

  function wireCommon() {
    document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeReject));
    $('rejectModal')?.addEventListener('click', e => { if (e.target.id === 'rejectModal') closeReject(); });
    $('confirmReject')?.addEventListener('click', () => { const reason = $('rejectionReason').value.trim(); if (!reason) { $('rejectionReason').focus(); toast('Please enter a rejection reason.'); return; } decideRequest(rejectingId, 'rejected', reason); });
    $('adminStatusFilter')?.addEventListener('change', renderAdminRequests);
  }
  showBaseProfile(); wireCommon();
  if (role === 'employee') {
    renderEmployee(); $('leaveForm')?.addEventListener('submit', submitLeave);
    const updateDays = () => { const s=$('startDate').value,e=$('endDate').value; $('leaveDays').value = s && e && s<=e ? `${workingDays(s,e)} working day(s)` : 'Select valid dates'; };
    $('startDate')?.addEventListener('change', () => { const sv = $('startDate').value; if (sv) { $('endDate').min = sv; if ($('endDate').value && $('endDate').value < sv) $('endDate').value = sv; } updateDays(); }); $('endDate')?.addEventListener('change', updateDays);
    $('startDate').min = isoToday; $('endDate').min = isoToday;
  } else if (role === 'manager') renderManager();
  else if (role === 'admin') { renderAdmin(); $('employeeForm')?.addEventListener('submit', createEmployee); $('holidayForm')?.addEventListener('submit', addHoliday); }
})();
