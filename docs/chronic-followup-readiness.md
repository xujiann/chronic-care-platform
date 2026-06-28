# Chronic Follow-Up Application Evidence

## Scope

Priority application 6 covers chronic screening, tiered management, post-discharge follow-up, return visit reminders, medication adherence, family doctor collaboration, and resident feedback loops.

This increment also adds a shared alert queue for overdue follow-ups, near-term management reviews, medication pickup reminders, screening tasks, and resident feedback disposition.

Resident experience now includes self-monitoring upload, medication check-in, satisfaction feedback, family proxy handling, senior reminders, and health point evidence.

Field integration now covers device measurement ingestion, pharmacy pickup callbacks, family doctor closure actions, and senior reminder outreach evidence.

## Policy Basis

- 《关于加强基层慢性病健康管理服务的指导意见》（国卫基层发〔2025〕15号）要求强化基层慢病健康管理服务，覆盖家庭医生签约、分类分级管理、随访健康指导、自我健康管理、用药保障、医保协同和质量控制。
- 《基层慢性病健康管理服务能力建设指引》明确基层慢病健康管理中心可承担咨询筛查、诊断治疗、随访与健康指导、转诊、信息汇总流转和数智化支撑等能力。
- This application maps those policy requirements into runnable local evidence: `chronicScreeningTasks` for screening, `chronicManagementPlans` for tiered management, `followups` for post-discharge follow-up and return visits, `medicationPickups` for adherence and medication support, `taskMessages` for feedback handling, and audit logs for traceability.
- `GET /api/chronic/followup-summary` now returns a `policyAlignment` matrix so the institution workbench can show policy coverage alongside operational workload.

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
- `POST /api/chronic/resident-checkins`
- `POST /api/chronic/device-measurements`
- `POST /api/chronic/pharmacy-callbacks`
- `POST /api/chronic/family-doctor-actions`
- `POST /api/chronic/reminder-outreach`
- `POST /api/chronic/followup-dispatch`

The API keeps resident authorization checks, role-gated institution handling, data access logs, and security event audit trails in the existing server model.

Resident feedback also creates `taskMessages` for institution follow-up, and institution dispositions create resident-facing messages through the existing `/api/messages` channel.

`GET /api/chronic/followup-summary` includes `alertQueue`, `summary.alerts`, `summary.overdueAlerts`, and `summary.highPriorityAlerts` so institution and resident entry points can share the same follow-up risk queue.

Institution and resident pages now prefer that API queue when the backend is available, while retaining a local fallback for static preview.

`POST /api/chronic/resident-checkins` writes resident self-management check-ins to `personalRecords`, `chronicSelfManagement`, medication adherence state, optional senior service evidence, and institution `taskMessages` when review is needed.

The field integration APIs reuse the same resident authorization, institution scope, message, and audit model: device uploads land as resident self-management evidence, pharmacy callbacks update `medicationPickups`, family doctor actions close institution messages and write personal records, and reminder outreach records SMS/phone/in-app evidence in `seniorServices` plus task messages.

## Release Evidence

Run `npm run chronic:followup-readiness` to generate:

- `release/chronic-followup-readiness-report.json`
- `release/chronic-followup-readiness-report.md`

`release:report`, `deploy:check`, CI, and regression tests include the same readiness domain.

`release:report` also gates `chronicFollowup:policyAlignment`, requiring all seven policy evidence items to be covered before release.

`release:report` gates `chronicFollowup:alertQueue`, requiring risk reminders and high-priority follow-up alerts to remain available for release.

`release:report` gates `chronicFollowup:residentExperience`, requiring self-monitoring, satisfaction, family proxy, and senior reminder evidence to remain in the release package.

`release:report` gates `chronicFollowup:fieldIntegration`, requiring device measurement, pharmacy callback, family doctor closure, and reminder outreach evidence before publication.
