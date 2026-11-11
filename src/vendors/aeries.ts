import { ABSENCE_CODES, attendanceFor } from "../district/attendance.ts";
import type { District, School, Student } from "../district/model.ts";
import { clientCredentials, issueToken, json, tokenValid, bearer, type AeriesSwitches, type Ctx, type MockRequest, type MockResponse } from "./http.ts";
import { oneRosterRoute, type OneRosterStyle } from "./oneroster.ts";

/*
 * Aeries, as its published docs describe it (support.aeries.com). Address:
 * {base} = https://<host>/aeries
 *
 *   Aeries API v5 (header AERIES-CERT)
 *     GET  {base}/api/v5/systeminfo                       no certificate needed
 *     GET  {base}/api/v5/schools[/{SchoolCode}]
 *     GET  {base}/api/v5/schools/{SC}/students[/{StudentID}]   ?StartingRecord&EndingRecord
 *     GET  {base}/api/v5/schools/{SC}/contacts[/{StudentID}]
 *     GET  {base}/api/v5/schools/{SC}/AbsenceCodes[/{Code}]
 *     GET  {base}/api/v5/schools/{SC}/attendance[/{StudentID}] ?StartDate&EndDate (YYYYMMDD; other formats ignored)
 *
 *   OneRoster 1.1 (OAuth 2 client credentials; a scope is required)
 *     POST {base}/token
 *     GET  {base}/ims/oneroster/v1p1/schools/{SC}[/students|/teachers|/classes|/enrollments|/terms]
 *     GET  {base}/ims/oneroster/v1p1/users/{id}, /orgs     ?limit&offset
 *
 * Paths are case-insensitive, as on Aeries' IIS servers.
 */

/** The certificate Aeries' own docs use in examples. Fine for a fake district; never a real one's. */
export const AERIES_CERT = "477abe9e7d27439681d62f4e0de1f5e1";
export const AERIES_CLIENT_ID = "dummy-school-aeries";
export const AERIES_CLIENT_SECRET = "aeries-secret";

const OR_SCOPES = [
  "https://purl.imsglobal.org/spec/or/v1p1/scope/roster-core.readonly",
  "https://purl.imsglobal.org/spec/or/v1p1/scope/roster.readonly",
  "https://purl.imsglobal.org/spec/or/v1p1/scope/roster-demographics.readonly",
];

const RELATIONSHIP: Record<string, string> = { Father: "11", Mother: "12", Guardian: "13", Grandparent: "14", "Aunt/Uncle": "15", Other: "19" };

const denied = () => json(401, { Message: "Authorization has been denied for this request." });
const notFound = () => json(404, { Message: "No HTTP resource was found that matches the request URI." });
const ymdToIso = (v: string | null) => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

export const aeriesStyle = (d: District): OneRosterStyle => ({
  schoolId: (s) => String(s.aeriesCode),
  studentId: (s) => `STU_${s.id}`,
  studentIdentifier: (s, school) => `${school.aeriesCode}_STU_${s.id}`,
  guardianId: (g) => `PAT_${g}`,
  teacherId: (t) => `TCH_${t}`,
  classId: (sec, school) => `${school.aeriesCode}_${sec.id}`,
  termId: (t, school) => `${school.aeriesCode}_${d.terms.find((x) => x.id === t)?.code ?? t}`,
  inactive: "omit",
  districtName: d.name,
});

function aeriesStudent(s: Student, school: School, d: District) {
  const g = d.guardians.find((x) => x.id === s.guardians[0]?.guardianId);
  return {
    StudentID: s.id, StudentNumber: Number(s.number) || s.id, SchoolCode: school.aeriesCode, StateStudentID: s.stateId,
    FirstName: s.first, LastName: s.last, Grade: s.grade ?? school.lowGrade,
    InactiveStatusCode: s.status === "withdrawn" ? "I" : "",
    StudentEmailAddress: s.email, HomePhone: (g?.phone ?? "").replace(/\D/g, ""), ParentEmailAddress: "",
  };
}

function v5(req: MockRequest, parts: string[], ctx: Ctx<AeriesSwitches>): MockResponse {
  const d = ctx.district;
  if (parts[0] === "systeminfo") {
    return json(200, { AeriesVersion: "10.26.1.0", DatabaseYear: "dummy", AvailableDatabaseYears: [], LocalTimeZoneName: "(UTC-08:00) Pacific Time (US & Canada)", CurrentDateTime: new Date(ctx.now).toISOString() });
  }
  if (req.headers.get("aeries-cert") !== AERIES_CERT || ctx.switches.rejectSignIn) return denied();
  const deny = new Set(ctx.switches.deny);

  if (parts[0] !== "schools") return notFound();
  const schools = d.schools.map((s) => ({ SchoolCode: s.aeriesCode, Name: s.name, LowGradeLevel: s.lowGrade, HighGradeLevel: s.highGrade, AttendanceType: s.attendance, AttendanceReporting: "Negative" }));
  if (parts.length === 1) return json(200, schools);
  const school = d.schools.find((s) => s.aeriesCode === Number(parts[1]));
  if (!school) return json(404, { Message: `School ${parts[1]} not found` });
  if (parts.length === 2) return json(200, schools.find((s) => s.SchoolCode === school.aeriesCode));
  const id = parts[3] ? Number(parts[3]) : null;
  const atSchool = d.students.filter((s) => s.school === school.key && s.status !== "preregistered" && (id === null || s.id === id));

  switch (parts[2]) {
    case "students": {
      if (deny.has("Student Data")) return denied();
      if (id !== null && !atSchool.length) return json(404, { Message: "Student not found" });
      let list = atSchool.map((s) => aeriesStudent(s, school, d));
      const from = Number(req.query.get("startingrecord")), to = Number(req.query.get("endingrecord"));
      if (from > 0 && to >= from) list = list.slice(from - 1, to);
      return json(200, list);
    }
    case "contacts": {
      if (deny.has("Contacts")) return denied();
      return json(200, atSchool.flatMap((s) => s.guardians.map((link, i) => {
        const g = d.guardians.find((x) => x.id === link.guardianId)!;
        return {
          StudentID: s.id, SchoolCode: school.aeriesCode, SequenceNumber: i + 1, PortalAccountID: g.id,
          FirstName: g.first, LastName: g.last, EmailAddress: g.email, CellPhone: g.phone.replace(/\D/g, ""), HomePhone: "",
          RelationshipToStudentCode: RELATIONSHIP[link.relationship] ?? "19", ContactOrder: i + 1,
          MailingAddress: "", LivesWithStudentIndicator: link.type === "Parent/Guardian" ? "Y" : "N",
        };
      })));
    }
    case "absencecodes": {
      if (deny.has("Absence Code Table")) return denied();
      const codes = ABSENCE_CODES.filter((c) => !parts[3] || c.code.toLowerCase() === parts[3]).map((c) => ({
        SchoolCode: school.aeriesCode, AbsenceCode: c.code, Title: c.title, Abbreviation: c.abbreviation, TypeCode: c.type, TypeDescription: c.typeDescription,
        IsTemporarilyNotEnrolled: c.temporarilyNotEnrolled, IsSuspension: false, CountsForADA: false,
      }));
      return parts[3] ? (codes[0] ? json(200, codes[0]) : notFound()) : json(200, codes);
    }
    case "attendance": {
      if (deny.has("Attendance")) return denied();
      if (id === null && ctx.switches.noSchoolWideAttendance) return notFound();
      // Filters in any format other than YYYYMMDD are ignored, without an error.
      const from = ymdToIso(req.query.get("startdate"));
      const to = ymdToIso(req.query.get("enddate"));
      const out = atSchool
        .map((s) => ({
          StudentID: s.id,
          SchoolCode: school.aeriesCode,
          AttendanceDays: attendanceFor(d, s)
            .filter((a) => (!from || a.date >= from) && (!to || a.date <= to))
            .map((a) => ({ CalendarDate: `${a.date}T00:00:00`, AllDayAttendanceCode: a.allDayCode, Classes: a.periods.map((p) => ({ SectionNumber: p.sectionId, Period: p.period, AttendanceCode: p.code })) })),
        }))
        // Traditional schools leave out students with no attendance days.
        .filter((r) => r.AttendanceDays.length);
      return json(200, out);
    }
    default:
      return notFound();
  }
}

function token(req: MockRequest, ctx: Ctx<AeriesSwitches>): MockResponse {
  if (req.method !== "POST") return json(405, { error: "invalid_request" });
  const form = new URLSearchParams(req.body);
  const { id, secret } = clientCredentials(req.headers, form);
  if (form.get("grant_type") !== "client_credentials") return json(400, { error: "unsupported_grant_type" });
  if (id !== AERIES_CLIENT_ID || secret !== AERIES_CLIENT_SECRET || ctx.switches.rejectSignIn) return json(401, { error: "invalid_client" });
  // Aeries: "Scopes MUST be included in the request."
  const asked = (form.get("scope") ?? "").split(/\s+/).filter((s) => OR_SCOPES.includes(s));
  if (!asked.length) return json(400, { error: "invalid_scope" });
  return json(200, { access_token: issueToken("aeries", ctx.switches.tokenEpoch, 21600, ctx.now), token_type: "bearer", expires_in: 21600, scope: asked.join(" ") });
}

export function aeries(req: MockRequest, ctx: Ctx<AeriesSwitches>): MockResponse {
  const parts = req.path.map((p) => p.toLowerCase()).filter(Boolean);
  if (parts.length === 1 && parts[0] === "token") return token(req, ctx);
  if (parts[0] === "api" && parts[1] === "v5") {
    // Query names are case-insensitive too (StartDate, startdate).
    const query = new URLSearchParams([...req.query].map(([k, v]) => [k.toLowerCase(), v]));
    return v5({ ...req, query }, parts.slice(2), ctx);
  }
  if (parts[0] === "ims" && parts[1] === "oneroster" && parts[2] === "v1p1") {
    if (!tokenValid(bearer(req.headers), "aeries", ctx.switches.tokenEpoch, ctx.now)) {
      return json(401, { imsx_codeMajor: "failure", imsx_severity: "error", imsx_description: "Unauthorized" });
    }
    const d = ctx.district;
    return oneRosterRoute(d, req.path.filter(Boolean).slice(3), req.query, aeriesStyle(d), (id) => d.schools.find((s) => String(s.aeriesCode) === id));
  }
  return notFound();
}
