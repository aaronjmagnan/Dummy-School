import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildDistrict, NEXT_SYNC } from "./district/changes.ts";
import { COUNTED_ABSENCE_CODES, attendanceFor } from "./district/attendance.ts";
import { EDGE, seedDistrict } from "./district/seed.ts";
import { answer } from "./state/serve.ts";
import { defaultState, getStore, resetMemoryStore, type State } from "./state/store.ts";
import { AERIES_CERT, AERIES_CLIENT_ID, AERIES_CLIENT_SECRET } from "./vendors/aeries.ts";
import { CLEVER_TOKEN, cid } from "./vendors/clever.ts";
import { issueToken, tokenValid, type Vendor } from "./vendors/http.ts";
import { PS_CLIENT_ID, PS_CLIENT_SECRET } from "./vendors/powerschool.ts";

const TODAY = "2026-11-10";
const BASE = "https://dummy.test";

beforeEach(async () => {
  resetMemoryStore();
  await getStore().write({ ...defaultState(), today: TODAY });
});

async function call(vendor: Vendor, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const url = new URL(path, "https://dummy.test");
  const res = await answer(vendor, {
    method: init.method ?? "GET",
    path: url.pathname.split("/").filter(Boolean),
    query: url.searchParams,
    headers: new Headers(init.headers),
    body: init.body ?? "",
  }, `${BASE}/${vendor}`);
  return res as { status: number; body: any; headers?: Record<string, string> };
}
const setState = async (fn: (s: State) => void) => {
  const s = await getStore().read();
  fn(s);
  await getStore().write(s);
};
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

// ---------- the district ----------

test("the seed is the same every time for a date, and term dates follow the school year", () => {
  assert.deepEqual(seedDistrict(TODAY), seedDistrict(TODAY));
  assert.equal(seedDistrict("2026-11-10").terms[0].start, "2026-08-12");
  assert.equal(seedDistrict("2027-03-01").terms[0].start, "2026-08-12");
  assert.equal(seedDistrict("2027-09-01").terms[0].start, "2027-08-12");
  const d = seedDistrict(TODAY);
  assert.equal(new Set(d.students.map((s) => s.id)).size, d.students.length, "student ids are unique");
  assert.equal(d.students.find((s) => s.id === EDGE.withdrawn)!.status, "withdrawn");
  assert.ok(d.sections[0].roster.some((r) => r.studentId === EDGE.withdrawn && r.status === "left"));
});

test("next sync withdraws, adds, and edits; applying it twice adds nobody twice", () => {
  const before = buildDistrict(TODAY, []);
  const after = buildDistrict(TODAY, [{ type: "nextSync" }, { type: "nextSync" }]);
  for (const id of NEXT_SYNC.withdrawn) assert.equal(after.students.find((s) => s.id === id)!.status, "withdrawn");
  assert.equal(after.students.length, before.students.length + NEXT_SYNC.added.length);
  assert.equal(after.teachers.find((t) => t.id === 502)!.last, "Lee-Park");
  assert.equal(after.sections.find((s) => s.id === 9002)!.roster.find((r) => r.studentId === NEXT_SYNC.dropsAlgebra)!.status, "dropped");
});

test("new term ends fall classes and starts spring ones with new ids", () => {
  const d = buildDistrict(TODAY, [{ type: "newTerm" }]);
  const algebra = d.sections.find((s) => s.id === 9002)!;
  assert.ok(algebra.roster.every((r) => r.status !== "active"));
  const geometry = d.sections.find((s) => s.course === "Geometry")!;
  assert.equal(geometry.termId, 3602);
  assert.ok(geometry.roster.length > 0);
});

test("attendance is stable and only has days with a mark", () => {
  const d = seedDistrict(TODAY);
  const s = d.students[0];
  assert.deepEqual(attendanceFor(d, s), attendanceFor(d, s));
  const all = d.students.flatMap((x) => attendanceFor(d, x));
  assert.ok(all.some((a) => COUNTED_ABSENCE_CODES.has(a.allDayCode)));
  assert.ok(all.some((a) => a.allDayCode === "" && a.periods.length === 1), "a period-only mark exists");
  assert.deepEqual(attendanceFor(d, d.students.find((x) => x.id === EDGE.withdrawn)!), []);
});

// ---------- sign-in tokens ----------

test("tokens prove themselves, and ending sign-ins or a different system invalidates them", () => {
  const t = issueToken("aeries", 1, 60, Date.now());
  assert.ok(tokenValid(t, "aeries", 1));
  assert.ok(!tokenValid(t, "aeries", 2), "epoch bumped");
  assert.ok(!tokenValid(t, "powerschool", 1), "other system");
  assert.ok(!tokenValid(`${t}x`, "aeries", 1), "tampered");
  assert.ok(!tokenValid(issueToken("aeries", 1, -1), "aeries", 1), "expired");
});

// ---------- Aeries ----------

test("Aeries: certificate, schools, students, contacts, attendance, and case-insensitive paths", async () => {
  const h = { "AERIES-CERT": AERIES_CERT };
  assert.equal((await call("aeries", "/api/v5/schools")).status, 401);
  assert.equal((await call("aeries", "/api/v5/systeminfo")).status, 200, "no certificate needed");
  const schools = await call("aeries", "/API/v5/Schools", { headers: h });
  assert.deepEqual(schools.body.map((s: any) => s.SchoolCode), [994, 995, 996]);
  const students = (await call("aeries", "/api/v5/schools/994/students", { headers: h })).body;
  assert.ok(students.some((s: any) => s.StudentID === EDGE.withdrawn && s.InactiveStatusCode === "I"));
  assert.ok(!students.some((s: any) => s.StudentID === EDGE.preregistered));
  const page = (await call("aeries", "/api/v5/schools/994/students?StartingRecord=1&EndingRecord=10", { headers: h })).body;
  assert.equal(page.length, 10);
  const contacts = (await call("aeries", `/api/v5/schools/994/contacts/${EDGE.twoParents}`, { headers: h })).body;
  assert.equal(contacts.length, 2);
  const att = (await call("aeries", "/api/v5/schools/994/attendance?StartDate=20261101&EndDate=20261110", { headers: h })).body;
  assert.ok(att.length > 0);
  for (const r of att) for (const day of r.AttendanceDays) assert.ok(day.CalendarDate >= "2026-11-01" && day.CalendarDate <= "2026-11-10T99");
});

test("Aeries: denied areas, missing school-wide attendance, and OneRoster with a required scope", async () => {
  const h = { "AERIES-CERT": AERIES_CERT };
  await setState((s) => { s.switches.aeries.deny = ["Contacts"]; s.switches.aeries.noSchoolWideAttendance = true; });
  assert.equal((await call("aeries", "/api/v5/schools/994/contacts", { headers: h })).status, 401);
  assert.equal((await call("aeries", "/api/v5/schools/994/attendance", { headers: h })).status, 404);
  assert.equal((await call("aeries", `/api/v5/schools/994/attendance/2000`, { headers: h })).status, 200);

  const auth = basic(AERIES_CLIENT_ID, AERIES_CLIENT_SECRET);
  const noScope = await call("aeries", "/token", { method: "POST", headers: { authorization: auth }, body: "grant_type=client_credentials" });
  assert.equal(noScope.status, 400);
  const tok = await call("aeries", "/token", { method: "POST", headers: { authorization: auth }, body: "grant_type=client_credentials&scope=https%3A%2F%2Fpurl.imsglobal.org%2Fspec%2For%2Fv1p1%2Fscope%2Froster-core.readonly" });
  assert.equal(tok.status, 200);
  const users = await call("aeries", "/ims/oneroster/v1p1/schools/994/students?limit=500", { headers: { authorization: `Bearer ${tok.body.access_token}` } });
  assert.ok(users.body.users.every((u: any) => u.sourcedId.startsWith("STU_")));
  assert.ok(!users.body.users.some((u: any) => u.sourcedId === `STU_${EDGE.withdrawn}`), "withdrawn students aren't in OneRoster");
});

// ---------- Clever ----------

test("Clever: token, paging by next links, only shared records, and edge cases", async () => {
  const h = { authorization: `Bearer ${CLEVER_TOKEN}` };
  assert.equal((await call("clever", "/v3.0/schools")).status, 401);
  assert.equal((await call("clever", "/v2.1/schools", { headers: h })).status, 404);
  const school = cid("school:high");
  let next: string | null = `/v3.0/schools/${school}/users?role=student&limit=50`;
  const ids: string[] = [];
  while (next) {
    const r = await call("clever", next, { headers: h });
    ids.push(...r.body.data.map((x: any) => x.data.id));
    const link = r.body.links.find((l: any) => l.rel === "next")?.uri;
    assert.ok(!link || link.startsWith("/v3.0/"), "links are relative to the Clever address");
    next = r.body.data.length ? link : null;
  }
  assert.ok(ids.length > 100);
  assert.ok(ids.includes(cid(`student:${EDGE.multiSchool}`)), "a middle schooler enrolled at the high school too");
  assert.ok(!ids.includes(cid(`student:${EDGE.withdrawn}`)), "withdrawn students aren't shared");
  assert.equal((await call("clever", `/v3.0/users/${cid(`teacher:${EDGE.unsharedTeacher}`)}`, { headers: h })).status, 404);
  const sparse = (await call("clever", `/v3.0/users/${cid(`student:${EDGE.sparse}`)}`, { headers: h })).body.data;
  assert.equal(sparse.roles.student.grade, undefined);
  assert.equal(sparse.email, undefined);
  const bad = (await call("clever", `/v3.0/users/${cid(`contact:${EDGE.guardianBadEmail}`)}`, { headers: h })).body.data;
  assert.equal(bad.email, "jo.nosched.family.example", "Clever doesn't validate emails");
  assert.equal(bad.name.last, "Jo Nosched", "whole name in name.last");
});

// ---------- PowerSchool ----------

test("PowerSchool: sign-in, quirks, paging, expansions, and the OneRoster plugin", async () => {
  const tok = await call("powerschool", "/oauth/access_token", { method: "POST", headers: { authorization: basic(PS_CLIENT_ID, PS_CLIENT_SECRET) }, body: "grant_type=client_credentials" });
  assert.equal(tok.status, 200);
  assert.equal(tok.body.expires_in, "3600", "a string, as PowerSchool sends it");
  const h = { authorization: `Bearer ${tok.body.access_token}` };
  const schools = (await call("powerschool", "/ws/v1/district/school", { headers: h })).body.schools.school;
  assert.equal(typeof schools[0].id, "number");
  assert.equal(typeof schools[1].id, "string");
  const p1 = (await call("powerschool", "/ws/v1/school/3/student?page=1&pagesize=500&expansions=contact", { headers: h })).body.students.student;
  assert.equal(p1.length, 100, "pages hold at most 100");
  assert.ok(p1[0].contact && !p1[0].school_enrollment, "only asked-for expansions");
  const two = (await call("powerschool", `/ws/v1/school/3/student?page=2&pagesize=100&expansions=contact`, { headers: h })).body.students.student;
  const okafor = [...p1, ...two].find((s: any) => s.id === String(EDGE.twoParents));
  assert.equal(okafor.contact.guardian_email, "Tobi.Okafor@Family.example, ada.okafor@family.example");
  const terms = (await call("powerschool", "/ws/v1/school/5/term", { headers: h })).body.terms.term;
  assert.ok(!Array.isArray(terms), "one record comes back as a bare object");
  assert.equal((await call("powerschool", "/ws/v1/school/9/student", { headers: h })).status, 404);
  const or = await call("powerschool", "/ims/oneroster/v1p1/schools/100", { headers: h });
  assert.equal(or.body.org.name, "Lincoln High School", "the school number works for OneRoster");
});

// ---------- problems ----------

test("forced failures count down; refused sign-in and ended sign-ins work", async () => {
  await setState((s) => { s.switches.clever.rateLimitNext = 1; s.switches.clever.failNext = 1; });
  const h = { authorization: `Bearer ${CLEVER_TOKEN}` };
  assert.equal((await call("clever", "/v3.0/schools", { headers: h })).status, 500);
  const limited = await call("clever", "/v3.0/schools", { headers: h });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers!["X-RateLimit-Remaining"], "0");
  assert.equal((await call("clever", "/v3.0/schools", { headers: h })).status, 200);

  const auth = { authorization: basic(PS_CLIENT_ID, PS_CLIENT_SECRET) };
  const tok = (await call("powerschool", "/oauth/access_token", { method: "POST", headers: auth, body: "grant_type=client_credentials" })).body.access_token;
  await setState((s) => { s.switches.powerschool.tokenEpoch++; s.switches.powerschool.rejectSignIn = true; });
  assert.equal((await call("powerschool", "/ws/v1/district/school", { headers: { authorization: `Bearer ${tok}` } })).status, 401, "old sign-in ended");
  assert.equal((await call("powerschool", "/oauth/access_token", { method: "POST", headers: auth, body: "grant_type=client_credentials" })).status, 401, "sign-in refused");
});

test("changes made from the panel reach every system", async () => {
  await setState((s) => { s.changes.push({ type: "withdraw", studentId: 2050 }); });
  const aeries = (await call("aeries", "/api/v5/schools/994/students/2050", { headers: { "AERIES-CERT": AERIES_CERT } })).body[0];
  assert.equal(aeries.InactiveStatusCode, "I");
  assert.equal((await call("clever", `/v3.0/users/${cid("student:2050")}`, { headers: { authorization: `Bearer ${CLEVER_TOKEN}` } })).status, 404);
  const tok = (await call("powerschool", "/oauth/access_token", { method: "POST", headers: { authorization: basic(PS_CLIENT_ID, PS_CLIENT_SECRET) }, body: "grant_type=client_credentials" })).body.access_token;
  const ps = (await call("powerschool", "/ws/v1/school/3/student?page=1&expansions=school_enrollment", { headers: { authorization: `Bearer ${tok}` } })).body.students.student;
  assert.equal(ps.find((s: any) => s.id === "2050").school_enrollment.enroll_status, "T");
});
