# Chronic Follow-Up Application Evidence

## Scope

Priority application 6 covers chronic screening, tiered management, post-discharge follow-up, return visit reminders, medication adherence, family doctor collaboration, and resident feedback loops.

## Reuse Points

- `chronicScreeningTasks`
- `chronicManagementPlans`
- `followups`
- `personalRecords`
- `medicationPickups`
- `citizen.html`
- `institution.html`

## Runtime Entry Points

- `institution.html` includes a chronic follow-up disposition workbench for screening, management plans, follow-up tasks, medication adherence, and resident feedback.
- `citizen.html` includes a resident post-discharge follow-up feedback form that writes back to the platform API.

## API Evidence

- `GET /api/chronic/followup-summary`
- `POST /api/chronic/followup-feedback`
- `POST /api/chronic/followup-dispatch`

The API keeps resident authorization checks, role-gated institution handling, data access logs, and security event audit trails in the existing server model.

## Release Evidence

Run `npm run chronic:followup-readiness` to generate:

- `release/chronic-followup-readiness-report.json`
- `release/chronic-followup-readiness-report.md`

`release:report`, `deploy:check`, CI, and regression tests include the same readiness domain.
