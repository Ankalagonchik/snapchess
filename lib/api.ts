import { readSessionToken } from "@/lib/auth";

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

export function requireUsername(request: Request) {
  const session = readSessionToken(getBearerToken(request));
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session.username;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
