import type { District, SchoolKey, Section, Student } from "./model.ts";
import { seedDistrict } from "./seed.ts";

/*
 * Everything changed from the control panel is a Change, kept in order and
 * replayed over the seed. The seed itself is never stored, so state stays
 * tiny and "reset" is just an empty list.
 */

export type NewGuardian = { first: string; last: string; email: string; phone: string };

export type Change = { at?: string } & (
  | { type: "withdraw"; studentId: number }
  | { type: "restore"; studentId: number }
  | { type: "addStudent"; school: SchoolKey; first: string; last: string; grade: number | null; guardian?: NewGuardian | null }
  | { type: "editStudent"; studentId: number; first?: string; last?: string; grade?: number | null; stateId?: string }
  | { type: "editGuardian"; guardianId: number; first?: string; last?: string; email?: string; phone?: string }
  | { type: "dropClass"; studentId: number; sectionId: number }
  | { type: "addToClass"; studentId: number; sectionId: number }
  | { type: "setTeacher"; sectionId: number; teacherId: number }
  | { type: "editTeacher"; teacherId: number; first?: string; last?: string; email?: string }
  | { type: "nextSync" }
  | { type: "newTerm" }
);

/** What the "next sync" scenario does, so the panel and tests can describe it. */
export const NEXT_SYNC = {
  withdrawn: [2000, 2001, 2002, 2003, 2004],
  added: ["Ava Newcomer", "Kai Newcomer", "Lena Newcomer"],
  guardianEmailFor: 2010,
  newGuardianEmail: "new.address@family.example",
  gradeUp: 2013,
  dropsAlgebra: 2012,
  teacherRenamed: { id: 502, last: "Lee-Park", email: "mleepark@dummyschool.org" },
};

const NEW_STUDENT_ID = 5000;

function firstClasses(d: District, s: Student): Section[] {
  const at = d.sections.filter((x) => x.school === s.school && x.roster.length);
  if (s.school === "elem") return at.filter((x) => (x.id === 9201) === ((s.grade ?? 0) <= 0)).slice(0, 1);
  if (s.school === "high") return at.filter((x) => x.id === 9001);
  return at;
}

export function applyChange(d: District, c: Change) {
  const student = (id: number) => d.students.find((s) => s.id === id);
  const section = (id: number) => d.sections.find((s) => s.id === id);
  switch (c.type) {
    case "withdraw": {
      const s = student(c.studentId);
      if (!s) return;
      s.status = "withdrawn";
      for (const sec of d.sections) for (const r of sec.roster) if (r.studentId === s.id && r.status === "active") r.status = "left";
      return;
    }
    case "restore": {
      const s = student(c.studentId);
      if (!s || s.status === "active") return;
      s.status = "active";
      const left = d.sections.filter((sec) => sec.roster.some((r) => r.studentId === s.id && r.status === "left"));
      for (const sec of left.length ? left : firstClasses(d, s)) {
        const r = sec.roster.find((x) => x.studentId === s.id);
        if (r) r.status = "active";
        else sec.roster.push({ studentId: s.id, status: "active" });
      }
      return;
    }
    case "addStudent": {
      const id = Math.max(NEW_STUDENT_ID - 1, ...d.students.map((s) => s.id)) + 1;
      const school = d.schools.find((x) => x.key === c.school)!;
      const s: Student = {
        id, number: String(Number(school.number) * 1000 + 900 + (id - NEW_STUDENT_ID)), school: c.school,
        first: c.first.trim(), last: c.last.trim(), grade: c.grade, stateId: String(3000000000 + id),
        email: `${c.first}.${c.last}.${id}@students.dummyschool.org`.toLowerCase().replace(/\s+/g, ""),
        status: "active", guardians: [],
      };
      if (c.guardian && (c.guardian.first || c.guardian.last)) {
        const gid = Math.max(59999, ...d.guardians.map((g) => g.id)) + 1;
        d.guardians.push({ id: gid, ...c.guardian });
        s.guardians.push({ guardianId: gid, relationship: "Guardian", type: "Parent/Guardian" });
      }
      d.students.push(s);
      for (const sec of firstClasses(d, s)) sec.roster.push({ studentId: id, status: "active" });
      return;
    }
    case "editStudent": {
      const s = student(c.studentId);
      if (!s) return;
      if (c.first !== undefined) s.first = c.first;
      if (c.last !== undefined) s.last = c.last;
      if (c.grade !== undefined) s.grade = c.grade;
      if (c.stateId !== undefined) s.stateId = c.stateId;
      return;
    }
    case "editGuardian": {
      const g = d.guardians.find((x) => x.id === c.guardianId);
      if (!g) return;
      for (const k of ["first", "last", "email", "phone"] as const) if (c[k] !== undefined) g[k] = c[k]!;
      return;
    }
    case "dropClass": {
      const r = section(c.sectionId)?.roster.find((x) => x.studentId === c.studentId);
      if (r) r.status = "dropped";
      return;
    }
    case "addToClass": {
      const sec = section(c.sectionId);
      if (!sec || !student(c.studentId)) return;
      const r = sec.roster.find((x) => x.studentId === c.studentId);
      if (r) r.status = "active";
      else sec.roster.push({ studentId: c.studentId, status: "active" });
      return;
    }
    case "setTeacher": {
      const sec = section(c.sectionId);
      if (sec && d.teachers.some((t) => t.id === c.teacherId)) sec.teachers = [c.teacherId, ...sec.teachers.slice(1).filter((t) => t !== c.teacherId)];
      return;
    }
    case "editTeacher": {
      const t = d.teachers.find((x) => x.id === c.teacherId);
      if (!t) return;
      for (const k of ["first", "last", "email"] as const) if (c[k] !== undefined) t[k] = c[k]!;
      return;
    }
    case "nextSync": {
      const n = NEXT_SYNC;
      for (const id of n.withdrawn) applyChange(d, { type: "withdraw", studentId: id });
      for (const name of n.added) {
        const [first, last] = name.split(" ");
        if (d.students.some((s) => s.first === first && s.last === last)) continue;
        applyChange(d, { type: "addStudent", school: "high", first, last, grade: 9, guardian: { first: "Parent", last, email: `${first}.${last}@family.example`.toLowerCase(), phone: "(555) 020-0000" } });
      }
      const g = student(n.guardianEmailFor)?.guardians[0];
      if (g) applyChange(d, { type: "editGuardian", guardianId: g.guardianId, email: n.newGuardianEmail });
      const up = student(n.gradeUp);
      if (up && up.grade !== null) up.grade = Math.min(12, up.grade + 1);
      applyChange(d, { type: "dropClass", studentId: n.dropsAlgebra, sectionId: 9002 });
      applyChange(d, { type: "editTeacher", teacherId: n.teacherRenamed.id, last: n.teacherRenamed.last, email: n.teacherRenamed.email });
      return;
    }
    case "newTerm": {
      // Rollover: fall classes end; spring classes start with new ids, as a real SIS does.
      if (d.sections.some((s) => s.termId === 3602)) return;
      const fall = d.sections.filter((s) => s.termId === 3601);
      const next: Record<string, [string, string]> = { ALG1: ["Geometry", "GEOM"], BIO: ["Physics", "PHYS"] };
      for (const sec of fall) {
        const [course, courseNumber] = next[sec.courseNumber] ?? [`${sec.course} B`, `${sec.courseNumber}B`];
        d.sections.push({
          ...sec, id: sec.id + 300, course, courseNumber, termId: 3602,
          roster: sec.roster.filter((r) => r.status === "active").map((r) => ({ ...r })),
        });
        for (const r of sec.roster) if (r.status === "active") r.status = "left";
      }
      return;
    }
  }
}

/** The district as it stands: the seed for "today" with every change replayed. */
export function buildDistrict(today: string, changes: Change[]): District {
  const d = seedDistrict(today);
  for (const c of changes) applyChange(d, c);
  return d;
}
