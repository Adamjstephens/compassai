import Image from "next/image";
import { auth } from "@/auth";
import { signInMicrosoft } from "@/lib/server-session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.email) redirect("/app");

  return (
    <main className="login-shell">
      <section className="login-hero">
        <div className="brand-mark">
          <Image src="/logo512.png" width={64} height={64} alt="CompassAi" />
          <div>
            <h1>CompassAi</h1>
            <p>Secure cloud QA for call teams.</p>
          </div>
        </div>
        <h2>CompassQA, online.</h2>
        <p>
          Upload recordings, score against your client scorecards, review QA results,
          and export polished reports without installing the local desktop app.
        </p>
        <form action={signInMicrosoft}>
          <button className="primary large">Continue with Microsoft</button>
        </form>
        <p className="fine-print">Access is restricted to approved Microsoft domains.</p>
      </section>
    </main>
  );
}

