import { requireSession, signOutUser } from "@/lib/server-session";
import { CompassAiShell } from "@/components/app-shell";

export default async function AppPage() {
  const session = await requireSession();
  return (
    <>
      <form action={signOutUser} className="signout-form">
        <button>Sign out</button>
      </form>
      <CompassAiShell userEmail={session.user?.email ?? ""} />
    </>
  );
}

