// IDs and versions are stable; RAW values prevent formula injection from customer input.
export const MASTER_HEADERS = [
  "Lead ID",
  "Versi",
  "Nama Lead",
  "Kontak",
  "Program",
  "PIC ID",
  "PIC",
  "Langkah 1C–3E–2C",
  "Tahap Penjualan",
  "Respons Customer",
  "Prioritas",
  "Dorman",
  "Kontak Terakhir",
  "Next Action",
  "Tanggal Follow-up",
  "Jadwal Trial",
  "Tanggal Registrasi",
  "Catatan",
  "Dibuat Oleh ID",
  "Dibuat Oleh",
  "Dibuat Pada",
  "Diubah Oleh ID",
  "Diubah Oleh",
  "Diubah Pada",
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
  new: "Lead baru",
  contacted: "Sudah dihubungi",
  trial: "Trial",
  trial_attended: "Trial Attended",
  registered: "Registered",
  lost: "Tidak lanjut",
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
      p.lead_id,
      p.actor_id,
      p.actor_name,
      p.created_at,
      p.action,
      p.note,
      JSON.stringify(p.changes),
    ];
  if (job.kind !== "master") throw new Error("Invalid entity kind");
  return [
    p.id,
    job.source_version,
    p.name,
    p.phone,
    programs[p.program] || p.program,
    p.pic_id,
    p.pic_name,
    flows[p.flow_step] || p.flow_step,
    stages[p.sales_stage] || p.sales_stage,
    responses[p.response] || p.response,
    { high: "Tinggi", medium: "Sedang", low: "Rendah" }[p.priority],
    p.dormant ? "Ya" : "Tidak",
    p.last_contact_at,
    p.next_action,
    p.follow_up_on,
    p.trial_at,
    p.registered_on,
    p.notes,
    p.created_by,
    p.created_by_name,
    p.created_at,
    p.updated_by,
    p.updated_by_name,
    p.updated_at,
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
