# Job Milestone Report

A static webpage that pulls jobs completed on the monday.com **Shop Updates**
board in a date range (default: year to date), follows each job out to its
linked boards (Project Managers, Opportunities, Invoicing, Engineering Log,
Shipping, Panda 3 - Scheduling) and shows:

- **Summary**: jobs, average and median days per month for each measure
  (opportunity to completed, deal won to deposit, engineering to first
  drawings, customer time to sign, days in production, ...), plus notes on
  outliers and dates entered out of order.
- **Milestones**: one row per job, one column per milestone; dates earlier than
  a milestone to their left are highlighted.
- **Cycle times**: days for each measure, per job.
- **Download Excel** of all three.

Service jobs are left out. Panda jobs with no engineering dates and Private
Label jobs are listed separately.

## How it works

Everything runs in the browser. The page calls the monday.com API directly with
the API token you paste in (Profile picture → Developers → My access tokens).
The token is never stored on the website; it is only kept in the browser if you
tick "Remember on this computer". No job data is stored in this repository.

## Files

- `index.html`, `style.css`: the page
- `app.js`: date range, token, tables and Excel download
- `report.js`: the milestone rules (same as `job_milestone_timeline.py`)
- `vendor/xlsx.full.min.js`: SheetJS 0.18.5 (Apache-2.0) for the Excel download

## Hosting

Part of the Leadership Boards GitHub Pages site, at
`https://georgebails12-design.github.io/leadership-boards/job-milestones/`.
To run locally: `python -m http.server` in the repository root and open
http://localhost:8000/job-milestones/.

The milestone rules match `job_milestone_timeline.py` in the
PandaWindowsWaspAdminUtility repository; change both together.
