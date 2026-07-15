import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | CompassAi",
  description: "Privacy Policy for the CompassAi call transcription and QA application.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document">
        <header className="legal-header">
          <a className="legal-brand" href="/app">CompassAi</a>
          <span>Effective July 15, 2026</span>
          <h1>Privacy Policy</h1>
          <p>This policy explains how CompassAi handles information when authorized users transcribe recordings, perform quality assurance reviews, manage scorecards, match MirrorCXT leads, and create reports.</p>
        </header>

        <div className="legal-callout">
          <strong>Plain-language summary</strong>
          <p>CompassAi stores its working data primarily in your browser. Recordings and transcript content are sent through CompassAi&apos;s secure web relay to OpenAI using the API key you provide. Microsoft Entra ID authenticates approved users.</p>
        </div>

        <section><h2>1. Scope and operator</h2><p>This Privacy Policy applies to the CompassAi web application and its related pages. CompassAi is designed and operated by Adam Stephens. Questions or privacy requests may be sent to <a href="mailto:astephens@convertros.com">astephens@convertros.com</a>.</p></section>

        <section><h2>2. Information CompassAi processes</h2>
          <ul>
            <li><strong>Account information:</strong> your name, business email address, and authentication/session information supplied through Microsoft Entra ID.</li>
            <li><strong>Call content:</strong> audio or video recordings you select, generated transcripts, timestamps, detected client, agent and customer details, QA evidence, scores, reviewer notes, overrides, and report content.</li>
            <li><strong>Business context:</strong> scorecards, client detection rules, MirrorCXT exports, lead details, phone numbers, dispositions, and Clover links you import.</li>
            <li><strong>Preferences and credentials:</strong> your selected models, display theme, locally saved OpenAI API key, and other workspace preferences.</li>
            <li><strong>Technical information:</strong> hosting, authentication, and AI service providers may process routine request metadata such as IP address, browser/device information, timestamps, authentication events, usage information, and error details under their own policies.</li>
          </ul>
        </section>

        <section><h2>3. How information is used</h2><p>Information is used only to provide, secure, maintain, and troubleshoot CompassAi; authenticate authorized users; transcribe and analyze calls; select and apply scorecards; support human QA review; match imported leads; generate reports; and prevent misuse. CompassAi does not sell personal information or use call content for advertising.</p></section>

        <section><h2>4. Browser-local storage</h2><p>CompassAi currently stores the OpenAI API key, jobs, transcripts, QA results, scorecard changes, reports, model selections, and appearance preferences in the local storage of the browser profile you use. This information may remain there until you clear it through CompassAi, clear browser/site data, or remove the browser profile. Other users or software with access to that browser profile may be able to access locally stored information.</p></section>

        <section><h2>5. Cloud processing and service providers</h2>
          <p>CompassAi relies on the following providers to deliver the service:</p>
          <ul>
            <li><strong>Microsoft Entra ID</strong> authenticates users and returns identity information needed to establish an authorized session.</li>
            <li><strong>Vercel</strong> hosts the web application and temporarily relays authorized transcription and QA requests.</li>
            <li><strong>OpenAI</strong> receives recordings, transcript text, prompts, scorecard context, and your API key as needed to provide transcription and QA results.</li>
          </ul>
          <p>CompassAi&apos;s relay responses use no-store cache controls and CompassAi does not maintain a separate application database for call content. Providers may nevertheless process and retain information according to their own terms, security logs, and legal obligations. OpenAI states that API data is not used to train its models by default unless the API customer opts in, and that default abuse-monitoring logs may be retained for up to 30 days. Your OpenAI organization&apos;s settings and eligibility for additional retention controls may change that treatment.</p>
          <p>Review the <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">OpenAI Privacy Policy</a>, <a href="https://platform.openai.com/docs/models/default-usage-policies-by-endpoint" target="_blank" rel="noreferrer">OpenAI API data controls</a>, <a href="https://privacy.microsoft.com/privacystatement" target="_blank" rel="noreferrer">Microsoft Privacy Statement</a>, and <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">Vercel Privacy Policy</a> for provider-specific details.</p>
        </section>

        <section><h2>6. Retention and deletion</h2><p>Browser-stored CompassAi data remains until it is cleared by the user or browser. Use Settings to clear the API key and local jobs, or clear the site&apos;s browser data to remove all locally saved CompassAi information. Downloaded reports are controlled by whoever downloaded them. Microsoft, Vercel, and OpenAI may retain provider-side information under their own policies and account settings. Requests concerning CompassAi-controlled information may be sent to the contact address above.</p></section>

        <section><h2>7. Security</h2><p>CompassAi uses Microsoft authentication, an approved-domain allowlist, HTTPS transport, same-origin relay endpoints, and browser-local storage to reduce unnecessary server-side persistence. No system is completely secure. Users must protect their Microsoft account, browser profile, device, OpenAI API key, exported reports, and downloaded files, and must promptly report suspected unauthorized access.</p></section>

        <section><h2>8. Recording and data responsibilities</h2><p>You must have lawful authority, required notices, and any necessary consent before uploading or processing a recording or personal information. Do not submit content you are not authorized to use. CompassAi is not intended for highly sensitive data requiring specialized legal or regulatory safeguards unless your organization has independently determined that its configuration and provider agreements satisfy those requirements.</p></section>

        <section><h2>9. Children</h2><p>CompassAi is a business application intended for authorized adult users and is not directed to children under 18. Do not use the service to intentionally collect information directly from children.</p></section>

        <section><h2>10. International processing</h2><p>Information may be processed in the United States or other locations where the service providers operate. Your organization is responsible for determining whether its use of CompassAi and any cross-border transfer complies with applicable requirements.</p></section>

        <section><h2>11. Changes to this policy</h2><p>This policy may be updated as CompassAi&apos;s features, providers, or legal obligations change. The effective date at the top of this page identifies the current version. Continued use after an update means you acknowledge the revised policy.</p></section>

        <div className="legal-note">This policy is intended to accurately describe the current application. It is not legal advice, and organizations should obtain their own legal review for their recording, privacy, employment, and customer-data obligations.</div>
      </article>
    </main>
  );
}
