import { createHmac, randomUUID, timingSafeEqual } from "crypto";

import type { SessionPayload } from "@/lib/types";

const AUTH_SECRET = process.env.AUTH_SECRET || "snapchess-dev-secret";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(username: string) {
  const now = new Date();
  const payload: SessionPayload = {
    username,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function readSessionToken(token?: string | null): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = signPayload(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function makeNonce() {
  return randomUUID();
}
