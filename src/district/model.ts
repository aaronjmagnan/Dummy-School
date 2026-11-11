/*
 * The one fake district behind every mock. Each SIS (Aeries, Clever,
 * PowerSchool) presents this same data in its own format, so a student
 * added here shows up in all three.
 *
 * Every name, number, and address is made up.
 */

export type SchoolKey = "high" | "middle" | "elem";

export type School = {
  key: SchoolKey;
  name: string;
  /** The school number people use (PowerSchool school_number, Clever school_number). */
  number: string;
  /** Aeries school code. */
  aeriesCode: number;
  /** PowerSchool's internal school id. */
  psId: number;
  lowGrade: number;
  highGrade: number;
  attendance: "Period" | "Daily";
};

/** -2 preschool, -1 transitional kindergarten, 0 kindergarten, 1-12 grades. */
export type Grade = number;

export type StudentStatus = "active" | "withdrawn" | "preregistered";

export type GuardianLink = {
  guardianId: number;
  /** Mother, Father, Guardian, Grandparent, Aunt/Uncle, Other. */
  relationship: string;
  /** Clever's grouping: Parent/Guardian, Family, Emergency. */
  type: "Parent/Guardian" | "Family" | "Emergency";
};

export type Student = {
  /** Unique across the district; also Aeries StudentID and PowerSchool id. */
  id: number;
  /** The student number schools know. Blank on purpose for one student. */
  number: string;
  school: SchoolKey;
  /** Other schools the student is also enrolled at (Clever shares them there too). */
  alsoAt?: SchoolKey[];
  first: string;
  last: string;
  grade: Grade | null;
  /** 10 digits, or blank, or malformed on purpose. */
  stateId: string;
  email: string;
  status: StudentStatus;
  guardians: GuardianLink[];
  /** Only the fields every SIS guarantees (Clever's "sparse" student). */
  sparse?: boolean;
};

export type Guardian = { id: number; first: string; last: string; email: string; phone: string };

export type Teacher = {
  id: number;
  first: string;
  last: string;
  email: string;
  school: SchoolKey;
  /** Also staff and district admin (Clever). */
  multiRole?: boolean;
  /** The district doesn't share this teacher (Clever returns 404 for them). */
  unshared?: boolean;
};

export type Term = { id: number; code: string; name: string; start: string; end: string };

export type RosterEntry = {
  studentId: number;
  /** dropped: removed from the class. left: exited before today. */
  status: "active" | "dropped" | "left";
};

export type Section = {
  id: number;
  school: SchoolKey;
  course: string;
  courseNumber: string;
  /** null for classes without a period (art, kindergarten). */
  period: string | null;
  termId: number | null;
  /** First is the primary teacher. */
  teachers: number[];
  roster: RosterEntry[];
};

export type District = {
  name: string;
  schools: School[];
  students: Student[];
  guardians: Guardian[];
  teachers: Teacher[];
  terms: Term[];
  sections: Section[];
  /** YYYY-MM-DD: "today" for this district. */
  today: string;
};

export const gradeLabel = (g: Grade | null) => (g === null ? "" : g === -2 ? "PK" : g === -1 ? "TK" : g === 0 ? "K" : String(g));
export const fullName = (p: { first: string; last: string }) => `${p.first} ${p.last}`.trim();
