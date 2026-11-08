// Run locally or in CI with the PUBLIC project URL and anon/publishable key only.
import { writeFileSync } from "node:fs";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
if (!supabaseUrl || !supabaseAnonKey)
  throw new Error(
    "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required. Never use service_role here.",
  );
const url = new URL(supabaseUrl);
if (url.protocol !== "https:" && url.hostname !== "127.0.0.1")
  throw new Error("HTTPS required outside local development.");
if (supabaseAnonKey.startsWith("sb_secret_"))
  throw new Error("Secret key rejected. Use a public anon/publishable key.");
if (!supabaseAnonKey.startsWith("sb_publishable_")) {
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(supabaseAnonKey.split(".")[1], "base64url").toString(),
    );
  } catch {
    throw new Error("Invalid public key format.");
  }
  if (payload.role !== "anon")
    throw new Error("Only anon JWT keys are permitted in browser config.");
}
writeFileSync(
  new URL("../staff/config.js", import.meta.url),
  "// Public Supabase configuration; database permissions are enforced by RLS.\nwindow.ETU_STAFF_CONFIG = Object.freeze(" +
    JSON.stringify({ supabaseUrl, supabaseAnonKey }, null, 2) +
    ");\n",
);
console.log("Public staff configuration written; no server secrets included.");
