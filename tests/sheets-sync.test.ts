import {
  deliver,
  type Batch,
  type Result,
} from "../supabase/functions/sheets-sync/core.ts";
import { authorizeScheduler } from "../supabase/functions/sheets-sync/scheduler.ts";
import {
  GoogleSheets,
  googleToken,
  SyncError,
  type Job,
} from "../supabase/functions/sheets-sync/google.ts";
import {
  headers,
  range,
  cells,
} from "../supabase/functions/sheets-sync/mapping.js";
const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};
Deno.test("scheduler requires its secret and service-only database access", async () => {
  const token = "x".repeat(48);
  let calls = 0;
  const allowed = (async () => {
    calls++;
    return Response.json([{ singleton: true }]);
  }) as typeof fetch;
  assert(!await authorizeScheduler("https://example.test", "Bearer staff", "wrong", token, allowed));
  assert(calls === 0);
  assert(await authorizeScheduler("https://example.test", "Bearer valid-service-jwt", token, token, allowed));
  for (const response of [
    new Response("denied", { status: 403 }), Response.json([]),
    Response.json({ singleton: true }), Response.json([{ singleton: false }]),
  ]) {
    assert(!await authorizeScheduler("https://example.test", "Bearer staff", token, token,
      (async () => response) as typeof fetch));
  }
  assert(!await authorizeScheduler("https://example.test", "Bearer service", token, token,
    (async () => { throw new Error("offline"); }) as typeof fetch));
});
const config = {
  spreadsheet_id: "local-fixture-only",
  master_title: "ETU App - Master Prospek",
  activity_title: "ETU App - Log Aktivitas",
};
const job: Job = {
  kind: "master",
  entity_id: "lead-1",
  source_version: 2,
  row_number: 2,
  payload: {
    id: "lead-1",
    name: '=IMPORTXML("bad")',
    program: "kid-talker",
    priority: "high",
    notes: "Uji saja",
    updated_at: "2026-11-08T00:00:00Z",
  },
};
function provider(
  options: {
    unowned?: boolean;
    wrongHeaders?: boolean;
    badAck?: boolean;
    denied?: boolean;
    ambiguous?: boolean;
  } = {},
) {
  const rows = new Map<string, any[]>();
  let writes = 0;
  let ambiguous = !!options.ambiguous;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert(url.hostname === "sheets.googleapis.com");
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (options.denied) return response({ error: "No permission" }, 403);
    if (url.pathname.endsWith("/values:batchUpdate")) {
      const body = JSON.parse(String(init?.body));
      assert(
        body.valueInputOption === "RAW",
        "Formula-safe RAW writes required",
      );
      writes++;
      for (const row of body.data) rows.set(row.range, row.values[0]);
      if (ambiguous) {
        ambiguous = false;
        throw new Error("Connection lost after provider accepted write");
      }
      return response({
        spreadsheetId: config.spreadsheet_id,
        totalUpdatedRows: body.data.length,
        responses: body.data.map((r: any) => ({
          updatedRange: r.range,
          updatedRows: 1,
          updatedColumns: r.values[0].length,
          updatedCells: options.badAck ? 0 : r.values[0].length,
        })),
      });
    }
    if (url.pathname.endsWith("/values:batchGet"))
      return response({
        valueRanges: url.searchParams.getAll("ranges").map((r) => ({
          range: r,
          values: rows.has(r)
            ? [rows.get(r)]
            : options.wrongHeaders
              ? [["Manual workbook"]]
              : [],
        })),
      });
    return response({
      spreadsheetId: config.spreadsheet_id,
      sheets: ["master", "activity"].map((kind, i) => ({
        properties: {
          sheetId: i + 1,
          title:
            kind === "master" ? config.master_title : config.activity_title,
          gridProperties: { rowCount: 1000, columnCount: 26 },
        },
        developerMetadata: options.unowned
          ? []
          : [
              {
                metadataKey: "etu_staff_sync_v1",
                metadataValue: kind,
                location: { sheetId: i + 1 },
              },
            ],
      })),
    });
  }) as typeof fetch;
  return {
    google: new GoogleSheets("fake-token", fetcher),
    rows,
    writes: () => writes,
  };
}
function store(jobs: Job[] = [job]) {
  const finished: Result[][] = [];
  return {
    finished,
    claim: (_token: string) =>
      Promise.resolve({ jobs, config, previously_synced: false } as Batch),
    finish: (_token: string, results: Result[]) => {
      finished.push(results);
      return Promise.resolve();
    },
  };
}
Deno.test(
  "RAW column mapping preserves Lead ID, version, separate response and stage",
  () => {
    const row = cells({
      ...job,
      payload: {
        ...job.payload,
        sales_stage: "trial",
        response: "considering",
      },
    });
    assert(
      row[0] === "lead-1" &&
        row[25] === 2 &&
        row[12] === "Trial Booked" &&
        row[27] === "Masih mempertimbangkan",
    );
    assert(range("Tim 'ETU'", 2, "master").startsWith("'Tim ''ETU'''!A2:"));
    assert(row.length === headers("master").length);
  },
);
Deno.test(
  "confirmed only after correct Google acknowledgement; retries use fixed ranges",
  async () => {
    const p = provider();
    const db = store();
    await deliver(db, p.google);
    await deliver(db, p.google);
    assert(p.writes() === 2);
    assert(p.rows.size === 3);
    assert(db.finished.every((x) => x[0].ok));
    assert(
      p.rows.get(range(config.master_title, 2, "master"))?.[26] ===
        job.payload.name,
    );
  },
);
Deno.test(
  "ambiguous success is pending; retry never appends a duplicate row",
  async () => {
    const p = provider({ ambiguous: true });
    const db = store();
    const first = await deliver(db, p.google);
    assert(first.pending === 1);
    assert(!db.finished[0][0].ok);
    await deliver(db, p.google);
    assert(db.finished[1][0].ok);
    assert(p.rows.size === 3);
  },
);
for (const [name, opts, code] of [
  ["unowned tab", { unowned: true }, "destination_conflict"],
  ["manual header", { wrongHeaders: true }, "header_conflict"],
  ["Google denies access", { denied: true }, "permission_denied"],
  ["incorrect acknowledgement", { badAck: true }, "ack_mismatch"],
] as const) {
  Deno.test(name + " cannot be marked synced", async () => {
    const p = provider(opts);
    const db = store();
    await deliver(db, p.google);
    assert(!db.finished[0][0].ok);
    assert(db.finished[0][0].error === code);
    if (code !== "ack_mismatch") assert(p.writes() === 0);
  });
}
Deno.test(
  "DB acknowledgement failure is propagated; retry writes the same exact row",
  async () => {
    const p = provider();
    const db = store();
    const broken = {
      ...db,
      finish: () => Promise.reject(new Error("DB offline")),
    };
    let failed = false;
    try {
      await deliver(broken, p.google);
    } catch {
      failed = true;
    }
    assert(failed);
    await deliver(db, p.google);
    assert(p.rows.size === 3 && db.finished[0][0].ok);
  },
);
Deno.test("busy/disabled workers make no Google writes", async () => {
  const p = provider();
  for (const flag of ["disabled", "busy"]) {
    const db = {
      ...store(),
      claim: () =>
        Promise.resolve({
          [flag]: true,
          jobs: [],
          config,
          previously_synced: false,
        }),
    };
    await deliver(db, p.google);
  }
  assert(p.writes() === 0);
});
Deno.test(
  "service account JWT uses Google token endpoint and Sheets-only scope",
  async () => {
    const key = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const der = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", key.privateKey),
    );
    const pem =
      "-----BEGIN PRIVATE KEY-----\n" +
      btoa(String.fromCharCode(...der)) +
      "\n-----END PRIVATE KEY-----";
    const token = await googleToken(
      JSON.stringify({
        type: "service_account",
        client_email: "test@example.iam.gserviceaccount.com",
        private_key: pem,
        token_uri: "https://not-google.invalid",
      }),
      (async (input, init) => {
        assert(String(input) === "https://oauth2.googleapis.com/token");
        const jwt = new URLSearchParams(String(init?.body)).get("assertion")!;
        const payload = JSON.parse(
          atob(jwt.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
        );
        assert(
          payload.scope === "https://www.googleapis.com/auth/spreadsheets",
        );
        assert(payload.aud === "https://oauth2.googleapis.com/token");
        return new Response(
          JSON.stringify({ access_token: "test-access-token" }),
        );
      }) as typeof fetch,
    );
    assert(token === "test-access-token");
  },
);

Deno.test(
  "Google quota Retry-After is preserved for the retry queue",
  async () => {
    const google = new GoogleSheets(
      "fake-token",
      (async () =>
        new Response("{}", {
          status: 429,
          headers: { "Retry-After": "3600" },
        })) as typeof fetch,
    );
    const db = store();
    await deliver(db, google);
    assert(db.finished[0][0].retry_after === 3600 && !db.finished[0][0].ok);
  },
);
Deno.test(
  "a previously confirmed destination cannot be silently recreated",
  async () => {
    const google = new GoogleSheets(
      "fake-token",
      (async () =>
        new Response(
          JSON.stringify({ spreadsheetId: config.spreadsheet_id, sheets: [] }),
        )) as typeof fetch,
    );
    const db = {
      ...store(),
      claim: () =>
        Promise.resolve({ jobs: [job], config, previously_synced: true }),
    };
    await deliver(db, google);
    assert(db.finished[0][0].error === "destination_missing");
  },
);
Deno.test(
  "initial setup only adds app-owned tabs and metadata; never clears or renames existing tabs",
  async () => {
    let structural = false;
    let written = false;
    const google = new GoogleSheets("fake-token", (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/values:batchUpdate")) {
        written = true;
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            spreadsheetId: config.spreadsheet_id,
            totalUpdatedRows: body.data.length,
            responses: body.data.map((x: any) => ({
              updatedRange: x.range,
              updatedRows: 1,
              updatedColumns: x.values[0].length,
              updatedCells: x.values[0].length,
            })),
          }),
        );
      }
      if (path.endsWith(":batchUpdate")) {
        structural = true;
        const body = JSON.parse(String(init?.body));
        assert(body.requests.length === 4);
        assert(
          body.requests.every((x: any) =>
            Object.keys(x).every((key) =>
              ["addSheet", "createDeveloperMetadata"].includes(key),
            ),
          ),
        );
        return new Response("{}");
      }
      if (path.endsWith("/values:batchGet"))
        return new Response(
          JSON.stringify({ valueRanges: [{ values: [] }, { values: [] }] }),
        );
      return new Response(
        JSON.stringify({
          spreadsheetId: config.spreadsheet_id,
          sheets: [
            { properties: { sheetId: 10, title: "Manual existing tab" } },
          ],
        }),
      );
    }) as typeof fetch);
    const db = store();
    await deliver(db, google);
    assert(structural && written && db.finished[0][0].ok);
  },
);
Deno.test("Master Prospek exports all 25 template columns and preserves legacy values", () => {
  const detail = {
    entered_on: "2026-11-12", parent_name: "Parent Dummy", student_name: "Student Dummy",
    school: "School Dummy", age: "10", domicile: "Citra Raya", lead_source: "School Event",
    source_detail: "Event Dummy", temperature: "Warm", follow_up_count: "3",
    trial_attendance: "Reschedule", recommended_level: "Level Dummy",
    recommended_schedule: "Saturday", decision_barrier: "Schedule", payment_status: "Payment 1",
    legacy_lead_id: "OLD-001",
  };
  const row = cells({...job, payload: {...job.payload, master_details: detail,
    phone: "0800000000", pic_name: "CS Dummy", sales_stage: "follow_up_after_trial",
    last_contact_at: "2026-11-11T02:00:00Z", next_action: "Confirm schedule",
    follow_up_on: "2026-11-13", trial_at: "2026-11-14T02:00:00Z", registered_on: "2026-11-15"}});
  assert(JSON.stringify(row.slice(0,25)) === JSON.stringify([
    "lead-1", "2026-11-12", "Parent Dummy", "Student Dummy", "School Dummy", "10",
    "0800000000", "Citra Raya", "Kid Talker", "School Event", "Event Dummy", "CS Dummy",
    "Follow-up After Trial", "Warm", "2026-11-11T02:00:00Z", "Confirm schedule", "2026-11-13",
    "3", "2026-11-14T02:00:00Z", "Reschedule", "Level Dummy", "Saturday", "Schedule", "2026-11-15", "Payment 1",
  ]));
  assert(row[32] === "OLD-001");
  const old = cells({...job, payload: {...job.payload, created_at: "2026-11-11T18:00:00Z"}});
  assert(old[1] === "2026-11-12");
  assert(old[2] === "" && old[3] === ""); // Never guess who the legacy name refers to.
  assert(old[26] === job.payload.name);
});
