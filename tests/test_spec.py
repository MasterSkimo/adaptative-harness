"""Contract and SQLite smoke tests for the V1 specification (not product E2E)."""
from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "migrations/0001_init.sql").read_text(encoding="utf-8")
NOW = "2026-11-02T07:00:00Z"


def db() -> sqlite3.Connection:
    """Use an isolated in-memory database and enforce the intended FK policy."""
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SQL)
    return conn


def project(conn: sqlite3.Connection, pid: str) -> None:
    """Create a project fixture with an opaque ID."""
    conn.execute(
        "INSERT INTO projects (id, display_name, created_at, updated_at) VALUES (?,?,?,?)",
        (pid, pid, NOW, NOW),
    )


class ContractTests(unittest.TestCase):
    """Detect drift between schemas, fixtures and HTTP documentation."""

    def test_event_json_schema_accepts_only_sanitized_fixture(self) -> None:
        schema = json.loads((ROOT / "docs/contracts/event-v1.schema.json").read_text())
        event = json.loads((ROOT / "docs/contracts/examples/event.json").read_text())
        validate = Draft202012Validator(schema, format_checker=FormatChecker())
        self.assertEqual(list(validate.iter_errors(event)), [])
        event["prompt"] = "raw transcript forbidden"
        self.assertTrue(list(validate.iter_errors(event)))
        del event["prompt"]
        event["eventType"] = "unknown.type"
        self.assertTrue(list(validate.iter_errors(event)))

    def test_openapi_exposes_bearer_auth_and_bounded_context(self) -> None:
        spec = yaml.safe_load((ROOT / "docs/api/openapi.yaml").read_text())
        self.assertEqual(spec["openapi"], "3.1.0")
        self.assertEqual(spec["security"], [{"LocalToken": []}])
        self.assertIn("/v1/events", spec["paths"])
        self.assertIn("/v1/context/resolve", spec["paths"])
        self.assertEqual(spec["paths"]["/health"]["get"]["security"], [])


class StorageTests(unittest.TestCase):
    """Check SQL invariants independently from the future TypeScript daemon."""

    def setUp(self) -> None:
        self.conn = db()
        project(self.conn, "project_1")
        project(self.conn, "project_2")

    def tearDown(self) -> None:
        self.conn.close()

    def test_migration_integrity_and_replay(self) -> None:
        self.assertEqual(self.conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.conn.executescript(SQL)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE version = 1").fetchone()[0],
            1,
        )

    def test_event_deduplication(self) -> None:
        self.conn.execute(
            "INSERT INTO provider_instances "
            "(id,provider,launcher,profile_fingerprint,capabilities_json,created_at,updated_at) "
            "VALUES ('source_1','opencode','cli','f1','{}',?,?)", (NOW, NOW),
        )
        insert = (
            "INSERT INTO events "
            "(source_instance_id,event_id,project_id,native_session_id,event_type,"
            "schema_version,occurred_at,observed_at,received_at,outcome,privacy_class,"
            "payload_digest,sanitized_payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        values = ("source_1","evt1","project_1","sess1","tool.completed",1,
                  NOW,NOW,NOW,"failed","metadata","sha256:abc","{}")
        self.conn.execute(insert, values)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(insert, values)

    def test_memory_project_isolation_and_fts_update(self) -> None:
        insert = (
            "INSERT INTO memories "
            "(id,project_id,scope,kind,title,content,confidence,status,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                insert, ("invalid","project_1","global","fact","x","bad",0.9,"published",NOW,NOW),
            )
        self.conn.execute(
            insert, ("m1","project_1","project","lesson","Build","pnpm install",0.9,
                     "published",NOW,NOW),
        )
        search = (
            "SELECT m.id FROM memory_fts "
            "JOIN memories m ON m.rowid=memory_fts.rowid "
            "WHERE memory_fts MATCH ? AND m.project_id=? AND m.status='published'"
        )
        self.assertEqual(self.conn.execute(search, ("pnpm","project_1")).fetchall(), [("m1",)])
        self.assertEqual(self.conn.execute(search, ("pnpm","project_2")).fetchall(), [])
        self.conn.execute("UPDATE memories SET content='gradle test' WHERE id='m1'")
        self.assertEqual(self.conn.execute(search, ("pnpm","project_1")).fetchall(), [])
        self.assertEqual(self.conn.execute(search, ("gradle","project_1")).fetchall(), [("m1",)])
        self.conn.execute("DELETE FROM memories WHERE id='m1'")
        self.assertEqual(self.conn.execute(search, ("gradle","project_1")).fetchall(), [])

    def test_global_artifact_and_single_release_uniqueness(self) -> None:
        self.conn.execute(
            "INSERT INTO artifacts (id,kind,logical_key,scope,created_at) "
            "VALUES ('a1','skill','review','global',?)", (NOW,),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO artifacts (id,kind,logical_key,scope,created_at) "
                "VALUES ('a2','skill','review','global',?)", (NOW,),
            )
        for number in (1,2):
            self.conn.execute(
                "INSERT INTO artifact_versions "
                "(id,artifact_id,version_number,content_digest,storage_path,status,created_at) "
                "VALUES (?,?,?,?,?,'published',?)",
                (f"v{number}","a1",number,f"sha256:{number}",f"versions/{number}",NOW),
            )
        for release, version in (("r1","v1"),("r2","v2")):
            if release == "r1":
                self.conn.execute(
                    "INSERT INTO releases (id,artifact_id,artifact_version_id,state,created_at) "
                    "VALUES (?,?,?,'active',?)",
                    (release,"a1",version,NOW),
                )
            else:
                with self.assertRaises(sqlite3.IntegrityError):
                    self.conn.execute(
                        "INSERT INTO releases "
                        "(id,artifact_id,artifact_version_id,state,created_at) "
                        "VALUES (?,?,?,'active',?)",
                        (release,"a1",version,NOW),
                    )


if __name__ == "__main__":
    # Use the standard-library runner so external test frameworks are optional.
    unittest.main()

