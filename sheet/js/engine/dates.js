// Excel-compatible date serials: whole days since 1899-12-30 plus a fraction of a day.
// (Using 1899-12-30 as day 0 reproduces Excel's numbering for every date after 1900-02-28.)

const MS_PER_DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);

// Month and day overflow like Excel: DATE(2026, 14, 1) is 2027-02-01, DATE(2026, 3, 0) is 2026-02-28.
export function dateToSerial(year, month, day) {
  if (year >= 0 && year < 1900) year += 1900;
  const ms = Date.UTC(year, month - 1, 1) + (day - 1) * MS_PER_DAY;
  return Math.round((ms - EPOCH) / MS_PER_DAY);
}

export function timeToSerial(h, m, s) {
  return (h * 3600 + m * 60 + s) / 86400;
}

export function serialToParts(serial) {
  // Round to the nearest millisecond-second boundary so 0.5 displays as 12:00:00, not 11:59:59.
  const totalSeconds = Math.round(serial * 86400);
  const days = Math.floor(totalSeconds / 86400);
  const secs = totalSeconds - days * 86400;
  const d = new Date(EPOCH + days * MS_PER_DAY);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 = Sunday
    hour: Math.floor(secs / 3600),
    minute: Math.floor((secs % 3600) / 60),
    second: secs % 60
  };
}

export function serialFromJsDate(date) {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return (local - EPOCH) / MS_PER_DAY;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// "2026-11-08", "2026/11/8", "2026年11月8日", optionally followed by a time. Returns a serial or null.
const DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/;

export function parseDateText(text) {
  const t = text.trim();
  let m = DATE_RE.exec(t);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    let serial = dateToSerial(y, mo, d);
    const hasTime = m[4] !== undefined;
    if (hasTime) {
      const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6] || 0);
      if (h > 23 || mi > 59 || s > 59) return null;
      serial += timeToSerial(h, mi, s);
    }
    return { serial, kind: hasTime ? 'datetime' : 'date' };
  }
  m = TIME_RE.exec(t);
  if (m) {
    let h = Number(m[1]);
    const mi = Number(m[2]), s = Number(m[3] || 0);
    const ap = m[4]?.toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
    }
    if (h > 23 || mi > 59 || s > 59) return null;
    return { serial: timeToSerial(h, mi, s), kind: m[3] !== undefined ? 'time-s' : 'time' };
  }
  return null;
}
