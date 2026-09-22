"use client";

import { useCallback, useEffect, useState } from "react";
import type { Claim, JevSemanticResult, ProviderId } from "@/lib/types";
import type { ProviderAccuracy, ProviderSnapshot, RunSnapshot } from "@/lib/events";
import { CATEGORY_ZH, DECISION_ZH, STRINGS, type Lang } from "@/lib/i18n";

/**
 * The single benchmark page. Left: Jev. Right: DeepSeek Flash.
 *
 * Everything displayed comes from server events. Nothing here invents a
 * probability, latency, cost or accuracy figure, and the DeepSeek column
 * never shows intermediate judgments because that route does not produce any.
 *
 * Language affects UI copy only. Provider-produced values (decisions,
 * categories, model IDs) are always shown in their original form, with a
 * Chinese gloss beside them when the page is in Chinese.
 */

const EMPTY: ProviderSnapshot = {
  processed: 0, succeeded: 0, failed: 0, total: 0, elapsed_ms: 0,
  decisions_per_second: 0, current_latency_ms: null, avg_latency_ms: 0,
  p50_latency_ms: 0, p95_latency_ms: 0, total_cost: 0, finished: false,
  current_claim: null, last_decision: null, last_semantic: null, last_error: null,
};

export default function Page() {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [status, setStatus] = useState<{
    env: Record<string, unknown>;
    sources: Record<string, { ok: boolean; detail: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [count, setCount] = useState(1);
  const [connected, setConnected] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const t = STRINGS[lang];

  // Remember the reader's language choice across reloads.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("benchmark-lang");
      if (saved === "en" || saved === "zh") setLang(saved);
    } catch {
      // Private mode or blocked storage: fall back to the default.
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === "en" ? "zh" : "en";
      try {
        window.localStorage.setItem("benchmark-lang", next);
      } catch {
        // Not persisting is acceptable; the page still switches.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  /**
   * Live event stream, with explicit reconnect.
   *
   * A dropped connection must never look like a stalled run: the runners keep
   * going server-side and the page would otherwise sit frozen until a manual
   * refresh. On error we close and retry, and the server replays the full
   * snapshot on subscribe, so no state is lost.
   */
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let lastMessageAt = Date.now();
    let stopped = false;

    const cleanupSource = () => {
      source?.close();
      source = null;
    };

    const connect = () => {
      if (stopped) return;
      cleanupSource();
      lastMessageAt = Date.now();

      source = new EventSource("/api/stream");

      source.onopen = () => setConnected(true);

      source.onmessage = (event) => {
        lastMessageAt = Date.now();
        setConnected(true);
        setSnapshot(JSON.parse(event.data) as RunSnapshot);
      };

      // Heartbeats only prove the stream is alive; they carry no run state.
      source.addEventListener("ping", () => {
        lastMessageAt = Date.now();
        setConnected(true);
      });

      source.onerror = () => {
        setConnected(false);
        cleanupSource();
        if (!stopped) retry = setTimeout(connect, 1000);
      };
    };

    /**
     * Watchdog for a silently dead stream.
     *
     * A connection can stay open at the browser while its server handler is
     * gone (a dev-server route recompile does exactly this). Then `onerror`
     * never fires and the page sits at zero while the run advances. The server
     * sends a heartbeat every 5s, so a longer gap means the stream is dead
     * regardless of what its readyState claims: force a reconnect.
     */
    watchdog = setInterval(() => {
      if (stopped || !source) return;
      if (Date.now() - lastMessageAt > 12000) {
        setConnected(false);
        connect();
      }
    }, 3000);

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (watchdog) clearInterval(watchdog);
      cleanupSource();
    };
  }, []);

  useEffect(() => {
    void fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const running = snapshot?.status === "running";

  const start = useCallback(
    async (mode: "demo" | "development", limit?: number) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode, limit }),
        });
        if (!response.ok) {
          setError(((await response.json()) as { error?: string }).error ?? "Failed to start.");
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /**
   * Real API runs cost money, so they are confirmed first.
   *
   * The confirmation is rendered in-page rather than via window.confirm():
   * a native dialog blocks the main thread, which stalls EventSource delivery
   * and makes a running benchmark look frozen until the page is refreshed.
   */
  const startReal = useCallback(async () => {
    setPendingConfirm(false);
    await start("development", count);
  }, [count, start]);

  const stop = useCallback(async () => {
    setStopping(true);
    setError(null);
    try {
      await fetch("/api/run", { method: "DELETE" });
    } finally {
      setStopping(false);
    }
  }, []);

  const jev = snapshot?.providers.jev ?? EMPTY;
  const ds = snapshot?.providers.deepseek ?? EMPTY;
  const total = snapshot?.total_cases ?? 0;
  const keysReady =
    Boolean(status?.env.typesafe_key_present) && Boolean(status?.env.deepseek_key_present);

  return (
    <main className="page">
      <div className="head-row">
        <div>
          <h1 className="title">{t.title}</h1>
          <p className="subtitle">{t.subtitle}</p>
        </div>
        <button className="lang" onClick={toggleLang} aria-label="Switch language">
          {t.langLabel}
        </button>
      </div>

      {snapshot?.mode === "demo" && <div className="banner">{t.demoBanner}</div>}
      {snapshot?.mode === "development" && <div className="banner live">{t.devBanner}</div>}
      {snapshot?.mode === "live" && <div className="banner live">{t.liveBanner}</div>}

      <div className="toolbar">
        <button onClick={() => void start("demo", count)} disabled={busy || running}>
          {t.startDemo}
        </button>
        <span className="count-picker" title={t.countHint}>
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            disabled={busy || running}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              setCount(Number.isFinite(n) ? Math.min(1000, Math.max(1, n)) : 1);
            }}
          />
          <span className="count-unit">{t.countLabel}</span>
          {[1, 3, 20, 100].map((n) => (
            <button
              key={n}
              className={`chip ${count === n ? "on" : ""}`}
              disabled={busy || running}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </span>
        <button
          className="secondary"
          onClick={() => setPendingConfirm(true)}
          disabled={busy || running || !keysReady}
          title={keysReady ? undefined : "API keys are not configured."}
        >
          {t.startTest}
        </button>
        <button className="danger" onClick={() => void stop()} disabled={!running || stopping}>
          {stopping ? t.stopping : t.stop}
        </button>

        {status && (
          <span className="col-model">
            TYPESAFE_API_KEY {status.env.typesafe_key_present ? t.keySet : t.keyMissing} ·
            DEEPSEEK_API_KEY {status.env.deepseek_key_present ? t.keySet : t.keyMissing} ·
            {" "}{t.input} {status.sources.input?.ok ? "✓" : "✗"} ·
            {" "}{t.policy} {status.sources.policy?.ok ? "✓" : "✗"}
          </span>
        )}
        <span className={`conn ${connected ? "on" : "off"}`}>
          {connected ? t.connected : t.disconnected}
        </span>
        {error && <span style={{ color: "var(--bad)" }}>{error}</span>}
      </div>

      {pendingConfirm && (
        <div className="confirm-bar">
          <span>{t.confirmRun(count)}</span>
          <span className="confirm-actions">
            <button onClick={() => void startReal()}>{t.confirmYes}</button>
            <button className="secondary" onClick={() => setPendingConfirm(false)}>
              {t.confirmNo}
            </button>
          </span>
        </div>
      )}

      <div className="toolbar cost-line">
        <span className="col-model">{t.costWarn(count)}</span>
      </div>

      <div className="columns">
        <Column
          kind="jev"
          name="Jev"
          model={`TypeSafe · ${String(status?.env.typesafe_model ?? "jev-1.13.0")}`}
          snapshot={jev}
          total={total}
          lang={lang}
        />
        <Column
          kind="deepseek"
          name="DeepSeek"
          model={`DeepSeek · ${String(status?.env.deepseek_model ?? "deepseek-flash")} · thinking high`}
          snapshot={ds}
          total={total}
          lang={lang}
        />
      </div>

      {(snapshot?.status === "finished" || snapshot?.status === "aborted") && (
        <Summary
          jev={jev}
          deepseek={ds}
          total={total}
          mode={snapshot.mode}
          lang={lang}
          scores={snapshot.scores}
          aborted={snapshot.status === "aborted"}
        />
      )}

      <p className="footnote">{t.footnote}</p>
    </main>
  );
}

function Column(props: {
  kind: ProviderId;
  name: string;
  model: string;
  snapshot: ProviderSnapshot;
  total: number;
  lang: Lang;
}) {
  const { kind, name, model, snapshot, total, lang } = props;
  const t = STRINGS[lang];
  const pct = total > 0 ? (snapshot.processed / total) * 100 : 0;

  return (
    <section className={`col ${kind === "jev" ? "jev" : "ds"}`}>
      <div className="col-head">
        <span className="col-name">{name}</span>
        <span className="col-model">{model}</span>
        <span className="col-state">
          {snapshot.finished
            ? t.finished
            : snapshot.current_claim
              ? t.reading(snapshot.current_claim.case_id)
              : t.idle}
        </span>
      </div>

      <div className="metrics">
        <Metric k={t.processed} v={`${snapshot.processed}`} sub={`/${total}`} />
        <Metric k={t.successful} v={`${snapshot.succeeded}`} />
        <Metric k={t.failed} v={`${snapshot.failed}`} />
        <Metric k={t.perSecond} v={snapshot.decisions_per_second.toFixed(2)} />
        <Metric
          k={t.currentLatency}
          v={snapshot.current_latency_ms == null ? "—" : Math.round(snapshot.current_latency_ms).toString()}
          sub="ms"
        />
        <Metric k={t.avg} v={Math.round(snapshot.avg_latency_ms).toString()} sub="ms" />
        <Metric k={t.elapsed} v={(snapshot.elapsed_ms / 1000).toFixed(1)} sub="s" />
        <Metric k={t.cost} v={`$${snapshot.total_cost.toFixed(4)}`} />
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>{t.currentClaim}</span>
          <span>{snapshot.current_claim?.case_id ?? "—"}</span>
        </div>
        <div className="panel-body">
          {snapshot.current_claim ? (
            <ClaimFields claim={snapshot.current_claim} lang={lang} />
          ) : (
            <span className="null">{t.noClaim}</span>
          )}
        </div>
      </div>

      {kind === "jev" ? (
        <div className="panel">
          <div className="panel-head">
            <span>{t.judgments}</span>
            <span>{t.judgmentsMeta}</span>
          </div>
          <div className="panel-body">
            {snapshot.last_semantic ? (
              <Judgments semantic={snapshot.last_semantic} lang={lang} />
            ) : (
              <span className="null">{t.waitingFirst}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span>{t.fullPolicy}</span>
            <span>{t.finalOnly}</span>
          </div>
          <div className="panel-body">
            <span className="null">{t.deepseekNote}</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <span>{t.latestDecision}</span>
          <span>
            {snapshot.current_latency_ms == null
              ? "—"
              : `${Math.round(snapshot.current_latency_ms)} ms`}
          </span>
        </div>
        <div className="panel-body">
          {snapshot.last_error ? (
            <span style={{ color: "var(--bad)" }}>failed · {snapshot.last_error}</span>
          ) : snapshot.last_decision ? (
            <>
              <div className={`decision ${snapshot.last_decision}`}>
                {snapshot.last_decision}
                {lang === "zh" && (
                  <span className="gloss">{DECISION_ZH[snapshot.last_decision]}</span>
                )}
              </div>
              <div className="route-note">{kind === "jev" ? t.byCode : t.byModel}</div>
            </>
          ) : (
            <span className="null">—</span>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

function ClaimFields({ claim, lang }: { claim: Claim; lang: Lang }) {
  const t = STRINGS[lang];
  const rows: [string, string | number | null][] = [
    [t.fDescription, claim.employee_description],
    [t.fAmount, claim.amount],
    [t.fCurrency, claim.currency],
    [t.fAttendees, claim.attendee_count],
    [t.fDate, claim.expense_date],
    [t.fMerchant, claim.merchant_or_vendor],
    [t.fSubmitted, claim.submitted_category],
    [t.fNotes, claim.notes_or_context],
  ];
  return (
    <dl className="fields">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>
            {value === null || value === "" ? (
              <span className="null">{t.missing}</span>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Judgments({ semantic, lang }: { semantic: JevSemanticResult; lang: Lang }) {
  const t = STRINGS[lang];
  const nouls: [string, { p_yes: number; value: boolean }][] = [
    [t.jPurpose, semantic.has_business_purpose],
    [t.jExternal, semantic.has_external_party_identity],
    [t.jException, semantic.has_exception_explanation],
    [t.jHuman, semantic.requires_human_review],
  ];

  return (
    <>
      <div className="judgment">
        <div className="judgment-top">
          <span className="judgment-name">{t.jCategory}</span>
          <span className="judgment-val">
            {semantic.expense_category.choice}
            {lang === "zh" && (
              <span className="gloss">{CATEGORY_ZH[semantic.expense_category.choice]}</span>
            )}{" "}
            {(semantic.expense_category.selected_probability * 100).toFixed(1)}%
          </span>
        </div>
        <div className="pbar">
          <i style={{ width: `${semantic.expense_category.selected_probability * 100}%` }} />
        </div>
        <div className="route-note">
          {t.confidence} {(semantic.expense_category.confidence * 100).toFixed(1)}%
        </div>
      </div>

      {nouls.map(([label, answer]) => (
        <div className="judgment" key={label}>
          <div className="judgment-top">
            <span className="judgment-name">{label}</span>
            <span className="judgment-val">
              {answer.value ? t.yes : t.no} · P(YES) {(answer.p_yes * 100).toFixed(1)}%
            </span>
          </div>
          <div className="pbar">
            <i style={{ width: `${answer.p_yes * 100}%` }} />
          </div>
        </div>
      ))}

      <div className="judgment">
        <div className="judgment-top">
          <span className="judgment-name">{t.jQuality}</span>
          <span className="judgment-val">
            {t.level} {semantic.explanation_quality.level} · {t.raw}{" "}
            {semantic.explanation_quality.score.toFixed(2)}
          </span>
        </div>
        <div className="pbar">
          <i style={{ width: `${(semantic.explanation_quality.level / 3) * 100}%` }} />
        </div>
        <div className="route-note">
          {t.confidence} {(semantic.explanation_quality.confidence * 100).toFixed(1)}%
          {semantic.explanation_quality.tie && ` · ${t.tieNote}`}
        </div>
      </div>
    </>
  );
}

function Summary(props: {
  jev: ProviderSnapshot;
  deepseek: ProviderSnapshot;
  total: number;
  mode: RunSnapshot["mode"];
  lang: Lang;
  scores: RunSnapshot["scores"];
  aborted: boolean;
}) {
  const { jev, deepseek, total, mode, lang, scores, aborted } = props;
  const t = STRINGS[lang];
  const jevScore = scores?.jev;
  const dsScore = scores?.deepseek;
  const rows: [string, string, string][] = [
    [t.mTotalTime, `${(jev.elapsed_ms / 1000).toFixed(1)} s`, `${(deepseek.elapsed_ms / 1000).toFixed(1)} s`],
    [t.mAvg, `${Math.round(jev.avg_latency_ms)} ms`, `${Math.round(deepseek.avg_latency_ms)} ms`],
    [t.mP50, `${Math.round(jev.p50_latency_ms)} ms`, `${Math.round(deepseek.p50_latency_ms)} ms`],
    [t.mP95, `${Math.round(jev.p95_latency_ms)} ms`, `${Math.round(deepseek.p95_latency_ms)} ms`],
    [t.mPerSec, jev.decisions_per_second.toFixed(2), deepseek.decisions_per_second.toFixed(2)],
    [t.mCost, `$${jev.total_cost.toFixed(4)}`, `$${deepseek.total_cost.toFixed(4)}`],
    [t.mSuccess, `${jev.succeeded}/${total}`, `${deepseek.succeeded}/${total}`],
    [t.mFailed, `${jev.failed}`, `${deepseek.failed}`],
  ];

  const fmtAcc = (s: ProviderAccuracy | undefined) =>
    s ? `${(s.accuracy * 100).toFixed(1)}%  (${s.correct}/${s.scored})` : "—";

  // Only claims that actually produced a result are scored; a stopped run
  // never counts the claims a provider had not reached.
  const fmtScope = (s: ProviderAccuracy | undefined) =>
    s ? `${s.scored}` : "—";

  return (
    <div className="final">
      <div className="panel-head" style={{ padding: "8px 12px" }}>
        <span>
          {aborted ? t.runStopped : t.runComplete}
          {mode === "demo" ? t.simulatedData : ""}
        </span>
        <span>
          {aborted
            ? t.processedOf(jev.processed, deepseek.processed, total)
            : t.perProvider(total)}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t.metric}</th>
            <th style={{ textAlign: "right" }}>Jev</th>
            <th style={{ textAlign: "right" }}>DeepSeek</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{a}</td>
              <td className="num">{b}</td>
            </tr>
          ))}
          {(jevScore || dsScore) && (
            <>
              <tr>
                <td>{t.mScoredCount}</td>
                <td className="num">{fmtScope(jevScore)}</td>
                <td className="num">{fmtScope(dsScore)}</td>
              </tr>
              <tr className="acc-row">
                <td>{t.mAccuracy}</td>
                <td className="num">{fmtAcc(jevScore)}</td>
                <td className="num">{fmtAcc(dsScore)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {mode !== "demo" && jevScore && dsScore && (
        <CaseBreakdown jev={jevScore} deepseek={dsScore} lang={lang} />
      )}
      <div style={{ padding: "9px 12px", fontSize: 11.5, color: "var(--muted)" }}>
        {mode === "demo" ? t.demoNoScore : t.accuracyNote}
      </div>
    </div>
  );
}

/** Per-claim comparison against gold. Shown only for real runs. */
function CaseBreakdown(props: {
  jev: ProviderAccuracy;
  deepseek: ProviderAccuracy;
  lang: Lang;
}) {
  const { jev, deepseek, lang } = props;
  const t = STRINGS[lang];
  const byCase = new Map<string, { expected: string; jev: string | null; ds: string | null }>();

  for (const row of jev.per_case) {
    byCase.set(row.case_id, { expected: row.expected, jev: row.predicted, ds: null });
  }
  for (const row of deepseek.per_case) {
    const entry = byCase.get(row.case_id);
    if (entry) entry.ds = row.predicted;
    else byCase.set(row.case_id, { expected: row.expected, jev: null, ds: row.predicted });
  }

  const cases = [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (cases.length === 0) return null;

  const cell = (value: string | null, expected: string) => {
    // Dash means this provider never produced a result for the claim.
    if (value === null) return <span className="null">—</span>;
    const ok = value === expected;
    return (
      <span className={ok ? "hit" : "miss"}>
        {ok ? "✓" : "✗"} {value}
        {lang === "zh" && <span className="gloss">{DECISION_ZH[value]}</span>}
      </span>
    );
  };

  return (
    <table className="breakdown">
      <thead>
        <tr>
          <th>{t.thCase}</th>
          <th>{t.thExpected}</th>
          <th>{t.thJev}</th>
          <th>{t.thDeepSeek}</th>
        </tr>
      </thead>
      <tbody>
        {cases.map(([caseId, row]) => (
          <tr key={caseId}>
            <td className="mono">{caseId}</td>
            <td>
              {row.expected}
              {lang === "zh" && <span className="gloss">{DECISION_ZH[row.expected]}</span>}
            </td>
            <td>{cell(row.jev, row.expected)}</td>
            <td>{cell(row.ds, row.expected)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
