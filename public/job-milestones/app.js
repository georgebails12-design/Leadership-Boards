/* Page wiring for the job milestone report. Logic lives in report.js. */
(function () {
  "use strict";

  const R = window.MilestoneReport;
  const $ = (id) => document.getElementById(id);
  let report = null;
  let range = null;
  let jobsById = new Map();

  // ---------------------------------------------------------------- format

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = (m) => `${monthNames[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const shortDate = (d) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(2, 4)}` : "");
  const num = (v, digits) => (v === null || v === undefined ? "" : Number(v).toFixed(digits));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = kind || "";
  }

  const jobLink = (job) => `<button type="button" class="joblink" data-job="${esc(job.id)}">${esc(job.job)}</button>`;

  // --------------------------------------------------------------- sign in

  async function checkSession() {
    try {
      const res = await fetch("/api/session", { credentials: "same-origin" });
      const data = await res.json();
      showSignedIn(!!data.signedIn);
    } catch (e) {
      showSignedIn(false);
      $("signin-status").textContent = "Can't reach the report server.";
    }
  }

  function showSignedIn(signedIn) {
    $("signin").hidden = signedIn;
    $("app").hidden = !signedIn;
    $("signout").hidden = !signedIn;
    if (!signedIn) setTimeout(() => $("password").focus(), 0);
  }

  async function signIn(event) {
    event.preventDefault();
    const status = $("signin-status");
    status.textContent = "Signing in…";
    status.className = "";
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("password").value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sign in failed.");
      $("password").value = "";
      status.textContent = "";
      showSignedIn(true);
      if (!report) load();
    } catch (err) {
      status.textContent = err.message;
      status.className = "error";
    }
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    showSignedIn(false);
  }

  // ------------------------------------------------------------ date range

  function setPreset(name) {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    let from = new Date(y, 0, 1);
    let to = today;
    if (name === "last3") from = new Date(y, m - 2, 1);
    if (name === "thismonth") from = new Date(y, m, 1);
    if (name === "lastmonth") { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
    $("from").value = iso(from);
    $("to").value = iso(to);
  }

  // ---------------------------------------------------------------- summary

  function statsTable(rows, kind, firstHeader) {
    const { months } = report;
    let html = `<div class="table-wrap"><table class="summary"><thead>
      <tr><th rowspan="2" class="sticky">${esc(firstHeader)}</th><th rowspan="2">Job type</th>
        ${months.map((m) => `<th colspan="3" class="month">${monthLabel(m)}</th>`).join("")}
        <th colspan="5" class="month all">All</th></tr>
      <tr>${months.map(() => "<th>Jobs</th><th>Avg</th><th>Median</th>").join("")}
        <th>Jobs</th><th>Avg</th><th>Median</th><th>Min</th><th>Max</th></tr></thead><tbody>`;
    rows.forEach((row, i) => {
      const tip = row.start ? `${row.start} → ${row.end}` : "Days from the previous station's completion to this one's";
      html += `<tr class="clickable" data-kind="${kind}" data-index="${i}" title="Click for the jobs behind this row">
        <th class="sticky" scope="row" title="${esc(tip)}">${esc(row.measure)}</th><td class="group">${esc(row.group)}</td>`;
      for (const m of months) {
        const s = row.byMonth[m];
        html += `<td class="n cell" data-month="${m}">${s.jobs || ""}</td><td class="avg cell" data-month="${m}">${num(s.average, 1)}</td>
          <td class="cell" data-month="${m}">${num(s.median, 1)}</td>`;
      }
      const a = row.all;
      html += `<td class="n">${a.jobs}</td><td class="avg">${num(a.average, 1)}</td><td>${num(a.median, 1)}</td>
        <td>${num(a.min, 0)}</td><td>${num(a.max, 0)}</td></tr>`;
    });
    return html + "</tbody></table></div>";
  }

  function renderSummary() {
    const { rows, skipped, groups, summary, stationSummary, notes } = report;
    const counts = groups.map(([g, jobs]) => `${jobs.length} ${g}`).join(", ");
    const noEng = groups.find(([g]) => g === R.NO_ENGINEERING);
    const panda = groups.filter(([g]) => g === "Panda" || g === R.NO_ENGINEERING)
      .reduce((n, [, jobs]) => n + jobs.length, 0);

    $("summary").innerHTML = `<div class="card">
        <h2>Summary <span class="range">${esc(shortDate(range.from))} – ${esc(shortDate(range.to))}</span></h2>
        <p class="meta">${esc(counts)} jobs (${rows.length} total)${skipped.length ? `; ${skipped.length} service jobs left out` : ""}.
          "Completed" is the Shop Updates Date Completed. Figures are in days. <b>Click a row, or a month's numbers,
          to see the jobs behind it; click a job for its full breakdown.</b></p>
        ${noEng ? `<p class="warn">${noEng[1].length} of ${panda} Panda jobs have no engineering dates and are shown separately as
          "${esc(R.NO_ENGINEERING)}", so they are not in the Panda averages.</p>` : ""}
        ${statsTable(summary, "measure", "Measure")}
        <div id="breakdown-measure" class="breakdown" hidden></div>
      </div>
      <div class="card">
        <h2>Days at each station</h2>
        <p class="meta">From the Panda 3 - Scheduling board: days from the previous station's completion (or Job to floor)
          to this station's completion, so waiting time is included. Finish vendor is sent to received.</p>
        ${statsTable(stationSummary, "station", "Station")}
        <div id="breakdown-station" class="breakdown" hidden></div>
      </div>
      <div class="card"><h2>Notes</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
  }

  function showBreakdown(kind, index, month) {
    const row = (kind === "measure" ? report.summary : report.stationSummary)[index];
    const jobs = report.groups.find(([g]) => g === row.group)[1]
      .filter((j) => !month || (j.completed || "").startsWith(month));
    const target = $(`breakdown-${kind}`);
    let items;
    let head;
    if (kind === "measure") {
      const i = R.DURATIONS.findIndex(([name]) => name === row.measure);
      const when = (j, m) => (m === "Completed" ? j.completed : j.milestones[m][0]);
      items = jobs.filter((j) => j.durations[i] !== null).map((j) => ({ j, value: j.durations[i],
        cells: [shortDate(when(j, row.start)), shortDate(when(j, row.end))] }));
      head = [row.start, row.end];
    } else {
      items = jobs.map((j) => ({ j, s: j.stations.find((s) => s.key === row.key) }))
        .filter((x) => x.s && x.s.days !== null)
        .map(({ j, s }) => ({ j, value: s.days,
          cells: [shortDate(s.start), shortDate(s.done), s.handsOn === null ? "" : s.handsOn, s.passes > 1 ? s.passes : ""] }));
      head = ["Started", "Completed", "Hands-on days", "Passes"];
    }
    items.sort((a, b) => b.value - a.value);
    const s = R.stats(items.map((x) => x.value));
    target.innerHTML = `<div class="breakdown-head">
        <h3>${esc(row.measure)} · ${esc(row.group)}${month ? ` · ${monthLabel(month)}` : ""}</h3>
        <span class="meta">${s.jobs} jobs · average ${num(s.average, 1)} · median ${num(s.median, 1)} days</span>
        <button type="button" class="link" data-close="${kind}">Hide ✕</button>
      </div>
      <div class="table-wrap short"><table class="grid"><thead><tr><th class="sticky">Job</th><th>Customer</th><th>Completed</th>
        ${head.map((h) => `<th>${esc(h)}</th>`).join("")}<th>Days</th></tr></thead><tbody>
        ${items.map((x) => `<tr><th class="sticky" scope="row">${jobLink(x.j)}</th><td class="customer">${esc(x.j.customer)}</td>
          <td>${shortDate(x.j.completed)}</td>${x.cells.map((c) => `<td>${esc(c)}</td>`).join("")}
          <td class="n strong${x.value < 0 ? " late" : ""}">${x.value}</td></tr>`).join("")}
      </tbody></table></div>`;
    target.hidden = false;
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------- job detail

  function showJob(id) {
    const job = jobsById.get(id);
    if (!job) return;
    $("job-title").innerHTML = `${esc(job.job)} <span class="range">${esc(job.customer)} · ${esc(job.group)}</span>`;

    const cycle = R.DURATIONS.map(([name, start, end], i) => ({ name, start, end, value: job.durations[i] }))
      .filter((d) => d.value !== null);
    const maxDays = Math.max(1, ...job.stations.map((s) => Math.abs(s.days || 0)));
    const late = new Map(job.outOfOrder.map((o) => [o.milestone, o]));
    let prev = null;

    $("job-body").innerHTML = `
      <p class="meta">Completed ${shortDate(job.completed) || "—"} ·
        <a href="${esc(job.url)}" target="_blank" rel="noopener">Open in monday.com ↗</a></p>

      <h3>Days at each station</h3>
      ${job.stations.length ? `<table class="grid stations"><thead><tr><th>Station</th><th>Started</th><th>Completed</th>
          <th>Days</th><th class="bar-col"></th><th>Hands-on</th><th>Passes</th></tr></thead><tbody>
        ${job.stations.map((s) => `<tr><th scope="row" title="Days counted from: ${esc(s.from)}">${esc(s.name)}</th>
          <td>${shortDate(s.start)}</td><td>${shortDate(s.done)}</td>
          <td class="n strong${s.days !== null && s.days < 0 ? " late" : ""}">${s.days === null ? "" : s.days}</td>
          <td class="bar-col"><span class="bar${s.days < 0 ? " neg" : ""}" style="width:${Math.round(Math.abs(s.days || 0) / maxDays * 100)}%"></span></td>
          <td class="n">${s.handsOn === null ? "" : s.handsOn}</td><td class="n">${s.passes > 1 ? s.passes : ""}</td></tr>`).join("")}
        </tbody></table>
        <p class="meta small">Days = from the previous station's completion (Job to floor for Pull) to this one's, including waiting.
          Hands-on = the station's own start to completion, where a start date was recorded.</p>`
        : `<p class="meta">No Panda 3 station records found for this job.</p>`}

      <h3>Cycle times</h3>
      ${cycle.length ? `<table class="grid"><tbody>${cycle.map((d) => `<tr><th scope="row">${esc(d.name)}</th>
          <td class="meta">${esc(d.start)} → ${esc(d.end)}</td><td class="n strong${d.value < 0 ? " late" : ""}">${d.value}</td></tr>`).join("")}
        </tbody></table>` : `<p class="meta">No cycle times for this job.</p>`}

      <h3>Timeline</h3>
      <table class="grid timeline"><thead><tr><th>Milestone</th><th>Date</th><th>Days since previous</th><th>Notes</th></tr></thead><tbody>
        ${R.MILESTONES.map(([m]) => {
          const [when, note] = job.milestones[m];
          if (!when) return `<tr class="empty"><th scope="row">${esc(m)}</th><td></td><td></td><td></td></tr>`;
          const gap = prev ? dayNum(when) - dayNum(prev) : "";
          if (!R.ORDER_EXEMPT.has(m)) prev = when;
          const flag = late.get(m);
          return `<tr><th scope="row">${esc(m)}</th><td class="${flag ? "late" : ""}">${shortDate(when)}</td>
            <td class="n">${gap}</td><td class="note">${esc([note, flag ? `Earlier than ${flag.before} (${shortDate(flag.beforeDate)})` : ""].filter(Boolean).join(" — "))}</td></tr>`;
        }).join("")}
      </tbody></table>`;
    const dialog = $("job-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  }

  // ------------------------------------------------------ milestones & cycle

  function renderMilestones() {
    const names = R.MILESTONES.map(([m]) => m);
    let html = `<div class="card"><h2>Milestones</h2>
      <p class="meta">Red dates are earlier than a milestone to their left. Change order requested is not checked.
        Hover a date with a dotted underline for the source file or Panda 3 passes. Click a job for its breakdown.</p>
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="sticky">Job</th><th>Customer</th><th>Completed</th>
        ${names.map((m) => `<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>`;
    for (const [group, jobs] of report.groups) {
      html += `<tr class="section"><th class="sticky" colspan="${names.length + 3}">${esc(group)} jobs (${jobs.length})</th></tr>`;
      for (const job of jobs) {
        html += `<tr><th class="sticky" scope="row">${jobLink(job)}</th><td class="customer">${esc(job.customer)}</td>
          <td>${shortDate(job.completed)}</td>`;
        for (const m of names) {
          const [when, note] = job.milestones[m];
          const flag = job.outOfOrder.find((o) => o.milestone === m);
          const title = [note, flag ? `Earlier than ${flag.before} (${flag.beforeDate})` : ""].filter(Boolean).join(" — ");
          const cls = [flag ? "late" : "", R.ORDER_EXEMPT.has(m) ? "exempt" : "", note ? "has-note" : ""].filter(Boolean).join(" ");
          html += `<td class="${cls}"${title ? ` title="${esc(title)}"` : ""}>${shortDate(when)}</td>`;
        }
        html += "</tr>";
      }
    }
    $("milestones").innerHTML = html + "</tbody></table></div></div>";
  }

  function renderCycle() {
    const stationNames = R.STATIONS.map((s) => s.name);
    let html = `<div class="card"><h2>Cycle times (days)</h2>
      <p class="meta">Negative values mean the dates were entered out of order. Click a job for its breakdown.</p>
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="sticky">Job</th><th>Customer</th><th>Completed</th>
        ${R.DURATIONS.map(([name, start, end]) => `<th title="${esc(start)} → ${esc(end)}">${esc(name)}</th>`).join("")}
        ${stationNames.map((n) => `<th class="station-col">${esc(n)}</th>`).join("")}
      </tr></thead><tbody>`;
    for (const [group, jobs] of report.groups) {
      html += `<tr class="section"><th class="sticky" colspan="${R.DURATIONS.length + stationNames.length + 3}">${esc(group)} jobs (${jobs.length})</th></tr>`;
      for (const job of jobs) {
        html += `<tr><th class="sticky" scope="row">${jobLink(job)}</th><td class="customer">${esc(job.customer)}</td>
          <td>${shortDate(job.completed)}</td>
          ${job.durations.map((d) => `<td class="n${d !== null && d < 0 ? " late" : ""}">${d === null ? "" : d}</td>`).join("")}
          ${R.STATIONS.map((st) => { const s = job.stations.find((x) => x.key === st.key); const d = s ? s.days : null;
            return `<td class="n station-col${d !== null && d < 0 ? " late" : ""}">${d === null ? "" : d}</td>`; }).join("")}</tr>`;
      }
    }
    $("cycle").innerHTML = html + "</tbody></table></div></div>";
  }

  function showTab(name) {
    for (const btn of document.querySelectorAll("[data-tab]")) {
      const on = btn.dataset.tab === name;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      $(btn.dataset.tab).hidden = !on;
    }
  }

  // ----------------------------------------------------------------- excel

  function toDate(d) {
    return d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))) : null;
  }

  function downloadExcel() {
    if (!window.XLSX) { setStatus("The Excel library didn't load; refresh the page.", "error"); return; }
    const X = window.XLSX;
    const { months, summary, stationSummary, notes, groups } = report;
    const r = (v, d) => (v === null ? null : +v.toFixed(d));
    const statRow = (row) => [row.measure, row.start || "", row.end || "", row.group,
      ...months.flatMap((m) => [row.byMonth[m].jobs || null, r(row.byMonth[m].average, 1), r(row.byMonth[m].median, 1)]),
      row.all.jobs, r(row.all.average, 1), r(row.all.median, 1), row.all.min, row.all.max];
    const header = (first) => [first, "From", "To", "Job type",
      ...months.flatMap((m) => [`${monthLabel(m)} jobs`, `${monthLabel(m)} avg`, `${monthLabel(m)} median`]),
      "All jobs", "All avg", "All median", "Min", "Max"];

    const sum = [[`Job milestone report ${range.from} to ${range.to}`], [], header("Measure"),
      ...summary.map(statRow), [], ["Days at each station"], header("Station"),
      ...stationSummary.map(statRow), [], ["Notes"], ...notes.map((n) => [n])];

    const names = R.MILESTONES.map(([m]) => m);
    const ms = [["Job type", "Job", "Customer", "Completed", ...names, "Out-of-order milestones"]];
    const cyc = [["Job type", "Job", "Customer", "Completed", ...R.DURATIONS.map(([n]) => n)]];
    const st = [["Job type", "Job", "Customer", "Completed", "Station", "Started", "Completed at station", "Days", "Hands-on days", "Passes"]];
    for (const [group, jobs] of groups) {
      for (const job of jobs) {
        ms.push([group, job.job, job.customer, toDate(job.completed), ...names.map((m) => toDate(job.milestones[m][0])),
          job.outOfOrder.map((o) => `${o.milestone} (${o.when}) before ${o.before} (${o.beforeDate})`).join("; ")]);
        cyc.push([group, job.job, job.customer, toDate(job.completed), ...job.durations]);
        for (const s of job.stations) {
          st.push([group, job.job, job.customer, toDate(job.completed), s.name, toDate(s.start), toDate(s.done),
            s.days, s.handsOn, s.passes]);
        }
      }
    }

    const wb = X.utils.book_new();
    const sheet = (aoa, widths) => {
      const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "mm/dd/yy" });
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      return ws;
    };
    X.utils.book_append_sheet(wb, sheet(sum, [42, 24, 24, 26]), "Summary");
    X.utils.book_append_sheet(wb, sheet(ms, [14, 16, 26, 10, ...names.map(() => 11), 60]), "Milestones");
    X.utils.book_append_sheet(wb, sheet(cyc, [14, 16, 26, 10, ...R.DURATIONS.map(() => 14)]), "Cycle Times");
    X.utils.book_append_sheet(wb, sheet(st, [14, 16, 26, 10, 30, 11, 11, 8, 12, 8]), "Stations");
    X.writeFile(wb, `Job_Milestones_${range.from}_to_${range.to}.xlsx`);
  }

  // ------------------------------------------------------------------ load

  async function load() {
    const from = $("from").value;
    const to = $("to").value;
    if (!from || !to || from > to) { setStatus("Pick a From date on or before the To date.", "error"); return; }
    $("load").disabled = true;
    $("download").disabled = true;
    setStatus("Loading from monday.com…");
    try {
      let jobCount = 0;
      let stationCount = 0;
      const progress = () => setStatus(`Loading from monday.com… ${jobCount} jobs, ${stationCount} station records`);
      const [items, panda3] = await Promise.all([
        R.fetchJobs(from, to, (n) => { jobCount = n; progress(); }),
        R.fetchPanda3((n) => { stationCount = n; progress(); }),
      ]);
      report = R.buildReport(items, panda3);
      range = { from, to };
      jobsById = new Map(report.rows.map((j) => [j.id, j]));
      renderSummary();
      renderMilestones();
      renderCycle();
      $("tabs").hidden = false;
      showTab("summary");
      $("download").disabled = !report.rows.length;
      setStatus(`Loaded ${report.rows.length} jobs (${items.length} including service) at ${new Date().toLocaleTimeString()}.`, "ok");
    } catch (err) {
      if (err && err.signIn) { showSignedIn(false); setStatus(""); return; }
      const msg = err && err.message ? err.message : String(err);
      setStatus(/Failed to fetch|NetworkError/i.test(msg) ? "Couldn't reach the report server." : `Error: ${msg}`, "error");
    } finally {
      $("load").disabled = false;
    }
  }

  // ------------------------------------------------------------------ init

  setPreset("ytd");
  for (const btn of document.querySelectorAll("[data-preset]")) btn.addEventListener("click", () => setPreset(btn.dataset.preset));
  for (const btn of document.querySelectorAll("[data-tab]")) btn.addEventListener("click", () => showTab(btn.dataset.tab));
  $("signin-form").addEventListener("submit", signIn);
  $("signout").addEventListener("click", signOut);
  $("load").addEventListener("click", load);
  $("download").addEventListener("click", downloadExcel);
  $("job-close").addEventListener("click", () => $("job-dialog").close());
  $("job-dialog").addEventListener("click", (e) => { if (e.target === $("job-dialog")) $("job-dialog").close(); });

  document.addEventListener("click", (e) => {
    const job = e.target.closest(".joblink");
    if (job) { showJob(job.dataset.job); return; }
    const close = e.target.closest("[data-close]");
    if (close) { $(`breakdown-${close.dataset.close}`).hidden = true; return; }
    const row = e.target.closest("tr.clickable");
    if (row) {
      const cell = e.target.closest("td.cell");
      showBreakdown(row.dataset.kind, +row.dataset.index, cell ? cell.dataset.month : "");
    }
  });

  checkSession().then(() => { if (!$("app").hidden) load(); });
})();
