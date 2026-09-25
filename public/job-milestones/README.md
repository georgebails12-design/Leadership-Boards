# Job Milestone Report

Pulls jobs completed on the monday.com **Shop Updates** board in a date range
(default: year to date), follows each job out to its linked boards (Project
Managers, Opportunities, Invoicing, Engineering Log, Shipping) and matches its
**Panda 3 - Scheduling** station records by job number.

- **Summary**: jobs, average and median days per month for each measure
  (opportunity to completed, deal won to deposit, engineering to first
  drawings, customer time to sign, days in production, ...) and for **days at
  each station**. Click a row, or one month's numbers, to list the jobs behind
  it; click a job for its breakdown.
- **Job breakdown**: days at each station (with hands-on days where a start
  date was recorded, and rework passes), every cycle time, and the full
  milestone timeline, with a link to the job in monday.com.
- **Milestones** and **Cycle times** tabs: one row per job.
- **Download Excel**: Summary, Milestones, Cycle Times and Stations sheets.

Service jobs are left out. Panda jobs with no engineering dates and Private
Label jobs are listed separately.

## Station days

Panda 3 records are matched to a job by job number (the board link from Shop
Updates exists for only a minority of jobs), keeping records dated between 14
days before Job to floor and 30 days after completion. Rework records
("87145 -R", "Respray") count as extra passes; service records ("-S") are left
out. Days at a station run from the previous station's completion (Job to floor
for Pull) to this station's completion, so waiting time is included. Hands-on
days are the station's own start to completion.

## Files

- `index.html`, `style.css`: the page
- `app.js`: sign-in, date range, tables, breakdowns, job view, Excel download
- `report.js`: the milestone and station rules (milestones match
  `job_milestone_timeline.py` in PandaWindowsWaspAdminUtility)
- `vendor/xlsx.full.min.js`: SheetJS 0.18.5 (Apache-2.0) for the Excel download
