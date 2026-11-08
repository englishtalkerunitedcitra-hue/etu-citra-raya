import { cells, range } from "./mapping.js";
import {
  GoogleSheets,
  SyncError,
  type Job,
  type SheetConfig,
} from "./google.ts";
export type Batch = {
  disabled?: boolean;
  busy?: boolean;
  jobs: Job[];
  config: SheetConfig;
  previously_synced: boolean;
};
export type Result = {
  kind: string;
  id: string;
  version: number;
  ok: boolean;
  error?: string;
  retry_after?: number;
};
export interface Store {
  claim(token: string): Promise<Batch>;
  finish(token: string, results: Result[]): Promise<void>;
}
export async function deliver(
  store: Store,
  google: Pick<GoogleSheets, "prepare" | "write">,
  token = crypto.randomUUID(),
) {
  const started = Date.now();
  const batch = await store.claim(token);
  if (batch.disabled || batch.busy)
    return { disabled: !!batch.disabled, busy: !!batch.busy, confirmed: 0 };
  const results = batch.jobs.map(
    (j) =>
      ({
        kind: j.kind,
        id: j.entity_id,
        version: j.source_version,
        ok: false,
      }) as Result,
  );
  if (!batch.jobs.length) {
    await store.finish(token, []);
    return { confirmed: 0 };
  }
  try {
    const headerWrites = await google.prepare(
      batch.config,
      batch.jobs,
      batch.previously_synced,
    );
    if (Date.now() - started > 60000)
      throw new SyncError("provider_unavailable");
    const data = headerWrites.concat(
      batch.jobs.map((job) => ({
        range: range(
          job.kind === "master"
            ? batch.config.master_title
            : batch.config.activity_title,
          job.row_number,
          job.kind,
        ),
        values: [cells(job)],
      })),
    );
    await google.write(batch.config, data); // A 2xx with a missing/incorrect acknowledgement is NOT success.
    results.forEach((result) => (result.ok = true));
  } catch (error) {
    const failure =
      error instanceof SyncError
        ? error
        : new SyncError("provider_unavailable");
    results.forEach((result) => {
      result.error = failure.code;
      result.retry_after = failure.retryAfter;
    });
  }
  await store.finish(token, results); // Failed DB acknowledgement is retried later at the same exact Sheet rows.
  return {
    confirmed: results.filter((r) => r.ok).length,
    pending: results.filter((r) => !r.ok).length,
  };
}
export class DatabaseStore implements Store {
  constructor(
    private url: string,
    private key: string,
  ) {}
  private async rpc(name: string, args: unknown) {
    const response = await fetch(this.url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Database sync operation failed");
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  claim(token: string) {
    return this.rpc("claim_sheet_jobs", { p_token: token, p_limit: 25 });
  }
  async finish(token: string, results: Result[]) {
    await this.rpc("finish_sheet_jobs", { p_token: token, p_results: results });
  }
}
