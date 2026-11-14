import { MAX_VALUE } from "../core/constants.js";

/** Parse a decimal token amount into base units without floating point. */
export function parseAmount(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) {
    throw new Error("unsupported token decimals");
  }
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a number such as 0.05.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error("That amount has too many decimal places.");
  }
  const base = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (base <= 0n) throw new Error("Enter an amount greater than zero.");
  if (base > MAX_VALUE) throw new Error("That amount is larger than one shielded note can hold.");
  return base;
}

/** Format base units as a decimal string. Trailing zeros in the fraction are dropped. */
export function formatAmount(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) {
    throw new Error("unsupported token decimals");
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const text = absolute.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const fraction = text.slice(text.length - decimals).replace(/0+$/, "");
  const rendered = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${rendered}` : rendered;
}
