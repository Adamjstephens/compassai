import { auth } from "@/auth";
import { makeCompassAiToken } from "@/lib/api-token";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = await makeCompassAiToken(email, session.user?.name ?? "");
  return NextResponse.json({
    token,
    apiUrl: process.env.COMPASSAI_API_URL ?? "",
    expiresInSeconds: 900
  });
}

