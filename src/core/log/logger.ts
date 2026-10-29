const SECRET_KEY =
  /(secret|private|password|passphrase|mnemonic|seed|api[_-]?key|token|spend(ing)?key|viewprivate|viewkey|keypair|authorization|ciphertext|opening|blinding)/i;

export type LogLevel = "info" | "warn" | "error";
export type LogSink = (line: string) => void;

let sink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Test hook. Pass null to restore stdout. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? ((line) => process.stdout.write(`${line}\n`));
}

export function redact(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `[bytes:${value.length}]`;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redact(childValue, childKey);
    }
    return out;
  }
  return value;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = { level, message };
  if (meta) payload.meta = redact(meta);
  sink(JSON.stringify(payload));
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    write("error", message, meta);
  },
};
