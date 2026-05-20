import {
  BrainCircuit,
  CheckCircle2,
  Github,
  Link2,
  MessageCircle,
  ShieldCheck,
  Twitter,
} from "lucide-react";

const SUPPORTED_PLATFORMS = [
  { label: "GitHub", icon: <Github className="h-4 w-4" /> },
  { label: "X", icon: <Twitter className="h-4 w-4" /> },
  { label: "Discord", icon: <MessageCircle className="h-4 w-4" /> },
];

const FLOW_STEPS = [
  {
    title: "Connect a wallet",
    body: "Start from the address that will hold your public identity record.",
    icon: <Link2 className="h-5 w-5" />,
  },
  {
    title: "Prove account control",
    body: "Post a code publicly or approve a Discord OAuth attestation.",
    icon: <CheckCircle2 className="h-5 w-5" />,
  },
  {
    title: "Build reputation",
    body: "SoulStamp records verified accounts, scores, reasoning, and audit history on-chain.",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
];

const SIGNALS = [
  "Exact-code verification",
  "Account quality signals",
  "Validator reasoning",
  "Admin moderation",
];

export function LandingPage() {
  return (
    <div className="space-y-14 pb-8">
      <section className="relative overflow-hidden border-b border-gray-900 pb-12 pt-4 text-center">
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-200">
            <BrainCircuit className="h-3.5 w-3.5" />
            GenLayer AI identity reputation
          </div>

          <img
            src="/soulstamp-logo.png"
            alt="SoulStamp"
            className="h-24 w-24 rounded-2xl object-contain"
          />

          <h1 className="mt-7 max-w-3xl text-4xl font-bold tracking-normal text-white sm:text-5xl">
            Verified social identity for on-chain reputation.
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-gray-400">
            SoulStamp links a wallet to controlled GitHub, X, and Discord accounts,
            then stores transparent verification evidence, confidence scores, and
            audit history on GenLayer Studionet.
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {SUPPORTED_PLATFORMS.map(platform => (
              <span
                key={platform.label}
                className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm text-gray-300"
              >
                {platform.icon}
                {platform.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {FLOW_STEPS.map(step => (
          <article
            key={step.title}
            className="rounded-lg border border-gray-800 bg-gray-900/70 p-5"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-300">
              {step.icon}
            </div>
            <h2 className="text-base font-semibold text-white">{step.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">{step.body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 border-y border-gray-900 py-9 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">
            Verification model
          </p>
          <h2 className="mt-3 text-2xl font-bold text-white">
            A public identity record with a readable audit trail.
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {SIGNALS.map(signal => (
            <div
              key={signal}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-300"
            >
              <CheckCircle2 className="h-4 w-4 text-success" />
              {signal}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
