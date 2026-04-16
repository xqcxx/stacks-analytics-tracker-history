"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClarityValue } from "@stacks/transactions";

type ActivityItem = {
  id: string;
  type: "page-view" | "action" | "conversion" | "custom";
  summary: string;
  txId: string;
  at: string;
};

const DEFAULT_NETWORK = "testnet";

function txIdFromResult(result: { txid?: string; txId?: string }): string {
  return result.txid ?? result.txId ?? "unknown";
}

async function loadStacksConnect() {
  return import("@stacks/connect");
}

async function loadStacksTransactions() {
  return import("@stacks/transactions");
}

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [contract, setContract] = useState<string>(
    "ST000000000000000000002AMW42H.analytics-tracker"
  );
  const [network, setNetwork] = useState<string>(DEFAULT_NETWORK);
  const [status, setStatus] = useState<string>("Ready");
  const [busy, setBusy] = useState<boolean>(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const [projectId, setProjectId] = useState<string>("demo-app");
  const [page, setPage] = useState<string>("/landing");
  const [actionName, setActionName] = useState<string>("cta_click");
  const [target, setTarget] = useState<string>("hero-start-button");
  const [conversionType, setConversionType] = useState<string>("signup");
  const [value, setValue] = useState<string>("1");
  const [customEventType, setCustomEventType] = useState<string>("session");
  const [payload, setPayload] = useState<string>("source=frontend");

  useEffect(() => {
    (async () => {
      const { getLocalStorage, isConnected } = await loadStacksConnect();
      const cached = getLocalStorage();
      const stxAddress = cached?.addresses?.stx?.[0]?.address ?? "";

      if (isConnected() && stxAddress) {
        setWalletAddress(stxAddress);
        setStatus("Wallet connected.");
      }
    })();
  }, []);

  const shortAddress = useMemo(() => {
    if (!walletAddress) return "Not connected";
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  async function refreshAddress() {
    const { getLocalStorage, request } = await loadStacksConnect();
    const data = getLocalStorage();
    const fromCache = data?.addresses?.stx?.[0]?.address;

    if (fromCache) {
      setWalletAddress(fromCache);
      return;
    }

    const response = await request("stx_getAddresses", { network });
    const first = response.addresses[0]?.address ?? "";
    setWalletAddress(first);
  }

  async function connectWallet() {
    try {
      setBusy(true);
      setStatus("Opening wallet selector...");
      const { connect } = await loadStacksConnect();
      await connect({ network });
      await refreshAddress();
      setStatus("Wallet connected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Connect failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  function disconnectWallet() {
    void (async () => {
      const { disconnect } = await loadStacksConnect();
      disconnect();
      setWalletAddress("");
      setStatus("Disconnected.");
    })();
  }

  async function callTracker(
    functionName: string,
    functionArgs: ClarityValue[],
    activityType: ActivityItem["type"],
    summary: string
  ) {
    if (!contract.includes(".")) {
      setStatus("Invalid contract format. Use: SP....contract-name");
      return;
    }

    try {
      setBusy(true);
      setStatus(`Sending ${functionName} transaction...`);
      const { request } = await loadStacksConnect();

      const tx = await request("stx_callContract", {
        contract: contract as `${string}.${string}`,
        functionName,
        functionArgs,
        network,
        sponsored: false,
      });

      const txId = txIdFromResult(tx);
      setActivity((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type: activityType,
          summary,
          txId,
          at: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      setStatus(`Transaction submitted: ${txId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Transaction failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitPageView() {
    const { Cl } = await loadStacksTransactions();
    await callTracker(
      "track-page-view",
      [Cl.stringAscii(projectId), Cl.stringUtf8(page)],
      "page-view",
      `${projectId} page view on ${page}`
    );
  }

  async function submitAction() {
    const { Cl } = await loadStacksTransactions();
    await callTracker(
      "track-action",
      [
        Cl.stringAscii(projectId),
        Cl.stringAscii(actionName),
        Cl.stringUtf8(target),
      ],
      "action",
      `${projectId} action ${actionName} on ${target}`
    );
  }

  async function submitConversion() {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber) || asNumber < 0) {
      setStatus("Conversion value must be a positive number.");
      return;
    }

    const { Cl } = await loadStacksTransactions();
    await callTracker(
      "track-conversion",
      [
        Cl.stringAscii(projectId),
        Cl.stringAscii(conversionType),
        Cl.uint(asNumber),
      ],
      "conversion",
      `${projectId} conversion ${conversionType} value=${asNumber}`
    );
  }

  async function submitCustomEvent() {
    const { Cl } = await loadStacksTransactions();
    await callTracker(
      "track-custom-event",
      [
        Cl.stringAscii(projectId),
        Cl.stringAscii(customEventType),
        Cl.stringUtf8(payload),
      ],
      "custom",
      `${projectId} custom ${customEventType}`
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
      <a
        href="#live-console"
        className="sr-only rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[#04131f] focus:not-sr-only"
      >
        Skip to live console
      </a>
      <nav className="rise-in glass-nav sticky top-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--text-soft)]"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" />GraphForge</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
<a href="#how-it-works" className="rounded-full border border-[var(--border)] px-4 py-1.5 transition hover:border-[var(--brand)] hover:text-[var(--brand)]">How It Works</a>
        <a href="#live-console" className="rounded-full border border-[var(--border)] px-4 py-1.5 transition hover:border-[var(--brand)] hover:text-[var(--brand)]">Console</a>
        <a href="#contact" className="rounded-full bg-[var(--brand)] px-4 py-1.5 font-semibold text-[#04131f] transition hover:bg-[var(--brand-soft)]">Request Demo</a>
        </div>
      </nav>

      <section className="rise-in surface-panel rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[0_22px_80px_-45px_rgba(50,212,161,0.65)]">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--text-soft)]">GraphForge Analytics</p>
        <h1 className="mt-3 text-[2.5rem] font-semibold leading-[1.1] md:text-[3.5rem]">Event Analytics on Stacks</h1>
        <p className="mt-5 max-w-3xl text-base text-[var(--text-soft)] md:text-lg">
          Capture page views, user actions, conversions, and custom events as on-chain telemetry.
          Built for teams that need auditable analytics plus high-frequency scripted submissions.
        </p>
        <div className="mt-5 grid gap-2 text-xs sm:grid-cols-3">
          <div className="metric-chip rounded-xl px-3 py-2">
            <p className="font-mono uppercase tracking-wide text-[var(--text-soft)]">Event Types</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">4 tracked functions</p>
          </div>
          <div className="metric-chip rounded-xl px-3 py-2">
            <p className="font-mono uppercase tracking-wide text-[var(--text-soft)]">Network</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">{network}</p>
          </div>
          <div className="metric-chip rounded-xl px-3 py-2">
            <p className="font-mono uppercase tracking-wide text-[var(--text-soft)]">Local Feed</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text)]">{activity.length} events</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={connectWallet}
            disabled={busy}
            className="rounded-full bg-[var(--brand)] px-6 py-3 text-sm font-semibold text-[#04131f] transition hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect Wallet
          </button>
          <button
            type="button"
            onClick={disconnectWallet}
            className="rounded-full border border-[var(--border)] bg-transparent px-6 py-3 text-sm font-semibold transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            Disconnect
          </button>
          <span className="rounded-full border border-[var(--border)] px-4 py-2 font-mono text-xs text-[var(--text-soft)]">{shortAddress}</span>
        </div>
      </section>

      <section id="how-it-works" className="rise-in grid gap-5 [animation-delay:80ms] md:grid-cols-3">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">How It Works</p>
          <h2 className="mt-3 text-[1.25rem] font-semibold">1) Choose event + payload</h2>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Define event data in the console below using typed Clarity arguments.</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">How It Works</p>
          <h2 className="mt-3 text-[1.25rem] font-semibold">2) Submit contract call</h2>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Each call emits a structured event with no mutable state dependencies.</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">How It Works</p>
          <h2 className="mt-3 text-[1.25rem] font-semibold">3) Index and analyze</h2>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Read tx/event stream via indexers for dashboards, cohorts, and funnels.</p>
        </article>
      </section>

      <section className="rise-in surface-panel rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 [animation-delay:130ms]">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Use Cases</p>
            <p className="mt-2 text-sm">Growth tracking, campaign attribution, retention event auditing.</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Architecture</p>
            <p className="mt-2 text-sm">Stateless emit-only contract + off-chain indexing layer.</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Network</p>
            <p className="mt-2 text-sm">Current target: {network}. Local log entries: {activity.length}.</p>
          </div>
        </div>
      </section>

      <section className="rise-in grid gap-4 [animation-delay:155ms] lg:grid-cols-3">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Trust</p>
          <h3 className="mt-2 text-lg font-semibold">Production-safe event model</h3>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Stateless contract calls, deterministic payload structure, and clean indexer compatibility.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[var(--border)] px-2 py-1">No mutable state writes</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Script-friendly</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Stacks-native</span>
          </div>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Integrations</p>
          <h3 className="mt-2 text-lg font-semibold">Fits existing analytics stack</h3>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Feed emitted events into ETL jobs, warehouse tables, BI dashboards, and cohort pipelines.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Data Warehouses</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Indexer APIs</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Dashboards</span>
          </div>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">FAQ</p>
          <h3 className="mt-2 text-lg font-semibold">Can we send high-volume events?</h3>
          <p className="mt-3 text-sm text-[var(--text-soft)]">Yes. Calls do not depend on prior state transitions, so repeated submits remain predictable.</p>
          <h4 className="mt-3 text-sm font-semibold">Do we need sponsorship?</h4>
          <p className="mt-1 text-sm text-[var(--text-soft)]">Not required. You can run standard wallet-signed calls or layer sponsorship later.</p>
        </article>
      </section>

      <section className="rise-in surface-panel rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 [animation-delay:162ms]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-soft)]">Ready to launch</p>
            <h2 className="mt-1 text-2xl font-semibold">Start tracking product behavior on-chain</h2>
            <p className="mt-1 text-sm text-[var(--text-soft)]">Connect wallet, set contract, and submit your first production-like telemetry event.</p>
          </div>
          <button
            type="button"
            onClick={connectWallet}
            disabled={busy}
            className="rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[#04131f] disabled:opacity-60"
          >
            Open Console
          </button>
        </div>
      </section>

      <section id="contact" className="rise-in surface-panel rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 [animation-delay:166ms]">
        <h2 className="text-2xl font-semibold">Request a Demo</h2>
        <p className="mt-1 text-sm text-[var(--text-soft)]">Share your team details and analytics goals. We will follow up with an implementation walkthrough.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
<input className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="Work email" />
      <input className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="Company" />
      <input className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="Monthly events" />
        </div>
        <button type="button" className="mt-3 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[#04131f]">Submit Interest</button>
      </section>

      <section id="live-console" className="rise-in surface-panel space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 [animation-delay:170ms]">
        <h2 className="text-2xl font-semibold">Live Console</h2>
        <p className="text-sm text-[var(--text-soft)]">Interactive contract form for demos and scripted operation dry-runs.</p>
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 font-mono text-xs text-[var(--text-soft)]">{status}</p>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 lg:col-span-2">
              <h3 className="text-base font-semibold">Runtime Config</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <input value={contract} onChange={(event) => setContract(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-xs outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="SP...analytics-tracker" />
                <select value={network} onChange={(event) => setNetwork(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]"><option value="testnet">testnet</option><option value="mainnet">mainnet</option><option value="devnet">devnet</option></select>
                <input value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="project-id" />
              </div>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <h3 className="text-base font-semibold">Page View</h3>
              <input value={page} onChange={(event) => setPage(event.target.value)} className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="page path" />
              <button type="button" onClick={submitPageView} disabled={busy} className="mt-3 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[#04131f] transition hover:bg-[var(--brand-soft)] disabled:opacity-60">Fire `track-page-view`</button>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <h3 className="text-base font-semibold">Action</h3>
              <div className="mt-2 grid gap-2">
                <input value={actionName} onChange={(event) => setActionName(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="action" />
                <input value={target} onChange={(event) => setTarget(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="target" />
              </div>
              <button type="button" onClick={submitAction} disabled={busy} className="mt-3 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[#04131f] transition hover:bg-[var(--brand-soft)] disabled:opacity-60">Fire `track-action`</button>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <h3 className="text-base font-semibold">Conversion</h3>
              <div className="mt-2 grid gap-2">
<input value={conversionType} onChange={(event) => setConversionType(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="conversion type" />
          <input type="number" min="0" value={value} onChange={(event) => setValue(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="value" />
              </div>
              <button type="button" onClick={submitConversion} disabled={busy} className="mt-3 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[#201105] transition hover:opacity-90 disabled:opacity-60">Fire `track-conversion`</button>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <h3 className="text-base font-semibold">Custom Event</h3>
              <div className="mt-2 grid gap-2">
<input value={customEventType} onChange={(event) => setCustomEventType(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="event type" />
          <input value={payload} onChange={(event) => setPayload(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[#0c172b] px-4 py-2.5 font-mono text-sm outline-none ring-[var(--ring)] transition focus:ring focus:border-[var(--brand)]" placeholder="payload" />
              </div>
              <button type="button" onClick={submitCustomEvent} disabled={busy} className="mt-3 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[#04131f] transition hover:bg-[var(--brand-soft)] disabled:opacity-60">Fire `track-custom-event`</button>
            </article>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[#0c172b] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Recent Events</h3>
              <span className="rounded-full border border-[var(--border)] px-3 py-1 font-mono text-xs text-[var(--text-soft)]">{activity.length}</span>
            </div>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--text-soft)]">Nothing emitted yet. Fire any function to append entries.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {activity.map((item) => (
                  <li key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-[var(--text-soft)]">{item.type} @ {item.at}</p>
                    <p className="mt-1 text-sm">{item.summary}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--text-soft)]">{item.txId}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <footer className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-xs text-[var(--text-soft)]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p>GraphForge Analytics - On-chain telemetry infrastructure for product teams.</p>
          <div className="flex items-center gap-3">
            <span>Security-first architecture</span>
            <span>Stacks compatible</span>
            <span>Version 1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
