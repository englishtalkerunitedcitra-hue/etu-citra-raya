// IDs and versions are stable; RAW values prevent formula injection from customer input.
// First 25 columns follow ETU Master Prospek (gid 2127889910).
export const MASTER_HEADERS = [
  "Lead ID",
  "Tanggal Masuk",
  "Nama Parent",
  "Nama Siswa",
  "Asal Sekolah",
  "Usia",
  "WhatsApp",
  "Domisili",
  "Program",
  "Sumber Lead",
  "Detail Sumber / Sekolah",
  "PIC",
  "Current Stage",
  "Temperature",
  "Last Contact",
  "Next Action",
  "Next Follow-up",
  "Follow-up Count",
  "Trial Date",
  "Trial Attendance",
  "Recommended Level",
  "Recommended Schedule",
  "Decision Barrier",
  "Registration Date",
  "Payment Status",
  "Versi",
  "Nama Lead",
  "Respons Customer",
  "Prioritas",
  "Dorman",
  "Langkah 1C–3E–2C",
  "Catatan",
  "Lead ID Lama",
  "PIC ID",
  "Dibuat Oleh ID",
  "Dibuat Oleh",
  "Dibuat Pada",
  "Diubah Oleh ID",
  "Diubah Oleh",
  "Diubah Pada",
  "Cabang",
];
export const ACTIVITY_HEADERS = [
  "Activity ID",
  "Lead ID",
  "Aktor ID",
  "Aktor",
  "Waktu",
  "Aksi",
  "Catatan Follow-up",
  "Perubahan JSON",
];
const flows = {
  connect: "Connect",
  explore: "Explore",
  educate: "Educate",
  experience: "Experience",
  closing: "Closing",
  care: "Care",
};
const stages = {
  new: "New Lead",
  contacted: "Contacted",
  responded: "Responded",
  trial_offered: "Trial Offered",
  placement_test_booked: "Placement Test Booked",
  follow_up_after_trial: "Follow-up After Trial",
  future_lead: "Future Lead",

  trial: "Trial Booked",
  trial_attended: "Trial Attended",
  registered: "Registered",
  lost: "Lost Lead",
};
const responses = {
  unknown: "Belum dicatat",
  no_response: "Belum respons",
  considering: "Masih mempertimbangkan",
  interested: "Tertarik",
  not_interested: "Belum berminat",
  follow_up_needed: "Minta follow-up",
};
const programs = {
  "small-talker": "Small Talker",
  "kid-talker": "Kid Talker",
  "junior-talker": "Junior Talker",
  "senior-talker": "Senior Talker",
  "adult-talker": "Adult Talker",
  undecided: "Belum ditentukan",
};
const branches = {
  taman_royal: "ETU Taman Royal",
  citra_raya: "ETU Citra Raya",
  palem_semi: "ETU Palem Semi",
};
export function headers(kind) {
  if (kind === "master") return MASTER_HEADERS;
  if (kind === "activity") return ACTIVITY_HEADERS;
  throw new Error("Invalid entity kind");
}
export function cells(job) {
  const p = job.payload;
  if (job.kind === "activity")
    return [
      p.id,
      p.lead_code || p.lead_id,
      p.actor_id,
      p.actor_name,
      p.created_at,
      p.action,
      p.note,
      JSON.stringify(p.changes),
    ];
  if (job.kind !== "master") throw new Error("Invalid entity kind");
  const d = p.master_details || {};
  return [
    p.lead_code || p.id, d.entered_on || (p.created_at ? new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(p.created_at)) : ""),
    d.parent_name, d.student_name, d.school, d.age, p.phone, d.domicile,
    programs[p.program] || p.program, d.lead_source, d.source_detail,
    p.pic_name, stages[p.sales_stage] || p.sales_stage, d.temperature,
    p.last_contact_at, p.next_action, p.follow_up_on, d.follow_up_count,
    p.trial_at, d.trial_attendance, d.recommended_level, d.recommended_schedule,
    d.decision_barrier, p.registered_on, d.payment_status,
    job.source_version, p.name, responses[p.response] || p.response,
    { high: "Tinggi", medium: "Sedang", low: "Rendah" }[p.priority],
    p.dormant ? "Ya" : "Tidak", flows[p.flow_step] || p.flow_step, p.notes,
    d.legacy_lead_id, p.pic_id, p.created_by, p.created_by_name, p.created_at,
    p.updated_by, p.updated_by_name, p.updated_at,
    branches[p.branch_code] || "ETU Citra Raya",
  ].map((x) => x ?? "");
}
export function column(count) {
  let s = "";
  while (count > 0) {
    count--;
    s = String.fromCharCode(65 + (count % 26)) + s;
    count = Math.floor(count / 26);
  }
  return s;
}
export function range(title, row, kind) {
  if (!Number.isSafeInteger(Number(row)) || Number(row) < 1)
    throw new Error("Invalid row");
  return `'${title.replaceAll("'", "''")}'!A${row}:${column(headers(kind).length)}${row}`;
}
