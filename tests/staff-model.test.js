import { test } from "node:test";
import assert from "node:assert/strict";
import { jakartaDay, summary, filterLeads, top15 } from "../staff/src/model.js";
const lead = (id, overrides = {}) => ({
  id,
  name: `Lead ${id}`,
  phone: "0800000000",
  pic_id: "a",
  sales_stage: "new",
  response: "no_response",
  priority: "medium",
  follow_up_on: "2026-11-08",
  next_action: "Telepon",
  created_at: "2026-11-01T00:00:00Z",
  ...overrides,
});
test("WIB day remains correct across UTC midnight", () =>
  assert.equal(jakartaDay(new Date("2026-11-07T18:00:00Z")), "2026-11-08"));
test("Top15 is priority, due-date, deterministic ID; closed leads excluded", () => {
  const leads = Array.from({ length: 20 }, (_, i) =>
    lead(String(i).padStart(2, "0")),
  );
  leads.push(
    lead("high", { priority: "high", follow_up_on: "2026-11-10" }),
    lead("old", { priority: "medium", follow_up_on: "2026-10-01" }),
    lead("closed", { priority: "high", sales_stage: "registered" }),
  );
  const ids = top15(leads).map((x) => x.id);
  assert.equal(ids.length, 15);
  assert.deepEqual(ids.slice(0, 3), ["high", "old", "00"]);
  assert(!ids.includes("closed"));
});
test("Top15 puts missing follow-up after dated leads within the same priority", () =>
  assert.deepEqual(
    top15([lead("a", { follow_up_on: null }), lead("b")]).map((x) => x.id),
    ["b", "a"],
  ));
test("Response, sales stage and dormant remain independent filters", () => {
  const leads = [
    lead("a", { sales_stage: "trial", dormant: true }),
    lead("b", { sales_stage: "trial", response: "interested" }),
    lead("c", { sales_stage: "registered", dormant: true }),
  ];
  assert.deepEqual(
    filterLeads(leads, {
      stage: "trial",
      response: "no_response",
      dormant: true,
    }).map((x) => x.id),
    ["a"],
  );
  assert.equal(filterLeads(leads, { pic: "b" }).length, 0);
});
test("Daily summary uses WIB trial dates, distinct registration date, and open-lead overdue counts", () => {
  const leads = [
    lead("a", { follow_up_on: "2026-11-07", next_action: "" }),
    lead("b", {
      sales_stage: "registered",
      registered_on: "2026-11-08",
      next_action: "",
      follow_up_on: "2026-11-01",
    }),
    lead("c", { sales_stage: "trial", trial_at: "2026-11-07T18:00:00Z" }),
  ];
  assert.deepEqual(summary(leads, "2026-11-08"), {
    total: 3,
    overdue: 1,
    noAction: 1,
    trials: 1,
    registered: 1,
  });
});
test("Master Prospek search includes parent, student, school and legacy ID", () => {
  const record = lead("one", {master_details: {parent_name: "Parent Dummy", student_name: "Student Dummy", school: "School Dummy", legacy_lead_id: "OLD-001"}});
  for (const search of ["parent dummy", "student dummy", "school dummy", "old-001"])
    assert.equal(filterLeads([record], {search}).length, 1);
});
test("Placement test bookings are included in upcoming trial summary", () => {
  const record = lead("placement", {sales_stage: "placement_test_booked", trial_at: "2026-11-12T03:00:00Z"});
  assert.equal(summary([record], "2026-11-12").trials, 1);
});
