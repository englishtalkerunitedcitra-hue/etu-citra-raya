// Verify the caller's database permission rather than requiring an identical
// JWT string: multiple valid service-role JWTs may exist for the same project.
export async function authorizeScheduler(
  url: string,
  authorization: string,
  supplied: string,
  expected: string | undefined,
  transport: typeof fetch = fetch,
) {
  if (!expected || expected.length < 32 || supplied !== expected ||
      !authorization.startsWith("Bearer ")) return false;
  try {
    const response = await transport(
      url + "/rest/v1/sheet_sync_config?select=singleton",
      {
        headers: {
          apikey: authorization.slice(7),
          Authorization: authorization,
        },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) return false;
    const rows = await response.json();
    // This table has no anon/authenticated grants; only service_role can read it.
    return Array.isArray(rows) && rows.length === 1 && rows[0].singleton === true;
  } catch {
    return false;
  }
}
