"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { Change } from "@/district/changes";
import type { SchoolKey } from "@/district/model";
import { getStore, defaultState, type State } from "@/state/store";
import type { Vendor } from "@/vendors/http";
import { checkPassword, COOKIE, requirePanel } from "./auth";

/*
 * Every button on the control panel. Each change goes on the end of the
 * change list (so it can be undone); switches are set directly.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(f.get(k));
const grade = (f: FormData, k: string) => (str(f, k) === "" ? null : Number(str(f, k)));

async function update(fn: (s: State) => void) {
  await requirePanel();
  const store = getStore();
  const s = await store.read();
  fn(s);
  await store.write(s);
  refresh();
}

const push = (c: Change) => update((s) => void s.changes.push({ ...c, at: new Date().toISOString() }));

export async function signIn(formData: FormData) {
  const proof = checkPassword(str(formData, "password"));
  if (!proof) redirect("/?error=1");
  (await cookies()).set(COOKIE, proof, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
  redirect("/");
}

// ---------- students ----------

export async function withdraw(formData: FormData) {
  await push({ type: "withdraw", studentId: num(formData, "studentId") });
}
export async function restore(formData: FormData) {
  await push({ type: "restore", studentId: num(formData, "studentId") });
}
export async function addStudent(formData: FormData) {
  const first = str(formData, "first"), last = str(formData, "last");
  if (!first || !last) return;
  await push({
    type: "addStudent", school: str(formData, "school") as SchoolKey, first, last, grade: grade(formData, "grade"),
    guardian: str(formData, "gFirst") || str(formData, "gLast")
      ? { first: str(formData, "gFirst"), last: str(formData, "gLast") || last, email: str(formData, "gEmail"), phone: str(formData, "gPhone") }
      : null,
  });
}
export async function editStudent(formData: FormData) {
  const studentId = num(formData, "studentId");
  await push({ type: "editStudent", studentId, first: str(formData, "first"), last: str(formData, "last"), grade: grade(formData, "grade"), stateId: str(formData, "stateId") });
  const guardianId = num(formData, "guardianId");
  if (guardianId) await push({ type: "editGuardian", guardianId, first: str(formData, "gFirst"), last: str(formData, "gLast"), email: str(formData, "gEmail"), phone: str(formData, "gPhone") });
}
export async function dropClass(formData: FormData) {
  await push({ type: "dropClass", studentId: num(formData, "studentId"), sectionId: num(formData, "sectionId") });
}
export async function addToClass(formData: FormData) {
  if (!num(formData, "sectionId")) return;
  await push({ type: "addToClass", studentId: num(formData, "studentId"), sectionId: num(formData, "sectionId") });
}

// ---------- classes and teachers ----------

export async function setTeacher(formData: FormData) {
  await push({ type: "setTeacher", sectionId: num(formData, "sectionId"), teacherId: num(formData, "teacherId") });
}
export async function editTeacher(formData: FormData) {
  await push({ type: "editTeacher", teacherId: num(formData, "teacherId"), first: str(formData, "first"), last: str(formData, "last"), email: str(formData, "email") });
}

// ---------- scenarios and history ----------

export async function runScenario(formData: FormData) {
  const name = str(formData, "scenario");
  if (name === "nextSync" || name === "newTerm") await push({ type: name });
}
export async function undoLast() {
  await update((s) => void s.changes.pop());
}
export async function resetDistrict() {
  await update((s) => void (s.changes = []));
}
export async function setToday(formData: FormData) {
  const v = str(formData, "today");
  await update((s) => void (s.today = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
}
export async function resetEverything() {
  await requirePanel();
  const store = getStore();
  await store.write(defaultState());
  await store.clearLogs();
  refresh();
}

// ---------- problems ----------

export async function setSwitch(formData: FormData) {
  const vendor = str(formData, "vendor") as Vendor;
  const what = str(formData, "what");
  await update((s) => {
    const sw = s.switches[vendor];
    if (!sw) return;
    if (what === "rejectSignIn") sw.rejectSignIn = !sw.rejectSignIn;
    if (what === "expireTokens") sw.tokenEpoch++;
    if (what === "failNext") sw.failNext = Math.max(0, Math.min(50, num(formData, "n") || 0));
    if (what === "rateLimitNext") sw.rateLimitNext = Math.max(0, Math.min(50, num(formData, "n") || 0));
    if (vendor === "aeries" && what === "deny") s.switches.aeries.deny = formData.getAll("area").map(String);
    if (vendor === "aeries" && what === "noSchoolWide") s.switches.aeries.noSchoolWideAttendance = !s.switches.aeries.noSchoolWideAttendance;
  });
}

export async function clearLog() {
  await requirePanel();
  await getStore().clearLogs();
  refresh();
}
