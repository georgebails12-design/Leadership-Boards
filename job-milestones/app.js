/* Page wiring for the job milestone report. Logic lives in report.js. */
(function () {
  "use strict";

  const R = window.MilestoneReport;
  const TOKEN_KEY = "mondayApiToken";
  const $ = (id) => document.getElementById(id);
  let report = null;
  let range = null;

  // ------------------------------------------------------------ date range

  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

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

  // ----------------------------------------------------------------- token

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function loadSavedToken() {
    const store = storage();
    const saved = store && store.getItem(TOKEN_KEY);
    if (saved) { $("token").value = saved; $("remember").checked = true; }
  }

  function saveToken() {
    const store = storage();
    if (!store) return;
    try {
      if ($("remember").checked) store.setItem(TOKEN_KEY, $("token").value.trim());
      else store.removeItem(TOKEN_KEY);
    } catch (e) { /* storage blocked: nothing to do */ }
  }

  // ---------------------------------------------------------------- format

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = (m) => `${monthNames[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const shortDate = (d) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(2, 4)}` : "");
  const num = (v, digits) => (v === null || v === undefined ? "" : Number(v).toFixed(digits));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = kind || "";
  }

  // ---------------------------------------------------------------- render

  function renderSummary() {
    const { rows, skipped, groups, months, summary, notes } = report;
    const counts = groups.map(([g, jobs]) => `${jobs.length} ${g}`).join(", ");
    const noEng = groups.find(([g]) => g === R.NO_ENGINEERING);
    const panda = groups.filter(([g]) => g === "Panda" || g === R.NO_ENGINEERING)
      .reduce((n, [, jobs]) => n + jobs.length, 0);

    let html = `<div class="card">
      <h2>Summary <span class="range">${esc(shortDate(range.from))} – ${esc(shortDate(range.to))}</span></h2>
      <p class="meta">${esc(counts)} jobs (${rows.length} total)${skipped.length ? `; ${skipped.length} service jobs left out` : ""}.
        "Completed" is the Shop Updates Date Completed. Figures are in days.</p>
      ${noEng ? `<p class="warn">${noEng[1].length} of ${panda} Panda jobs have no engineering dates and are shown separately as
        "${esc(R.NO_ENGINEERING)}", so they are not in the Panda averages.</p>` : ""}
      <div class="table-wrap"><table class="summary">
        <thead><tr><th rowspan="2" class="sticky">Measure</th><th rowspan="2">Job type</th>
          ${months.map((m) => `<th colspan="3" class="month">${monthLabel(m)}</th>`).join("")}
          <th colspan="5" class="month all">All</th></tr>
        <tr>${months.map(() => "<th>Jobs</th><th>Avg</th><th>Median</th>").join("")}
          <th>Jobs</th><th>Avg</th><th>Median</th><th>Min</th><th>Max</th></tr></thead><tbody>`;
    for (const row of summary) {
      html += `<tr><th class="sticky" scope="row" title="${esc(row.start)} → ${esc(row.end)}">${esc(row.measure)}</th>
        <td class="group">${esc(row.group)}</td>`;
      for (const m of months) {
        const s = row.byMonth[m];
        html += `<td class="n">${s.jobs || ""}</td><td class="avg">${num(s.average, 1)}</td><td>${num(s.median, 1)}</td>`;
      }
      const a = row.all;
      html += `<td class="n">${a.jobs}</td><td class="avg">${num(a.average, 1)}</td><td>${num(a.median, 1)}</td>
        <td>${num(a.min, 0)}</td><td>${num(a.max, 0)}</td></tr>`;
    }
    html += `</tbody></table></div></div>
      <div class="card"><h2>Notes</h2><ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
    $("summary").innerHTML = html;
  }

  function renderMilestones() {
    const names = R.MILESTONES.map(([m]) => m);
    let html = `<div class="card"><h2>Milestones</h2>
      <p class="meta">Red dates are earlier than a milestone to their left. Change order requested is not checked.
        Hover a date with a dotted underline for the source file or Panda 3 passes.</p>
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="sticky">Job</th><th>Customer</th><th>Completed</th>
        ${names.map((m) => `<th>${esc(m)}</th>`).join("")}</tr></thead><tbody>`;
    for (const [group, jobs] of report.groups) {
      html += `<tr class="section"><th class="sticky" colspan="${names.length + 3}">${esc(group)} jobs (${jobs.length})</th></tr>`;
      for (const job of jobs) {
        const late = new Set(job.outOfOrder.map((o) => o.milestone));
        html += `<tr><th class="sticky" scope="row">${esc(job.job)}</th><td class="customer">${esc(job.customer)}</td>
          <td>${shortDate(job.completed)}</td>`;
        for (const m of names) {
          const [when, note] = job.milestones[m];
          const flag = job.outOfOrder.find((o) => o.milestone === m);
          const title = [note, flag ? `Earlier than ${flag.before} (${flag.beforeDate})` : ""].filter(Boolean).join(" — ");
          const cls = [late.has(m) ? "late" : "", R.ORDER_EXEMPT.has(m) ? "exempt" : "", note ? "has-note" : ""]
            .filter(Boolean).join(" ");
          html += `<td class="${cls}"${title ? ` title="${esc(title)}"` : ""}>${shortDate(when)}</td>`;
        }
        html += "</tr>";
      }
    }
    $("milestones").innerHTML = html + "</tbody></table></div></div>";
  }

  function renderCycle() {
    let html = `<div class="card"><h2>Cycle times (days)</h2>
      <p class="meta">Negative values mean the dates were entered out of order.</p>
      <div class="table-wrap"><table class="grid"><thead><tr>
        <th class="sticky">Job</th><th>Customer</th><th>Completed</th>
        ${R.DURATIONS.map(([name, start, end]) => `<th title="${esc(start)} → ${esc(end)}">${esc(name)}</th>`).join("")}
      </tr></thead><tbody>`;
    for (const [group, jobs] of report.groups) {
      html += `<tr class="section"><th class="sticky" colspan="${R.DURATIONS.length + 3}">${esc(group)} jobs (${jobs.length})</th></tr>`;
      for (const job of jobs) {
        html += `<tr><th class="sticky" scope="row">${esc(job.job)}</th><td class="customer">${esc(job.customer)}</td>
          <td>${shortDate(job.completed)}</td>
          ${job.durations.map((d) => `<td class="n${d !== null && d < 0 ? " late" : ""}">${d === null ? "" : d}</td>`).join("")}</tr>`;
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
    if (!window.XLSX) { setStatus("The Excel library didn't load; check the internet connection.", "error"); return; }
    const X = window.XLSX;
    const { months, summary, notes, groups } = report;

    const sum = [[`Job milestone report ${range.from} to ${range.to}`], [],
      ["Measure", "From", "To", "Job type",
        ...months.flatMap((m) => [`${monthLabel(m)} jobs`, `${monthLabel(m)} avg`, `${monthLabel(m)} median`]),
        "All jobs", "All avg", "All median", "Min", "Max"]];
    for (const row of summary) {
      const r = (v, d) => (v === null ? null : +v.toFixed(d));
      sum.push([row.measure, row.start, row.end, row.group,
        ...months.flatMap((m) => [row.byMonth[m].jobs || null, r(row.byMonth[m].average, 1), r(row.byMonth[m].median, 1)]),
        row.all.jobs, r(row.all.average, 1), r(row.all.median, 1), row.all.min, row.all.max]);
    }
    sum.push([], ["Notes"], ...notes.map((n) => [n]));

    const names = R.MILESTONES.map(([m]) => m);
    const ms = [["Job type", "Job", "Customer", "Completed", ...names, "Out-of-order milestones"]];
    const cyc = [["Job type", "Job", "Customer", "Completed", ...R.DURATIONS.map(([n]) => n)]];
    for (const [group, jobs] of groups) {
      for (const job of jobs) {
        ms.push([group, job.job, job.customer, toDate(job.completed), ...names.map((m) => toDate(job.milestones[m][0])),
          job.outOfOrder.map((o) => `${o.milestone} (${o.when}) before ${o.before} (${o.beforeDate})`).join("; ")]);
        cyc.push([group, job.job, job.customer, toDate(job.completed), ...job.durations]);
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
    X.writeFile(wb, `Job_Milestones_${range.from}_to_${range.to}.xlsx`);
  }

  // ------------------------------------------------------------------ load

  async function load() {
    const token = $("token").value.trim();
    const from = $("from").value;
    const to = $("to").value;
    if (!token) { setStatus("Paste your monday.com API token first.", "error"); $("token").focus(); return; }
    if (!from || !to || from > to) { setStatus("Pick a From date on or before the To date.", "error"); return; }
    saveToken();
    $("load").disabled = true;
    $("download").disabled = true;
    setStatus("Loading jobs from monday.com…");
    try {
      const items = await R.fetchJobs(token, from, to, (n) => setStatus(`Loading jobs from monday.com… ${n} so far`));
      report = R.buildReport(items);
      range = { from, to };
      renderSummary();
      renderMilestones();
      renderCycle();
      $("tabs").hidden = false;
      showTab("summary");
      $("download").disabled = !report.rows.length;
      setStatus(`Loaded ${report.rows.length} jobs (${items.length} including service) at ${new Date().toLocaleTimeString()}.`, "ok");
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setStatus(/Failed to fetch|NetworkError/i.test(msg)
        ? "Couldn't reach monday.com. Check the internet connection and the token." : `Error: ${msg}`, "error");
    } finally {
      $("load").disabled = false;
    }
  }

  // ------------------------------------------------------------------ init

  setPreset("ytd");
  loadSavedToken();
  for (const btn of document.querySelectorAll("[data-preset]")) btn.addEventListener("click", () => setPreset(btn.dataset.preset));
  for (const btn of document.querySelectorAll("[data-tab]")) btn.addEventListener("click", () => showTab(btn.dataset.tab));
  $("remember").addEventListener("change", saveToken);
  $("load").addEventListener("click", load);
  $("download").addEventListener("click", downloadExcel);
  $("token").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
})();
