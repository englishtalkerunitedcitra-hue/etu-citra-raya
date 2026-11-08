import { headers, range } from "./mapping.js";
export class SyncError extends Error {
  constructor(
    public code: string,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
export type Job = {
  kind: "master" | "activity";
  entity_id: string;
  source_version: number;
  row_number: number;
  payload: Record<string, any>;
};
export type SheetConfig = {
  spreadsheet_id: string;
  master_title: string;
  activity_title: string;
};
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const encoded = (value: unknown) =>
  b64(new TextEncoder().encode(JSON.stringify(value)));
export async function googleToken(
  json: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let account;
  try {
    account = JSON.parse(json);
  } catch {
    throw new SyncError("auth_failed");
  }
  if (
    account.type !== "service_account" ||
    !account.client_email ||
    !account.private_key
  )
    throw new SyncError("auth_failed");
  try {
    const pem = account.private_key
      .replace(/-----[^-]+-----/g, "")
      .replace(/\s/g, "");
    const key = await crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const now = Math.floor(Date.now() / 1000);
    const message =
      encoded({ alg: "RS256", typ: "JWT" }) +
      "." +
      encoded({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(message),
    );
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: message + "." + b64(new Uint8Array(signature)),
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new SyncError("auth_failed");
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token)
      throw new SyncError("auth_failed");
    return data.access_token;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("auth_failed");
  }
}
function normalizedRange(value: string) {
  const at = value.lastIndexOf("!");
  return (
    value.slice(0, at).replace(/^'|'$/g, "").replaceAll("''", "'") +
    value.slice(at)
  );
}
export class GoogleSheets {
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async call(path: string, method = "GET", body?: unknown) {
    let response;
    try {
      response = await this.fetcher(
        "https://sheets.googleapis.com/v4/spreadsheets/" + path,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new SyncError("provider_unavailable");
    }
    if (!response.ok) {
      const retry = response.headers.get("Retry-After") || "";
      const retryAfter = /^\d+$/.test(retry)
        ? Number(retry)
        : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) || 0;
      throw new SyncError(
        response.status === 401
          ? "auth_failed"
          : [403, 404].includes(response.status)
            ? "permission_denied"
            : "provider_unavailable",
        retryAfter,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new SyncError("ack_mismatch");
    }
  }
  async prepare(
    config: SheetConfig,
    jobs: Job[],
    previouslySynced: boolean,
  ): Promise<{ range: string; values: any[][] }[]> {
    const id = encodeURIComponent(config.spreadsheet_id);
    const metadata = await this.call(
      id + "?fields=spreadsheetId,sheets(properties,developerMetadata)",
    );
    if (
      metadata.spreadsheetId !== config.spreadsheet_id ||
      !Array.isArray(metadata.sheets)
    )
      throw new SyncError("destination_conflict");
    const kinds = ["master", "activity"] as const;
    const tabs: any = {};
    const requests: any[] = [];
    let freeId =
      Math.max(
        0,
        ...metadata.sheets.map((s: any) => Number(s.properties.sheetId)),
      ) + 1;
    for (const kind of kinds) {
      const title =
        kind === "master" ? config.master_title : config.activity_title;
      let tab = metadata.sheets.find((s: any) => s.properties.title === title);
      const maxRow = Math.max(
        1000,
        ...jobs
          .filter((j) => j.kind === kind)
          .map((j) => Number(j.row_number) + 100),
      );
      if (!tab) {
        if (previouslySynced) throw new SyncError("destination_missing");
        const sheetId = freeId++;
        tab = {
          properties: {
            sheetId,
            title,
            gridProperties: {
              rowCount: maxRow,
              columnCount: Math.max(26, headers(kind).length),
            },
          },
        };
        requests.push(
          { addSheet: { properties: tab.properties } },
          {
            createDeveloperMetadata: {
              developerMetadata: {
                metadataKey: "etu_staff_sync_v1",
                metadataValue: kind,
                visibility: "DOCUMENT",
                location: { sheetId },
              },
            },
          },
        );
      } else {
        const owned = tab.developerMetadata?.some(
          (m: any) =>
            m.metadataKey === "etu_staff_sync_v1" &&
            m.metadataValue === kind &&
            m.location?.sheetId === tab.properties.sheetId,
        );
        if (!owned) throw new SyncError("destination_conflict");
        if (maxRow > tab.properties.gridProperties.rowCount)
          requests.push({
            updateSheetProperties: {
              properties: {
                sheetId: tab.properties.sheetId,
                gridProperties: { rowCount: maxRow },
              },
              fields: "gridProperties.rowCount",
            },
          });
      }
      tabs[kind] = tab;
    }
    if (requests.length)
      await this.call(id + ":batchUpdate", "POST", { requests });
    const ranges = kinds.map((kind) =>
      range(tabs[kind].properties.title, 1, kind),
    );
    const current = await this.call(
      id +
        "/values:batchGet?" +
        ranges.map((r) => "ranges=" + encodeURIComponent(r)).join("&"),
    );
    if (!Array.isArray(current.valueRanges) || current.valueRanges.length !== 2)
      throw new SyncError("ack_mismatch");
    const headerWrites = [];
    for (let index = 0; index < kinds.length; index++) {
      const actual = current.valueRanges[index].values?.[0] || [];
      const expected = headers(kinds[index]);
      if (
        actual.length &&
        JSON.stringify(actual.slice(0, expected.length)) !==
          JSON.stringify(expected)
      )
        throw new SyncError("header_conflict");
      if (!actual.length)
        headerWrites.push({ range: ranges[index], values: [expected] });
    }
    return headerWrites;
  }
  async write(config: SheetConfig, data: { range: string; values: any[][] }[]) {
    const result = await this.call(
      encodeURIComponent(config.spreadsheet_id) + "/values:batchUpdate",
      "POST",
      { valueInputOption: "RAW", data },
    );
    if (
      result.spreadsheetId !== config.spreadsheet_id ||
      result.responses?.length !== data.length ||
      result.totalUpdatedRows !== data.length
    )
      throw new SyncError("ack_mismatch");
    for (let i = 0; i < data.length; i++) {
      const ack = result.responses[i];
      const width = data[i].values[0].length;
      if (
        ack.updatedRows !== 1 ||
        ack.updatedColumns !== width ||
        ack.updatedCells !== width ||
        normalizedRange(ack.updatedRange || "") !==
          normalizedRange(data[i].range)
      )
        throw new SyncError("ack_mismatch");
    }
  }
}
