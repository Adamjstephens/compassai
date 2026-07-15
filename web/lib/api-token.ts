import { SignJWT } from "jose";

export async function makeCompassAiToken(email: string, name = "") {
  const secret = process.env.COMPASSAI_JWT_SECRET;
  if (!secret) throw new Error("COMPASSAI_JWT_SECRET is not configured.");
  const encoded = new TextEncoder().encode(secret);
  return new SignJWT({ email: email.toLowerCase(), name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(email.toLowerCase())
    .setIssuer("compassai-web")
    .setAudience("compassai-api")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(encoded);
}

