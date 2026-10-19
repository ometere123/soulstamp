import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const localValues = parseEnvFile(path.join(ROOT, ".env.test-wallets.local"));

/**
 * Read one secret/config value without ever printing the local env file.
 * Process env wins so CI can inject a secret without a checked-out file.
 */
export function secret(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = process.env[key] ?? localValues[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function config(name, fallback = "") {
  return secret(name) || fallback;
}

export function requireSecret(name, aliases = []) {
  const value = secret(name, aliases);
  if (!value) throw new Error(`${name} is not configured in the process environment or ignored local wallet file`);
  return value;
}

export function repositoryRoot() {
  return ROOT;
}

