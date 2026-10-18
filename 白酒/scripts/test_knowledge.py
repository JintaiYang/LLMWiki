"""Verify report scoping and durable financial knowledge updates."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import knowledge_store as store


class KnowledgeStoreTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / "knowledge.json"
        self.original = store.read_store()
        self.path.write_text(json.dumps(self.original), encoding="utf-8")
        self.patch = patch.object(store, "STORE_PATH", self.path)
        self.patch.start()
        self.entry = deepcopy(self.original["entries"][0])

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def test_seed_entries_and_sources(self):
        for entry in self.original["entries"]:
            store.validate_entry(entry, self.original)
        for source in self.original["sources"]:
            self.assertTrue(store.source_path(source["id"]).is_file())

    def test_edit_versions_and_preserves_other_entries(self):
        self.entry["answer"] += "\n\n补充核验。"
        updated = store.save_entry(self.entry, self.original["revision"])
        current = next(e for e in updated["entries"] if e["id"] == self.entry["id"])
        previous = self.original["entries"][0]
        self.assertEqual(current["version"], previous["version"] + 1)
        self.assertEqual(current["history"][-1]["answer"], previous["answer"])
        self.assertNotIn("history", current["history"][-1])
        self.assertEqual(current["created_at"], previous["created_at"])
        self.assertEqual(updated["entries"][1:], self.original["entries"][1:])
        self.assertEqual(store.read_store(), updated)

    def test_concurrent_save_rejected(self):
        store.save_entry(self.entry, self.original["revision"])
        before = self.path.read_bytes()
        with self.assertRaises(store.ConflictError):
            store.save_entry(self.entry, self.original["revision"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_invalid_entries_do_not_modify_file(self):
        bad_values = [{"periods": []}, {"periods": ["2025-02-30"]}, {"reference_periods": ["2025-12-31"]},
                      {"metrics": ["made-up"]}, {"company": "wrong"}, {"sources": []},
                      {"sources": [{"source_id": "../data", "pages": "1"}]}, {"kind": "general"}]
        before = self.path.read_bytes()
        for bad in bad_values:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                store.save_entry({**self.entry, **bad}, self.original["revision"])
            self.assertEqual(before, self.path.read_bytes())

    def test_new_entry_and_source_scope(self):
        self.entry.update(id="test-new", status="pending", sources=[])
        saved = store.save_entry(self.entry, self.original["revision"])
        self.assertEqual(saved["entries"][-1]["version"], 1)
        self.assertEqual(saved["entries"][-1]["history"], [])
        with self.assertRaises(FileNotFoundError):
            store.source_path("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
