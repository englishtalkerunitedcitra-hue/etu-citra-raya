export const PROGRAMS = {
  "small-talker": "Small Talker",
  "kid-talker": "Kid Talker",
  "junior-talker": "Junior Talker",
  "senior-talker": "Senior Talker",
  "adult-talker": "Adult Talker",
  undecided: "Belum ditentukan",
};
export const FLOWS = {
  connect: "Connect",
  explore: "Explore",
  educate: "Educate",
  experience: "Experience",
  closing: "Closing",
  care: "Care",
};
export const STAGES = {
  new: "Lead baru",
  contacted: "Sudah dihubungi",
  responded: "Responded",
  trial_offered: "Trial Offered",
  placement_test_booked: "Placement Test Booked",
  follow_up_after_trial: "Follow-up After Trial",
  future_lead: "Future Lead",

  trial: "Trial",
  trial_attended: "Trial Attended",
  registered: "Registered",
  lost: "Tidak lanjut",
};
export const RESPONSES = {
  unknown: "Belum dicatat",
  no_response: "Belum respons",
  considering: "Masih mempertimbangkan",
  interested: "Tertarik",
  not_interested: "Belum berminat",
  follow_up_needed: "Minta follow-up",
};
export const PRIORITIES = { high: "Tinggi", medium: "Sedang", low: "Rendah" };
export function jakartaDay(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function summary(leads, day) {
  return {
    total: leads.length,
    overdue: leads.filter(
      (x) =>
        x.follow_up_on &&
        x.follow_up_on < day &&
        !["registered", "lost"].includes(x.sales_stage),
    ).length,
    noAction: leads.filter(
      (x) =>
        !x.next_action.trim() &&
        !["registered", "lost"].includes(x.sales_stage),
    ).length,
    trials: leads.filter(
      (x) =>
        ["trial", "placement_test_booked"].includes(x.sales_stage) &&
        x.trial_at &&
        jakartaDay(new Date(x.trial_at)) >= day,
    ).length,
    registered: leads.filter(
      (x) => x.registered_on === day && x.sales_stage === "registered",
    ).length,
  };
}
export function filterLeads(leads, filters) {
  return leads.filter(
    (x) =>
      (!filters.pic || x.pic_id === filters.pic) &&
      (!filters.stage || x.sales_stage === filters.stage) &&
      (!filters.priority || x.priority === filters.priority) &&
      (!filters.response || x.response === filters.response) &&
      (!filters.date || x.follow_up_on === filters.date) &&
      (!filters.dormant || x.dormant) &&
      (!filters.search ||
        `${x.name} ${x.phone} ${x.id} ${x.lead_code || ""} ${Object.values(x.master_details || {}).join(" ")}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())),
  );
}
export function top15(leads) {
  const rank = { high: 0, medium: 1, low: 2 };
  return leads
    .filter((x) => !["registered", "lost"].includes(x.sales_stage))
    .sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] ||
        (a.follow_up_on || "9999-12-31").localeCompare(
          b.follow_up_on || "9999-12-31",
        ) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 15);
}
export function localInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function dateTime(value) {
  return value
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(new Date(value)) + " WIB"
    : "—";
}
