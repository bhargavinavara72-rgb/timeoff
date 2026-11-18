// Demo data created the first time the server starts (when data/db.json does not exist yet).
const { hashPassword } = require('./auth');
const { todayISO } = require('./dates');

const DOMAIN = 'timeoffpro.in';
const people = [
  ['USR-ADMIN-001', 'Lakshmi Prasanna', 'lakshmi.prasanna', 'Lakshmi@2026', 'admin'],
  ['USR-MGR-001', 'Venkata Ramana', 'venkata.ramana', 'Ramana@2026', 'manager'],
  ['USR-MGR-002', 'Suresh Babu', 'suresh.babu', 'Suresh@2026', 'manager'],
  ['USR-EMP-001', 'Sai Kiran', 'sai.kiran', 'SaiKiran@2026', 'employee'],
  ['USR-EMP-002', 'Priya Menon', 'priya.menon', 'Priya@2026', 'employee'],
  ['USR-EMP-003', 'Rohan Shah', 'rohan.shah', 'Rohan@2026', 'employee'],
  ['USR-EMP-004', 'Ananya Kumar', 'ananya.kumar', 'Ananya@2026', 'employee'],
  ['USR-EMP-005', 'Divya Chowdary', 'divya.chowdary', 'Divya@2026', 'employee'],
  ['USR-EMP-006', 'Karthik Varma', 'karthik.varma', 'Karthik@2026', 'employee']
];

module.exports = function seed() {
  const users = people.map(([id, name, username, password, role]) => ({
    id, name, username, email: `${username}@${DOMAIN}`, passwordHash: hashPassword(password), role, active: true
  }));
  const emailOf = (uid) => users.find(u => u.id === uid).email;
  const E = (id, userId, name, department, designation, managerId, joiningDate) =>
    ({ id, userId, name, email: emailOf(userId), department, designation, managerId, joiningDate, active: true });
  const M1 = 'USR-MGR-001', M2 = 'USR-MGR-002', d = todayISO;

  return {
    users,
    employees: [
      E('EMP-1001', 'USR-EMP-001', 'Sai Kiran', 'Product & Technology', 'Software Engineer', M1, '2024-03-18'),
      E('EMP-1002', 'USR-EMP-002', 'Priya Menon', 'Product & Technology', 'Product Designer', M1, '2023-08-07'),
      E('EMP-1003', 'USR-EMP-003', 'Rohan Shah', 'Product & Technology', 'QA Analyst', M1, '2024-01-22'),
      E('EMP-1004', 'USR-EMP-004', 'Ananya Kumar', 'People Operations', 'HR Specialist', M1, '2022-11-14'),
      E('EMP-1005', 'USR-EMP-005', 'Divya Chowdary', 'Finance', 'Accounts Executive', M2, '2023-05-29'),
      E('EMP-1006', 'USR-EMP-006', 'Karthik Varma', 'Finance', 'Financial Analyst', M2, '2024-06-10')
    ],
    leaveTypes: [
      { id: 'annual', name: 'Annual Leave', allocation: 18, paid: true },
      { id: 'sick', name: 'Sick Leave', allocation: 10, paid: true },
      { id: 'casual', name: 'Casual Leave', allocation: 8, paid: true },
      { id: 'unpaid', name: 'Unpaid Leave', allocation: 0, paid: false }
    ],
    holidays: [
      { date: '2026-11-08', name: 'Diwali (Deepavali)' }, { date: '2026-12-25', name: 'Christmas' },
      { date: '2027-01-14', name: 'Makar Sankranti' }, { date: '2027-01-26', name: 'Republic Day' }
    ],
    requests: [
      { id: 'REQ-2401', employeeId: 'EMP-1001', employeeName: 'Sai Kiran', leaveType: 'annual', startDate: d(-35), endDate: d(-34), days: 2, reason: 'Personal travel', status: 'approved', submittedAt: d(-40), managerId: M1, reviewedBy: M1, reviewedAt: d(-39) },
      { id: 'REQ-2402', employeeId: 'EMP-1001', employeeName: 'Sai Kiran', leaveType: 'sick', startDate: d(-10), endDate: d(-10), days: 1, reason: 'Medical appointment', status: 'approved', submittedAt: d(-11), managerId: M1, reviewedBy: M1, reviewedAt: d(-10) },
      { id: 'REQ-2403', employeeId: 'EMP-1001', employeeName: 'Sai Kiran', leaveType: 'casual', startDate: d(7), endDate: d(8), days: 2, reason: 'Family function', status: 'pending', submittedAt: d(-1), managerId: M1 },
      { id: 'REQ-2404', employeeId: 'EMP-1002', employeeName: 'Priya Menon', leaveType: 'annual', startDate: d(8), endDate: d(10), days: 3, reason: 'Planned vacation', status: 'pending', submittedAt: d(-2), managerId: M1 },
      { id: 'REQ-2405', employeeId: 'EMP-1003', employeeName: 'Rohan Shah', leaveType: 'casual', startDate: d(15), endDate: d(15), days: 1, reason: 'Personal work', status: 'approved', submittedAt: d(-4), managerId: M1, reviewedBy: M1, reviewedAt: d(-3) },
      { id: 'REQ-2406', employeeId: 'EMP-1004', employeeName: 'Ananya Kumar', leaveType: 'sick', startDate: d(-20), endDate: d(-19), days: 2, reason: 'Recovery', status: 'rejected', rejectionReason: 'Please submit the supporting document and reapply.', submittedAt: d(-22), managerId: M1, reviewedBy: M1, reviewedAt: d(-21) },
      { id: 'REQ-2407', employeeId: 'EMP-1005', employeeName: 'Divya Chowdary', leaveType: 'annual', startDate: d(12), endDate: d(14), days: 3, reason: "Sister's wedding", status: 'pending', submittedAt: d(-3), managerId: M2 },
      { id: 'REQ-2408', employeeId: 'EMP-1006', employeeName: 'Karthik Varma', leaveType: 'casual', startDate: d(3), endDate: d(3), days: 1, reason: 'Bank and passport work', status: 'approved', submittedAt: d(-5), managerId: M2, reviewedBy: M2, reviewedAt: d(-4) }
    ],
    notifications: [],
    audit: [{ id: 'LOG-SEED', actor: 'SYSTEM', actorName: 'System', role: 'system', action: 'DEMO_DATA_INITIALIZED', details: 'Timeoff Pro demonstration data created.', timestamp: new Date().toISOString() }],
    counters: { request: 2409, employee: 1007 }
  };
};
