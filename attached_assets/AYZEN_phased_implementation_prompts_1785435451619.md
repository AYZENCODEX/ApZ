# AYZEN — Vault / Project / Team Overhaul — Phased Prompts

15 phases, each sized to fit in **one AI coding session**. Each phase below is
**self-contained** — copy just that phase's block (including its "Context" line) into a
fresh session; you don't need to paste earlier phases. Do them in order — later phases
assume earlier ones are already merged into the codebase (dependency noted per phase).

Stack recap (put this once at the top of every session if your tool doesn't keep it):
*Python FastAPI backend, Vite/React frontend in `artifacts/ayzen/src`, shadcn/ui,
Supabase Postgres + RLS, Redis, Telegram bot. Reuse existing components/hooks/API
patterns — do not introduce a second styling or data-fetching convention. Mobile-first;
test at narrow width.*

---

## PHASE 1 — Vault Entity: visible card details + richer quick view
**Depends on:** nothing. **Touches:** `pages/user/vault.tsx`

**Context:** Entity cards in the vault list currently reveal almost nothing until
clicked; clicking opens a quick-view dialog showing credential name only.

**Do:**
1. On each entity card (no click needed), show: entity name, platform-presence icons
   (Twitter/Discord/Telegram/Wallet/Other — whichever the entity has configured), a
   buy-value vs worth badge, and enrolled-project count.
2. Expand the click-triggered quick view beyond name-only: add platform
   handles/usernames, status flags, buy value vs worth, short enrollment summary.
3. **Do not** add passwords, seed phrases, 2FA secrets, or backup codes to either the
   card or the quick view — those stay behind the existing PIN/unlock gate flow, reached
   only via "View Full Details."

**Acceptance:** card grid shows the above without a click; quick-view dialog shows
materially more than today while still hiding all secrets; "View Full Details" button
still navigates to `vault-entity-detail.tsx` unchanged.

---

## PHASE 2 — Vault Entity: unified "Access" page (2FA / Mail / Backup)
**Depends on:** Phase 1 (not required, but logically next). **Touches:**
`pages/user/vault-entity-detail.tsx`, new route e.g. `/vault/entity/:id/access`, reusing
logic from `pages/user/vault-2fa-entity.tsx`, `pages/user/vault-mail.tsx` +
`vault-mail-inbox.tsx` + `vault-mail-message*.tsx`, `pages/user/vault-backup.tsx`.

**Context:** `vault-entity-detail.tsx` has tabs `dashboard/overview/credentials/twitter/
discord/telegram/wallet/other`. 2FA, Mail, and Backup currently live in separate,
not-fully-entity-scoped pages.

**Do:**
1. Add an **"Access"** button on `vault-entity-detail.tsx` (separate from the existing
   tab bar).
2. Clicking navigates to a new full-page route scoped to that single entity, with 3
   tabs: **2FA**, **Mail**, **Backup**.
   - 2FA tab: reuse `vault-2fa-entity.tsx` / `totp-card.tsx` logic, filtered to this
     entity's TOTP secrets only.
   - Mail tab: reuse the vault-mail components, but list **all email accounts belonging
     to this entity** (an entity can have more than one mailbox) — not the global inbox.
   - Backup tab: reuse `vault-backup.tsx`, filtered to this entity's backup/recovery
     codes.
3. Keep the existing PIN-gate / unlock-gate (`entity-pin-gate.tsx`,
   `vault-unlock-gate.tsx`) protecting this page exactly as elsewhere.

**Acceptance:** Access page only reachable from an entity's full-detail page; all 3 tabs
correctly filtered to one `vaultEntryId`; no cross-entity leakage; gates still enforced.

---

## PHASE 3 — Project description field
**Depends on:** nothing. **Touches:** `pages/admin/projects.tsx`,
`pages/admin/project-detail.tsx`, `pages/user/projects.tsx` (display only).

**Do:** Add a `description` textarea to the admin project create/edit form if not
already present; persist it; confirm it renders on the project card (`projects.tsx`
already reads `project.description` — just confirm the round-trip from admin works).

**Acceptance:** creating/editing a project from admin sets description; value shows on
the project card and detail page after save.

---

## PHASE 4 — Project activity log (enrollment / days worked / rewards)
**Depends on:** nothing (but Phase 13/15 will reuse this schema — see note at bottom).
**Touches:** backend log table/endpoint, `pages/user/project-entities.tsx`,
`entity-dashboard-tabs.tsx` (Project tab), new project-dashboard page (built in Phase 9).

**Do:** Build a log capturing, per entity↔project enrollment: `enrolled_at`,
`joined_at`, `left_at`, cumulative days active, and reward events (timestamp, amount,
running total). Design the table generically — `activity_log` with
`subject_type`/`subject_id` — so Phase 15 (team activity log) can reuse it instead of a
second bespoke table. Render as a table/timeline on: (a) the project's own dashboard
(aggregate, built in Phase 9), and (b) the entity's Project tab in
`entity-dashboard-tabs.tsx`.

**Acceptance:** every enroll/join/leave/reward action writes a log row; totals (days
active, total reward, reward/day) are computed from the log, not stored out-of-sync;
schema is generic enough for non-project subjects.

---

## PHASE 5 — Disqualify / ban / cancel enrollment
**Depends on:** Phase 4 (writes to its log). **Touches:**
`pages/user/project-entities.tsx`, admin project-detail equivalent.

**Do:** Add per-entity actions on the enrolled-entities view: **Disqualify** (stops
future reward accrual, keeps history), **Ban** (disqualify + blocks re-enrollment in
this project), **Cancel enrollment** (voluntary/admin removal, no stigma, can
re-enroll). Each writes to the Phase 4 log (who/when/why) and updates status visibly in
both user and admin views.

**Acceptance:** all 3 actions available to admin/moderator; status changes reflect
immediately; disqualified/banned entities are visually distinguished in lists.

---

## PHASE 6 — Project comparison view
**Depends on:** Phase 3 and Phase 7 (badges) for full field coverage, but can ship with
just Phase 3. **Touches:** `pages/user/projects.tsx`, new compare view/route.

**Do:** Allow selecting 2–3 projects (checkboxes or a "Compare" action on the list) and
show a side-by-side view: stats, reward structure, requirements, enrolled-entity count,
tier/category/badges, description. Read-only — no enrollment actions from this view.

**Acceptance:** works for exactly 2 or 3 selections; deselecting returns to normal list.

---

## PHASE 7 — Project badge/tag system
**Depends on:** Phase 3 (shares the admin form). **Touches:** `pages/admin/projects.tsx`,
`pages/user/projects.tsx`, compare view (Phase 6).

**Do:** Add a badges/tags list field to the project record, editable in admin alongside
description. Render consistently on project cards, detail, and compare view.

**Acceptance:** badges editable in admin; render identically across list/detail/compare.

---

## PHASE 8 — Tutorial step "full details" toggle
**Depends on:** nothing. **Touches:** the tutorial/submission-guide builder UI (locate
under admin or `project-detail.tsx`'s guide/submission-guide section) and its
consumer-facing render.

**Do:** Per tutorial step, add an optional "full step details" field/toggle at authoring
time — extra content (longer text/images/sub-steps), collapsed by default, expandable in
the consumer view when enabled.

**Acceptance:** author can enable per step; steps left off render exactly as today; steps
with it on show an expand/collapse control.

---

## PHASE 9 — Enroll sidebar shell + Projects (Overview + dedicated dashboard)
**Depends on:** Phase 4 (log data feeds the Overview stats). **Touches:** new
`components/layout/enroll-sidebar.tsx` (modeled on `vault-sidebar.tsx`), new
Projects-overview route, new per-project dashboard route (separate from
`project-detail.tsx`'s submission flow).

**Do:**
1. Build an Enroll sidebar with two sections: **Projects**, **Entities** (Entities
   wired up in Phase 10).
2. Projects section has an **Overview** (8–9 stat widgets: pie chart, bar chart(s), and
   a heatmap-style visualization of enrollment/activity — use whatever chart library is
   already a dependency in `artifacts/ayzen/package.json`) and a **Project list**.
3. Each project in the list is clickable and opens its **own dedicated dashboard page**
   (own URL, deep-linkable) showing that project's stats, enrolled entities, the Phase 4
   activity log, and the Phase 5 moderation actions — separate from the
   submission-flow `project-detail.tsx`.

**Acceptance:** Overview/list toggle within Projects section; every project has a
deep-linkable dashboard URL independent of the submission flow.

---

## PHASE 10 — Enroll: Entities (Overview + dedicated dashboard)
**Depends on:** Phase 9 (sidebar shell must exist), Phase 1/2 (entity data shapes).
**Touches:** Enroll sidebar's Entities section, reusing `entity-dashboard-tabs.tsx`.

**Do:** Mirror Phase 9 for entities: an Overview (aggregate dashboard across the user's
entities) and an Entity list where each entity opens its dedicated dashboard — reuse the
existing `EntityDashboardTabs` component (the same one used by `vault-entity-detail.tsx`
"dashboard" tab) rather than building a second dashboard implementation.

**Acceptance:** same Overview+list pattern as Phase 9; zero duplicate dashboard code —
confirmed reuse of `EntityDashboardTabs`.

---

## PHASE 11 — Team sidebar restructure (navigation shell only)
**Depends on:** nothing new (pure relocation). **Touches:** `pages/user/teams.tsx`.

**Do:** Replace the flat tab list (`dashboard, members, vault, missions, tasks,
leaderboard, projects, chat, panel, browse, invite`) with a hierarchical sidebar of 4
top-level sections — **Overview**, **Task**, **App**, **Other** — as empty/placeholder
containers for now. Map old tabs into new sections without deleting any logic yet:
`missions+tasks`→Task, `vault+projects`→App, `members+invite+chat/panel`→Other,
`dashboard`→Overview, `leaderboard/browse`→handled specially in Phase 12. This phase is
just the shell + routing; content moves in Phases 12–15.

**Acceptance:** new 4-section sidebar renders and navigates; no tab's underlying feature
is deleted (even if temporarily nested oddly) — full content relocation happens in the
following phases.

---

## PHASE 12 — Team Overview: browse/join/create + Leave/Leaderboard
**Depends on:** Phase 11. **Touches:** Overview section of `teams.tsx`, reusing the
existing `browse` tab and `TeamLeaderboard` component.

**Do:**
1. If the user is **not in a team**: Overview shows a team browser — search by team
   username (add a unique username/handle field to teams if not present) — with
   join/create actions, based on the existing `browse` tab logic.
2. Once the user **joins or creates** a team, Overview **replaces itself** with that
   team's scoped dashboard.
3. Scoped Overview has, top corner: a **Leave** button and a **Leaderboard** button
   (reuses `TeamLeaderboard`/existing `leaderboard` tab logic, surfaced here instead of
   as its own top-level tab).

**Acceptance:** non-member vs member states are distinct renders gated on membership;
username field searchable; Leave reverts to browse state; Leaderboard button opens the
existing leaderboard view.

---

## PHASE 13 — Team App section: Vault + Project + team mail
**Depends on:** Phase 11. **Touches:** App section of `teams.tsx`, reusing existing
`vault`/`projects` team tabs, new team-mail sub-view based on `vault-mail.tsx` patterns.

**Do:** App section = **Vault** (existing team `vault` tab, unchanged) + **Project**
(existing team `projects` tab, unchanged) + a new **mail** sub-view scoped to the team's
AYZEN-provided mailbox (distinct from per-entity vault mail — Phase 2) — reuse
vault-mail component patterns but point them at the team-level mailbox/API.

**Acceptance:** Vault/Project sub-views work exactly as before, just relocated; team
mail sub-view lists the team mailbox and never mixes with entity-scoped vault mail.

---

## PHASE 14 — Team Task section: Task + Mission
**Depends on:** Phase 11. **Touches:** Task section of `teams.tsx`, reusing existing
`tasks` and `missions` tabs.

**Do:** Relocate the existing `tasks` and `missions` tabs under the new Task section as
two sub-views. No reimplementation — this is pure relocation.

**Acceptance:** both sub-views function identically to the old tabs, just nested under
Task.

---

## PHASE 15 — Team Other section: Social (members + invite + activity log)
**Depends on:** Phase 11, Phase 4 (shared activity-log schema). **Touches:** Other
section of `teams.tsx`, reusing `members`/`invite` tabs, new team activity-log view.

**Do:**
1. **Members** sub-view: reuse existing `members` tab, but also surface each member's
   progress (task/mission completion, vault-activity contribution) — not just a static
   roster.
2. **Invite** sub-view: reuse existing `invite` tab unchanged.
3. **Activity log** sub-view: chronological feed of team-level actions — who did what,
   when — explicitly including vault-usage events (which member accessed/used which
   vault entity, when). Use the **same generic `activity_log` table** built in Phase 4
   (`subject_type`/`subject_id`) rather than a second logging system.

**Acceptance:** Members shows live progress; Invite unchanged; activity log includes
vault-usage entries, attributed and timestamped, sourced from the shared log table.

---

## Suggested session grouping (if you want to batch phases)
- **Session block 1 (Vault):** Phases 1–2
- **Session block 2 (Projects — data/moderation):** Phases 3–5
- **Session block 3 (Projects — discovery):** Phases 6–7
- **Session block 4 (Tutorial):** Phase 8 (small, can tack onto block 3)
- **Session block 5 (Enroll dashboards):** Phases 9–10
- **Session block 6 (Team shell + Overview):** Phases 11–12
- **Session block 7 (Team App + Task):** Phases 13–14
- **Session block 8 (Team Other/Social):** Phase 15

Each individual phase is small enough to run standalone if you'd rather do all 15
one-by-one.
