#!/usr/bin/env python3
"""Focused standard-library tests for the localization inventory exporter."""

from collections import Counter
from dataclasses import replace
import csv
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

import ja_review_inventory as inv


def catalogs(text="jouzu-test = Test { $name }\n"):
    return {f"{inv.LOCALE_ROOT}{locale}/cli.ftl": text.encode() for locale in inv.LOCALES}


def with_lock(blobs):
    result = dict(blobs)
    lock = {"version": "1", "locales": {}, "extra": {}}
    for path, data in blobs.items():
        locale, name = path.removeprefix(inv.LOCALE_ROOT).split("/")
        target = lock["locales"] if name == "cli.ftl" else lock["extra"]
        target[locale if name == "cli.ftl" else f"{locale}/{name}"] = inv.sha256(data)
    result[inv.LOCALE_ROOT + "catalog.lock.json"] = inv.json_bytes(lock)
    return result


def integration_contract():
    """Use the configured candidate, or an explicit test-only pin/count fixture.

    JOUZU_JA_REVIEW_FIXTURE is JSON with commit, file_counts, and allowlist_entries.
    It changes test expectations only; the exporter's production defaults stay fixed.
    """
    raw = os.environ.get("JOUZU_JA_REVIEW_FIXTURE")
    if raw is None:
        return inv.DEFAULT_SOURCE, inv.PIN_COUNTS
    fixture = inv.unique_json(raw.encode("utf-8"), "JOUZU_JA_REVIEW_FIXTURE")
    if set(fixture) != {"commit", "file_counts", "allowlist_entries"}:
        raise inv.InventoryError("integration fixture requires commit, file_counts, and allowlist_entries")
    return (inv.SourcePin(inv.REPOSITORY, fixture["commit"]),
            inv.CountContract(fixture["file_counts"], fixture["allowlist_entries"]))


class Tags(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.data = []
        self.articles = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        if tag == "article":
            self.articles.append(dict(attrs).get("id"))

    def handle_data(self, data):
        self.data.append(data)


class FluentTests(unittest.TestCase):
    def test_lossless_comments_multiline_attributes_and_selects(self):
        data = ("### File comments: keep --flag and <path>\r\n\r\n"
                "# Message comment\r\n"
                "jouzu-test = First line { $name }\r\n"
                "    second line\r\n\r\n"
                "    third line\r\n"
                "    .title = Title { $name }\r\n"
                "    .description = { $count ->\r\n"
                "        [one] One { $name }\r\n"
                "       *[other] Many { $name }\r\n"
                "    }\r\n"
                "\r\n# Standalone comment\r\n"
                "attr-only =\r\n    .title = Attribute only\r\n"
                "-term = Protected\r\n"
                "# Trailing comment, no newline").encode()
        parsed = inv.parse_fluent(data, "fixture.ftl")
        self.assertEqual(b"".join(b["source"].encode() for b in parsed["blocks"]), data)
        self.assertEqual(set(parsed["messages"]), {"jouzu-test", "attr-only", "-term"})
        message = parsed["messages"]["jouzu-test"]
        self.assertIn("--flag", message["preceding_comments"])
        self.assertIn("second line\r\n\r\n    third", message["value_source"])
        self.assertIn("*[other] Many", message["attributes"]["description"])
        self.assertEqual(message["start_line"], 4)
        self.assertEqual(message["end_line"], 12)
        self.assertEqual(parsed["messages"]["-term"]["kind"], "term")

    def test_quoted_literals_protected_tokens_and_nested_select(self):
        data = b'''message = Keep --json <path> `command` { " " } { "\\u000A" } { "{ }" }
other = { $count ->
    [one] { $state ->
        [on] { $name }
       *[off] Off
    }
   *[other] Many
}
'''
        result = inv.parse_fluent(data, "nested.ftl")
        self.assertEqual(result["messages"]["message"]["source"], data.decode().split("other =")[0])
        self.assertIn("$state", result["messages"]["other"]["value_source"])

    def test_malformed_or_unsupported_fluent_fails_closed(self):
        cases = [
            "not an entry\n", "x =\n", "x = a\nbroken continuation\n",
            "x = { $arg\n", "x = bad }\n", "x = {}\n", "x = { $ }\n",
            'x = { "unterminated }\n', 'x = { "bad\\q" }\n',
            "x = { $count ->\n    [one] One\n}\n",
            "x = { $count ->\n   *[one] One\n   *[other] More\n}\n",
            "x = { $count ->\n    [one] One\n   *[one] More\n}\n",
            "x = { $count ->\n   *[other]\n}\n",
            "x = { $count -> broken }\n", "x = { NUMBER($count) }\n",
            "x = a\n    .title =\n", "-term =\n    .attr = Only attr\n",
        ]
        for text in cases:
            with self.subTest(text=text), self.assertRaises(inv.InventoryError):
                inv.parse_fluent(text.encode(), "bad.ftl")

    def test_duplicate_ids_and_attributes_are_errors(self):
        for text in ("x = one\nx = two\n", "x = value\n    .a = one\n    .a = two\n"):
            with self.subTest(text=text), self.assertRaisesRegex(inv.InventoryError, "duplicate"):
                inv.parse_fluent(text.encode(), "duplicate.ftl")
        blobs = catalogs()
        for locale in inv.LOCALES:
            blobs[f"{inv.LOCALE_ROOT}{locale}/extra.ftl"] = b"jouzu-test = Duplicate\n"
        with self.assertRaisesRegex(inv.InventoryError, "across files"):
            inv.collect_catalogs(blobs)

    def test_invalid_encoding_is_not_dropped(self):
        for data in (b"x = \xff\n", b"x = \x00\n", b"\xef\xbb\xbfx = Value\n"):
            with self.subTest(data=data), self.assertRaises(inv.InventoryError):
                inv.parse_fluent(data, "bad.ftl")

    def test_missing_extra_locale_namespace_attributes_and_arguments(self):
        mutations = {
            "missing": b"another = No original\n",
            "extra": b"jouzu-test = Test { $name }\nextra = Untracked\n",
            "argument": b"jouzu-test = Test { $other }\n",
            "attribute": b"jouzu-test = Test { $name }\n    .label = More\n",
        }
        for label, data in mutations.items():
            blobs = catalogs()
            blobs[inv.LOCALE_ROOT + "ja/cli.ftl"] = data
            with self.subTest(label=label), self.assertRaisesRegex(inv.InventoryError, "parity"):
                inv.collect_catalogs(blobs)
        blobs = catalogs()
        blobs[inv.LOCALE_ROOT + "ja/extra.ftl"] = blobs.pop(inv.LOCALE_ROOT + "ja/cli.ftl")
        with self.assertRaisesRegex(inv.InventoryError, "namespace"):
            inv.collect_catalogs(blobs)
        blobs = catalogs()
        del blobs[inv.LOCALE_ROOT + "ja/cli.ftl"]
        with self.assertRaisesRegex(inv.InventoryError, "missing"):
            inv.collect_catalogs(blobs)
        blobs[inv.LOCALE_ROOT + "fr/cli.ftl"] = b"jouzu-test = Bonjour\n"
        with self.assertRaisesRegex(inv.InventoryError, "unexpected"):
            inv.collect_catalogs(blobs)

    def test_count_contract_is_central_immutable_and_validated(self):
        original = {"cli.ftl": 2, "extra.ftl": 1}
        counts = inv.CountContract(original, 3)
        original["cli.ftl"] = 99
        self.assertEqual(counts.ids_per_locale, 3)
        self.assertEqual(counts.to_dict(), {"file_counts": {"cli.ftl": 2, "extra.ftl": 1},
                                           "ids_per_locale": 3, "allowlist_entries": 3})
        with self.assertRaises(TypeError):
            counts.file_counts["cli.ftl"] = 99
        for files, entries in (({}, 1), ({"wrong-path": 1}, 1), ({"cli.ftl": True}, 1),
                               ({"cli.ftl": 0}, 1), ({"cli.ftl": 1}, 0), ({"cli.ftl": 1}, True)):
            with self.subTest(files=files, entries=entries), self.assertRaises(inv.InventoryError):
                inv.CountContract(files, entries)
        self.assertEqual(inv.PIN_COUNTS.ids_per_locale, sum(inv.PIN_COUNTS.file_counts.values()))

    def test_counts_enforced_and_identical_values_retained(self):
        blobs = catalogs()
        rows, info = inv.collect_catalogs(blobs, {"cli.ftl": 1})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["review_status"], inv.REVIEW_STATUS)
        self.assertEqual(rows[0]["stable_id"], "jouzu.test")
        self.assertTrue(rows[0]["locales"]["ja"]["same_as_en"])
        self.assertEqual(info["counts"]["ja"], {"cli.ftl": 1})
        with self.assertRaisesRegex(inv.InventoryError, "counts differ"):
            inv.collect_catalogs(blobs, {"cli.ftl": 2})

    def test_allowlist_rejects_duplicates_missing_sources_and_missing_reasons(self):
        entry = {"file": "src/file.ts", "kind": "record-value", "text": "Text", "category": "model-facing", "reason": "Model text"}
        self.assertEqual(inv.read_allowlist(inv.json_bytes([entry]), [entry["file"]]), [entry])
        for entries, paths in (([], []), ([entry, entry], [entry["file"]]), ([entry], []),
                               ([{**entry, "reason": ""}], [entry["file"]])):
            with self.subTest(entries=entries), self.assertRaises(inv.InventoryError):
                inv.read_allowlist(inv.json_bytes(entries), paths)

    def test_lock_digests_and_duplicate_json_keys(self):
        blobs = with_lock(catalogs())
        self.assertEqual(inv.check_catalog_lock(blobs)["version"], "1")
        invalid = with_lock(catalogs())
        lock_path = inv.LOCALE_ROOT + "catalog.lock.json"
        lock = json.loads(invalid[lock_path])
        del lock["version"]
        invalid[lock_path] = inv.json_bytes(lock)
        with self.assertRaisesRegex(inv.InventoryError, "version"):
            inv.check_catalog_lock(invalid)
        blobs[inv.LOCALE_ROOT + "ja/cli.ftl"] += b"# change\n"
        with self.assertRaisesRegex(inv.InventoryError, "digests/file set"):
            inv.check_catalog_lock(blobs)
        with self.assertRaisesRegex(inv.InventoryError, "duplicate JSON"):
            inv.unique_json(b'{"key": 1, "key": 2}', "fixture.json")
        with self.assertRaises(inv.InventoryError):
            inv.unique_json(b"[1]", "fixture.json")


class OutputTests(unittest.TestCase):
    def test_default_candidate_and_explicit_integration_fixture(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(integration_contract(), (inv.DEFAULT_SOURCE, inv.PIN_COUNTS))
        fixture = {"commit": "1" * 40, "file_counts": {"cli.ftl": 2}, "allowlist_entries": 1}
        with patch.dict(os.environ, {"JOUZU_JA_REVIEW_FIXTURE": json.dumps(fixture)}):
            pin, counts = integration_contract()
            self.assertEqual(pin.commit, fixture["commit"])
            self.assertEqual(pin.repository, inv.REPOSITORY)
            self.assertEqual(counts.file_counts, fixture["file_counts"])
            self.assertEqual(counts.allowlist_entries, fixture["allowlist_entries"])
        for value in ({"commit": "main"}, {**fixture, "commit": None}, {**fixture, "unexpected": "value"}):
            with patch.dict(os.environ, {"JOUZU_JA_REVIEW_FIXTURE": json.dumps(value)}):
                with self.assertRaises(inv.InventoryError):
                    integration_contract()

    def test_cli_defaults_to_public_repository_links_and_pin_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(inv, "build_outputs", return_value={}) as build, \
                    patch.object(inv, "save_outputs") as save, patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(inv.main(["--source", str(root / "source"), "--output", str(root / "out")]), 0)
            build.assert_called_once_with(root / "source", inv.DEFAULT_SOURCE, inv.PIN_COUNTS.ids_per_locale, "links")
            self.assertEqual(inv.REPOSITORY, "https://github.com/shisa-ai/jouzu")
            save.assert_called_once_with(root / "out", {}, False)
        with self.assertRaisesRegex(inv.InventoryError, "file-count contract"):
            inv.build_outputs(Path("unused"), expected_ids=inv.PIN_COUNTS.ids_per_locale + 1)

    def test_nondefault_pin_keeps_exact_file_and_allowlist_counts(self):
        pin = inv.SourcePin("https://github.com/example-org/example-project", "2" * 40)
        counts = inv.CountContract({"cli.ftl": 1, "extra.ftl": 1}, 2)
        blobs = with_lock(catalogs("one = First\ntwo = Second\n"))
        with patch.object(inv, "verify_source"), patch.object(inv, "tracked_paths", return_value=list(blobs)), \
                patch.object(inv, "select_sources", return_value=({p: "fluent-catalog" for p in blobs}, [])), \
                patch.object(inv, "read_source", side_effect=lambda root, path: blobs[path]):
            with self.assertRaisesRegex(inv.InventoryError, "pinned counts differ"):
                inv.build_outputs(Path("unused"), pin, counts=counts)
        entry = {"file": "src/file.ts", "kind": "record-value", "text": "Text", "category": "model-facing", "reason": "Model text"}
        with patch.object(inv, "SOURCE_GROUPS", {}), \
                patch.object(inv, "read_source", return_value=inv.json_bytes([entry])):
            with self.assertRaisesRegex(inv.InventoryError, "allowlist count differs"):
                inv.select_sources(Path("unused"), [entry["file"]], pin, counts)

    def test_public_instructions_contain_no_review_history(self):
        rows, info = inv.collect_catalogs(catalogs())
        instructions = inv.readme(info["counts"], rows, [], [], inv.DEFAULT_SOURCE, "links", [])
        self.assertNotRegex(instructions.decode(), r"\b(?:baseline|coordinator|historical)\b")
        self.assertNotRegex(instructions.decode(), r"[\u3040-\u30ff\u3400-\u9fff]")
        self.assertIn(inv.REPOSITORY.encode(), instructions)
        self.assertIn(b"not all hardcoded UI strings", instructions)
        self.assertIn(b"immutable links to complete source files", instructions)
        self.assertNotIn(b"(sources/", instructions)

    def test_configurable_repository_and_commit_stay_immutable(self):
        pin = inv.SourcePin("https://github.com/example-org/example-project", "1" * 40)
        url = inv.source_url("some file.ftl", 3, 4, pin)
        self.assertEqual(url, f"{pin.repository}/blob/{pin.commit}/some%20file.ftl#L3-L4")
        rows, _ = inv.collect_catalogs(catalogs(), provenance=pin)
        self.assertIn(pin.commit, rows[0]["locales"]["ja"]["source_url"])
        self.assertIn(pin.commit.encode(), inv.catalog_html(rows, pin))
        with patch.object(inv, "git", side_effect=[(pin.commit + "\n").encode(), b""]):
            inv.verify_source(Path("unused"), pin.commit)
        for repository, commit in ((inv.REPOSITORY, "main"), ("https://github.com/a/b?x=1", inv.PIN),
                                   ("https://user:pass@github.com/a/b", inv.PIN)):
            with self.subTest(repository=repository, commit=commit), self.assertRaises(inv.InventoryError):
                inv.SourcePin(repository, commit)

    def test_english_instructions_preserve_catalog_language(self):
        rows, _ = inv.collect_catalogs(catalogs("message = English source\n"))
        page = inv.catalog_html(rows).decode()
        self.assertNotRegex(page, r"[\u3040-\u30ff\u3400-\u9fff]")
        self.assertIn('<html lang="en">', page)
        self.assertIn('<section lang="ja">', page)

    def test_disclosure_flags_keep_source_exact_and_do_not_claim_clearance(self):
        data = b"/home/example-user/review\nTASK-123\npreview.example.internal\nprivate readonly field\noutside this repository\n"
        original = data
        report = inv.disclosure_review({"file.ts": data})
        self.assertEqual(report["status"], "requires-public-disclosure-review")
        self.assertEqual(len(report["findings"]), 4)
        self.assertEqual(report["findings"][0]["text"], "/home/example-user/review")
        self.assertIn("No automatic redaction", report["boundary"])
        self.assertEqual(data, original)

    def test_csv_roundtrip_preserves_quotes_newlines_and_text(self):
        text = '# keep "quotes", --flag\nx = =SUM(A1) <script>alert("&")</script>\n    続き, "引用" { $name }\n'
        rows, _ = inv.collect_catalogs(catalogs(text))
        encoded = inv.catalog_csv(rows)
        parsed = list(csv.DictReader(io.StringIO(encoded.decode(), newline="")))
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["ja_source"], rows[0]["locales"]["ja"]["source"])
        self.assertEqual(parsed[0]["ja_value_source"], rows[0]["locales"]["ja"]["value_source"])
        self.assertIn('"quotes"', parsed[0]["en_preceding_comments"])
        self.assertEqual(parsed[0]["finding"], "")
        self.assertEqual(parsed[0]["review_status"], inv.REVIEW_STATUS)
        self.assertTrue(parsed[0]["ja_source_url"].startswith(inv.REPOSITORY + "/blob/" + inv.PIN))
        self.assertIn("#L2-L3", parsed[0]["ja_source_url"])

    def test_html_escaping_no_source_execution_and_stable_anchors(self):
        text = 'jouzu-html = <script>alert("&")</script> </pre> <img src=x onerror=evil()>\n'
        rows, _ = inv.collect_catalogs(catalogs(text))
        output = inv.catalog_html(rows).decode()
        parsed = Tags()
        parsed.feed(output)
        self.assertEqual(parsed.tags.count("script"), 1)  # Only the exporter's static search code.
        self.assertNotIn("img", parsed.tags)
        self.assertEqual(parsed.articles, ["jouzu-html"])
        self.assertIn(text, "".join(parsed.data))
        self.assertIn("&lt;script&gt;", output)
        self.assertIn(inv.REVIEW_STATUS, output)

    def test_pin_mismatch_dirty_source_and_git_failure(self):
        with patch.object(inv, "git", return_value=b"bad-pin\n"):
            with self.assertRaisesRegex(inv.InventoryError, "source pin mismatch"):
                inv.verify_source(Path("unused"))
        with patch.object(inv, "git", side_effect=[(inv.PIN + "\n").encode(), b"?? unknown\n"]):
            with self.assertRaisesRegex(inv.InventoryError, "not clean"):
                inv.verify_source(Path("unused"))
        with patch.object(inv, "git", side_effect=[(inv.PIN + "\n").encode(), b""]):
            inv.verify_source(Path("unused"))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(inv.InventoryError, "git rev-parse HEAD failed"):
                inv.verify_source(Path(directory))

    def test_output_check_preserves_annotations_and_detects_extra_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "out"
            outputs = {"catalogs.csv": b"original\n", "sources/file.ftl": b"x = text\n"}
            with self.assertRaisesRegex(inv.InventoryError, "missing"):
                inv.save_outputs(root, outputs, check=True)
            self.assertFalse(root.exists())
            inv.save_outputs(root, outputs)
            inv.save_outputs(root, outputs, check=True)
            inv.save_outputs(root, outputs)
            (root / "catalogs.csv").write_bytes(b"reviewer annotation\n")
            with self.assertRaisesRegex(inv.InventoryError, "changed"):
                inv.save_outputs(root, outputs)
            self.assertEqual((root / "catalogs.csv").read_bytes(), b"reviewer annotation\n")
            (root / "extra").write_bytes(b"user-owned")
            with self.assertRaisesRegex(inv.InventoryError, "extra"):
                inv.save_outputs(root, outputs, check=True)

    def test_source_and_output_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "target").write_bytes(b"text")
            (root / "link").symlink_to("target")
            with self.assertRaisesRegex(inv.InventoryError, "regular file"):
                inv.read_source(root, "link")
            with self.assertRaisesRegex(inv.InventoryError, "symlink"):
                inv.save_outputs(root / "link", {})
            out = root / "out"
            out.mkdir()
            (out / "link").symlink_to(root / "target")
            with self.assertRaisesRegex(inv.InventoryError, "symlink"):
                inv.save_outputs(out, {"file": b"text"})

    def test_generation_rejects_source_as_output(self):
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", new_callable=io.StringIO) as err:
            self.assertEqual(inv.main(["--source", directory, "--output", directory]), 1)
            self.assertIn("must not contain each other", err.getvalue())


@unittest.skipUnless(os.environ.get("JOUZU_JA_REVIEW_SOURCE"), "set JOUZU_JA_REVIEW_SOURCE for pinned-source integration tests")
class PinnedCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(os.environ["JOUZU_JA_REVIEW_SOURCE"])
        cls.provenance, cls.counts = integration_contract()
        cls.outputs = cls.export(source_mode="snapshots")
        cls.manifest = json.loads(cls.outputs["manifest.json"])
        cls.inventory = json.loads(cls.outputs["catalogs.json"])

    @classmethod
    def export(cls, provenance=None, source_mode=inv.DEFAULT_SOURCE_MODE, **kwargs):
        return inv.build_outputs(cls.root, provenance or cls.provenance, source_mode=source_mode,
                                 counts=cls.counts, **kwargs)

    def test_all_entries_independently_counted_and_reconstructed(self):
        counts = Counter()
        for record in self.manifest["source_files"]:
            path = record["path"]
            raw = (self.root / path).read_bytes()
            self.assertEqual(self.outputs[record["snapshot"]], raw, path)
            self.assertEqual(record["sha256"], inv.sha256(raw), path)
            if not path.endswith(".ftl"):
                continue
            # Independent identifier scan for this pin; parser counts must agree.
            identifiers = re.findall(rb"(?m)^(-?[A-Za-z][A-Za-z0-9_-]*)\s*=", raw)
            counts[path.split("/")[3]] += len(identifiers)
            blocks = self.inventory["files"][path]["blocks"]
            self.assertEqual("".join(block["source"] for block in blocks).encode(), raw)
            self.assertEqual(set(i.decode() for i in identifiers), set(self.inventory["files"][path]["messages"]))
        self.assertEqual(dict(counts), dict.fromkeys(inv.LOCALES, self.counts.ids_per_locale))
        self.assertEqual(len(self.inventory["messages"]), self.counts.ids_per_locale)
        self.assertEqual(self.manifest["pin_count_contract"], self.counts.to_dict())
        for locale in inv.LOCALES:
            self.assertEqual(self.manifest["counts"][locale], self.counts.file_counts)
        for row in self.inventory["messages"]:
            self.assertEqual(row["review_status"], inv.REVIEW_STATUS)
            for locale in inv.LOCALES:
                value = row["locales"][locale]
                raw = (self.root / value["path"]).read_bytes().decode().splitlines(keepends=True)
                self.assertEqual(value["source"], "".join(raw[value["start_line"] - 1:value["end_line"]]))

    def test_csv_html_and_source_boundaries(self):
        rows = list(csv.DictReader(io.StringIO(self.outputs["catalogs.csv"].decode(), newline="")))
        self.assertEqual(len(rows), self.counts.ids_per_locale)
        parsed = Tags()
        parsed.feed(self.outputs["catalogs.html"].decode())
        self.assertEqual(len(parsed.articles), self.counts.ids_per_locale)
        self.assertEqual(len(set(parsed.articles)), self.counts.ids_per_locale)
        paths = {r["path"] for r in self.manifest["source_files"]}
        for category, expected in inv.SOURCE_GROUPS.items():
            self.assertTrue(set(expected) <= paths, category)
        profile_paths = {p for p in inv.tracked_paths(self.root) if p.startswith("packages/cli/profiles/")}
        self.assertTrue(profile_paths <= paths)
        self.assertIn("packaging/launcher/installer-messages.nsh", paths)
        self.assertIn("packages/cli/src/release-surface-record.ts", paths)
        allowlist = json.loads((self.root / "scripts/direct-strings-allowlist.json").read_bytes())
        self.assertEqual(len(allowlist), self.counts.allowlist_entries)
        self.assertTrue({entry["file"] for entry in allowlist} <= paths)
        direct_rows = list(csv.DictReader(io.StringIO(self.outputs["direct-strings.csv"].decode(), newline="")))
        self.assertEqual(len(direct_rows), self.counts.allowlist_entries)
        self.assertEqual(len({entry["record_id"] for entry in direct_rows}), self.counts.allowlist_entries)
        for exported, original in zip(direct_rows, allowlist):
            for key, value in original.items():
                self.assertEqual(exported[key], value)
            self.assertEqual(exported["review_status"], inv.REVIEW_STATUS)
        self.assertFalse(self.manifest["coverage_boundaries"]["direct_strings"]["detector_executed_by_exporter"])
        self.assertIn(b"not all hardcoded UI strings", self.outputs["README.md"])
        self.assertIn(b"not a complete\nflattened string table", self.outputs["README.md"])
        source_page = Tags()
        source_page.feed(self.outputs["sources.html"].decode())
        self.assertNotIn("script", source_page.tags)
        self.assertEqual(len(source_page.articles), len(paths))

    def test_alternate_repository_propagates_without_changing_snapshots(self):
        pin = inv.SourcePin("https://github.com/example-org/example-project", self.provenance.commit)
        outputs = self.export(pin, source_mode="snapshots")
        manifest = json.loads(outputs["manifest.json"])
        self.assertEqual(manifest["repository"], pin.repository)
        for record in manifest["source_files"]:
            self.assertTrue(record["source_url"].startswith(pin.repository + "/blob/" + pin.commit))
            self.assertEqual(outputs[record["snapshot"]], self.outputs[record["snapshot"]])
        rows = json.loads(outputs["catalogs.json"])["messages"]
        for row in rows:
            self.assertTrue(row["locales"]["ja"]["source_url"].startswith(pin.repository + "/blob/"))
        with self.assertRaisesRegex(inv.InventoryError, "file-count contract"):
            self.export(expected_ids=self.counts.ids_per_locale - 1)

    def test_link_only_package_has_no_copied_or_embedded_source_files(self):
        outputs = self.export()
        self.assertFalse(any(path.startswith("sources/") for path in outputs))
        self.assertEqual(len(outputs), 11)
        manifest = json.loads(outputs["manifest.json"])
        self.assertEqual(manifest["source_mode"], "links")
        self.assertTrue(all(record["snapshot"] is None for record in manifest["source_files"]))
        self.assertNotIn(b"<pre>", outputs["sources.html"])
        self.assertNotIn(b'href="sources/', outputs["catalogs.html"])
        self.assertNotIn(b'href="sources/', outputs["sources.html"])
        self.assertNotIn(b"(sources/", outputs["README.md"])
        self.assertIn(self.provenance.repository.encode(), outputs["README.md"])
        self.assertNotRegex(outputs["README.md"].decode(), r"\b(?:baseline|coordinator|historical)\b")
        self.assertNotRegex(outputs["README.md"].decode(), r"[\u3040-\u30ff\u3400-\u9fff]")
        self.assertIn(b"not copied", outputs["sources.html"])
        for record in manifest["source_files"]:
            self.assertEqual(record["sha256"], inv.sha256((self.root / record["path"]).read_bytes()))
        self.assertEqual(json.loads(outputs["catalogs.json"])["messages"], self.inventory["messages"])
        self.assertEqual(outputs, self.export())

    def test_missing_optional_context_is_recorded_not_required_or_imported(self):
        paths = [p for p in inv.tracked_paths(self.root) if p not in inv.OPTIONAL_CONTEXT]
        with patch.object(inv, "tracked_paths", return_value=paths):
            outputs = self.export()
        manifest = json.loads(outputs["manifest.json"])
        self.assertEqual(manifest["omitted_optional_context"], sorted(inv.OPTIONAL_CONTEXT))
        self.assertFalse(set(inv.OPTIONAL_CONTEXT) & {r["path"] for r in manifest["source_files"]})
        self.assertEqual(manifest["ids_per_locale"], self.counts.ids_per_locale)
        self.assertIn(b"an absent review record is not evidence of approval", outputs["README.md"])

    def test_wrong_contract_counts_fail_against_candidate(self):
        wrong_files = dict(self.counts.file_counts)
        first = next(iter(wrong_files))
        wrong_files[first] += 1
        for counts, expected_error in (
            (replace(self.counts, file_counts=wrong_files), "pinned counts differ"),
            (replace(self.counts, allowlist_entries=self.counts.allowlist_entries + 1), "allowlist count differs"),
        ):
            with self.subTest(counts=counts.to_dict()), self.assertRaisesRegex(inv.InventoryError, expected_error):
                inv.build_outputs(self.root, self.provenance, counts=counts)

    def test_deterministic_regeneration_and_every_digest(self):
        self.assertEqual(self.outputs, self.export(source_mode="snapshots"))
        for path, digest in self.manifest["output_sha256"].items():
            self.assertEqual(inv.sha256(self.outputs[path]), digest, path)
        checksums = self.outputs["SHA256SUMS"].decode().splitlines()
        self.assertEqual(len(checksums), len(self.outputs) - 1)
        for line in checksums:
            digest, path = line.split("  ", 1)
            self.assertEqual(inv.sha256(self.outputs[path]), digest, path)
        inv.verify_source(self.root, self.provenance.commit)


if __name__ == "__main__":
    unittest.main()
