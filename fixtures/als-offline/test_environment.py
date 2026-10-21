"""Harness-owned synthetic environment smoke; does not import or test ALS."""
import asyncio
import importlib.metadata
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock


class OfflineEnvironmentSmoke(unittest.TestCase):
    def test_non_root_and_versions(self):
        self.assertNotEqual(os.getuid(), 0)
        versions = {name: importlib.metadata.version(name) for name in
                    ("pytest", "pydantic", "PyYAML", "numpy", "fastapi", "httpx2")}
        print(json.dumps({"synthetic_environment_versions": versions}))

    def test_fake_worker_and_temporary_sqlite(self):
        async def scenario():
            fake_worker = AsyncMock(return_value="completed")
            with tempfile.TemporaryDirectory(prefix="harness-synthetic-") as folder:
                with sqlite3.connect(Path(folder) / "synthetic.sqlite") as connection:
                    connection.execute("CREATE TABLE jobs (state TEXT)")
                    connection.execute("INSERT INTO jobs VALUES ('queued')")
                    result = await fake_worker()
                    connection.execute("UPDATE jobs SET state=?", (result,))
                    self.assertEqual(connection.execute("SELECT state FROM jobs").fetchone()[0], "completed")
            fake_worker.assert_awaited_once()
        asyncio.run(scenario())
