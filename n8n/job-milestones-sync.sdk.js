import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const mondayHeaders = { parameters: [{ name: 'API-Version', value: '2025-04' }] };

const manualBackfill = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Backfill 2026', position: [0, 0] },
  output: [{}]
});

const nightly = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Every Night',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 0, triggerAtMinute: 5 }] } },
    position: [0, 224]
  },
  output: [{}]
});

const backfillRange = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Range: All of 2026',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [
        { id: 'from', name: 'from', value: '2026-01-01', type: 'string' },
        { id: 'to', name: 'to', value: expr('{{ $today.toFormat("yyyy-MM-dd") }}'), type: 'string' }
      ] }
    },
    position: [224, 0]
  },
  output: [{ from: '2026-01-01', to: '2026-09-25' }]
});

const nightlyRange = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Range: Last 45 Days',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [
        { id: 'from', name: 'from', value: expr('{{ $today.minus(45, "days").toFormat("yyyy-MM-dd") }}'), type: 'string' },
        { id: 'to', name: 'to', value: expr('{{ $today.toFormat("yyyy-MM-dd") }}'), type: 'string' }
      ] }
    },
    position: [224, 224]
  },
  output: [{ from: '2026-08-11', to: '2026-09-25' }]
});

const listJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'List Completed Jobs',
    parameters: {
      method: 'POST',
      url: 'https://api.monday.com/v2',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'mondayComApi',
      sendHeaders: true,
      headerParameters: mondayHeaders,
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ query: 'query { boards(ids: [8203086442]) { items_page(limit: 500, query_params: {rules: [{column_id: \"date_mks3bbfa\", compare_value: [\"' + $json.from + '\", \"' + $json.to + '\"], operator: between}]}) { cursor items { id } } } }' }) }}",
      options: {
        timeout: 120000,
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'body', name: 'query', value: "={{ 'query { next_items_page(limit: 500, cursor: \"' + ($response.body.data.next_items_page || $response.body.data.boards[0].items_page).cursor + '\") { cursor items { id } } }' }}" }] },
          paginationCompleteWhen: 'other',
          completeExpression: "={{ !!$response.body.errors || !($response.body.data.next_items_page || $response.body.data.boards[0].items_page).cursor }}",
          limitPagesFetched: true,
          maxRequests: 20,
          requestInterval: 500
        } }
      }
    },
    credentials: { mondayComApi: {"id":"Rix71SkfIwsKApN2","name":"Monday.com account"} },
    position: [448, 112]
  },
  output: [{ data: { boards: [{ items_page: { cursor: null, items: [{ id: '123' }] } }] } }]
});

const batchIds = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Batch Job IDs',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Collect the completed job ids from every page and split them into batches of 25\nconst ids = [];\nfor (const page of $input.all()) {\n  const body = page.json;\n  if (body.errors) throw new Error('monday.com: ' + body.errors.map((e) => e.message).join('; '));\n  const data = body.data || {};\n  const items = (data.next_items_page || (data.boards && data.boards[0] && data.boards[0].items_page) || {}).items || [];\n  for (const item of items) if (!ids.includes(item.id)) ids.push(item.id);\n}\nconst fields = \"id name column_values(ids: [\\\"connect_boards_mkm1y5em\\\", \\\"board_relation_mm63vk5m\\\", \\\"text_1__1\\\", \\\"date_mks3bbfa\\\", \\\"status_1_mkmq3t6v\\\"]) { id text ... on BoardRelationValue { linked_items { id name created_at board { id } column_values(ids: [\\\"date7__1\\\", \\\"date__1\\\", \\\"date_mkxmrrgq\\\", \\\"date4\\\", \\\"connect_boards_mkm2w1vv\\\", \\\"connect_boards_mkm29s9s\\\", \\\"connect_boards_mkm242zk\\\", \\\"board_relation_mknsyh5r\\\", \\\"date_mm4c91rw\\\", \\\"date_mm4c2yak\\\", \\\"date_mm4cjfw6\\\", \\\"date_mm4cqrcx\\\", \\\"date_mm4cfa4j\\\", \\\"date_mm4ce57n\\\", \\\"date_mm4dbh1w\\\", \\\"date_mm4d2hj\\\", \\\"date_mm4dabjm\\\", \\\"date_mm4dw8k\\\", \\\"date_mm4etv6z\\\", \\\"date_mm4ecvmp\\\", \\\"date_mm4ejn65\\\", \\\"date_mm4e47e8\\\", \\\"date_mm4d1kg1\\\", \\\"date_mm4dm9tw\\\", \\\"date_mm4d51qv\\\", \\\"date_mm4d7fsx\\\", \\\"date_mm4dpz91\\\"]) { id text ... on BoardRelationValue { linked_items { id name created_at board { id } column_values(ids: [\\\"date3__1\\\", \\\"date_mkkams8m\\\", \\\"date_Mjj55tN8\\\", \\\"date_Mjj6dz0E\\\", \\\"date2__1\\\", \\\"date_mkkcfzsx\\\", \\\"date_mkwx62gb\\\", \\\"date_mkv1e755\\\", \\\"expected_collection_date\\\", \\\"date_mknpqd1c\\\", \\\"date_mknp94pk\\\", \\\"color_mknpsstj\\\"]) { id text } assets { name created_at } } } } } } }\";\nconst batches = [];\nfor (let i = 0; i < ids.length; i += 25) {\n  const chunk = ids.slice(i, i + 25);\n  batches.push({ json: { count: chunk.length, query: 'query { items(ids: [' + chunk.join(', ') + '], limit: 25) { ' + fields + ' } }' } });\n}\nreturn batches;\n" },
    position: [672, 112]
  },
  output: [{ count: 1, query: 'query { items(ids: [123], limit: 25) { id name } }' }]
});

const fetchDetails = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Job Details',
    parameters: {
      method: 'POST',
      url: 'https://api.monday.com/v2',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'mondayComApi',
      sendHeaders: true,
      headerParameters: mondayHeaders,
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ query: $json.query }) }}',
      options: {
        timeout: 120000,
        batching: { batch: { batchSize: 1, batchInterval: 500 } }
      }
    },
    credentials: { mondayComApi: {"id":"Rix71SkfIwsKApN2","name":"Monday.com account"} },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    position: [896, 112]
  },
  output: [{ data: { items: [{ id: '123', name: '91599', column_values: [] }] } }]
});

const fetchPanda3 = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Panda 3 Stations',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: 'https://api.monday.com/v2',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'mondayComApi',
      sendHeaders: true,
      headerParameters: mondayHeaders,
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "{\"query\":\"query { boards(ids: [18418008068]) { items_page(limit: 500) { cursor items { id name created_at column_values(ids: [\\\"date_mm4dabjm\\\", \\\"date_mm4c91rw\\\", \\\"date_mm4dw8k\\\", \\\"date_mm4c2yak\\\", \\\"date_mm4etv6z\\\", \\\"date_mm4ecvmp\\\", \\\"date_mm4ejn65\\\", \\\"date_mm4e47e8\\\", \\\"date_mm4d1kg1\\\", \\\"date_mm4cjfw6\\\", \\\"date_mm4dm9tw\\\", \\\"date_mm4cqrcx\\\", \\\"date_mm4d51qv\\\", \\\"date_mm4cfa4j\\\", \\\"date_mm4d7fsx\\\", \\\"date_mm4ce57n\\\", \\\"date_mm4dpz91\\\", \\\"date_mm4dbh1w\\\", \\\"date_mm4d2hj\\\"]) { id text } } } } }\"}",
      options: {
        timeout: 120000,
        pagination: { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'body', name: 'query', value: "={{ 'query { next_items_page(limit: 500, cursor: \"' + ($response.body.data.next_items_page || $response.body.data.boards[0].items_page).cursor + '\") { cursor items { id name created_at column_values(ids: [\"date_mm4dabjm\", \"date_mm4c91rw\", \"date_mm4dw8k\", \"date_mm4c2yak\", \"date_mm4etv6z\", \"date_mm4ecvmp\", \"date_mm4ejn65\", \"date_mm4e47e8\", \"date_mm4d1kg1\", \"date_mm4cjfw6\", \"date_mm4dm9tw\", \"date_mm4cqrcx\", \"date_mm4d51qv\", \"date_mm4cfa4j\", \"date_mm4d7fsx\", \"date_mm4ce57n\", \"date_mm4dpz91\", \"date_mm4dbh1w\", \"date_mm4d2hj\"]) { id text } } } }' }}" }] },
          paginationCompleteWhen: 'other',
          completeExpression: "={{ !!$response.body.errors || !($response.body.data.next_items_page || $response.body.data.boards[0].items_page).cursor }}",
          limitPagesFetched: true,
          maxRequests: 40,
          requestInterval: 500
        } }
      }
    },
    credentials: { mondayComApi: {"id":"Rix71SkfIwsKApN2","name":"Monday.com account"} },
    position: [1120, 112]
  },
  output: [{ data: { boards: [{ items_page: { cursor: null, items: [{ id: '1', name: '91599', created_at: '2026-01-01T00:00:00Z', column_values: [] }] } }] } }]
});

const buildRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Job Rows',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Same rules as public/job-milestones/report.js in the Leadership-Boards repo\n// (generated by n8n/build-workflows.js; edit report.js, not this node).\nconst lib = {};\n(function (root) {\n\"use strict\";\nconst API_URL = \"/api/monday\"; // the server adds the monday.com token\nconst ITEM_URL = \"https://panda-windows-and-doors.monday.com/boards/8203086442/pulses/\";\nconst SHOP_UPDATES_BOARD = \"8203086442\";\nconst PANDA3_BOARD = \"18418008068\";\nconst SHOP_DATE_COMPLETED = \"date_mks3bbfa\";\nconst SHOP_CUSTOMER = \"text_1__1\";\nconst SHOP_JOB_TYPE = \"status_1_mkmq3t6v\";\nconst SHOP_TO_PM = \"connect_boards_mkm1y5em\";\nconst SHOP_TO_PANDA3 = \"board_relation_mm63vk5m\";\nconst PL_JOB_TO_FLOOR = \"date4\";\nconst PM_LINKS = {\nopp: \"connect_boards_mkm2w1vv\",\ninv: \"connect_boards_mkm29s9s\",\neng: \"connect_boards_mkm242zk\",\nship: \"board_relation_mknsyh5r\",\n};\nconst LINKED_BOARDS = { opp: \"7469134152\", inv: \"7469134121\", eng: \"6032240337\", ship: \"8602455345\" };\nconst SHIP_DATE = \"date_mknpqd1c\";\nconst DELIVERY_DATE = \"date_mknp94pk\";\nconst SHIP_STATUS = \"color_mknpsstj\";\nconst PANDA3 = {\npull: \"date_mm4c91rw\",\npolish: \"date_mm4c2yak\",\ncut: \"date_mm4cjfw6\",\ninspection: \"date_mm4cqrcx\",\nprep: \"date_mm4cfa4j\",\npowder: \"date_mm4ce57n\",\nfinal: \"date_mm4dbh1w\",\npanda1: \"date_mm4d2hj\",\n};\nconst STATIONS = [\n{ key: \"pull\", name: \"Pull\", start: \"date_mm4dabjm\", done: \"date_mm4c91rw\" },\n{ key: \"polish\", name: \"Polish\", start: \"date_mm4dw8k\", done: \"date_mm4c2yak\" },\n{ key: \"vendor\", name: \"Finish vendor (sent to received)\", start: \"date_mm4etv6z\", done: \"date_mm4ecvmp\", vendor: true },\n{ key: \"bending\", name: \"Bending\", start: \"date_mm4ejn65\", done: \"date_mm4e47e8\" },\n{ key: \"cut\", name: \"Cut/CNC\", start: \"date_mm4d1kg1\", done: \"date_mm4cjfw6\" },\n{ key: \"inspection\", name: \"Inspection\", start: \"date_mm4dm9tw\", done: \"date_mm4cqrcx\" },\n{ key: \"prep\", name: \"Prep\", start: \"date_mm4d51qv\", done: \"date_mm4cfa4j\" },\n{ key: \"powder\", name: \"Powder coat\", start: \"date_mm4d7fsx\", done: \"date_mm4ce57n\" },\n{ key: \"final\", name: \"Final inspection\", start: \"date_mm4dpz91\", done: \"date_mm4dbh1w\" },\n{ key: \"panda1\", name: \"Sent to Panda 1\", start: null, done: \"date_mm4d2hj\" },\n];\nconst MILESTONES = [\n[\"Opportunity created\", \"opp\", \"created\"],\n[\"Qualified\", \"opp\", \"date3__1\"],\n[\"Deal won\", \"opp\", \"date_mkkams8m\"],\n[\"Deposit requested\", \"inv\", \"date_Mjj55tN8\"],\n[\"Deposit collected\", \"inv\", \"date_Mjj6dz0E\"],\n[\"Submitted to engineering\", \"eng\", \"date2__1\"],\n[\"First drawings sent\", \"eng_file\", \"first_drawings\"],\n[\"Final drawings sent\", \"eng_file\", \"final_drawings\"],\n[\"Shop drawings signed\", \"eng_file\", \"signed_drawings\"],\n[\"Change order requested\", \"inv\", \"date_mkkcfzsx\"],\n[\"Order date\", \"pm\", \"date7__1\"],\n[\"Assigned to engineer\", \"eng\", \"date_mkwx62gb\"],\n[\"Production docs (cutlist/BOM) uploaded\", \"eng_file\", \"production_docs\"],\n[\"Job to floor\", \"pm\", \"date__1\"],\n[\"Shipment 1 shipped\", \"shipment\", [1, SHIP_DATE]],\n[\"Pull complete\", \"panda3\", \"pull\"],\n[\"Polish complete\", \"panda3\", \"polish\"],\n[\"Cut/CNC complete\", \"panda3\", \"cut\"],\n[\"Inspection complete\", \"panda3\", \"inspection\"],\n[\"Prep complete\", \"panda3\", \"prep\"],\n[\"Powder coat complete\", \"panda3\", \"powder\"],\n[\"Shipment 1 delivered\", \"shipment\", [1, DELIVERY_DATE]],\n[\"Production completed\", \"pm\", \"date_mkxmrrgq\"],\n[\"Final inspection complete\", \"panda3\", \"final\"],\n[\"Received at Panda 1\", \"panda3\", \"panda1\"],\n[\"Shipment 2 shipped\", \"shipment\", [2, SHIP_DATE]],\n[\"Final invoice requested\", \"inv\", \"date_mkv1e755\"],\n[\"Final invoice collected\", \"inv\", \"expected_collection_date\"],\n];\nconst ORDER_EXEMPT = new Set([\"Change order requested\"]);\nconst DURATIONS = [\n[\"Total days (opportunity to completed)\", \"Opportunity created\", \"Completed\"],\n[\"Deal won to deposit requested\", \"Deal won\", \"Deposit requested\"],\n[\"Deal won to deposit collected\", \"Deal won\", \"Deposit collected\"],\n[\"Engineering received to first drawings sent\", \"Submitted to engineering\", \"First drawings sent\"],\n[\"First drawings sent to signed (incl. revisions)\", \"First drawings sent\", \"Shop drawings signed\"],\n[\"Customer time to sign\", \"Final drawings sent\", \"Shop drawings signed\"],\n[\"Days in engineering\", \"Assigned to engineer\", \"Production docs (cutlist/BOM) uploaded\"],\n[\"Shop drawings signed to production docs\", \"Shop drawings signed\", \"Production docs (cutlist/BOM) uploaded\"],\n[\"Days in production\", \"Job to floor\", \"Completed\"],\n];\nconst JOB_TYPES = [\"Panda\", \"Private Label\"]; // Service is left out\nconst ENGINEERING_MILESTONES = [\n\"Submitted to engineering\", \"First drawings sent\", \"Final drawings sent\",\n\"Assigned to engineer\", \"Production docs (cutlist/BOM) uploaded\",\n];\nconst NO_ENGINEERING = \"Panda - no engineering dates\";\nconst GROUPS = [\"Panda\", NO_ENGINEERING, \"Private Label\"];\nconst SIGNED_DRAWING_RE = /sign|_R\\d+S[._ -]|_S\\d?(?=[._ -])|_R\\d+.*_X\\.pdf$/i;\nconst NOT_DRAWING_RE = /backer|sales order|proposal|QQ ?#|docusign|signature/i;\nconst PRODUCTION_DOC_RE = /CUT ?LIST|B\\.?O\\.?M\\b|\\bOPT\\b|Cut optimisation/i;\nconst DRAWING_RE = /^Q\\d{5}.*\\.pdf$|shop drawing report/i;\nconst NOT_SENT_DRAWING_RE = /W-DLO|KYNAR|ANODI|FINAL-Model|REDO|GLASS|MAT LIST/i;\nfunction jobNumber(name) {\nconst match = /^\\s*S?(\\d{5,})/.exec(name || \"\");\nreturn match ? match[1] : null;\n}\nconst SERVICE_NAME_RE = /^\\s*\\d{5,}[\\s-]*S\\d*\\b|^\\s*S\\d{5,}/i;\nfunction indexPanda3(items) {\nconst index = new Map();\nfor (const item of items || []) {\nconst number = jobNumber(item.name);\nif (!number || SERVICE_NAME_RE.test(item.name)) continue;\nif (!index.has(number)) index.set(number, []);\nindex.get(number).push(item);\n}\nreturn index;\n}\nfunction ymd(text) {\nconst match = /\\d{4}-\\d{2}-\\d{2}/.exec(text || \"\");\nreturn match ? match[0] : null;\n}\nfunction columns(item) {\nconst map = {};\nfor (const cv of (item && item.column_values) || []) map[cv.id] = cv;\nreturn map;\n}\nfunction colText(cols, id) {\nreturn (cols[id] && cols[id].text) || \"\";\n}\nfunction linkedItems(cols, id) {\nreturn (cols[id] && cols[id].linked_items) || [];\n}\nfunction byCreated(a, b) {\nreturn a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;\n}\nfunction jobRow(shop, panda3Index) {\nconst cols = columns(shop);\nconst pm = linkedItems(cols, SHOP_TO_PM)[0] || {};\nconst pmCols = columns(pm);\nconst completed = ymd(colText(cols, SHOP_DATE_COMPLETED));\nconst floor = ymd(colText(pmCols, \"date__1\")) || ymd(colText(pmCols, PL_JOB_TO_FLOOR));\nconst linked = {};\nconst single = {};\nfor (const [key, column] of Object.entries(PM_LINKS)) {\nlinked[key] = linkedItems(pmCols, column).filter((i) => i.board && i.board.id === LINKED_BOARDS[key]);\nsingle[key] = linked[key][0] || null;\n}\nconst shipments = linked.ship.slice().sort((a, b) => {\nconst da = ymd(colText(columns(a), SHIP_DATE)) || \"9999\";\nconst db = ymd(colText(columns(b), SHIP_DATE)) || \"9999\";\nreturn da < db ? -1 : da > db ? 1 : byCreated(a, b);\n});\nconst passes = linkedItems(cols, SHOP_TO_PANDA3).slice();\nconst seenPass = new Set(passes.map((p) => p.id));\nconst lo = floor ? dayNumber(floor) - 14 : null;\nconst hi = completed ? dayNumber(completed) + 30 : null;\nfor (const p of (panda3Index && panda3Index.get(jobNumber(shop.name))) || []) {\nif (seenPass.has(p.id)) continue;\nconst dates = STATIONS.map((st) => ymd(colText(columns(p), st.done))).filter(Boolean).map(dayNumber);\nif (!dates.length) continue;\nif ((lo !== null && Math.max(...dates) < lo) || (hi !== null && Math.min(...dates) > hi)) continue;\nseenPass.add(p.id);\npasses.push(p);\n}\nconst engFiles = ((single.eng && single.eng.assets) || []).slice().sort(byCreated);\nconst oppFiles = ((single.opp && single.opp.assets) || []).slice();\nconst files = {};\nfor (const f of engFiles) {\nif (PRODUCTION_DOC_RE.test(f.name) && !files.production_docs) {\nfiles.production_docs = [f.created_at.slice(0, 10), f.name];\n}\n}\nconst sent = [];\nconst seen = new Set();\nfor (const f of engFiles) {\nconst name = f.name;\nif (DRAWING_RE.test(name) && !seen.has(name.toLowerCase()) && !SIGNED_DRAWING_RE.test(name)\n&& !NOT_SENT_DRAWING_RE.test(name) && !PRODUCTION_DOC_RE.test(name)) {\nseen.add(name.toLowerCase());\nsent.push([f.created_at.slice(0, 10), name]);\n}\n}\nconst earliest = sent.length ? sent[0][0] : \"\";\nfor (const f of engFiles.concat(oppFiles).sort(byCreated)) {\nconst when = f.created_at.slice(0, 10);\nif (when >= earliest && SIGNED_DRAWING_RE.test(f.name)\n&& !NOT_DRAWING_RE.test(f.name) && !PRODUCTION_DOC_RE.test(f.name)) {\nfiles.signed_drawings = [when, f.name];\nbreak;\n}\n}\nif (sent.length) {\nfiles.first_drawings = sent[0];\nconst signed = files.signed_drawings ? files.signed_drawings[0] : null;\nconst before = sent.filter((s) => signed && s[0] <= signed);\nif (before.length) {\nconst revisions = before.length - 1;\nconst last = before[before.length - 1];\nfiles.final_drawings = [last[0],\n`${last[1]} (${revisions} revision${revisions === 1 ? \"\" : \"s\"} after first set)`];\n}\n}\nconst milestones = {};\nfor (const [milestone, source, key] of MILESTONES) {\nlet when = null;\nlet note = \"\";\nif (source === \"pm\") {\nwhen = ymd(colText(pmCols, key));\nif (!when && key === \"date__1\") when = ymd(colText(pmCols, PL_JOB_TO_FLOOR)); // private label log\n} else if (source === \"opp\" || source === \"inv\" || source === \"eng\") {\nconst item = single[source];\nif (item) when = key === \"created\" ? item.created_at.slice(0, 10) : ymd(colText(columns(item), key));\n} else if (source === \"eng_file\") {\nif (files[key]) [when, note] = files[key];\n} else if (source === \"shipment\") {\nconst [n, column] = key;\nif (shipments.length >= n) {\nconst shipCols = columns(shipments[n - 1]);\nwhen = ymd(colText(shipCols, column));\nnote = colText(shipCols, SHIP_STATUS);\n}\n} else if (source === \"panda3\") {\nconst dates = [...new Set(passes.map((p) => ymd(colText(columns(p), PANDA3[key]))).filter(Boolean))].sort();\nif (dates.length) {\nwhen = dates[dates.length - 1];\nif (dates.length > 1) note = `${dates.length} passes: ${dates.join(\", \")}`;\n}\n}\nmilestones[milestone] = [when, note];\n}\nreturn {\nid: shop.id,\nurl: ITEM_URL + shop.id,\njob: shop.name,\ntype: colText(cols, SHOP_JOB_TYPE),\ncustomer: colText(cols, SHOP_CUSTOMER),\ncompleted,\nmilestones,\noutOfOrder: outOfOrder(milestones),\nstations: stationBreakdown(passes, milestones[\"Job to floor\"][0]),\n};\n}\nfunction stationBreakdown(passes, jobToFloor) {\nconst rows = [];\nlet prevDone = jobToFloor || null;\nlet prevName = \"Job to floor\";\nfor (const station of STATIONS) {\nlet best = null;\nconst doneDates = new Set();\nfor (const p of passes) {\nconst pc = columns(p);\nconst done = ymd(colText(pc, station.done));\nif (!done) continue;\ndoneDates.add(done);\nconst start = station.start ? ymd(colText(pc, station.start)) : null;\nif (!best || done > best.done) best = { done, start: start && start <= done ? start : null };\n}\nif (!best) continue;\nconst days = station.vendor\n? (best.start ? dayNumber(best.done) - dayNumber(best.start) : null)\n: (prevDone ? dayNumber(best.done) - dayNumber(prevDone) : null);\nrows.push({\nkey: station.key,\nname: station.name,\nstart: best.start,\ndone: best.done,\ndays,\nfrom: station.vendor ? \"Sent to vendor\" : prevName,\nhandsOn: !station.vendor && best.start ? dayNumber(best.done) - dayNumber(best.start) : null,\npasses: doneDates.size,\n});\nprevDone = best.done;\nprevName = station.name;\n}\nreturn rows;\n}\nfunction outOfOrder(milestones) {\nconst flagged = [];\nlet latest = null;\nlet latestName = null;\nfor (const [milestone] of MILESTONES) {\nconst when = milestones[milestone][0];\nif (!when || ORDER_EXEMPT.has(milestone)) continue;\nif (latest && when < latest) flagged.push({ milestone, when, before: latestName, beforeDate: latest });\nelse { latest = when; latestName = milestone; }\n}\nreturn flagged;\n}\nfunction dayNumber(iso) {\nreturn Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;\n}\nroot.MilestoneReport = { indexPanda3, jobRow };\n})(lib);\n\nconst MR = lib.MilestoneReport;\n\nconst shopItems = [];\nfor (const page of $('Fetch Job Details').all()) {\n  const body = page.json;\n  if (body.errors) throw new Error('monday.com: ' + body.errors.map((e) => e.message).join('; '));\n  shopItems.push(...((body.data && body.data.items) || []));\n}\nconst panda3 = [];\nfor (const page of $input.all()) {\n  const body = page.json;\n  if (body.errors) throw new Error('monday.com: ' + body.errors.map((e) => e.message).join('; '));\n  const data = body.data || {};\n  const pageData = data.next_items_page || (data.boards && data.boards[0] && data.boards[0].items_page) || {};\n  panda3.push(...(pageData.items || []));\n}\n\nconst index = MR.indexPanda3(panda3);\nconst now = new Date().toISOString();\nconst out = [];\nfor (const item of shopItems) {\n  const job = MR.jobRow(item, index);\n  if (!job.completed) continue;\n  out.push({ json: {\n    shop_item_id: String(job.id),\n    job: job.job,\n    job_type: job.type,\n    customer: job.customer,\n    completed: job.completed,\n    completed_month: job.completed.slice(0, 7),\n    detail_json: JSON.stringify(job),\n    synced_at: now,\n  } });\n}\nreturn out;\n" },
    position: [1344, 112]
  },
  output: [{ shop_item_id: '123', job: '91599', job_type: 'Panda', customer: 'Acme', completed: '2026-09-01', completed_month: '2026-09', detail_json: '{}', synced_at: '2026-09-25T00:05:00.000Z' }]
});

const upsertRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save to Job Milestones',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: 'hZTkNckbMuLuTA9G', cachedResultName: 'Job Milestones' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'shop_item_id', condition: 'eq', keyValue: expr('{{ $json.shop_item_id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          shop_item_id: expr('{{ $json.shop_item_id }}'),
          job: expr('{{ $json.job }}'),
          job_type: expr('{{ $json.job_type }}'),
          customer: expr('{{ $json.customer }}'),
          completed: expr('{{ $json.completed }}'),
          completed_month: expr('{{ $json.completed_month }}'),
          detail_json: expr('{{ $json.detail_json }}'),
          synced_at: expr('{{ $json.synced_at }}')
        },
        matchingColumns: [],
        schema: [
          { id: 'shop_item_id', displayName: 'shop_item_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'job', displayName: 'job', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'job_type', displayName: 'job_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'customer', displayName: 'customer', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'completed', displayName: 'completed', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true },
          { id: 'completed_month', displayName: 'completed_month', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'detail_json', displayName: 'detail_json', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'synced_at', displayName: 'synced_at', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true }
        ]
      }
    },
    position: [1568, 112]
  },
  output: [{ id: 1 }]
});

const note = sticky('## Job Milestones sync\n**Every Night** (00:05) re-syncs jobs completed in the last 45 days, so new completions are added and later dates (final invoice, deliveries) get filled in.\n**Backfill 2026** (run manually) loads every job completed this year.\nRows are keyed by the Shop Updates item id in the **Job Milestones** data table. The Build Job Rows code is generated from report.js in the Leadership-Boards repo (n8n/build-workflows.js).', [], { color: 5, position: [0, 400], width: 620, height: 220 });

export default workflow('job-milestones-sync', 'Leadership Boards - Job Milestones Sync')
  .add(manualBackfill)
  .to(backfillRange)
  .to(listJobs)
  .to(batchIds)
  .to(fetchDetails)
  .to(fetchPanda3)
  .to(buildRows)
  .to(upsertRows)
  .add(nightly)
  .to(nightlyRange)
  .to(listJobs)
  .add(note);
