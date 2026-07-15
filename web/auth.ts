import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

function allowedDomains() {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function emailDomain(email: string) {
  return email.toLowerCase().split("@").pop() ?? "";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
    })
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email = (user.email ?? (profile as Record<string, unknown> | undefined)?.email ?? "").toString().toLowerCase();
      if (!email) return false;
      const domains = allowedDomains();
      return domains.length === 0 ? false : domains.includes(emailDomain(email));
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email.toLowerCase();
      if (user?.name) token.name = user.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
      }
      return session;
    }
  },
  pages: {
    signIn: "/login"
  }
});

