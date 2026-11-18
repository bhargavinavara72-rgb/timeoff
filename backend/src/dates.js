// All dates are plain YYYY-MM-DD strings, so time zones never shift a leave day.
const RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function workingDays(start, end, holidaySet) {
  if (start > end) return 0;
  let count = 0;
  const cursor = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidaySet.has(cursor.toISOString().slice(0, 10))) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const overlap = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;
function todayISO(offset = 0) { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }

module.exports = { isValidDate, workingDays, daysBetween, overlap, todayISO };
