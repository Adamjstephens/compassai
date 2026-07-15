import { auth, signIn, signOut } from "@/auth";
import { redirect } from "next/navigation";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session;
}

export async function signInMicrosoft() {
  "use server";
  await signIn("microsoft-entra-id", { redirectTo: "/app" });
}

export async function signOutUser() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

