import { DatabaseStore, deliver } from "./core.ts";
import { googleToken, GoogleSheets } from "./google.ts";
import { authorizeScheduler } from "./scheduler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const origins = (Deno.env.get("STAFF_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
Deno.serve(
  { port: Number(Deno.env.get("STAFF_LOCAL_SYNC_PORT") || 8000) },
  async (request) => {
    const origin = request.headers.get("Origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && origins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] =
        "authorization,apikey,content-type,x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST,OPTIONS";
    }
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.includes(origin))
      return reply({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return reply({ error: "POST required" }, 405);
    const authorization = request.headers.get("Authorization") || "";
    const expected = Deno.env.get("SHEETS_SYNC_JOB_TOKEN");
    const supplied = request.headers.get("x-job-token") || "";
    // Scheduler requires both the service credential and a separate secret header.
    const scheduled = await authorizeScheduler(url, authorization, supplied, expected);
    if (!scheduled) {
      const userHeaders = { apikey: anon, Authorization: authorization };
      const identity = await fetch(url + "/auth/v1/user", {
        headers: userHeaders,
      });
      if (!identity.ok) return reply({ error: "Authentication required" }, 401);
      const user = await identity.json();
      const profile = await fetch(
        url +
          "/rest/v1/staff_profiles?id=eq." +
          encodeURIComponent(user.id) +
          "&select=active,role",
        { headers: userHeaders },
      );
      const rows = profile.ok ? await profile.json() : [];
      if (!rows[0]?.active || rows[0]?.role !== "admin")
        return reply({ error: "Admin required" }, 403);
    }
    const credentials = Deno.env.get("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON");
    if (!credentials)
      return reply(
        {
          error:
            "Google service account belum dikonfigurasi. Belum ada konfirmasi sinkronisasi.",
        },
        503,
      );
    try {
      const accessToken = await googleToken(credentials);
      const result = await deliver(
        new DatabaseStore(url, service),
        new GoogleSheets(accessToken),
      );
      return reply(result, result.pending ? 502 : 200);
    } catch {
      return reply(
        {
          error:
            "Sinkronisasi belum terkonfirmasi. Periksa secret, izin Sheet, jaringan, dan antrean database.",
        },
        502,
      );
    }
  },
);
