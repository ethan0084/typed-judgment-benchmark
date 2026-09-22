import "server-only";

/**
 * The only place provider credentials are read.
 *
 * Nothing here ever returns, logs, or serializes a key value. Callers get a
 * boolean presence flag or an opaque client that closes over the secret.
 * See TASK-004 and the key-handling boundary in HANDOFF.md.
 */

const SECRET_VARS = ["TYPESAFE_API_KEY", "DEEPSEEK_API_KEY"] as const;
export type SecretVar = (typeof SECRET_VARS)[number];

export type EnvStatus = {
  typesafe_key_present: boolean;
  deepseek_key_present: boolean;
  typesafe_model: string;
  deepseek_model: string;
  deepseek_base_url: string;
  node_version: string;
  node_version_ok: boolean;
};

function present(name: SecretVar): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
}

/** Non-secret configuration, safe to display. */
export function publicConfig() {
  return {
    typesafe_model: process.env.TYPESAFE_MODEL?.trim() || "jev-1.13.0",
    deepseek_model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    deepseek_base_url:
      process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  };
}

/**
 * Non-secret run flag. Set BENCHMARK_STRICT=1 to turn dataset-integrity
 * warnings back into hard errors, which is what the published benchmark needs.
 */
export function isStrictMode(): boolean {
  return process.env.BENCHMARK_STRICT === "1";
}

function majorVersion(): number {
  const match = /^v?(\d+)/.exec(process.version);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Presence-only status. This is the exact shape sent to the browser, so it
 * must never gain a field carrying a secret value.
 */
export function readEnvStatus(): EnvStatus {
  const config = publicConfig();
  return {
    typesafe_key_present: present("TYPESAFE_API_KEY"),
    deepseek_key_present: present("DEEPSEEK_API_KEY"),
    ...config,
    node_version: process.version,
    node_version_ok: majorVersion() >= 20,
  };
}

/**
 * Returns the secret for server-side client construction only.
 * Throws a message that names the variable but never echoes its value.
 */
export function requireSecret(name: SecretVar): string {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(
      `Missing ${name}. Set it in .env.local (never commit it) before running live requests.`,
    );
  }
  return raw.trim();
}

/** Strips anything that looks like a credential out of an error message. */
export function redact(message: string): string {
  let out = message;
  for (const name of SECRET_VARS) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length >= 8) {
      out = out.split(value.trim()).join(`[redacted:${name}]`);
    }
  }
  return out
    .replace(/\b(sk|ts)-[A-Za-z0-9_-]{8,}/g, "[redacted:key]")
    .replace(/(authorization|api[-_]?key)\s*[:=]\s*\S+/gi, "$1: [redacted]");
}
