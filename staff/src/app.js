import { createClient } from "@supabase/supabase-js";
import {
  PROGRAMS,
  FLOWS,
  STAGES,
  RESPONSES,
  PRIORITIES,
  jakartaDay,
  summary,
  filterLeads,
  top15,
  localInput,
  dateTime,
} from "./model.js";
const $ = (selector) => document.querySelector(selector);
const el = (tag, text = "", cls = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const option = (value, label) => {
  const node = el("option", label);
  node.value = value;
  return node;
};
const fill = (select, values, blank) => {
  select.replaceChildren(
    ...(blank ? [option("", blank)] : []),
    ...Object.entries(values).map(([key, label]) => option(key, label)),
  );
};
const button = (text, action, cls = "") => {
  const node = el("button", text, cls);
  node.type = "button";
  node.addEventListener("click", () =>
    Promise.resolve(action()).catch((error) => notify(error.message, true)),
  );
  return node;
};
const notify = (message, error = false) => {
  $("#notice").textContent = message;
  $("#notice").classList.toggle("error", error);
  $("#notice").hidden = !message;
};
const config = window.ETU_STAFF_CONFIG || {};
let client,
  profile,
  session,
  leads = [],
  directory = [],
  picks = [],
  mode = "priority",
  loading = false,
  editing = null,
  pending = null,
  saving = false,
  authEpoch = 0;
const invitation = new URLSearchParams(location.hash.slice(1)).get("type");
let needsPassword = ["invite", "recovery"].includes(invitation);
const leadForm = $("#lead-form");
const formField = (name) => leadForm.elements.namedItem(name);
const filtersForm = $("#filters");
for (const [name, values] of Object.entries({
  program: PROGRAMS,
  flow_step: FLOWS,
  sales_stage: STAGES,
  response: RESPONSES,
  priority: PRIORITIES,
}))
  fill(formField(name), values);
fill(filtersForm.elements.stage, STAGES, "Semua tahap");
fill(filtersForm.elements.response, RESPONSES, "Semua respons");
fill(filtersForm.elements.priority, PRIORITIES, "Semua prioritas");
function clearPrivate() {
  authEpoch++;
  profile = null;
  leads = [];
  directory = [];
  picks = [];
  editing = null;
  pending = null;
  $("#dashboard").hidden = true;
  $("#password-panel").hidden = true;
  $("#login-panel").hidden = false;
  $("#admin-section").hidden = true;
  $("#lead-list").replaceChildren();
  $("#top3").replaceChildren();
  $("#metrics").replaceChildren();
  $("#staff-list").replaceChildren();
  $("#history").replaceChildren();
  leadForm.reset();
  if ($("#lead-dialog").open) $("#lead-dialog").close();
}
async function allRows(table, select = "*") {
  const items = [];
  let start = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .order("id")
      .range(start, start + 499);
    if (error) throw error;
    items.push(...data);
    if (data.length < 500) break;
    start += 500;
  }
  return items;
}
function nameOf(id) {
  return directory.find((x) => x.id === id)?.display_name || "PIC tidak aktif";
}
async function load() {
  if (loading || !session || needsPassword) return;
  loading = true;
  const epoch = authEpoch;
  $("#refresh").disabled = true;
  try {
    const { data: me, error } = await client
      .from("staff_profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!me?.active) {
      clearPrivate();
      notify(
        "Akun belum diundang atau akses sudah dinonaktifkan. Hubungi admin.",
        true,
      );
      await client.auth.signOut();
      return;
    }
    const [rows, people, pinned] = await Promise.all([
      allRows("sales_leads"),
      client.rpc("staff_directory"),
      client
        .from("daily_top_picks")
        .select("*")
        .eq("day", jakartaDay())
        .order("slot"),
    ]);
    if (people.error) throw people.error;
    if (pinned.error) throw pinned.error;
    if (epoch !== authEpoch) return;
    profile = me;
    leads = rows;
    directory = people.data;
    picks = pinned.data.map((x) => x.lead_id);
    $("#greeting").textContent =
      `Halo, ${profile.display_name}. ${profile.role === "admin" ? "Anda melihat seluruh lead tim." : "Anda melihat lead yang menjadi tanggung jawab Anda."}`;
    $("#today-label").textContent =
      new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "full",
      })
        .format(new Date())
        .toUpperCase() + " · WIB";
    const previous = filtersForm.elements.pic.value;
    fill(
      filtersForm.elements.pic,
      Object.fromEntries(directory.map((x) => [x.id, x.display_name])),
      "Semua PIC",
    );
    filtersForm.elements.pic.value = previous;
    $("#login-panel").hidden = true;
    $("#password-panel").hidden = true;
    $("#dashboard").hidden = false;
    $("#sync-status").textContent =
      `Database bersama · diperbarui ${dateTime(new Date().toISOString())}`;
    $("#admin-section").hidden = profile.role !== "admin";
    render();
    if (profile.role === "admin") await loadStaff();
  } catch (error) {
    if (epoch === authEpoch)
      notify(
        "Data belum dapat dimuat. Periksa koneksi atau sesi login. " +
          error.message,
        true,
      );
  } finally {
    loading = false;
    $("#refresh").disabled = false;
  }
}
function currentFilters() {
  const values = Object.fromEntries(new FormData(filtersForm));
  values.dormant = filtersForm.elements.dormant.checked;
  return values;
}
function render() {
  const filtered = filterLeads(leads, currentFilters());
  const counts = summary(filtered, jakartaDay());
  const labels = {
    total: "Total lead",
    overdue: "Follow-up overdue",
    noAction: "Tanpa next action",
    trials: "Trial terjadwal",
    registered: "Registrasi hari ini",
  };
  $("#metrics").replaceChildren(
    ...Object.entries(labels).map(([key, label]) => {
      const n = el("div", "", "metric" + (key === "overdue" ? " alert" : ""));
      n.append(el("span", label), el("strong", String(counts[key])));
      return n;
    }),
  );
  const selected = picks
    .map((id) => leads.find((x) => x.id === id))
    .filter(Boolean);
  $("#top3").replaceChildren(
    ...[0, 1, 2].map((index) => {
      const lead = selected[index];
      if (!lead)
        return el(
          "div",
          `0${index + 1} · Pilih bintang pada lead yang ingin difokuskan.`,
          "focus-card empty",
        );
      const card = el("article", "", "focus-card");
      card.append(
        el("span", `FOKUS 0${index + 1}`, "rank"),
        el("h3", lead.name),
        el("p", lead.next_action || "Next action belum dicatat", "fine"),
      );
      const actions = el("div", "", "mini-actions");
      actions.append(
        button("Lihat lead", () => openEditor(lead.id)),
        button("Lepas", () => pin(lead.id)),
      );
      card.append(actions);
      return card;
    }),
  );
  const visible =
    mode === "priority"
      ? top15(filtered)
      : [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  $("#lead-count").textContent =
    `${visible.length} dari ${filtered.length} lead`;
  $("#view-priority").classList.toggle("selected", mode === "priority");
  $("#view-all").classList.toggle("selected", mode === "all");
  $("#lead-list").replaceChildren(
    ...visible.map((lead) => {
      const row = el("article", "", "lead-row");
      row.dataset.leadId = lead.id;
      const info = el("div");
      info.append(
        el("div", lead.name, "lead-name"),
        el("span", "ID " + lead.id, "lead-id"),
        el("p", PROGRAMS[lead.program] + " · " + nameOf(lead.pic_id)),
      );
      const next = el("div");
      next.append(
        el("p", lead.next_action || "Belum ada next action", "next-action"),
        el(
          "p",
          lead.follow_up_on
            ? "Follow-up " + lead.follow_up_on
            : "Tanggal follow-up belum diisi",
          lead.follow_up_on && lead.follow_up_on < jakartaDay()
            ? "overdue"
            : "",
        ),
      );
      const state = el("div");
      state.append(
        el("span", PRIORITIES[lead.priority], "pill " + lead.priority),
        el("p", STAGES[lead.sales_stage] + " · " + FLOWS[lead.flow_step]),
        el("p", RESPONSES[lead.response]),
      );
      if (lead.dormant) state.append(el("span", "Dorman", "pill dormant"));
      const actions = el("div", "", "row-actions");
      const pinButton = button(
        picks.includes(lead.id) ? "★" : "☆",
        () => pin(lead.id),
        "pin",
      );
      pinButton.setAttribute(
        "aria-label",
        (picks.includes(lead.id) ? "Lepas dari" : "Pilih untuk") +
          " Top 3: " +
          lead.name,
      );
      actions.append(
        button("Buka / follow-up", () => openEditor(lead.id)),
        pinButton,
      );
      row.append(info, next, state, actions);
      return row;
    }),
  );
  if (!visible.length)
    $("#lead-list").append(
      el(
        "p",
        leads.length
          ? "Tidak ada lead pada filter ini. Coba reset filter atau pilih Semua lead."
          : "Belum ada lead. Mulai dengan menambahkan lead pertama.",
        "empty-state",
      ),
    );
}
async function pin(id) {
  const ids = picks.includes(id)
    ? picks.filter((x) => x !== id)
    : [...picks, id];
  if (ids.length > 3) {
    notify("Top 3 sudah penuh. Lepas satu pilihan terlebih dahulu.");
    return;
  }
  const { error } = await client.rpc("set_daily_top3", {
    p_day: jakartaDay(),
    p_leads: ids,
  });
  if (error) throw error;
  picks = ids;
  render();
}
async function openEditor(id = null) {
  if (saving) return;
  editing = id ? leads.find((x) => x.id === id) : null;
  pending = null;
  leadForm.reset();
  $("#editor-error").hidden = true;
  fill(
    formField("pic_id"),
    Object.fromEntries(directory.map((x) => [x.id, x.display_name])),
  );
  if (editing && !directory.some((x) => x.id === editing.pic_id))
    formField("pic_id").append(
      option(editing.pic_id, "PIC tidak aktif — admin perlu menetapkan ulang"),
    );
  formField("pic_id").value = editing?.pic_id || profile.id;
  formField("pic_id").disabled = profile.role !== "admin";
  formField("program").value = editing?.program || "undecided";
  formField("priority").value = editing?.priority || "medium";
  if (editing)
    for (const [key, value] of Object.entries(editing)) {
      const field = formField(key);
      if (!field) continue;
      if (field.type === "checkbox") field.checked = value;
      else if (field.type === "datetime-local") field.value = localInput(value);
      else field.value = value ?? "";
    }
  $("#editor-title").textContent = editing ? "Update & follow-up" : "Lead baru";
  $("#lead-id").textContent = editing
    ? `Lead ID ${editing.id} · Versi ${editing.version} · Diperbarui ${dateTime(editing.updated_at)} oleh ${nameOf(editing.updated_by)}`
    : "Lead ID dibuat otomatis saat penyimpanan pertama.";
  $("#history-section").hidden = !editing;
  $("#reload-lead").hidden = true;
  $("#history").replaceChildren();
  if (!$("#lead-dialog").open) $("#lead-dialog").showModal();
  if (editing) {
    const current = editing.id;
    const { data, error } = await client
      .from("lead_activities")
      .select("*")
      .eq("lead_id", current)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error)
      $("#history").append(
        el("p", "Riwayat belum dapat dimuat. " + error.message),
      );
    else if (editing?.id === current)
      $("#history").replaceChildren(
        ...data.map((log) => {
          const item = el("article", "", "history-item");
          item.append(
            el(
              "strong",
              `${log.actor_name} · ${log.action === "created" ? "Lead dibuat" : "Lead diperbarui"}`,
            ),
            el("time", dateTime(log.created_at)),
            el("p", log.note || "Perubahan data lead."),
          );
          return item;
        }),
      );
    if (data?.length === 100)
      $("#history").append(
        el(
          "p",
          "Menampilkan 100 aktivitas terbaru. Seluruh riwayat tetap tersimpan di database.",
          "fine",
        ),
      );
  }
}
leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !leadForm.reportValidity()) return;
  if (!formField("name").value.trim()) {
    formField("name").setCustomValidity("Nama tidak boleh kosong.");
    leadForm.reportValidity();
    return;
  }
  const data = Object.fromEntries(new FormData(leadForm));
  delete data.activity;
  data.pic_id = formField("pic_id").value;
  data.dormant = formField("dormant").checked;
  for (const name of ["last_contact_at", "trial_at"])
    data[name] = data[name] ? new Date(data[name]).toISOString() : null;
  const payload = {
    p_data: data,
    p_lead_id: editing?.id || null,
    p_expected_version: editing?.version || null,
    p_activity: formField("activity").value.trim(),
  };
  const fingerprint = JSON.stringify(payload);
  if (!pending || pending.fingerprint !== fingerprint)
    pending = { id: crypto.randomUUID(), fingerprint };
  saving = true;
  $("#save-lead").disabled = true;
  $("#close-editor").disabled = true;
  $("#editor-error").hidden = true;
  try {
    const { data: saved, error } = await client.rpc("save_sales_lead", {
      ...payload,
      p_request_id: pending.id,
    });
    if (error) throw error;
    $("#lead-dialog").close();
    pending = null;
    notify(
      `Tersimpan di database bersama. Lead ID: ${saved.id}. Google Sheet belum tersinkron.`,
    );
    await load();
  } catch (error) {
    $("#editor-error").textContent =
      error.code === "PT409"
        ? "Lead telah diubah dari sesi lain. Muat versi terbaru sebelum melanjutkan; isian Anda belum disimpan."
        : `Belum tersimpan. ${error.message}. Anda boleh mencoba Simpan lagi; kiriman yang sama tidak digandakan.`;
    $("#editor-error").hidden = false;
    $("#reload-lead").hidden = error.code !== "PT409";
  } finally {
    saving = false;
    $("#save-lead").disabled = false;
    $("#close-editor").disabled = false;
  }
});
formField("name").addEventListener("input", () =>
  formField("name").setCustomValidity(""),
);
$("#close-editor").addEventListener("click", () => {
  if (!saving) $("#lead-dialog").close();
});
$("#lead-dialog").addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
$("#reload-lead").addEventListener("click", async () => {
  const id = editing?.id;
  await load();
  await openEditor(id);
});
$("#add-lead").addEventListener("click", () =>
  openEditor().catch((error) => notify(error.message, true)),
);
filtersForm.addEventListener("submit", (event) => {
  event.preventDefault();
  render();
});
filtersForm.addEventListener("input", render);
filtersForm.addEventListener("change", render);
$("#clear-filters").addEventListener("click", () => {
  filtersForm.reset();
  render();
});
$("#view-priority").addEventListener("click", () => {
  mode = "priority";
  render();
});
$("#view-all").addEventListener("click", () => {
  mode = "all";
  render();
});
$("#refresh").addEventListener("click", load);
async function adminCall(body) {
  const { data, error } = await client.functions.invoke("staff-admin", {
    body,
  });
  if (error) {
    let message = error.message;
    try {
      message = (await error.context.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
async function loadStaff() {
  const { data, error } = await client
    .from("staff_profiles")
    .select("*")
    .order("created_at");
  if (error) throw error;
  $("#staff-list").replaceChildren(
    ...data.map((person) => {
      const row = el("div", "", "staff-row");
      const identity = el("div", "", "staff-name");
      identity.append(
        el("strong", person.display_name),
        el("span", person.email, "fine"),
      );
      const role = el("select");
      role.setAttribute("aria-label", "Role " + person.display_name);
      fill(role, { staff: "Staf", admin: "Admin" });
      role.value = person.role;
      row.append(
        identity,
        el("span", person.active ? "Aktif" : "Nonaktif", "pill"),
        role,
        button("Simpan role", async () => {
          await adminCall({
            action: "access",
            id: person.id,
            role: role.value,
            active: person.active,
          });
          notify("Role berhasil diperbarui.");
          await load();
        }),
        button(person.active ? "Nonaktifkan" : "Aktifkan", async () => {
          if (
            !confirm(
              `${person.active ? "Nonaktifkan" : "Aktifkan"} akses ${person.display_name}?`,
            )
          )
            return;
          await adminCall({
            action: "access",
            id: person.id,
            role: person.role,
            active: !person.active,
          });
          notify("Akses staf diperbarui.");
          await load();
        }),
      );
      return row;
    }),
  );
}
$("#invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button");
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const result = await adminCall({
      action: "invite",
      ...Object.fromEntries(new FormData(form)),
    });
    notify(result.message);
    form.reset();
    await loadStaff();
  } catch (error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});
async function authenticate(nextSession, event = "") {
  if (event === "INITIAL_SESSION" && session && !nextSession) return;
  if (!nextSession) {
    session = null;
    clearPrivate();
    return;
  }
  const wasSame = session?.user.id === nextSession.user.id;
  session = nextSession;
  if (event === "PASSWORD_RECOVERY") needsPassword = true;
  if (needsPassword) {
    $("#login-panel").hidden = true;
    $("#dashboard").hidden = true;
    $("#password-panel").hidden = false;
    return;
  }
  if (!wasSame || !profile || event === "SIGNED_IN") await load();
}
if (!config.supabaseUrl || !config.supabaseAnonKey) {
  $("#login-button").disabled = true;
  $("#reset-password").disabled = true;
  $("#config-status").textContent =
    "Backend belum dikonfigurasi. Admin perlu mengisi konfigurasi Supabase sebelum ruang tim dapat digunakan. Tidak ada data demo yang disimpan.";
} else {
  try {
    const target = new URL(config.supabaseUrl);
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1")
      throw new Error("Backend wajib menggunakan HTTPS.");
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        storage: sessionStorage,
        detectSessionInUrl: true,
        autoRefreshToken: true,
        flowType: "implicit",
      },
    });
    client.auth.onAuthStateChange((event, next) => {
      setTimeout(
        () =>
          authenticate(next, event).catch((error) =>
            notify(error.message, true),
          ),
        0,
      );
    });
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        if (data.session || !session) return authenticate(data.session);
      })
      .catch((error) => notify(error.message, true));
    $("#config-status").textContent =
      "Akun undangan · Data dilindungi izin akses database.";
  } catch (error) {
    $("#login-button").disabled = true;
    notify(error.message, true);
  }
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client) return;
  const form = event.currentTarget;
  const submit = $("#login-button");
  if (submit.disabled) return;
  submit.disabled = true;
  notify("");
  try {
    const { data, error } = await client.auth.signInWithPassword(
      Object.fromEntries(new FormData(form)),
    );
    if (error) throw error;
    form.elements.password.value = "";
    await authenticate(data.session, "SIGNED_IN");
  } catch {
    notify(
      "Login gagal. Periksa email, password, dan status undangan Anda.",
      true,
    );
  } finally {
    submit.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  clearPrivate();
  session = null;
  const { error } = await client.auth.signOut();
  notify(
    error
      ? "Data layar sudah dibersihkan. Logout server gagal; tutup tab ini dan coba lagi."
      : "Anda sudah keluar.",
    Boolean(error),
  );
});
$("#reset-password").addEventListener("click", async () => {
  const email = $("#login-form").elements.email;
  if (!email.reportValidity()) return;
  const button = $("#reset-password");
  button.disabled = true;
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.value, {
      redirectTo: new URL("./", location.href).href,
    });
    if (error) throw error;
    notify(
      "Jika email terdaftar, instruksi pemulihan akan dikirim. Periksa email atau hubungi admin.",
    );
  } catch {
    notify(
      "Pemulihan belum dapat diproses. Hubungi admin atau coba lagi nanti.",
      true,
    );
  } finally {
    button.disabled = false;
  }
});
$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.elements.password.value;
  if (password !== form.elements.confirm.value) {
    notify("Ulangi password yang sama.", true);
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    needsPassword = false;
    form.reset();
    notify("Password berhasil dibuat.");
    await load();
  } catch (error) {
    notify("Password belum tersimpan. " + error.message, true);
  } finally {
    button.disabled = false;
  }
});
setInterval(() => {
  if (!document.hidden && !$("#lead-dialog").open) load();
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("#lead-dialog").open) load();
});
