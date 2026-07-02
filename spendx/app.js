/* ==========================================================================
   app.js
   --------------------------------------------------------------------------
   Application entry point. Wires together: file import -> parser ->
   categorizer -> analytics -> predictionEngine -> charts/ui.

   Also owns persistence: the last imported dataset is cached in
   localStorage (as raw normalized transactions) so a page refresh doesn't
   lose the user's data. Nothing here ever leaves the browser.
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "fha_transactions_v1";

  const { parser, categorizer, analytics, predictionEngine, charts, ui, sampleData } = window.FHA;

  /* ------------------------------------------------------------------ */
  /* PIPELINE                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Runs the full analysis pipeline on a normalized (but not yet
   * categorized) transaction array, then paints every view.
   */
  function runPipeline(transactions) {
    categorizer.categorizeTransactions(transactions);

    const kpis = analytics.computeKpis(transactions);
    if (!kpis) {
      ui.showImportStatus("The file was read but no valid transactions could be extracted.", "error");
      return;
    }

    const categoryBreakdown = analytics.computeCategoryBreakdown(transactions);
    const monthlySeries = analytics.computeMonthlySeries(transactions);
    const monthlyCategorySeries = analytics.computeMonthlyCategorySeries(transactions);
    const dailySeries = analytics.computeDailySeries(transactions);
    const weekdaySpending = analytics.computeWeekdaySpending(transactions);
    const dayOfMonthSpending = analytics.computeDayOfMonthSpending(transactions);

    const insights = analytics.generateInsights(
      transactions, kpis, categoryBreakdown, monthlySeries,
      weekdaySpending, dayOfMonthSpending, monthlyCategorySeries
    );

    const healthScore = analytics.computeHealthScore(kpis, categoryBreakdown, monthlySeries);

    const predictions = predictionEngine.runPredictions(
      monthlySeries, monthlyCategorySeries, categoryBreakdown, kpis
    );

    // Upgrade 3: smart miscellaneous analysis (descriptive only — never
    // reclassifies any transaction).
    const miscReport = analytics.analyzeMiscellaneous(transactions, kpis);

    // Upgrade 4: recipient intelligence — who money is sent to most,
    // by amount and by frequency.
    const recipientReport = analytics.analyzeRecipients(transactions);

    // Upgrade 5: transfer charge & hidden cost analysis (round-up
    // detection + confirmed Bank Charges category aggregation).
    const hiddenCostReport = analytics.analyzeHiddenCosts(transactions, kpis);

    // Upgrade 2E: financial coach advice, reusing the analytics above.
    const coachAdvice = analytics.generateCoachAdvice(kpis, categoryBreakdown, monthlyCategorySeries, hiddenCostReport);

    // Cache the render payload globally so the dark-mode toggle can
    // re-render charts without recomputing analytics.
    window.FHA._lastRenderData = {
      categoryBreakdown,
      monthlySeries,
      dailySeries,
      projectionSeries: predictions.projectionSeries,
    };

    ui.showEmptyState(false);
    ui.renderKpiCards(kpis);
    ui.renderInsights(insights);
    ui.renderHealthScore(healthScore);
    ui.renderPredictions(predictions);
    ui.renderTransactionsTable(transactions);
    ui.renderMiscAnalysis(miscReport);
    ui.renderRecipients(recipientReport);
    ui.renderHiddenCosts(hiddenCostReport);
    ui.renderCoachAdvice(coachAdvice);
    charts.renderAll(window.FHA._lastRenderData);

    persistTransactions(transactions);
  }

  /* ------------------------------------------------------------------ */
  /* PERSISTENCE (localStorage)                                        */
  /* ------------------------------------------------------------------ */

  function persistTransactions(transactions) {
    try {
      // Store dates as ISO strings; everything else is already primitive.
      const serializable = transactions.map((t) => ({
        ...t,
        date: t.dateStr, // re-derive Date on load
        raw: undefined, // drop raw row to keep storage lean
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (err) {
      // Storage quota or privacy-mode failure — non-fatal, app still works
      // in-memory for this session.
      console.warn("Could not persist transactions to localStorage:", err);
    }
  }

  function loadPersistedTransactions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.map((t) => ({
        ...t,
        date: new Date(t.dateStr + "T00:00:00"),
      }));
    } catch (err) {
      console.warn("Could not load persisted transactions:", err);
      return null;
    }
  }

  function clearPersistedTransactions() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /* ------------------------------------------------------------------ */
  /* FILE IMPORT HANDLERS                                               */
  /* ------------------------------------------------------------------ */

  async function handleFileSelected(file) {
    if (!file) return;
    ui.showImportStatus(`Reading "${file.name}"…`, "ok");
    try {
      const transactions = await parser.parseFile(file);
      const debug = parser.getLastParseDebug();
      const skipNote = debug && debug.skippedRows > 0
        ? ` (auto-detected header at row ${debug.headerRowIndex + 1}, skipped ${debug.skippedRows} metadata row${debug.skippedRows === 1 ? "" : "s"})`
        : "";
      const sheetsNote = debug && debug.sheetsImported && debug.sheetsImported.length > 1
        ? ` Combined from ${debug.sheetsImported.length} sheets: ${debug.sheetsImported.map((s) => `${s.name} (${s.count})`).join(", ")}.`
        : "";
      ui.showImportStatus(
        `Imported ${transactions.length} transactions from "${file.name}".${skipNote}${sheetsNote}`,
        "ok"
      );
      ui.renderParserDebug(debug);
      runPipeline(transactions);
    } catch (err) {
      console.error(err);
      ui.showImportStatus(
        `Could not import "${file.name}": ${err.message || "unknown error."}`,
        "error"
      );
      ui.renderParserDebug(parser.getLastParseDebug());
    }
  }

  async function handleLoadSample() {
    ui.showImportStatus("Loading sample OPay statement…", "ok");
    try {
      const transactions = await parser.parseCsvString(sampleData.csv);
      ui.showImportStatus(`Loaded ${transactions.length} sample transactions.`, "ok");
      ui.renderParserDebug(parser.getLastParseDebug());
      runPipeline(transactions);
    } catch (err) {
      console.error(err);
      ui.showImportStatus("Could not load sample data.", "error");
    }
  }

  function wireFileInputs() {
    const inputs = [document.getElementById("fileInput"), document.getElementById("fileInput2")];
    inputs.forEach((input) => {
      if (!input) return;
      input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        handleFileSelected(file);
        e.target.value = ""; // allow re-selecting the same file later
      });
    });

    const sampleButtons = [document.getElementById("loadSampleBtn"), document.getElementById("loadSampleBtn2")];
    sampleButtons.forEach((btn) => btn && btn.addEventListener("click", handleLoadSample));

    document.getElementById("clearDataBtn").addEventListener("click", () => {
      if (!confirm("This will erase the imported statement from this device. Continue?")) return;
      clearPersistedTransactions();
      charts.destroyAll();
      window.FHA._lastRenderData = null;
      ui.showEmptyState(true);
      ui.showImportStatus("Stored data cleared.", "ok");
    });
  }

  /* ------------------------------------------------------------------ */
  /* BOOTSTRAP                                                          */
  /* ------------------------------------------------------------------ */

  function init() {
    ui.initNavigation();
    ui.initMobileSidebar();
    ui.initDarkMode();
    ui.renderLedgerTape();
    wireFileInputs();

    // Upgrade 2: standalone return-usage tools are independent of the
    // statement-import pipeline, so they initialize unconditionally.
    if (window.FHA.standaloneTools) {
      window.FHA.standaloneTools.initAll();
    }

    // The app no longer auto-imports a previously stored statement on
    // page load — always start at the empty state. If a prior session's
    // data exists in localStorage, surface a one-click "Restore" option
    // instead of silently loading it, so the person explicitly chooses
    // when their data gets analyzed.
    ui.showEmptyState(true);

    const persisted = loadPersistedTransactions();
    if (persisted && persisted.length) {
      ui.showRestorePrompt(persisted.length, () => {
        ui.showImportStatus(`Restored ${persisted.length} transactions from your last session.`, "ok");
        runPipeline(persisted);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
