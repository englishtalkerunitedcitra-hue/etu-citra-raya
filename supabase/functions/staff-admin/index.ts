// Service credentials stay in Edge Function secrets. This function never trusts client roles.
const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedOrigins = (Deno.env.get("STAFF_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const redirect = Deno.env.get("STAFF_REDIRECT_URL") || "";
Deno.serve(
  { port: Number(Deno.env.get("STAFF_LOCAL_PORT") || 8000) },
  async (request) => {
    const origin = request.headers.get("Origin");
    const cors: Record<string, string> = {
      Vary: "Origin",
      "Cache-Control": "no-store",
    };
    if (origin && allowedOrigins.includes(origin)) {
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Access-Control-Allow-Headers"] =
        "authorization, apikey, content-type, x-client-info";
      cors["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    if (origin && !allowedOrigins.includes(origin))
      return reply({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return reply({ error: "POST required" }, 405);
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer "))
      return reply({ error: "Authentication required" }, 401);
    const userHeaders = {
      apikey: anonKey,
      Authorization: authorization,
      "Content-Type": "application/json",
    };
    try {
      const identity = await fetch(`${url}/auth/v1/user`, {
        headers: userHeaders,
      });
      if (!identity.ok) return reply({ error: "Session expired" }, 401);
      const user = await identity.json();
      const profileResponse = await fetch(
        `${url}/rest/v1/staff_profiles?id=eq.${encodeURIComponent(user.id)}&select=role,active`,
        { headers: userHeaders },
      );
      const profiles = profileResponse.ok ? await profileResponse.json() : [];
      if (!profiles[0]?.active || profiles[0]?.role !== "admin")
        return reply({ error: "Admin required" }, 403);
      const text = await request.text();
      if (text.length > 8000) return reply({ error: "Request too large" }, 413);
      const body = JSON.parse(text);
      if (body.action === "branch") {
        if (!/^[0-9a-f-]{36}$/i.test(body.id || "") ||
            !["taman_royal", "citra_raya", "palem_semi"].includes(body.branch_code))
          return reply({ error: "Cabang tidak valid" }, 400);
        const result = await fetch(`${url}/rest/v1/rpc/admin_set_staff_branch`, {
          method: "POST",
          headers: userHeaders,
          body: JSON.stringify({ p_target: body.id, p_branch: body.branch_code }),
        });
        if (!result.ok)
          return reply({ error: "Pindahkan dahulu prospek yang masih ditangani staf di cabang lama." }, result.status);
        return reply({ ok: true });
      }
      if (body.action === "access") {
        if (
          !/^[0-9a-f-]{36}$/i.test(body.id || "") ||
          !["staff", "admin"].includes(body.role) ||
          typeof body.active !== "boolean"
        )
          return reply({ error: "Invalid access request" }, 400);
        const result = await fetch(
          `${url}/rest/v1/rpc/admin_set_staff_access`,
          {
            method: "POST",
            headers: userHeaders,
            body: JSON.stringify({
              p_target: body.id,
              p_role: body.role,
              p_active: body.active,
            }),
          },
        );
        if (!result.ok)
          return reply(
            {
              error:
                "Perubahan akses ditolak. Pastikan minimal satu admin tetap aktif.",
            },
            result.status,
          );
        return reply({ ok: true });
      }
      if (body.action !== "invite")
        return reply({ error: "Unknown action" }, 400);
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const name = String(body.display_name || "").trim();
      const branch = String(body.branch_code || "");
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        !name ||
        name.length > 100
        || !["taman_royal", "citra_raya", "palem_semi"].includes(branch)
      )
        return reply({ error: "Nama dan email valid diperlukan" }, 400);
      if (!redirect || !allowedOrigins.length)
        return reply({ error: "Invitation configuration is missing" }, 503);
      const existing = await fetch(
        `${url}/rest/v1/staff_profiles?email=eq.${encodeURIComponent(email)}&select=id`,
        { headers: userHeaders },
      );
      if (!existing.ok)
        return reply({ error: "Cannot check staff directory" }, 503);
      if ((await existing.json()).length)
        return reply(
          { error: "Email sudah memiliki akun. Kelola akses akun tersebut." },
          409,
        );
      const invited = await fetch(
        `${url}/auth/v1/invite?redirect_to=${encodeURIComponent(redirect)}`,
        {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, data: { display_name: name } }),
        },
      );
      if (!invited.ok)
        return reply(
          {
            error:
              "Undangan gagal. Periksa konfigurasi SMTP atau batas pengiriman Supabase.",
          },
          502,
        );
      const invitedUser = await invited.json();
      const branchGrant = await fetch(`${url}/rest/v1/rpc/admin_set_staff_branch`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ p_target: invitedUser.id, p_branch: branch }),
      });
      if (!branchGrant.ok)
        return reply({ error: "Undangan dikirim, tetapi cabang staf belum ditetapkan. Periksa daftar staf." }, 502);
      const grant = await fetch(`${url}/rest/v1/rpc/admin_set_staff_access`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          p_target: invitedUser.id,
          p_role: "staff",
          p_active: true,
        }),
      });
      if (!grant.ok)
        return reply(
          {
            error:
              "Undangan dikirim, tetapi akses belum aktif. Aktifkan akun melalui daftar staf.",
          },
          502,
        );
      return reply({
        ok: true,
        message:
          "Undangan diterima layanan email Supabase. Staf perlu membuka email dan membuat password.",
      });
    } catch {
      return reply(
        { error: "Permintaan tidak dapat diproses. Silakan coba kembali." },
        400,
      );
    }
  },
);
