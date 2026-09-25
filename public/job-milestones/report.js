/*
 * Job milestone report: the same rules as job_milestone_timeline.py, in the
 * browser. Pulls Shop Updates jobs completed in a date range from monday.com,
 * follows each job out to its linked boards and works out the milestone dates
 * and cycle times.
 *
 * Also loads under Node (module.exports) so the logic can be tested offline.
 */
(function (root) {
  "use strict";

  const API_URL = "/api/monday"; // the server adds the monday.com token
  const ITEM_URL = "https://panda-windows-and-doors.monday.com/boards/8203086442/pulses/";
  const SHOP_UPDATES_BOARD = "8203086442";
  const PANDA3_BOARD = "18418008068";
  const SHOP_DATE_COMPLETED = "date_mks3bbfa";
  const SHOP_CUSTOMER = "text_1__1";
  const SHOP_JOB_TYPE = "status_1_mkmq3t6v";
  const SHOP_TO_PM = "connect_boards_mkm1y5em";
  const SHOP_TO_PANDA3 = "board_relation_mm63vk5m";
  const PL_JOB_TO_FLOOR = "date4";

  const PM_LINKS = {
    opp: "connect_boards_mkm2w1vv",
    inv: "connect_boards_mkm29s9s",
    eng: "connect_boards_mkm242zk",
    ship: "board_relation_mknsyh5r",
  };
  const LINKED_BOARDS = { opp: "7469134152", inv: "7469134121", eng: "6032240337", ship: "8602455345" };

  const SHIP_DATE = "date_mknpqd1c";
  const DELIVERY_DATE = "date_mknp94pk";
  const SHIP_STATUS = "color_mknpsstj";

  const PANDA3 = {
    pull: "date_mm4c91rw",
    polish: "date_mm4c2yak",
    cut: "date_mm4cjfw6",
    inspection: "date_mm4cqrcx",
    prep: "date_mm4cfa4j",
    powder: "date_mm4ce57n",
    final: "date_mm4dbh1w",
    panda1: "date_mm4d2hj",
  };

  // Panda 3 - Scheduling stations, in shop order. Each Panda 3 item carries the
  // dates of the stations it has been through; "start"/"done" are column ids.
  const STATIONS = [
    { key: "pull", name: "Pull", start: "date_mm4dabjm", done: "date_mm4c91rw" },
    { key: "polish", name: "Polish", start: "date_mm4dw8k", done: "date_mm4c2yak" },
    { key: "vendor", name: "Finish vendor (sent to received)", start: "date_mm4etv6z", done: "date_mm4ecvmp", vendor: true },
    { key: "bending", name: "Bending", start: "date_mm4ejn65", done: "date_mm4e47e8" },
    { key: "cut", name: "Cut/CNC", start: "date_mm4d1kg1", done: "date_mm4cjfw6" },
    { key: "inspection", name: "Inspection", start: "date_mm4dm9tw", done: "date_mm4cqrcx" },
    { key: "prep", name: "Prep", start: "date_mm4d51qv", done: "date_mm4cfa4j" },
    { key: "powder", name: "Powder coat", start: "date_mm4d7fsx", done: "date_mm4ce57n" },
    { key: "final", name: "Final inspection", start: "date_mm4dpz91", done: "date_mm4dbh1w" },
    { key: "panda1", name: "Sent to Panda 1", start: null, done: "date_mm4d2hj" },
  ];

  // [milestone, source, key] in the order a job should move through them
  const MILESTONES = [
    ["Opportunity created", "opp", "created"],
    ["Qualified", "opp", "date3__1"],
    ["Deal won", "opp", "date_mkkams8m"],
    ["Deposit requested", "inv", "date_Mjj55tN8"],
    ["Deposit collected", "inv", "date_Mjj6dz0E"],
    ["Submitted to engineering", "eng", "date2__1"],
    ["First drawings sent", "eng_file", "first_drawings"],
    ["Final drawings sent", "eng_file", "final_drawings"],
    ["Shop drawings signed", "eng_file", "signed_drawings"],
    ["Change order requested", "inv", "date_mkkcfzsx"],
    ["Order date", "pm", "date7__1"],
    ["Assigned to engineer", "eng", "date_mkwx62gb"],
    ["Production docs (cutlist/BOM) uploaded", "eng_file", "production_docs"],
    ["Job to floor", "pm", "date__1"],
    ["Shipment 1 shipped", "shipment", [1, SHIP_DATE]],
    ["Pull complete", "panda3", "pull"],
    ["Polish complete", "panda3", "polish"],
    ["Cut/CNC complete", "panda3", "cut"],
    ["Inspection complete", "panda3", "inspection"],
    ["Prep complete", "panda3", "prep"],
    ["Powder coat complete", "panda3", "powder"],
    ["Shipment 1 delivered", "shipment", [1, DELIVERY_DATE]],
    ["Production completed", "pm", "date_mkxmrrgq"],
    ["Final inspection complete", "panda3", "final"],
    ["Received at Panda 1", "panda3", "panda1"],
    ["Shipment 2 shipped", "shipment", [2, SHIP_DATE]],
    ["Final invoice requested", "inv", "date_mkv1e755"],
    ["Final invoice collected", "inv", "expected_collection_date"],
  ];
  const ORDER_EXEMPT = new Set(["Change order requested"]);

  // [measure, start milestone, end milestone]; "Completed" = Shop Updates Date Completed
  const DURATIONS = [
    ["Total days (opportunity to completed)", "Opportunity created", "Completed"],
    ["Deal won to deposit requested", "Deal won", "Deposit requested"],
    ["Deal won to deposit collected", "Deal won", "Deposit collected"],
    ["Engineering received to first drawings sent", "Submitted to engineering", "First drawings sent"],
    ["First drawings sent to signed (incl. revisions)", "First drawings sent", "Shop drawings signed"],
    ["Customer time to sign", "Final drawings sent", "Shop drawings signed"],
    ["Days in engineering", "Assigned to engineer", "Production docs (cutlist/BOM) uploaded"],
    ["Shop drawings signed to production docs", "Shop drawings signed", "Production docs (cutlist/BOM) uploaded"],
    ["Days in production", "Job to floor", "Completed"],
  ];

  const JOB_TYPES = ["Panda", "Private Label"]; // Service is left out
  const ENGINEERING_MILESTONES = [
    "Submitted to engineering", "First drawings sent", "Final drawings sent",
    "Assigned to engineer", "Production docs (cutlist/BOM) uploaded",
  ];
  const NO_ENGINEERING = "Panda - no engineering dates";
  const GROUPS = ["Panda", NO_ENGINEERING, "Private Label"];

  const SIGNED_DRAWING_RE = /sign|_R\d+S[._ -]|_S\d?(?=[._ -])|_R\d+.*_X\.pdf$/i;
  const NOT_DRAWING_RE = /backer|sales order|proposal|QQ ?#|docusign|signature/i;
  const PRODUCTION_DOC_RE = /CUT ?LIST|B\.?O\.?M\b|\bOPT\b|Cut optimisation/i;
  const DRAWING_RE = /^Q\d{5}.*\.pdf$|shop drawing report/i;
  const NOT_SENT_DRAWING_RE = /W-DLO|KYNAR|ANODI|FINAL-Model|REDO|GLASS|MAT LIST/i;

  // ---------------------------------------------------------------- monday

  function quoted(ids) {
    return ids.map((i) => `"${i}"`).join(", ");
  }

  function itemFields() {
    const stationCols = STATIONS.flatMap((s) => [s.start, s.done]).filter(Boolean);
    const inner = [...new Set(["date7__1", "date__1", "date_mkxmrrgq", PL_JOB_TO_FLOOR,
      ...Object.values(PM_LINKS), ...Object.values(PANDA3), ...stationCols])];
    const leaf = MILESTONES
      .filter(([, source, key]) => ["opp", "inv", "eng"].includes(source) && key !== "created")
      .map(([, , key]) => key)
      .concat([SHIP_DATE, DELIVERY_DATE, SHIP_STATUS]);
    return `id name
      column_values(ids: [${quoted([SHOP_TO_PM, SHOP_TO_PANDA3, SHOP_CUSTOMER, SHOP_DATE_COMPLETED, SHOP_JOB_TYPE])}]) {
        id text
        ... on BoardRelationValue {
          linked_items {
            id name created_at board { id }
            column_values(ids: [${quoted(inner)}]) {
              id text
              ... on BoardRelationValue {
                linked_items {
                  id name created_at board { id }
                  column_values(ids: [${quoted(leaf)}]) { id text }
                  assets { name created_at }
                }
              }
            }
          }
        }
      }`;
  }

  async function mondayQuery(query, variables, fetchImpl) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    const response = await doFetch(API_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    if (response.status === 401) {
      const err = new Error("Please sign in again.");
      err.signIn = true;
      throw err;
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).error || ""; } catch (e) { /* not JSON */ }
      throw new Error(detail || `The server returned ${response.status}`);
    }
    const data = await response.json();
    if (data.errors && data.errors.length) {
      throw new Error(data.errors.map((e) => e.message).join("; "));
    }
    return data.data;
  }

  /**
   * Jobs completed between from and to (YYYY-MM-DD) as stored by the nightly
   * n8n sync: { jobs: [jobRow()...], syncedAt }. No monday.com calls.
   */
  async function fetchStoredJobs(from, to, fetchImpl) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const response = await doFetch(`/api/jobs?${qs}`, { credentials: "same-origin" });
    if (response.status === 401) {
      const err = new Error("Please sign in again.");
      err.signIn = true;
      throw err;
    }
    let data = null;
    try { data = await response.json(); } catch (e) { /* not JSON */ }
    if (!response.ok) throw new Error((data && data.error) || `The server returned ${response.status}`);
    return { jobs: (data && data.jobs) || [], syncedAt: (data && data.syncedAt) || null };
  }

  /** All Shop Updates items with Date Completed between from and to (YYYY-MM-DD). */
  async function fetchJobs(from, to, onProgress, fetchImpl) {
    const pageSize = 50;
    const fields = itemFields();
    const first = await mondayQuery(`
      query ($board: ID!, $from: String!, $to: String!) {
        boards(ids: [$board]) {
          items_page(limit: ${pageSize}, query_params: {rules: [
            {column_id: "${SHOP_DATE_COMPLETED}", compare_value: [$from, $to], operator: between}]}) {
            cursor items { ${fields} }
          }
        }
      }`, { board: SHOP_UPDATES_BOARD, from, to }, fetchImpl);
    let page = first.boards[0].items_page;
    const items = page.items.slice();
    if (onProgress) onProgress(items.length);
    while (page.cursor) {
      const next = await mondayQuery(`
        query ($cursor: String!) {
          next_items_page(limit: ${pageSize}, cursor: $cursor) { cursor items { ${fields} } }
        }`, { cursor: page.cursor }, fetchImpl);
      page = next.next_items_page;
      items.push(...page.items);
      if (onProgress) onProgress(items.length);
    }
    return items;
  }

  /**
   * Every Panda 3 - Scheduling item with its station dates. Only a minority of
   * jobs are linked to these from Shop Updates, so they are matched to jobs by
   * job number instead (see jobRow).
   */
  async function fetchPanda3(onProgress, fetchImpl) {
    const cols = quoted([...new Set(STATIONS.flatMap((s) => [s.start, s.done]).filter(Boolean))]);
    const fields = `id name created_at column_values(ids: [${cols}]) { id text }`;
    const first = await mondayQuery(`
      query ($board: ID!) { boards(ids: [$board]) { items_page(limit: 500) { cursor items { ${fields} } } } }`,
      { board: PANDA3_BOARD }, fetchImpl);
    let page = first.boards[0].items_page;
    const items = page.items.slice();
    if (onProgress) onProgress(items.length);
    while (page.cursor) {
      const next = await mondayQuery(`
        query ($cursor: String!) { next_items_page(limit: 500, cursor: $cursor) { cursor items { ${fields} } } }`,
        { cursor: page.cursor }, fetchImpl);
      page = next.next_items_page;
      items.push(...page.items);
      if (onProgress) onProgress(items.length);
    }
    return items;
  }

  /** Job number a name starts with ("91599 / 3087" -> "91599"); null for others. */
  function jobNumber(name) {
    const match = /^\s*S?(\d{5,})/.exec(name || "");
    return match ? match[1] : null;
  }

  // Service records ("89367-S", "87636S1") are not production passes for the job
  const SERVICE_NAME_RE = /^\s*\d{5,}[\s-]*S\d*\b|^\s*S\d{5,}/i;

  function indexPanda3(items) {
    const index = new Map();
    for (const item of items || []) {
      const number = jobNumber(item.name);
      if (!number || SERVICE_NAME_RE.test(item.name)) continue;
      if (!index.has(number)) index.set(number, []);
      index.get(number).push(item);
    }
    return index;
  }

  // --------------------------------------------------------------- milestones

  function ymd(text) {
    const match = /\d{4}-\d{2}-\d{2}/.exec(text || "");
    return match ? match[0] : null;
  }

  function columns(item) {
    const map = {};
    for (const cv of (item && item.column_values) || []) map[cv.id] = cv;
    return map;
  }

  function colText(cols, id) {
    return (cols[id] && cols[id].text) || "";
  }

  function linkedItems(cols, id) {
    return (cols[id] && cols[id].linked_items) || [];
  }

  function byCreated(a, b) {
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  }

  function jobRow(shop, panda3Index) {
    const cols = columns(shop);
    const pm = linkedItems(cols, SHOP_TO_PM)[0] || {};
    const pmCols = columns(pm);
    const completed = ymd(colText(cols, SHOP_DATE_COMPLETED));
    const floor = ymd(colText(pmCols, "date__1")) || ymd(colText(pmCols, PL_JOB_TO_FLOOR));

    const linked = {};
    const single = {};
    for (const [key, column] of Object.entries(PM_LINKS)) {
      linked[key] = linkedItems(pmCols, column).filter((i) => i.board && i.board.id === LINKED_BOARDS[key]);
      single[key] = linked[key][0] || null;
    }

    const shipments = linked.ship.slice().sort((a, b) => {
      const da = ymd(colText(columns(a), SHIP_DATE)) || "9999";
      const db = ymd(colText(columns(b), SHIP_DATE)) || "9999";
      return da < db ? -1 : da > db ? 1 : byCreated(a, b);
    });

    // Panda 3 passes: linked items plus same-number items dated within this job's
    // time on the floor (so an older job with the same number isn't mixed in)
    const passes = linkedItems(cols, SHOP_TO_PANDA3).slice();
    const seenPass = new Set(passes.map((p) => p.id));
    const lo = floor ? dayNumber(floor) - 14 : null;
    const hi = completed ? dayNumber(completed) + 30 : null;
    for (const p of (panda3Index && panda3Index.get(jobNumber(shop.name))) || []) {
      if (seenPass.has(p.id)) continue;
      const dates = STATIONS.map((st) => ymd(colText(columns(p), st.done))).filter(Boolean).map(dayNumber);
      if (!dates.length) continue;
      if ((lo !== null && Math.max(...dates) < lo) || (hi !== null && Math.min(...dates) > hi)) continue;
      seenPass.add(p.id);
      passes.push(p);
    }

    const engFiles = ((single.eng && single.eng.assets) || []).slice().sort(byCreated);
    const oppFiles = ((single.opp && single.opp.assets) || []).slice();
    const files = {};
    for (const f of engFiles) {
      if (PRODUCTION_DOC_RE.test(f.name) && !files.production_docs) {
        files.production_docs = [f.created_at.slice(0, 10), f.name];
      }
    }

    // Drawing sets sent out, first upload of each file name
    const sent = [];
    const seen = new Set();
    for (const f of engFiles) {
      const name = f.name;
      if (DRAWING_RE.test(name) && !seen.has(name.toLowerCase()) && !SIGNED_DRAWING_RE.test(name)
          && !NOT_SENT_DRAWING_RE.test(name) && !PRODUCTION_DOC_RE.test(name)) {
        seen.add(name.toLowerCase());
        sent.push([f.created_at.slice(0, 10), name]);
      }
    }
    // Signed set: first signed drawing file on or after the first set was sent
    // (earlier "signed" files are sales paperwork)
    const earliest = sent.length ? sent[0][0] : "";
    for (const f of engFiles.concat(oppFiles).sort(byCreated)) {
      const when = f.created_at.slice(0, 10);
      if (when >= earliest && SIGNED_DRAWING_RE.test(f.name)
          && !NOT_DRAWING_RE.test(f.name) && !PRODUCTION_DOC_RE.test(f.name)) {
        files.signed_drawings = [when, f.name];
        break;
      }
    }
    if (sent.length) {
      files.first_drawings = sent[0];
      const signed = files.signed_drawings ? files.signed_drawings[0] : null;
      const before = sent.filter((s) => signed && s[0] <= signed);
      if (before.length) {
        const revisions = before.length - 1;
        const last = before[before.length - 1];
        files.final_drawings = [last[0],
          `${last[1]} (${revisions} revision${revisions === 1 ? "" : "s"} after first set)`];
      }
    }

    const milestones = {};
    for (const [milestone, source, key] of MILESTONES) {
      let when = null;
      let note = "";
      if (source === "pm") {
        when = ymd(colText(pmCols, key));
        if (!when && key === "date__1") when = ymd(colText(pmCols, PL_JOB_TO_FLOOR)); // private label log
      } else if (source === "opp" || source === "inv" || source === "eng") {
        const item = single[source];
        if (item) when = key === "created" ? item.created_at.slice(0, 10) : ymd(colText(columns(item), key));
      } else if (source === "eng_file") {
        if (files[key]) [when, note] = files[key];
      } else if (source === "shipment") {
        const [n, column] = key;
        if (shipments.length >= n) {
          const shipCols = columns(shipments[n - 1]);
          when = ymd(colText(shipCols, column));
          note = colText(shipCols, SHIP_STATUS);
        }
      } else if (source === "panda3") {
        const dates = [...new Set(passes.map((p) => ymd(colText(columns(p), PANDA3[key]))).filter(Boolean))].sort();
        if (dates.length) {
          when = dates[dates.length - 1];
          if (dates.length > 1) note = `${dates.length} passes: ${dates.join(", ")}`;
        }
      }
      milestones[milestone] = [when, note];
    }

    return {
      id: shop.id,
      url: ITEM_URL + shop.id,
      job: shop.name,
      type: colText(cols, SHOP_JOB_TYPE),
      customer: colText(cols, SHOP_CUSTOMER),
      completed,
      milestones,
      outOfOrder: outOfOrder(milestones),
      stations: stationBreakdown(passes, milestones["Job to floor"][0]),
    };
  }

  /**
   * Days at each Panda 3 station. "days" runs from the previous station's
   * completion (Job to floor for the first) to this station's completion, so it
   * includes waiting time; "handsOn" is start to completion where a start date
   * was recorded. For the finish vendor, days = sent to received.
   */
  function stationBreakdown(passes, jobToFloor) {
    const rows = [];
    let prevDone = jobToFloor || null;
    let prevName = "Job to floor";
    for (const station of STATIONS) {
      let best = null;
      const doneDates = new Set();
      for (const p of passes) {
        const pc = columns(p);
        const done = ymd(colText(pc, station.done));
        if (!done) continue;
        doneDates.add(done);
        const start = station.start ? ymd(colText(pc, station.start)) : null;
        if (!best || done > best.done) best = { done, start: start && start <= done ? start : null };
      }
      if (!best) continue;
      const days = station.vendor
        ? (best.start ? dayNumber(best.done) - dayNumber(best.start) : null)
        : (prevDone ? dayNumber(best.done) - dayNumber(prevDone) : null);
      rows.push({
        key: station.key,
        name: station.name,
        start: best.start,
        done: best.done,
        days,
        from: station.vendor ? "Sent to vendor" : prevName,
        handsOn: !station.vendor && best.start ? dayNumber(best.done) - dayNumber(best.start) : null,
        passes: doneDates.size,
      });
      prevDone = best.done;
      prevName = station.name;
    }
    return rows;
  }

  function outOfOrder(milestones) {
    const flagged = [];
    let latest = null;
    let latestName = null;
    for (const [milestone] of MILESTONES) {
      const when = milestones[milestone][0];
      if (!when || ORDER_EXEMPT.has(milestone)) continue;
      if (latest && when < latest) flagged.push({ milestone, when, before: latestName, beforeDate: latest });
      else { latest = when; latestName = milestone; }
    }
    return flagged;
  }

  function reportGroup(job) {
    if (job.type === "Panda" && !ENGINEERING_MILESTONES.some((m) => job.milestones[m][0])) return NO_ENGINEERING;
    return job.type;
  }

  function dayNumber(iso) {
    return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  }

  function durations(job) {
    const when = (m) => (m === "Completed" ? job.completed : job.milestones[m][0]);
    return DURATIONS.map(([, start, end]) => {
      const a = when(start);
      const b = when(end);
      return a && b ? dayNumber(b) - dayNumber(a) : null;
    });
  }

  function stats(values) {
    const xs = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
    if (!xs.length) return { jobs: 0, average: null, median: null, min: null, max: null };
    const mid = Math.floor(xs.length / 2);
    return {
      jobs: xs.length,
      average: xs.reduce((s, v) => s + v, 0) / xs.length,
      median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2,
      min: xs[0],
      max: xs[xs.length - 1],
    };
  }

  /** Everything the page shows, from the raw monday items. */
  function buildReport(items, panda3Items) {
    const index = indexPanda3(panda3Items);
    return buildReportFromJobs(items.map((item) => jobRow(item, index)));
  }

  /** Everything the page shows, from jobRow() results (as stored by the n8n sync). */
  function buildReportFromJobs(jobs) {
    const all = jobs.map((j) => ({ ...j }));
    const rows = all.filter((j) => JOB_TYPES.includes(j.type))
      .sort((a, b) => ((a.completed || "9999") + a.job < (b.completed || "9999") + b.job ? -1 : 1));
    const skipped = all.filter((j) => !JOB_TYPES.includes(j.type));
    for (const job of rows) {
      job.group = reportGroup(job);
      job.durations = durations(job);
    }
    const groups = GROUPS.map((g) => [g, rows.filter((j) => j.group === g)]).filter(([, jobs]) => jobs.length);
    const months = [...new Set(rows.map((j) => (j.completed || "").slice(0, 7)).filter(Boolean))].sort();

    const summary = [];
    DURATIONS.forEach(([name, start, end], i) => {
      for (const [group, jobs] of groups) {
        if (!jobs.some((j) => j.durations[i] !== null)) continue;
        const byMonth = {};
        for (const m of months) byMonth[m] = stats(jobs.filter((j) => (j.completed || "").startsWith(m)).map((j) => j.durations[i]));
        summary.push({ measure: name, start, end, group, byMonth, all: stats(jobs.map((j) => j.durations[i])) });
      }
    });

    const stationSummary = [];
    for (const station of STATIONS) {
      for (const [group, jobs] of groups) {
        const value = (j) => {
          const row = j.stations.find((r) => r.key === station.key);
          return row ? row.days : null;
        };
        if (!jobs.some((j) => value(j) !== null)) continue;
        const byMonth = {};
        for (const m of months) byMonth[m] = stats(jobs.filter((j) => (j.completed || "").startsWith(m)).map(value));
        stationSummary.push({ key: station.key, measure: station.name, group, byMonth, all: stats(jobs.map(value)) });
      }
    }

    return { rows, skipped, groups, months, summary, stationSummary, notes: buildNotes(groups) };
  }

  function buildNotes(groups) {
    const notes = ["The median is the better typical figure; a few jobs pull the averages around, listed below."];
    DURATIONS.forEach(([name, start, end], i) => {
      for (const [group, jobs] of groups) {
        const values = jobs.filter((j) => j.durations[i] !== null).map((j) => [j.durations[i], j.job])
          .sort((a, b) => a[0] - b[0]);
        const negative = values.filter(([d]) => d < 0).map(([d, job]) => `${job} (${d})`);
        if (negative.length) {
          let listed = negative.slice(0, 5).join(", ");
          if (negative.length > 5) listed += ` and ${negative.length - 5} more`;
          notes.push(`${name} (${group}): negative on ${negative.length} of ${values.length} jobs - ${end} is dated before ${start}; worst: ${listed}.`);
        }
        if (values.length >= 5) {
          const top = values.slice(-3).reverse().map(([d, job]) => `${job} (${d})`).join(", ");
          notes.push(`${name} (${group}): longest were ${top}.`);
        }
      }
    });
    for (const [group, jobs] of groups) {
      if (group === NO_ENGINEERING) {
        notes.push(`${NO_ENGINEERING}: ${jobs.map((j) => j.job).join(", ")}. These have no Engineering Log dates or drawing uploads, usually because the dealer supplied the drawings or the Engineering Log item is missing.`);
      }
      if (!jobs.some((j) => j.durations[0] !== null)) {
        notes.push(`${group} jobs only have Job to Floor on their production log, so only days in production can be measured for them.`);
      }
    }
    return notes;
  }

  const api = {
    MILESTONES, DURATIONS, STATIONS, GROUPS, NO_ENGINEERING, ORDER_EXEMPT,
    fetchStoredJobs, fetchJobs, fetchPanda3, itemFields, indexPanda3, jobRow, durations, stats,
    buildReport, buildReportFromJobs, reportGroup,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MilestoneReport = api;
})(typeof window !== "undefined" ? window : globalThis);
