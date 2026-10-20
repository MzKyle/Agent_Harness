---
name: observability-design
description: Design the minimum useful logs, state, diagnosis, and regression entry points for a software feature while controlling sensitive data and runtime overhead.
---

Start with the feature's failure modes and the project's existing capabilities.
DevAgent capability status is metadata: `pending` does not prove that a logger,
test runner, UI harness, or hardware adapter works.

For each relevant failure, identify the observable symptom, evidence source,
diagnostic action, and automated regression entry point. Prefer existing event
names, correlation IDs, status APIs, and test commands. Add fields or endpoints
only when an explicit acceptance criterion cannot otherwise be checked.

For V0.2 `submit_plan`, return an observability object with `states`, `logs`,
`correlationIds`, `errorCodes`, `recovery`, `testEntry`, `regressionRisks`,
`diagnosticTools`, `sensitiveData`, and `overhead`. For proposed events specify trigger, stable name,
level, correlation ID, state/result, and bounded duration/error code when useful.
Exclude tokens, passwords, raw business records, images, and unfiltered stderr.
State expected event volume and any sampling or retention limit; avoid per-item
events on hot paths when one aggregate event answers the diagnostic question.

Use `query_diagnostics` for authorized sanitized events and `get_task_failures`
or `summarize_test_results` for the bound task's signed execution evidence. State
observed failure phase, source/version and remaining uncertainty. Do not invent a
root cause from a matching log string. Describe unavailable observation tools as
capability gaps and persist them with `record_capability_gap`. Distinguish project
instrumentation from reusable harness extensions. Do not install plugins, enable
remote log upload, change global permissions, or connect real hardware merely
because they would improve visibility. Include those proposals in the plan for
separate authorization.
