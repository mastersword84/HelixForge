"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

/* ── Ember particle ── */
function EmberParticle({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 3,
        height: 3,
        background: "var(--forge-ember)",
        boxShadow: "0 0 6px 2px var(--forge-ember)",
        animation: "heat-rise 2.5s ease-out infinite",
        ...style,
      }}
    />
  );
}

/* ── Nav ── */
function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 transition-all duration-300"
      style={{
        background: scrolled
          ? "rgba(8, 6, 8, 0.92)"
          : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid var(--forge-border)" : "none",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold"
          style={{
            background: "var(--forge-ember)",
            color: "var(--forge-black)",
            fontFamily: "Geist Mono, monospace",
          }}
        >
          HF
        </div>
        <span
          className="text-lg font-bold tracking-tight"
          style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}
        >
          HelixForge
        </span>
      </div>

      <div className="hidden md:flex items-center gap-8">
        {["How It Works", "Examples", "About"].map((label) => (
          <a
            key={label}
            href={`#${label.toLowerCase().replace(/ /g, "-")}`}
            className="text-sm transition-colors duration-200"
            style={{ color: "var(--forge-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--forge-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--forge-muted)")}
          >
            {label}
          </a>
        ))}
      </div>

      <Link
        href="/forge"
        className="px-5 py-2 rounded text-sm font-semibold transition-all duration-200 ember-glow"
        style={{
          background: "var(--forge-ember)",
          color: "var(--forge-black)",
          fontFamily: "Geist Mono, monospace",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--forge-glow)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--forge-ember)";
        }}
      >
        Launch Forge →
      </Link>
    </nav>
  );
}

/* ── Hero ── */
const TAGLINES = [
  "Describe your tone. AI builds the chain.",
  "Upload a clip. Get a Helix preset.",
  "From idea to .hsp in seconds.",
  "Your sound. Your signal chain. Instant.",
];

function HeroSection() {
  const [taglineIdx, setTaglineIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setTaglineIdx((i) => (i + 1) % TAGLINES.length);
        setFading(false);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const particles = [
    { left: "15%", animationDelay: "0s", animationDuration: "2.2s" },
    { left: "28%", animationDelay: "0.6s", animationDuration: "3s" },
    { left: "42%", animationDelay: "1.1s", animationDuration: "2.5s" },
    { left: "57%", animationDelay: "0.3s", animationDuration: "2.8s" },
    { left: "71%", animationDelay: "0.9s", animationDuration: "2s" },
    { left: "84%", animationDelay: "1.5s", animationDuration: "3.2s" },
  ];

  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center text-center overflow-hidden px-6"
      style={{ paddingTop: 80 }}
    >
      {/* Grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,107,26,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,107,26,0.06) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Radial ember glow from center */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 60%, rgba(255,107,26,0.12) 0%, transparent 70%)",
        }}
      />

      {/* Ember particles floating from the bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-64 pointer-events-none">
        {particles.map((p, i) => (
          <EmberParticle key={i} style={{ ...p, bottom: 0 }} />
        ))}
      </div>

      {/* Badge */}
      <div
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-mono mb-8"
        style={{
          border: "1px solid var(--forge-border-hot)",
          background: "rgba(255,107,26,0.08)",
          color: "var(--forge-ember)",
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-ember inline-block" />
        Powered by Claude AI · Line 6 Helix
      </div>

      {/* Title */}
      <h1
        className="text-6xl md:text-8xl font-black tracking-tighter mb-6 animate-flicker"
        style={{
          fontFamily: "Geist Mono, monospace",
          background: "linear-gradient(135deg, var(--forge-glow) 0%, var(--forge-ember) 50%, var(--forge-dim) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        HELIX
        <br />
        FORGE
      </h1>

      {/* Rotating tagline */}
      <p
        className="text-xl md:text-2xl max-w-2xl mb-4 transition-opacity duration-400"
        style={{
          color: "var(--forge-text)",
          opacity: fading ? 0 : 1,
          fontFamily: "Geist Mono, monospace",
          letterSpacing: "-0.02em",
        }}
      >
        {TAGLINES[taglineIdx]}
      </p>

      <p className="text-base max-w-lg mb-12" style={{ color: "var(--forge-muted)" }}>
        Describe your dream tone or drop in an audio clip — HelixForge builds a
        complete, download-ready{" "}
        <span style={{ color: "var(--forge-arc)" }}>.hsp preset</span> using AI that
        knows every Helix model, block, and signal-chain rule.
      </p>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <Link
          href="/forge"
          className="group flex items-center gap-2 px-8 py-4 rounded text-base font-bold transition-all duration-200 ember-glow"
          style={{
            background: "var(--forge-ember)",
            color: "var(--forge-black)",
            fontFamily: "Geist Mono, monospace",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--forge-glow)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--forge-ember)";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Start Forging
        </Link>

        <a
          href="#how-it-works"
          className="flex items-center gap-2 px-8 py-4 rounded text-base font-medium transition-all duration-200"
          style={{
            border: "1px solid var(--forge-border)",
            color: "var(--forge-muted)",
            fontFamily: "Geist Mono, monospace",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border-hot)";
            (e.currentTarget as HTMLElement).style.color = "var(--forge-text)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border)";
            (e.currentTarget as HTMLElement).style.color = "var(--forge-muted)";
          }}
        >
          See How It Works ↓
        </a>
      </div>

      {/* Forge divider */}
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, var(--forge-ember), transparent)" }} />
    </section>
  );
}

/* ── How It Works ── */
const STEPS = [
  {
    num: "01",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "Describe Your Tone",
    body: "Type what you hear in your head — SRV's Texas crunch, a tight modern country twang, ambient swell, whatever. Or upload an audio clip and let AI analyze it.",
  },
  {
    num: "02",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: "AI Builds the Chain",
    body: "Claude — trained on every Helix model, block parameter, and signal-chain rule — assembles amps, cabs, drives, modulation, and effects into a coherent preset.",
  },
  {
    num: "03",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    title: "Download & Load",
    body: "Grab your .hsp file and drag it onto Helix or import via HX Edit. Plug in and play — no menu diving, no knob-twiddling rabbit holes.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-32 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs font-mono mb-3" style={{ color: "var(--forge-ember)", letterSpacing: "0.15em" }}>
            THE PROCESS
          </p>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
            Forge in Three Steps
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="relative p-8 rounded-lg steel-border group transition-all duration-300"
              style={{ background: "var(--forge-steel)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,107,26,0.4)";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 30px rgba(255,107,26,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <div className="text-4xl font-black mb-4" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-faint)" }}>
                {step.num}
              </div>
              <div className="mb-4" style={{ color: "var(--forge-ember)" }}>
                {step.icon}
              </div>
              <h3 className="text-lg font-bold mb-3" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--forge-muted)" }}>
                {step.body}
              </p>

              {/* Connector line */}
              {step.num !== "03" && (
                <div
                  className="hidden md:block absolute top-1/2 -right-3 w-6 h-px"
                  style={{ background: "var(--forge-border-hot)" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Example Tones ── */
const EXAMPLES = [
  {
    name: "SRV Texas Blues",
    tags: ["Blues", "Vintage"],
    color: "var(--forge-ember)",
    desc: "Dumble-voiced clean headroom with a tubescreamer stacked. Warm, woody, just on the edge of breakup.",
    chain: ["TS Drive → Placater Clean → 4x12 Greenback"],
  },
  {
    name: "Modern Country Twang",
    tags: ["Country", "Clean"],
    color: "var(--forge-hot)",
    desc: "Glassy Fender-style clean with a touch of compression. Snap on the attack, that chicken-pickin' sparkle.",
    chain: ["Compressor → Litigator Clean → 1x12 Lunchbox"],
  },
  {
    name: "Marshall Crunch",
    tags: ["Rock", "Crunch"],
    color: "var(--forge-glow)",
    desc: "Mid-heavy British crunch with natural amp breakup. Classic rock cut with clarity on single notes.",
    chain: ["Scream Drive → Brit 2204 → 4x12 WhoWatt"],
  },
  {
    name: "High Gain Lead",
    tags: ["Metal", "Lead"],
    color: "#c084fc",
    desc: "Tight low-end, vocal mids, singing sustain. Built for legato runs and soaring bends.",
    chain: ["Noise Gate → Archon Lead → 4x12 XXL V30"],
  },
  {
    name: "Ambient Swells",
    tags: ["Ambient", "Clean"],
    color: "var(--forge-arc)",
    desc: "Volume-swelled reverb trails into infinity. Shimmer and hall reverb for atmospheric washes.",
    chain: ["Cosmos Echo → Ganymede Reverb → Hall Reverb"],
  },
  {
    name: "Tele Snap & Bite",
    tags: ["Country", "Chicken Pickin'"],
    color: "var(--forge-hot)",
    desc: "Percussive pop on hybrid picking, staccato bite, and spanky single-coil definition.",
    chain: ["Kinky Boost → Litigator Clean → Coulomb Comp"],
  },
];

function ExampleTones() {
  return (
    <section id="examples" className="py-32 px-6" style={{ background: "var(--forge-dark)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs font-mono mb-3" style={{ color: "var(--forge-ember)", letterSpacing: "0.15em" }}>
            WHAT YOU CAN BUILD
          </p>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
            Forged Tones
          </h2>
          <p className="mt-4 text-base" style={{ color: "var(--forge-muted)" }}>
            Real presets generated by HelixForge — click any to open the Forge with that prompt.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {EXAMPLES.map((ex) => (
            <Link
              href="/forge"
              key={ex.name}
              className="group block p-6 rounded-lg transition-all duration-300"
              style={{
                background: "var(--forge-steel)",
                border: "1px solid var(--forge-border)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = ex.color;
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 30px ${ex.color}22`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-bold" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
                  {ex.name}
                </h3>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2 mt-0.5"
                  style={{ color: ex.color }}
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>

              <div className="flex gap-2 mb-4">
                {ex.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-xs font-mono"
                    style={{ background: `${ex.color}18`, color: ex.color, border: `1px solid ${ex.color}33` }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--forge-muted)" }}>
                {ex.desc}
              </p>

              <div
                className="text-xs font-mono px-3 py-2 rounded"
                style={{ background: "var(--forge-iron)", color: "var(--forge-faint)" }}
              >
                {ex.chain[0]}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── CTA Banner ── */
function CtaBanner() {
  return (
    <section
      className="relative py-32 px-6 overflow-hidden text-center"
      style={{ background: "var(--forge-steel)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(255,107,26,0.1) 0%, transparent 70%)",
        }}
      />
      <div className="relative z-10 max-w-2xl mx-auto">
        <p className="text-xs font-mono mb-4" style={{ color: "var(--forge-ember)", letterSpacing: "0.15em" }}>
          READY TO FORGE?
        </p>
        <h2
          className="text-4xl md:text-6xl font-black tracking-tighter mb-6"
          style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}
        >
          Your tone is
          <br />
          <span style={{ color: "var(--forge-ember)" }}>waiting to be born.</span>
        </h2>
        <p className="text-base mb-10" style={{ color: "var(--forge-muted)" }}>
          No gear shopping. No YouTube rabbit holes. Just describe it — and download it.
        </p>
        <Link
          href="/forge"
          className="inline-flex items-center gap-3 px-10 py-5 rounded text-lg font-bold ember-glow transition-all duration-200"
          style={{
            background: "var(--forge-ember)",
            color: "var(--forge-black)",
            fontFamily: "Geist Mono, monospace",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--forge-glow)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--forge-ember)";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Open the Forge
        </Link>
      </div>
    </section>
  );
}

/* ── Footer ── */
function Footer() {
  return (
    <footer
      className="py-8 px-8 flex flex-col sm:flex-row items-center justify-between gap-4"
      style={{ borderTop: "1px solid var(--forge-border)", background: "var(--forge-black)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
          style={{ background: "var(--forge-ember)", color: "var(--forge-black)", fontFamily: "Geist Mono, monospace" }}
        >
          HF
        </div>
        <span className="text-sm font-mono" style={{ color: "var(--forge-muted)" }}>
          HelixForge
        </span>
      </div>
      <p className="text-xs font-mono" style={{ color: "var(--forge-faint)" }}>
        Not affiliated with Line 6 or Yamaha. Line 6® and Helix® are registered trademarks.
      </p>
      <p className="text-xs font-mono" style={{ color: "var(--forge-faint)" }}>
        © {new Date().getFullYear()} HelixForge
      </p>
    </footer>
  );
}

/* ── Page ── */
export default function Home() {
  return (
    <>
      <NavBar />
      <HeroSection />
      <HowItWorks />
      <ExampleTones />
      <CtaBanner />
      <Footer />
    </>
  );
}
