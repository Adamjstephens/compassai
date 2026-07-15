import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fair Use Policy | CompassAi",
  description: "Authorized-use and fair-use requirements for CompassAi.",
};

export default function FairUsePolicyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document">
        <header className="legal-header">
          <a className="legal-brand" href="/app">CompassAi</a>
          <span>Effective July 15, 2026</span>
          <h1>Fair Use Policy</h1>
          <p>This policy defines who may use CompassAi and the conduct required to protect the application, its users, customer information, and underlying systems.</p>
        </header>

        <div className="legal-callout warning">
          <strong>Authorized users only</strong>
          <p>Only users expressly approved by the application owner or an authorized organization administrator may access or use CompassAi. A working account or approved email domain does not grant permission when authorization has been revoked or was never provided.</p>
        </div>

        <section><h2>1. Permitted use</h2><p>Authorized users receive a limited, revocable, non-exclusive, non-transferable right to use CompassAi for approved internal call transcription, quality assurance, coaching, scorecard administration, lead matching, and reporting. Use must comply with applicable law, organizational policies, customer commitments, recording-consent requirements, and the OpenAI, Microsoft, and Vercel terms applicable to the connected services.</p></section>

        <section><h2>2. Prohibited access and sharing</h2><ul>
          <li>Accessing CompassAi without authorization or after authorization has ended.</li>
          <li>Sharing accounts, sessions, credentials, API keys, access links, or restricted content with unauthorized persons.</li>
          <li>Bypassing or attempting to bypass Microsoft authentication, domain restrictions, rate limits, access controls, security measures, or provider protections.</li>
          <li>Using another person&apos;s identity, credentials, recordings, customer information, or OpenAI account without permission.</li>
        </ul></section>

        <section><h2>3. No copying, restructuring, or manipulation</h2><p>Except with prior written authorization from Adam Stephens, users may not copy, clone, reproduce, republish, distribute, sublicense, sell, rent, host, rebrand, restructure, repackage, adapt, translate, modify, manipulate, create derivative applications from, or commercially exploit CompassAi or any substantial portion of its interface, workflows, source code, scorecard system, report templates, prompts, or proprietary materials.</p><p>Users may not reverse engineer, decompile, disassemble, scrape, extract source materials, map private endpoints, probe implementation details, reconstruct application logic, or use automated or manual methods to create a competing or substantially similar product. Attempts are prohibited whether or not they are completed successfully.</p></section>

        <section><h2>4. No interference or deceptive use</h2><ul>
          <li>Do not introduce malware, overload the service, conduct unauthorized vulnerability testing, automate abusive requests, or interfere with availability.</li>
          <li>Do not manipulate QA evidence, grades, reports, transcripts, identities, timestamps, or customer data to deceive others or misrepresent what occurred.</li>
          <li>Do not use CompassAi for unlawful surveillance, discrimination, harassment, fraud, impersonation, unauthorized profiling, or other harmful conduct.</li>
          <li>Do not upload recordings, personal information, scorecards, or proprietary material unless you have authority to process them.</li>
        </ul></section>

        <section><h2>5. Human review and responsible AI use</h2><p>Transcriptions, identity detection, client matching, scorecard selection, evidence, and grades may contain errors. CompassAi is a decision-support tool, not a substitute for qualified human review. Authorized users must verify material results before using them for compensation, discipline, customer commitments, compliance decisions, or other consequential actions.</p></section>

        <section><h2>6. API keys and costs</h2><p>Users are responsible for protecting any API key they enter and for all provider charges, limits, suspensions, and activity associated with their OpenAI account. API keys may not be shared through reports, screenshots, support messages, or unauthorized devices.</p></section>

        <section><h2>7. Enforcement</h2><p>Access may be limited, suspended, or terminated immediately when misuse, unauthorized access, security risk, legal exposure, or a violation of this policy is suspected. The application owner may preserve relevant security and provider records, notify the affected organization, and pursue available contractual or legal remedies.</p></section>

        <section><h2>8. Ownership and attribution</h2><p>CompassAi was designed and developed by Adam Stephens with development assistance from OpenAI Codex. CompassAi&apos;s original interface, workflows, scorecard tooling, report presentation, and application-specific materials are reserved to their respective owner. OpenAI, Codex, Microsoft, Entra, Vercel, and other third-party names and services remain the property of their respective owners. Use of OpenAI Codex as a development tool does not make OpenAI the operator, publisher, or owner of CompassAi.</p></section>

        <section><h2>9. Required legal exceptions</h2><p>Nothing in this policy prohibits activity expressly authorized in writing by the application owner, good-faith security testing performed under written authorization, or rights that cannot lawfully be restricted or waived. This product policy is not a determination of statutory copyright fair use.</p></section>

        <section><h2>10. Acceptance and contact</h2><p>By accessing or using CompassAi, you acknowledge this policy and agree to comply with it. If you do not agree or are not authorized, do not access or use the application. Authorization and policy questions may be sent to <a href="mailto:astephens@convertros.com">astephens@convertros.com</a>.</p></section>
      </article>
    </main>
  );
}
