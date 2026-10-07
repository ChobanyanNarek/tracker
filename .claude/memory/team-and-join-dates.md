---
name: team-and-join-dates
description: Global Team panel (opened from All Devs → Manage team) and per-project join dates that gate Schedule/Report worked-day counts
metadata:
  type: project
---

**Team management is a panel, not a tab.** Opened via "Manage team" at the bottom of the **All Devs** dropdown in the header (`TeamPanel.tsx` in `components/layout/`). This mirrors how the project segment both filters and opens its settings panel — the user explicitly rejected a content tab for this.

**Per-project join dates:** `project.joinDates` is a `Record<devId, 'YYYY-MM-DD'>` kept ALONGSIDE `project.members` (a plain `string[]`). Members was deliberately left as an id list because it's read in ~26 places; reshaping it would have been a wide, risky refactor for no benefit.

**How to apply:**

- Read join state through `joinedByDate(projects, selectedProject, devId, dateStr)` in the store. A membership with **no** date means "always on the project", so existing data is unaffected until dates are filled in.
- Days before the join date are greyed out, non-editable, and **excluded from worked-day totals**.
- Keep ScheduleView and ReportView/MonthlySection in step — they both count worked days. They disagreed once (22 days in Report vs 12 in Schedule for the same developer) because only Schedule respected join dates.
- `toggleMember` and `removeDeveloper` must scrub `joinDates` too, or a re-added member silently inherits a stale date, and deleted developers linger as dangling ids.
