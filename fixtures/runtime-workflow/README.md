# Dedicated ALS-like runtime fixture

This is synthetic source authorized for online evaluation. It runs a real loopback
HTTP API, a worker thread and a temporary SQLite database using Node 24 built-ins.
It is not ALS, FastAPI, Electron, CVAT or a GPU workload. No production data is used.

The initial implementation intentionally fails to persist worker errors/timeouts.
Independent acceptance tests are mounted outside this workspace read-only. Fix the
implementation, preserve public APIs, and verify both internal and independent tests.
