import type { District, Student } from "./model.ts";

/*
 * Attendance, generated rather than stored: the same student and date
 * always get the same mark. Only days with a mark exist ("negative"
 * attendance, as Aeries reports it). Codes follow Aeries' documented types.
 */

export type AbsenceCode = { code: string; title: string; abbreviation: string; type: number; typeDescription: string; temporarilyNotEnrolled: boolean };

export const ABSENCE_CODES: AbsenceCode[] = [
  ["A", "UNVERIFIED", "UNV", 1], ["I", "ILLNESS", "ILL", 2], ["D", "Dr Note", "DR", 2], ["U", "UNEXCUSED", "UNX", 3],
  ["X", "VERIFIED", "VER", 4], ["T", "TARDY", "TDY", 5], ["L", "Late>30", ">30", 9], ["Q", "SchActvty", "ACT", 6], ["G", "TmpNotEnr", "TNE", 2],
].map(([code, title, abbreviation, type]) => ({
  code: code as string, title: title as string, abbreviation: abbreviation as string, type: type as number,
  typeDescription: ({ 1: "Unverified Absence", 2: "Excused Absence", 3: "Unexcused Absence", 4: "Verified Not Absent", 5: "Tardy", 6: "Present", 9: "Verified Unexcused Tardy" } as Record<number, string>)[type as number],
  temporarilyNotEnrolled: code === "G",
}));

/** Full-day absences a correct import keeps: types 1 to 3, not "temporarily not enrolled". */
export const COUNTED_ABSENCE_CODES = new Set(ABSENCE_CODES.filter((c) => c.type >= 1 && c.type <= 3 && !c.temporarilyNotEnrolled).map((c) => c.code));

export type AttendanceDay = { studentId: number; date: string; allDayCode: string; periods: { sectionId: number; period: string; code: string }[] };

/** The last `n` weekdays up to and including today, oldest first. */
export function schoolDays(today: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${today}T12:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** A stable number in [0, 1) for a student and date. */
function chance(studentId: number, date: string) {
  let h = 2166136261;
  for (const ch of `${studentId}:${date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const ALL_DAY = ["A", "A", "I", "D", "U", "T", "L", "Q", "X", "G"];

export function attendanceFor(d: District, s: Student, days = schoolDays(d.today, 25)): AttendanceDay[] {
  if (s.status !== "active") return [];
  const school = d.schools.find((x) => x.key === s.school)!;
  const sections = d.sections.filter((sec) => sec.school === s.school && sec.roster.some((r) => r.studentId === s.id && r.status === "active"));
  const out: AttendanceDay[] = [];
  for (const date of days) {
    const r = chance(s.id, date);
    if (r < 0.08) {
      const code = ALL_DAY[Math.floor((r / 0.08) * ALL_DAY.length)];
      out.push({ studentId: s.id, date, allDayCode: code, periods: school.attendance === "Period" ? sections.map((x) => ({ sectionId: x.id, period: x.period ?? "", code })) : [] });
    } else if (r < 0.11 && school.attendance === "Period" && sections.length) {
      // Cut one class: a period mark with no all-day code, so not a full-day absence.
      const sec = sections[Math.floor(((r - 0.08) / 0.03) * sections.length)];
      out.push({ studentId: s.id, date, allDayCode: "", periods: [{ sectionId: sec.id, period: sec.period ?? "", code: "U" }] });
    }
  }
  return out;
}
