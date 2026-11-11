import type { District, Guardian, GuardianLink, School, Section, Student, Teacher, Term } from "./model.ts";

/*
 * The starting district. Deterministic for a given "today": the same date
 * always gives the same people and classes. Term dates follow the school
 * year that "today" falls in, so the data never goes stale.
 *
 * Edge cases planted on purpose (see EDGE below), gathered from what the
 * Aeries, Clever, and PowerSchool connectors each have to handle.
 */

const FIRST = ["Jordan", "Aisha", "Mateo", "Priya", "Liam", "Sofia", "Noah", "Mei", "Elijah", "Zara", "Diego", "Hana", "Owen", "Isla", "Caleb", "Amara", "Leo", "Grace", "Kai", "Nora"];
const LAST = ["Whitfield", "Patel", "Garcia", "Nguyen", "Okafor", "Kim", "Rossi", "Haddad", "Ito", "Brennan", "Silva", "Novak", "Reyes", "Chen", "Lopez", "Davis", "Singh", "Moore", "Clark", "Ahmed"];
const PARENT_FIRST = ["Alex", "Chris", "Jamie", "Robin", "Dana", "Morgan", "Casey", "Taylor", "Jesse", "Riley"];

export const SCHOOLS: School[] = [
  { key: "high", name: "Lincoln High School", number: "100", aeriesCode: 994, psId: 3, lowGrade: 9, highGrade: 12, attendance: "Period" },
  { key: "middle", name: "Roosevelt Middle School", number: "200", aeriesCode: 995, psId: 4, lowGrade: 6, highGrade: 8, attendance: "Daily" },
  { key: "elem", name: "Cedar Elementary School", number: "300", aeriesCode: 996, psId: 5, lowGrade: -1, highGrade: 5, attendance: "Daily" },
];

/** Who to look at for each planted edge case. */
export const EDGE = {
  noStudentNumber: 2900,
  withdrawn: 2901,
  preregistered: 2902,
  multiSchool: 2903,
  noSections: 2904,
  sparse: 2905,
  siblings: [2906, 2907],
  auntSharesGuardian: 2908,
  emergencyContactFirst: 2909,
  twoParents: 2910,
  badStateId: 2911,
  teacherNoEmail: 503,
  teacherFromMiddleSchool: 601,
  multiRoleTeacher: 505,
  coTeacher: 506,
  unsharedTeacher: 599,
  guardianBadEmail: 59004,
};

/** The school year "today" falls in: it starts in August. */
export function schoolYear(today: string) {
  const [y, m] = today.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}

export function seedDistrict(today: string): District {
  const year = schoolYear(today);
  const terms: Term[] = [
    { id: 3600, code: "Y", name: `${year}-${year + 1}`, start: `${year}-08-12`, end: `${year + 1}-06-04` },
    { id: 3601, code: "F", name: `Fall ${year}`, start: `${year}-08-12`, end: `${year}-12-18` },
    { id: 3602, code: "S", name: `Spring ${year + 1}`, start: `${year + 1}-01-06`, end: `${year + 1}-06-04` },
  ];

  const teachers: Teacher[] = [
    { id: 501, first: "Erin", last: "Donovan", email: "edonovan@dummyschool.org", school: "high" },
    { id: 502, first: "Marcus", last: "Lee", email: "mlee@dummyschool.org", school: "high" },
    { id: 503, first: "Rosa", last: "Alvarez", email: "", school: "high" },
    { id: 504, first: "Yuki", last: "Tanaka", email: "ytanaka@dummyschool.org", school: "high" },
    { id: 505, first: "Pat", last: "Morgan", email: "pmorgan@dummyschool.org", school: "high", multiRole: true },
    { id: 506, first: "Sam", last: "Alvarez", email: "salvarez@dummyschool.org", school: "high" },
    { id: 599, first: "Unshared", last: "Teacher", email: "unshared@dummyschool.org", school: "high", unshared: true },
    { id: 601, first: "Dana", last: "Brooks", email: "dbrooks@dummyschool.org", school: "middle" },
    { id: 602, first: "Omar", last: "Haddad", email: "ohaddad@dummyschool.org", school: "middle" },
    { id: 701, first: "Rosa", last: "Flores", email: "rflores@dummyschool.org", school: "elem" },
    { id: 702, first: "Kim", last: "Park", email: "kpark@dummyschool.org", school: "elem" },
  ];

  const students: Student[] = [];
  const guardians: Guardian[] = [];
  let guardianId = 50000;
  const parentOf = (s: { last: string; id: number }, i: number, relationship = i % 2 ? "Father" : "Mother"): GuardianLink => {
    const first = PARENT_FIRST[i % PARENT_FIRST.length];
    const id = guardianId++;
    guardians.push({ id, first, last: s.last, email: i % 6 === 5 ? "" : `${first}.${s.last}.${s.id}@family.example`.toLowerCase(), phone: `(555) 010-${String(1000 + (i % 9000)).slice(-4)}` });
    return { guardianId: id, relationship, type: "Parent/Guardian" };
  };

  const regular = (key: Student["school"], count: number, idBase: number, numberBase: number, grades: number[]) => {
    for (let i = 0; i < count; i++) {
      const id = idBase + i;
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 7 + idBase) % LAST.length];
      const s: Student = {
        id, number: String(numberBase + i), school: key, first, last,
        grade: grades[i % grades.length],
        stateId: String(1000000000 + id * 7).padStart(10, "0"),
        email: `${first}.${last}.${id}@students.dummyschool.org`.toLowerCase(),
        status: "active", guardians: [],
      };
      // Every seventh student has no guardian on file.
      if (i % 7 !== 6) s.guardians.push(parentOf(s, i));
      students.push(s);
    }
  };
  regular("high", 120, 2000, 100000, [9, 10, 11, 12]);
  regular("middle", 18, 3000, 200000, [6, 7, 8]);
  regular("elem", 14, 4000, 300000, [-1, 0, 0, 1, 2, 3, 4, 5]);

  // ---------- edge cases ----------
  const edge = (s: Omit<Student, "email" | "guardians" | "status"> & Partial<Student>) =>
    students.push({ email: "", guardians: [], status: "active", ...s });
  edge({ id: 2900, number: "", school: "high", first: "Noel", last: "Ito", grade: 9, stateId: "1000020300" });
  edge({ id: 2901, number: "109001", school: "high", first: "Gabe", last: "Away", grade: 12, stateId: "1000020307", status: "withdrawn" });
  edge({ id: 2902, number: "109002", school: "high", first: "Penny", last: "Prereg", grade: 9, stateId: "", status: "preregistered" });
  edge({ id: 2903, number: "209003", school: "middle", alsoAt: ["high"], first: "Ava", last: "Twoschools", grade: 8, stateId: "1000020321" });
  edge({ id: 2905, number: "109005", school: "high", first: "Remy", last: "Sato", grade: null, stateId: "", sparse: true });
  edge({ id: 2911, number: "109011", school: "high", first: "Lena", last: "Badid", grade: 10, stateId: "12345" });

  const noSections: Student = { id: 2904, number: "109004", school: "high", first: "Jesse", last: "Nosched", grade: 10, stateId: "1000020328", email: "", status: "active", guardians: [] };
  guardians.push({ id: 59004, first: "Jo", last: "Nosched", email: "jo.nosched.family.example", phone: "(555) 040-4000" });
  noSections.guardians.push({ guardianId: 59004, relationship: "Mother", type: "Parent/Guardian" });
  students.push(noSections);

  // One guardian for two siblings, and the same person as an aunt for a third student.
  guardians.push({ id: 59006, first: "Morgan", last: "Lee", email: "morgan.lee@family.example", phone: "(555) 020-2000" });
  for (const [id, first] of [[2906, "Theo"], [2907, "Tess"]] as const) {
    students.push({ id, number: String(107000 + id), school: "high", first, last: "Lee", grade: id === 2906 ? 9 : 11, stateId: String(1000000000 + id * 7), email: "", status: "active", guardians: [{ guardianId: 59006, relationship: "Guardian", type: "Parent/Guardian" }] });
  }
  students.push({ id: 2908, number: "109008", school: "high", first: "Max", last: "Ortiz", grade: 10, stateId: "1000020356", email: "", status: "active", guardians: [{ guardianId: 59006, relationship: "Aunt/Uncle", type: "Family" }] });

  // An emergency contact listed before the family member.
  guardians.push({ id: 59009, first: "Quinn", last: "Neighbor", email: "", phone: "(555) 030-3000" });
  guardians.push({ id: 59010, first: "Taylor", last: "Kim", email: "taylor.kim@family.example", phone: "(555) 030-3001" });
  students.push({ id: 2909, number: "109009", school: "high", first: "Iris", last: "Kim", grade: 12, stateId: "1000020363", email: "", status: "active", guardians: [
    { guardianId: 59009, relationship: "Other", type: "Emergency" },
    { guardianId: 59010, relationship: "Grandparent", type: "Family" },
  ] });

  // Two parents on file: PowerSchool lists both emails in one field.
  guardians.push({ id: 59011, first: "Tobi", last: "Okafor", email: "Tobi.Okafor@Family.example", phone: "(555) 050-5000" });
  guardians.push({ id: 59012, first: "Ada", last: "Okafor", email: "ada.okafor@family.example", phone: "(555) 050-5001" });
  students.push({ id: 2910, number: "109010", school: "high", first: "Remi", last: "Okafor", grade: 11, stateId: "1000020370", email: "", status: "active", guardians: [
    { guardianId: 59011, relationship: "Father", type: "Parent/Guardian" },
    { guardianId: 59012, relationship: "Mother", type: "Parent/Guardian" },
  ] });

  // ---------- classes ----------
  // Regular students only; edge-case students are placed in classes by hand.
  const ids = (school: Student["school"], filter: (s: Student, i: number) => boolean = () => true) =>
    students.filter((s) => s.school === school && (s.id < 2900 || s.id >= 3000)).filter(filter).map((s) => s.id);
  const active = (xs: number[]) => xs.map((studentId) => ({ studentId, status: "active" as const }));
  const highEdge = [2900, 2905, 2906, 2907, 2908, 2909, 2910, 2911];

  const sections: Section[] = [
    { id: 9001, school: "high", course: "English 9", courseNumber: "ENG9", period: "1", termId: 3600, teachers: [501, 506], roster: active([...ids("high"), ...highEdge, 2901]) },
    { id: 9002, school: "high", course: "Algebra I", courseNumber: "ALG1", period: "2", termId: 3601, teachers: [502], roster: active(ids("high", (_, i) => i % 2 === 0)) },
    { id: 9003, school: "high", course: "Biology", courseNumber: "BIO", period: "3", termId: 3601, teachers: [503], roster: active(ids("high", (_, i) => i < 40)) },
    { id: 9004, school: "high", course: "Spanish I", courseNumber: "SPAN1", period: "4", termId: 3600, teachers: [601], roster: active([...ids("high", (_, i) => i < 12), 2903]) },
    { id: 9005, school: "high", course: "Art", courseNumber: "ART", period: null, termId: null, teachers: [599], roster: active(ids("high", (_, i) => i >= 100)) },
    { id: 9006, school: "high", course: "Chemistry", courseNumber: "CHEM", period: "5", termId: 3600, teachers: [505], roster: active(ids("high", (_, i) => i >= 60)) },
    { id: 9101, school: "middle", course: "Science 7", courseNumber: "SCI7", period: "1", termId: 3600, teachers: [601], roster: active([...ids("middle"), 2903]) },
    { id: 9102, school: "middle", course: "Math 7", courseNumber: "MATH7", period: "2", termId: 3600, teachers: [602], roster: active(ids("middle")) },
    { id: 9201, school: "elem", course: "Kindergarten AM", courseNumber: "KAM", period: null, termId: 3600, teachers: [701], roster: active(ids("elem", (s) => (s.grade ?? 0) <= 0)) },
    { id: 9202, school: "elem", course: "Grades 1-5", courseNumber: "G15", period: null, termId: 3600, teachers: [702], roster: active(ids("elem", (s) => (s.grade ?? 0) > 0)) },
  ];
  // A dropped class and a class the student already left.
  sections[1].roster[0].status = "dropped";
  sections[2].roster[1].status = "left";
  // The withdrawn student's classes ended when they left.
  sections[0].roster.find((r) => r.studentId === EDGE.withdrawn)!.status = "left";

  return { name: "Dummy School District", schools: SCHOOLS, students, guardians, teachers, terms, sections, today };
}
