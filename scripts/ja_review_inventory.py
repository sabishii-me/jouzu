#!/usr/bin/env python3
"""Export the pinned Japanese localization review inventory without product dependencies."""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from dataclasses import dataclass
import hashlib
import html
import io
import json
from pathlib import Path
import re
import subprocess
import sys
from types import MappingProxyType
from typing import Mapping
from urllib.parse import quote

# Repin this commit and PIN_COUNTS together after validating the candidate source.
PIN = "df12d20bb693d595f6814335d5b53082815342c7"
REPOSITORY = "https://github.com/shisa-ai/jouzu"
DEFAULT_SOURCE_MODE = "links"
LOCALES = ("en", "ja", "zh-Hans", "zh-Hant")
LOCALE_ROOT = "packages/cli/locales/"
REVIEW_STATUS = "unreviewed-in-this-review"
IDENTIFIER = r"-?[A-Za-z][A-Za-z0-9_-]*"
ENTRY = re.compile(rf"^({IDENTIFIER})[ \t]*=")
ATTRIBUTE = re.compile(r"^[ \t]+\.([A-Za-z][A-Za-z0-9_-]*)[ \t]*=")
VARIABLE = re.compile(r"\$([A-Za-z][A-Za-z0-9_-]*)")
# Discovery is evidence of coverage, not a claim to detect every English literal.
DISCOVERY = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]|[\"']zh-Han[st][\"']|LANG_JAPANESE")
DISCLOSURE_PATTERNS = {
    "personal-or-temporary-path": re.compile(r"/home/[^\s/]+|/Users/[^\s/]+|/tmp/|[A-Z]:\\Users\\", re.I),
    "work-item-or-milestone-reference": re.compile(r"\b[A-Z]{2,8}-?\d{2,6}\b|\bmilestone\b"),
    "local-hostname": re.compile(r"\b(?:localhost|[\w.-]+\.(?:local|internal|lan))\b"),
    "internal-operation-reference": re.compile(r"outside this repository|internal[- ]only|private (?:repository|runbook)|not for publication", re.I),
}

# Complete files, never slices. The pin fixes this source boundary; the discovery
# pass also includes first-party files containing CJK text or locale markers.
SOURCE_GROUPS = {
    "desktop-localization": [
        "apps/launcher/src/i18n.ts",
        "apps/launcher/src/recovery-text.ts",
        "apps/launcher/src/update-preview.tsx",
    ],
    "installer-localization": [
        "packaging/launcher/installer-messages.nsh",
        "packaging/launcher/installer.nsi",
        "apps/launcher/src-tauri/tauri.conf.json",
    ],
    "language-contract-and-wiring": [
        "packages/cli/src/language-choice.ts",
        "packages/cli/src/language-contract.ts",
        "packages/cli/src/language-settings.ts",
        "packages/cli/src/ui-locale.ts",
        "packages/cli/src/locale-catalog.ts",
        "packages/cli/src/locale-status.ts",
        "packages/cli/src/localization-deferral.ts",
        "packages/cli/src/localization-ops.ts",
        "packages/cli/src/profile-choice.ts",
        "packages/cli/src/profile-manager.ts",
        "packages/cli/src/profile-migration.ts",
        "packages/cli/src/profile-migration-command.ts",
        "packages/cli/src/profiles.ts",
        "packages/cli/src/main-cli.ts",
        "packages/cli/src/subagents/language.ts",
        "packages/cli/src/subagents/roles.ts",
        "packages/cli/src/subagents/resources.ts",
        "packages/cli/src/subagents/protocol.ts",
        "packages/cli/src/subagents/manager.ts",
    ],
    "catalog-contract-and-protected-values": [
        "packages/cli/locales/catalog.lock.json",
        "packages/cli/locales/catalog-status.json",
        "packages/cli/src/cli-messages.ts",
        "packages/cli/src/human-messages.ts",
        "packages/cli/src/command-report.ts",
        "packages/cli/test/protected-values.test.mjs",
        "scripts/check-locales.mjs",
        "scripts/catalog-digest.mjs",
    ],
    "direct-string-check-and-allowlist": [
        "scripts/direct-strings-allowlist.json",
        "scripts/check-direct-strings.mjs",
        "packages/cli/test/direct-strings.test.mjs",
    ],
    "residual-English-ownership": [
        "packages/cli/src/release-surface-record.ts",
        "packages/cli/release-extensions.json",
        "upstream/pi.lock.json",
        "docs/localization.md",
    ],
    "language-review-context": [
        "docs/configuration.md",
        "docs/profiles.md",
    ],
}
# Review evidence is optional context, not a runtime dependency.
OPTIONAL_CONTEXT = (
    "docs/evaluation/per-language-eval-criteria.md",
    "docs/evaluation/per-language-eval-record.md",
    "docs/localization-cjk-verification.md",
    "docs/localization-zh-hans-review.md",
    "docs/localization-zh-hant-review.md",
)


class InventoryError(ValueError):
    """Input or output does not meet the pinned inventory contract."""


@dataclass(frozen=True)
class SourcePin:
    repository: str = REPOSITORY
    commit: str = PIN

    def __post_init__(self):
        if not isinstance(self.repository, str) or not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", self.repository):
            raise InventoryError("repository must be an HTTPS GitHub repository URL without a ref, query, or credentials")
        if not isinstance(self.commit, str) or not re.fullmatch(r"[0-9a-f]{40}", self.commit):
            raise InventoryError("expected commit must be a full lowercase 40-character Git commit ID")


@dataclass(frozen=True)
class CountContract:
    """Exact catalog-file and allowlist counts for one candidate pin."""

    file_counts: Mapping[str, int]
    allowlist_entries: int

    def __post_init__(self):
        if not isinstance(self.file_counts, Mapping) or not self.file_counts:
            raise InventoryError("count contract requires catalog file counts")
        for name, count in self.file_counts.items():
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.ftl", name):
                raise InventoryError("count contract keys must be catalog filenames")
            if type(count) is not int or count < 1:
                raise InventoryError("catalog file counts must be positive integers")
        if type(self.allowlist_entries) is not int or self.allowlist_entries < 1:
            raise InventoryError("allowlist entry count must be a positive integer")
        object.__setattr__(self, "file_counts", MappingProxyType(dict(sorted(self.file_counts.items()))))

    @property
    def ids_per_locale(self) -> int:
        return sum(self.file_counts.values())

    def to_dict(self) -> dict:
        return {
            "file_counts": dict(self.file_counts),
            "ids_per_locale": self.ids_per_locale,
            "allowlist_entries": self.allowlist_entries,
        }


# Keep all candidate count expectations here; totals and tests derive from them.
PIN_COUNTS = CountContract(
    file_counts={
        "cli.ftl": 1492,
        "localization-deferral.ftl": 9,
        "localization-settings.ftl": 19,
        "profile-migration-command.ftl": 15,
        "runtime.ftl": 41,
    },
    allowlist_entries=165,
)
DEFAULT_SOURCE = SourcePin()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def source_url(path: str, start: int | None = None, end: int | None = None, provenance: SourcePin = DEFAULT_SOURCE) -> str:
    url = f"{provenance.repository}/blob/{provenance.commit}/{quote(path, safe='/')}"
    if start is not None:
        url += f"#L{start}"
        if end is not None and end != start:
            url += f"-L{end}"
    return url


def git(root: Path, *args: str) -> bytes:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False)
    if result.returncode:
        raise InventoryError(f"git {' '.join(args)} failed: {result.stderr.decode('utf-8', errors='replace').strip()}")
    return result.stdout


def verify_source(root: Path, expected_commit: str = PIN) -> None:
    actual = git(root, "rev-parse", "HEAD").decode().strip()
    if actual != expected_commit:
        raise InventoryError(f"source pin mismatch: expected {expected_commit}, found {actual}")
    if git(root, "status", "--porcelain=v1", "--untracked-files=all"):
        raise InventoryError("source checkout is not clean; use a clean checkout of the pinned commit")


def tracked_paths(root: Path) -> list[str]:
    return sorted(p for p in git(root, "ls-files", "-z").decode("utf-8").split("\0") if p)


def read_source(root: Path, path: str) -> bytes:
    target = root / path
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(root.resolve()):
        raise InventoryError(f"source must be a regular file inside the checkout: {path}")
    return target.read_bytes()


def unique_json(data: bytes, path: str, expected_type: type = dict):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InventoryError(f"{path}: duplicate JSON key {key}")
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise InventoryError(f"{path}: invalid JSON: {error}") from error
    if not isinstance(value, expected_type):
        shape = "object" if expected_type is dict else "array"
        raise InventoryError(f"{path}: expected a JSON {shape}")
    return value


def read_allowlist(data: bytes, paths: list[str]) -> list[dict]:
    path = "scripts/direct-strings-allowlist.json"
    entries = unique_json(data, path, list)
    if not entries:
        raise InventoryError("direct-string allowlist must not be empty")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or any(not isinstance(entry.get(key), str) or not entry[key].strip()
                                              for key in ("file", "kind", "text", "category", "reason")):
            raise InventoryError("direct-string allowlist: every entry needs file, kind, text, category, and reason")
        key = (entry["file"], entry["kind"], entry["text"])
        if key in seen:
            raise InventoryError(f"direct-string allowlist: duplicate entry {key}")
        seen.add(key)
        if entry["file"] not in paths:
            raise InventoryError(f"direct-string allowlist: missing source {entry['file']}")
    return entries


def validate_pattern(pattern: str, where: str) -> None:
    """Fail closed on syntax outside the candidate's Fluent expression subset.

    This is a lossless source inventory, not a replacement for @fluent/syntax.
    Accept variables, quoted literals, nested placeables, and variable selects.
    Do not evaluate, unescape, normalize, or render any catalog value.
    """
    def fail(detail):
        raise InventoryError(f"{where}: {detail}")

    def expression(body):
        body = body.strip()
        if re.fullmatch(r"\$[A-Za-z][A-Za-z0-9_-]*", body):
            return
        if body.startswith('"'):
            if not re.fullmatch(r'"(?:[^"\\\r\n]|\\(?:[\\"]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}))*"', body):
                fail("invalid quoted Fluent literal")
            return
        select = re.match(r"\$[A-Za-z][A-Za-z0-9_-]*[ \t]*->[ \t]*\r?\n", body)
        if not select:
            fail("unsupported or malformed Fluent expression (no content was exported)")
        variants = body[select.end():]
        # Mark nested placeables with spaces before recognizing top-level variants.
        masked = list(variants)
        depth = 0
        quoted = False
        escaped = False
        for pos, char in enumerate(variants):
            if depth and char == '"' and not escaped:
                quoted = not quoted
            if not quoted:
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
            if depth or char == "}":
                if char not in "\r\n":
                    masked[pos] = " "
            escaped = char == "\\" and not escaped if quoted else False
        headers = list(re.finditer(r"(?m)^[ \t]*(\*?)\[([A-Za-z][A-Za-z0-9_-]*|-?\d+(?:\.\d+)?)\]", "".join(masked)))
        if not headers or variants[:headers[0].start()].strip():
            fail("select has no valid variants")
        if sum(bool(h[1]) for h in headers) != 1:
            fail("select must have exactly one default variant")
        keys = [h[2] for h in headers]
        if len(keys) != len(set(keys)):
            fail("duplicate select variant")
        for i, header in enumerate(headers):
            end = headers[i + 1].start() if i + 1 < len(headers) else len(variants)
            value = variants[header.end():end]
            if not value.strip():
                fail("empty select variant")
            validate_pattern(value, where)

    i = 0
    while i < len(pattern):
        if pattern[i] == "}":
            fail("unmatched closing brace")
        if pattern[i] != "{":
            i += 1
            continue
        start = i + 1
        depth = 1
        quoted = False
        escaped = False
        i += 1
        while i < len(pattern) and depth:
            char = pattern[i]
            if char == '"' and not escaped:
                quoted = not quoted
            if not quoted:
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
            escaped = char == "\\" and not escaped if quoted else False
            i += 1
        if depth or quoted:
            fail("unclosed Fluent placeable or string")
        expression(pattern[start:i - 1])


def parse_fluent(data: bytes, path: str) -> dict:
    """Keep every source byte in ordered message/comment/blank blocks."""
    try:
        text = data.decode("utf-8")
    except UnicodeError as error:
        raise InventoryError(f"{path}: catalog is not UTF-8") from error
    if "\x00" in text or text.startswith("\ufeff"):
        raise InventoryError(f"{path}: unsupported NUL or byte-order mark")
    lines = text.splitlines(keepends=True)
    blocks = []
    messages = {}
    context = ""
    i = 0
    while i < len(lines):
        start = i
        line = lines[i]
        if not line.strip() or line.startswith("#"):
            kind = "comment" if line.startswith("#") else "blank"
            i += 1
            while i < len(lines) and (lines[i].startswith("#") if kind == "comment" else not lines[i].strip()):
                i += 1
            raw = "".join(lines[start:i])
            blocks.append({"kind": kind, "start_line": start + 1, "end_line": i, "source": raw})
            if kind == "comment":
                context += raw
            continue
        match = ENTRY.match(line)
        if not match:
            raise InventoryError(f"{path}:{i + 1}: malformed or unsupported Fluent entry")
        identifier = match[1]
        if identifier in messages:
            raise InventoryError(f"{path}:{i + 1}: duplicate Fluent ID {identifier}")
        i += 1
        while i < len(lines):
            following = lines[i]
            if ENTRY.match(following) or following.startswith("#"):
                break
            if not following.strip():
                j = i
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j == len(lines) or not (lines[j].startswith((" ", "\t", "}"))):
                    break
                i = j
                continue
            if not following.startswith((" ", "\t", "}")):
                raise InventoryError(f"{path}:{i + 1}: malformed continuation")
            i += 1
        raw = "".join(lines[start:i])
        value = line[match.end():]
        attributes = {}
        current = None
        for continuation in lines[start + 1:i]:
            attr = ATTRIBUTE.match(continuation)
            if attr:
                current = attr[1]
                if current in attributes:
                    raise InventoryError(f"{path}:{start + 1}: duplicate attribute {current}")
                attributes[current] = continuation[attr.end():]
            elif current is None:
                value += continuation
            else:
                attributes[current] += continuation
        if not value.strip() and not attributes:
            raise InventoryError(f"{path}:{start + 1}: empty Fluent message {identifier}")
        if identifier.startswith("-") and not value.strip():
            raise InventoryError(f"{path}:{start + 1}: Fluent term requires a value")
        validate_pattern(value, f"{path}:{start + 1}:{identifier}")
        for name, pattern in attributes.items():
            if not pattern.strip():
                raise InventoryError(f"{path}:{start + 1}: empty attribute {name}")
            validate_pattern(pattern, f"{path}:{start + 1}:{identifier}.{name}")
        message = {
            "id": identifier, "kind": "term" if identifier.startswith("-") else "message",
            "source": raw, "value_source": value, "attributes": attributes,
            "preceding_comments": context, "start_line": start + 1, "end_line": i,
        }
        context = ""
        messages[identifier] = message
        blocks.append(message)
    if "".join(block["source"] for block in blocks).encode("utf-8") != data:
        raise InventoryError(f"{path}: lossless extraction failed")
    return {"blocks": blocks, "messages": messages}


def collect_catalogs(blobs: dict[str, bytes], expected_counts: Mapping[str, int] | None = None, provenance: SourcePin = DEFAULT_SOURCE) -> tuple[list, dict]:
    catalog_paths = sorted(p for p in blobs if p.endswith(".ftl"))
    by_locale = {locale: {} for locale in LOCALES}
    counts = {locale: {} for locale in LOCALES}
    parsed = {}
    for path in catalog_paths:
        parts = path.split("/")
        if len(parts) != 5 or not path.startswith(LOCALE_ROOT) or parts[3] not in LOCALES:
            raise InventoryError(f"unexpected Fluent source: {path}")
        locale, namespace = parts[3:]
        catalog = parse_fluent(blobs[path], path)
        parsed[path] = catalog
        counts[locale][namespace] = len(catalog["messages"])
        for identifier, message in catalog["messages"].items():
            if identifier in by_locale[locale]:
                raise InventoryError(f"{locale}: duplicate Fluent ID across files: {identifier}")
            by_locale[locale][identifier] = {**message, "path": path, "namespace": namespace}
    english = by_locale["en"]
    if not english:
        raise InventoryError("missing English catalog messages")
    for locale, entries in by_locale.items():
        missing, extra = sorted(english.keys() - entries.keys()), sorted(entries.keys() - english.keys())
        if missing or extra:
            raise InventoryError(f"{locale}: key parity failure; missing={missing}, extra={extra}")
        if counts[locale] != counts["en"]:
            raise InventoryError(f"{locale}: namespace/count parity failure")
        if expected_counts is not None and counts[locale] != expected_counts:
            raise InventoryError(f"{locale}: pinned counts differ: {counts[locale]} != {expected_counts}")
        for identifier, entry in entries.items():
            original = english[identifier]
            if entry["namespace"] != original["namespace"]:
                raise InventoryError(f"{locale}:{identifier}: namespace mismatch")
            if entry["attributes"].keys() != original["attributes"].keys():
                raise InventoryError(f"{locale}:{identifier}: attribute key parity failure")
            for component in [None, *original["attributes"]]:
                a = original["value_source"] if component is None else original["attributes"][component]
                b = entry["value_source"] if component is None else entry["attributes"][component]
                if set(VARIABLE.findall(a)) != set(VARIABLE.findall(b)):
                    raise InventoryError(f"{locale}:{identifier}: placeholder parity failure")
    rows = []
    for identifier in sorted(english, key=lambda key: (english[key]["namespace"], key)):
        entry = english[identifier]
        row = {
            "fluent_id": identifier, "stable_id": identifier.replace("-", "."),
            "namespace": entry["namespace"], "entry_kind": entry["kind"],
            "review_status": REVIEW_STATUS, "locales": {},
        }
        for locale in LOCALES:
            value = by_locale[locale][identifier]
            same = (value["value_source"] == entry["value_source"] and value["attributes"] == entry["attributes"])
            row["locales"][locale] = {
                **value, "source_url": source_url(value["path"], value["start_line"], value["end_line"], provenance),
                "same_as_en": same, "sha256": sha256(value["source"].encode("utf-8")),
                "variables": sorted(set(VARIABLE.findall(value["source"]))),
            }
        rows.append(row)
    return rows, {"counts": counts, "parsed": parsed}


def check_catalog_lock(blobs: dict[str, bytes]) -> dict:
    path = LOCALE_ROOT + "catalog.lock.json"
    if path not in blobs:
        raise InventoryError("missing catalog.lock.json")
    lock = unique_json(blobs[path], path)
    if not isinstance(lock.get("version"), str) or not lock["version"]:
        raise InventoryError("catalog lock requires a non-empty version")
    if not isinstance(lock.get("locales"), dict) or set(lock["locales"]) != set(LOCALES):
        raise InventoryError("catalog lock locale set differs from the four pinned locales")
    if not isinstance(lock.get("extra"), dict):
        raise InventoryError("catalog lock extra must be an object")
    recorded = {LOCALE_ROOT + locale + "/cli.ftl": digest for locale, digest in lock["locales"].items()}
    recorded.update({LOCALE_ROOT + key: digest for key, digest in lock["extra"].items()})
    actual = {p: sha256(data) for p, data in blobs.items() if p.endswith(".ftl")}
    if recorded != actual:
        raise InventoryError("catalog lock digests/file set differ from source bytes")
    return lock


def select_sources(root: Path, paths: list[str], provenance: SourcePin = DEFAULT_SOURCE, counts: CountContract = PIN_COUNTS) -> tuple[dict, list]:
    selected = {}
    for category, members in SOURCE_GROUPS.items():
        for path in members:
            if path not in paths:
                raise InventoryError(f"missing required localization source: {path}")
            selected[path] = category
    for path in OPTIONAL_CONTEXT:
        if path in paths:
            selected[path] = "language-review-context"
    for path in paths:
        if path.endswith(".ftl"):
            selected[path] = "fluent-catalog"
        elif path.startswith("packages/cli/profiles/"):
            selected[path] = "profile-prompt-asset"
        elif path.startswith("docs/localization"):
            selected[path] = "language-review-context"
    allowlist = read_allowlist(read_source(root, "scripts/direct-strings-allowlist.json"), paths)
    if len(allowlist) != counts.allowlist_entries:
        raise InventoryError(f"pinned direct-string allowlist count differs: {len(allowlist)} != {counts.allowlist_entries}")
    for entry in allowlist:
        selected.setdefault(entry["file"], "allowlisted-direct-string-source")
    evidence = []
    for path in paths:
        # Vendored libraries have their own localization/data; inventory their boundary,
        # not their Unicode tables or dependency-owned strings.
        # Generated review exports are not product sources; do not recursively index them.
        if path.startswith(("upstream/", "review/ja-localization/")) or (root / path).is_symlink():
            continue
        try:
            text = read_source(root, path).decode("utf-8")
        except UnicodeError:
            continue
        matches = [i for i, line in enumerate(text.splitlines(), 1) if DISCOVERY.search(line)]
        if not matches or path.endswith(".ftl"):
            continue
        test = bool(re.search(r"(^|/)(test|tests|e2e|fixtures)/|[.-](test|spec)\.|(^|/)test[-_]|smoke", path))
        if path not in selected and not test:
            selected[path] = "additional-localization-source"
        evidence.append({
            "path": path, "matched_lines": matches, "source_url": source_url(path, provenance=provenance),
            "disposition": "indexed-source" if path in selected else "test-or-fixture-reference",
        })
    return dict(sorted(selected.items())), evidence


def disclosure_review(blobs: dict[str, bytes], provenance: SourcePin = DEFAULT_SOURCE, source_mode: str = DEFAULT_SOURCE_MODE) -> dict:
    findings = []
    for path, data in sorted(blobs.items()):
        for number, line in enumerate(data.decode("utf-8").splitlines(), 1):
            for category, pattern in DISCLOSURE_PATTERNS.items():
                if pattern.search(line):
                    findings.append({
                        "category": category, "path": path, "line": number, "text": line,
                        "source_url": source_url(path, number, provenance=provenance),
                        "snapshot": "sources/" + path if source_mode == "snapshots" else None,
                    })
    return {
        "status": "requires-public-disclosure-review",
        "boundary": "Heuristic flags only; examples and localhost are not necessarily private. No automatic redaction or publication approval. Source content remains unchanged.",
        "patterns": {name: pattern.pattern for name, pattern in DISCLOSURE_PATTERNS.items()},
        "findings": findings,
    }


def csv_bytes(fields: list[str], rows: list[dict]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n", quoting=csv.QUOTE_ALL)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def catalog_csv(rows: list[dict]) -> bytes:
    fields = ["stable_id", "fluent_id", "namespace", "entry_kind", "review_status"]
    suffixes = ["source", "source_url", "value_source", "attributes_json", "preceding_comments", "same_as_en", "sha256"]
    fields += [f"{locale}_{suffix}" for locale in LOCALES for suffix in suffixes]
    fields += ["reviewer", "finding", "severity", "suggested_ja", "context_or_steps", "decision"]
    result = []
    for row in rows:
        flat = {field: row[field] for field in fields[:5]}
        for locale, value in row["locales"].items():
            for suffix in suffixes:
                content = json.dumps(value["attributes"], ensure_ascii=False, sort_keys=True) if suffix == "attributes_json" else value[suffix]
                flat[f"{locale}_{suffix}"] = str(content).lower() if isinstance(content, bool) else content
        result.append(flat)
    return csv_bytes(fields, result)


STYLE = """body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:100rem;color:#222;background:#fff}a{color:#0645ad}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,monospace;background:#f5f5f5;padding:.8rem}article{border-top:1px solid #bbb;margin:2rem 0;padding-top:1rem}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(24rem,1fr));gap:1rem}summary{cursor:pointer}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:.4rem;text-align:left}code{overflow-wrap:anywhere}.status{font-weight:bold}input{font:inherit;width:90%;padding:.4rem}.line{color:#666;font-size:12px}nav{margin:1rem 0}"""


def page(title: str, content: str, script: str = "") -> bytes:
    return ("<!doctype html>\n<html lang=\"en\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            f"<title>{html.escape(title)}</title><style>{STYLE}</style><body>"
            f"{content}{script}</body></html>\n").encode("utf-8")


def catalog_html(rows: list[dict], provenance: SourcePin = DEFAULT_SOURCE, source_mode: str = DEFAULT_SOURCE_MODE) -> bytes:
    esc = html.escape
    parts = ["<h1>Japanese localization review: all Fluent messages</h1>",
             f"<p>Candidate <code>{provenance.commit}</code>. {len(rows):,} IDs × four locales. "
             "Every row is <strong>unreviewed-in-this-review</strong>.</p>",
             '<nav><a href="README.md">Review instructions</a> · <a href="catalogs.csv">Annotation CSV</a> · '
             '<a href="sources.html">Source index and non-Fluent material</a></nav>',
             "<p>Values below are exact Fluent source, not rendered output. Whitespace, placeholders, "
             "select/plural branches and comments are preserved. “Same as English” is a review flag, "
             "not proof of an error; protected names and placeholders may match intentionally.</p>",
             '<label for="search">Search IDs or text</label> <input id="search" type="search">',
             '<p id="count" aria-live="polite"></p>', "<nav>Namespaces: "]
    for namespace in sorted({r["namespace"] for r in rows}):
        first = next(r["fluent_id"] for r in rows if r["namespace"] == namespace)
        parts.append(f'<a href="#{esc(first, quote=True)}">{esc(namespace)}</a> ')
    parts.append("</nav>")
    for row in rows:
        parts.append(f'<article id="{esc(row["fluent_id"], quote=True)}"><h2>{esc(row["stable_id"])}</h2>'
                     f'<p><code>{esc(row["namespace"])} / {esc(row["fluent_id"])}</code> · '
                     f'<span class="status">{REVIEW_STATUS}</span></p><div class="pair">')
        for locale in LOCALES:
            value = row["locales"][locale]
            full_file = "sources/" + quote(value["path"], safe="/") if source_mode == "snapshots" else source_url(value["path"], provenance=provenance)
            content = (f'<section lang="{locale}"><h3>{locale}</h3>'
                       f'<a href="{esc(value["source_url"], quote=True)}">Pinned source, lines '
                       f'{value["start_line"]}–{value["end_line"]}</a> · '
                       f'<a href="{esc(full_file, quote=True)}">Exact file</a>'
                       f'<pre>{esc(value["source"])}</pre>')
            if locale != "en" and value["same_as_en"]:
                content += "<p>Same as English</p>"
            if value["preceding_comments"]:
                content += '<details><summary>Preceding source comments</summary><pre>' + esc(value["preceding_comments"]) + '</pre></details>'
            content += "</section>"
            if locale.startswith("zh"):
                content = f"<details><summary>{locale} reference</summary>{content}</details>"
            parts.append(content)
        parts.append("</div></article>")
    script = """<script>
const search = document.getElementById('search');
const articles = [...document.querySelectorAll('article')];
const texts = articles.map(article => article.textContent.toLowerCase());
search.addEventListener('input', () => {
  const query = search.value.toLowerCase(); let visible = 0;
  articles.forEach((article, i) => { article.hidden = !texts[i].includes(query); if (!article.hidden) visible++; });
  document.getElementById('count').textContent = `${visible} / ${articles.length} IDs`;
});
</script>"""
    return page("Jouzu Japanese review: all Fluent messages", "".join(parts), script)


def source_html(records: list[dict], blobs: dict[str, bytes], source_mode: str = DEFAULT_SOURCE_MODE) -> bytes:
    esc = html.escape
    boundary = ("Full source bytes are included below and in the downloadable snapshots."
                if source_mode == "snapshots" else
                "Full source files are linked at the exact commit, not copied into this package. Follow the links online or read the same paths in your candidate checkout.")
    parts = ['<h1>Source index</h1><nav><a href="catalogs.html">All Fluent messages</a> · '
             '<a href="non-fluent.csv">Non-Fluent annotation CSV</a> · <a href="direct-strings.csv">Direct-string allowlist CSV</a> · <a href="README.md">Instructions</a></nav>',
             "<p>Non-Fluent material is indexed by full source file, not flattened into a string table. "
             "No TypeScript, installer code, or prompt is executed. All are unreviewed-in-this-review. "
             + boundary + "</p><ul>"]
    for record in records:
        parts.append(f'<li><a href="#{record["anchor"]}">{esc(record["path"])}</a> — {esc(record["category"])}</li>')
    parts.append("</ul>")
    for record in records:
        path = record["path"]
        parts.append(f'<article id="{record["anchor"]}"><h2>{esc(path)}</h2>'
                     f'<p>{esc(record["category"])} · {REVIEW_STATUS} · <a href="{esc(record["source_url"], quote=True)}">Pinned source</a></p>'
                     f'<p>SHA-256: <code>{record["sha256"]}</code> · {record["lines"]} lines</p>')
        if source_mode == "snapshots":
            text = blobs[path].decode("utf-8")
            parts.append(f'<a href="{quote(record["snapshot"], safe="/")}">Exact file</a>'
                         '<details><summary>Read complete source (line numbers are presentation only)</summary><pre>')
            for number, line in enumerate(text.splitlines(keepends=True), 1):
                parts.append(f'<span class="line" id="{record["anchor"]}-L{number}">{number:5} </span>{esc(line)}')
            parts.append("</pre></details>")
        parts.append("</article>")
    return page("Jouzu Japanese review: source index", "".join(parts))


def readme(counts: dict, rows: list, records: list, allowlist: list, provenance: SourcePin, source_mode: str, omitted: list[str]) -> bytes:
    def ref(path):
        return "sources/" + path if source_mode == "snapshots" else source_url(path, provenance=provenance)

    source_description = "byte-exact source snapshots" if source_mode == "snapshots" else "immutable links to complete source files"
    storage_boundary = (
        "The `sources/` files match the pinned source bytes, including comments and final newlines. "
        "The source browser embeds these exact files with display-only line numbers."
        if source_mode == "snapshots" else
        "No `sources/` copies or embedded non-Fluent source bodies are generated. "
        "Open pinned links online, or read the same paths in a checkout at the candidate commit. "
        "The Fluent tables remain available offline without a product installation."
    )
    omission_note = ", ".join(f"`{path}`" for path in omitted) or "None."
    direct_count = len(allowlist)
    direct_files = len({entry["file"] for entry in allowlist})
    equal = {locale: sum(row["locales"][locale]["same_as_en"] for row in rows) for locale in LOCALES[1:]}
    breakdown = "\n".join(f"| `{name}` | {count} |" for name, count in counts["en"].items())
    sources = "\n".join(f"| {category} | {count} |" for category, count in sorted(Counter(r["category"] for r in records).items()))
    return f"""# Japanese localization review

The source links identify the exact candidate commit. This inventory does not
approve a release or a translation.

Source repository: `{provenance.repository.removeprefix('https://github.com/')}`.

Candidate: [`{provenance.commit}`]({provenance.repository}/tree/{provenance.commit}).
All {len(rows):,} Fluent IDs in all four locales are included: `en`, `ja`,
`zh-Hans`, and `zh-Hant` ({len(rows) * len(LOCALES):,} locale entries). Every row
starts with `unreviewed-in-this-review`.
The candidate's existing review claims are retained as source evidence; they do
not approve any row in this review. The Chinese drafts are included for reference,
not as a claim that the CLI offers them.

## Start reviewing

1. Open [catalogs.html](catalogs.html) in a browser. No Jouzu, Node, Python,
   network connection, or installation is needed to read it. English and Japanese
   appear together; expand the Chinese reference and comment sections as needed.
   Browser search works without JavaScript; the search box filters when JavaScript
   is enabled.
2. Make a separate copy of [catalogs.csv](catalogs.csv) for annotations. Import
   it as **UTF-8, comma-separated, double-quote-delimited, with all columns as
   text**. Fields can contain quoted newlines. Do not split the file on lines.
   Importing as text also prevents spreadsheet formulas in source strings from
   being evaluated. The exporter preserves exact text rather than adding formula
   escape prefixes.
3. Fill `reviewer`, `finding`, `severity`, `suggested_ja`, `context_or_steps`, and
   `decision`; change `review_status` only after reviewing that row. Keep IDs,
   source text, and source links unchanged. Note the command, screen, width, or
   action needed to reproduce layout or behavioral findings.
4. Review [sources.html](sources.html) and annotate a copy of
   [non-fluent.csv](non-fluent.csv) for desktop, installer, prompt, and language
   policy findings. Use `source_lines_or_symbol` to locate each finding. Add rows
   when one source file has multiple findings. Use [the root review guide](../../JA-REVIEW.md)
   for the isolated build/run procedure.

## Fluent coverage

| Source file (per locale) | IDs |
| --- | ---: |
{breakdown}
| **Total per locale** | **{len(rows)}** |

The exporter rejects duplicate IDs within or across files, missing or extra locale
keys, mismatched file namespaces, attribute keys, placeholder names, lock digests,
and counts. Values are **Fluent source**, not rendered text: indentation, newlines,
`{{ $variables }}`, quoted literals, select/plural branches, and attributes remain
intact. The `*_source` CSV fields contain the full entry, including the identifier;
`*_value_source` starts immediately after `=`. `*_attributes_json` separately
records attributes without flattening their patterns. Dotted `stable_id` values
follow the candidate loader's hyphen-to-dot transform; `fluent_id` preserves the
original identifier. `namespace` is the catalog filename.

Preceding comment blocks are included with each message. All comments (including
standalone, file-level, and trailing comments) and blank lines are also retained in
[catalogs.json](catalogs.json). The source index also provides {source_description}.
Comments on protected values remain source evidence. Read the
[shared glossary]({ref('docs/localization-glossary.md')}) and
[protected-value checks]({ref('packages/cli/test/protected-values.test.mjs')})
before proposing changes to commands, identifiers, paths, or placeholders.

`same_as_en` flags exact source-value and attribute equality: `ja` {equal['ja']},
`zh-Hans` {equal['zh-Hans']}, `zh-Hant` {equal['zh-Hant']}. No identical value is
removed or marked approved. Equality can be intentional for protected names and
placeholder-only messages; it can also expose untranslated wording. It is not a
complete English-language detector or a translation-quality judgment.

## Non-Fluent boundary

There are {len(records)} indexed source files, including all {len(counts['en']) * len(LOCALES)} Fluent files.
Outside Fluent, the inventory provides **{source_description}, not a complete
flattened string table**. TypeScript dictionaries, inline arrays, generated prompt
text, NSIS installer syntax, and runtime language choices are not executed or
reinterpreted by this exporter. Review their original structure through `sources.html`.

{storage_boundary}

Evaluation, terminal-check, and approval records are optional context, not required
product inputs. Omitted known context files: {omission_note}
The manifest records these omissions; an absent review record is not evidence of approval.

| Source category | Files |
| --- | ---: |
{sources}

The source index includes:

- Desktop dictionaries in `apps/launcher/src/i18n.ts`, recovery text in
  `recovery-text.ts`, and the `labels` and `noteText` tables in `update-preview.tsx`.
- All four languages in `packaging/launcher/installer-messages.nsh`, plus the
  installer template and language configuration. Standard NSIS/Tauri page text is
  dependency-owned and is not copied from uninstalled dependencies.
- Every checked-in Core/JA profile asset and manifest, including the exact Japanese
  `APPEND_SYSTEM.md`; response/role language-contract sources, defaults, resource
  assembly, settings, choice, migration, and runtime wiring.
- Catalog support/review records, glossary/context documents, and protected-value
  checks. Existing source prose may describe behavior or prior review; this export
  does not independently validate those claims.

[discovery.json](discovery.json) records every non-Fluent tracked text file outside
`upstream/` that contains Japanese/Chinese characters, quoted `zh-Hans`/`zh-Hant`,
or `LANG_JAPANESE`, with matching lines and its indexed-source or test-fixture disposition.
The explicit source list adds English-only contract and ownership files. This
search is a reproducible coverage aid, **not a proof that every hard-coded English
literal in the application is translatable or cataloged**. Test fixtures are linked
as evidence rather than treated as product strings. Binary files, symlinks, installed
third-party packages, vendored Unicode/security data, service pages, user files,
and live provider responses are not a string inventory in this package.

## Direct strings outside the catalog

[direct-strings.csv](direct-strings.csv) includes all **{direct_count} allowlist entries**,
with exact recorded text, category, reason, immutable source links, and annotation
columns. Templates in that record use the candidate checker's `{{…}}` notation;
read the linked complete source file for exact executable syntax. All {direct_files} files
named by the allowlist are indexed. The allowlist is an ownership/exception
record, not a Japanese translation table or reviewer approval.

Read the [exact allowlist]({ref('scripts/direct-strings-allowlist.json')}),
[checker and its stated detection limits]({ref('scripts/check-direct-strings.mjs')}),
and [checker tests]({ref('packages/cli/test/direct-strings.test.mjs')}).
One allowlist entry can cover multiple locations. This exporter validates the
{direct_count}-entry record and indexes its source
files; it does **not** rerun the TypeScript-based detector or claim that its
syntactic detection shapes find all hardcoded UI strings. In a built candidate,
`node scripts/check-direct-strings.mjs --all` prints its matching file/line locations.

The {len(rows):,} Fluent rows are **not all hardcoded UI strings**. Desktop/installer
localization, prompt prose, direct-string exceptions, dependency English, and
dynamic/error text have separate source and ownership boundaries here.

## Residual English and ownership

Read the [residual-English guide]({ref('docs/localization.md')}) and
[ownership record]({ref('packages/cli/src/release-surface-record.ts')}).
Use that commit's guide and source record for its surface counts; these count
surfaces, not individual strings. This is a bounded ownership record, not a
complete desktop/installer audit or a new reviewer sign-off. Upstream Pi/extension English, protected identifiers, and service-owned
screens remain distinct from untranslated Jouzu-owned wording. Report additional
English with its source or reproduction steps; do not infer approval from ownership.

## Public disclosure boundary

[disclosure-review.json](disclosure-review.json) flags personal/local paths,
milestone naming conventions, local hostnames, and internal-operation references
in the source. These are heuristic flags, not a credential scan or a
publication approval. Examples and standard local development endpoints need
different treatment from a person's home path or private planning references.
Do not edit copied content while retaining its source digests. Review and sanitize
the candidate source where necessary, then regenerate from its clean commit.
Do not copy snapshots from another candidate into this package.

## Provenance and regeneration

[manifest.json](manifest.json) records the pin, source-file SHA-256 digests, source
links, per-locale counts, equality flags, exporter digest, and output digests.
[SHA256SUMS](SHA256SUMS) covers every output except itself, including the manifest.
No generation time or local checkout path is embedded, so repeated exports from
the same input bytes are byte-identical. HTML is escaped presentation only.
Source delivery mode: `{source_mode}`.

Regeneration requires Python 3.10+ and Git, not a product installation. Maintainers
can run the exporter from its repository against a clean source checkout:

```sh
python3 -m unittest discover -s scripts -p 'test_ja_review_inventory.py' -v
python3 scripts/ja_review_inventory.py --source /path/to/clean/candidate --repository {provenance.repository} --expected-commit {provenance.commit} --expected-ids {len(rows)} --source-mode {source_mode} --output /path/to/new/inventory
```

Add `--check` with the same source, pin, options, and output path to compare the
export without writing. `--source-mode links` avoids copying source files and
embedding their bodies in `sources.html`; use it when the package accompanies the
original repository. `--source-mode snapshots` includes byte-exact offline copies.
Optional context absent from the candidate is recorded as omitted, not imported
from another checkout.

The commit must match HEAD exactly; branch names are not accepted as immutable pins.
Every export checks the per-file and per-locale counts in `PIN_COUNTS`, its allowlist
entry count, four-locale key/namespace/attribute/placeholder parity, and catalog-lock
digests. `--expected-ids` must agree with the file-count contract; it cannot bypass
those checks. Repin `PIN` and `PIN_COUNTS` together when the candidate changes.
Set `JOUZU_JA_REVIEW_SOURCE` to a clean checkout to run the pinned-source integration
tests against that configured candidate. Without it, only unit tests run.

`--check` reads and compares every expected output, detects extra/missing files,
and writes nothing. Generation accepts an empty/new directory or already-identical
output; it refuses to overwrite changed output or reviewer annotations. Keep
annotations outside the generated directory. Source HEAD and cleanliness are
checked before and after reading. No package installation, code execution from the
candidate, provider calls, or network requests occur.

The dependency-free Fluent validator deliberately accepts only the expression
forms used by this pin (variables, quoted literals, nested placeables, variable
selects), plus multiline values and attributes. Unsupported syntax fails instead
of being dropped. It is not the full Fluent grammar or a runtime rendering test.
Native layout, input methods, installed dependency UI, and response-language behavior
still require the separate working-build review.
""".encode("utf-8")


def build_outputs(root: Path, provenance: SourcePin = DEFAULT_SOURCE, expected_ids: int | None = None,
                  source_mode: str = DEFAULT_SOURCE_MODE, counts: CountContract = PIN_COUNTS) -> dict[str, bytes]:
    if source_mode not in ("snapshots", "links"):
        raise InventoryError("source mode must be snapshots or links")
    if expected_ids is None:
        expected_ids = counts.ids_per_locale
    if type(expected_ids) is not int or expected_ids != counts.ids_per_locale:
        raise InventoryError("expected ID total must match the file-count contract")
    verify_source(root, provenance.commit)
    paths = tracked_paths(root)
    selected, discovery = select_sources(root, paths, provenance, counts)
    omitted = sorted(set(OPTIONAL_CONTEXT) - set(paths))
    blobs = {path: read_source(root, path) for path in selected}
    lock = check_catalog_lock(blobs)
    rows, catalog = collect_catalogs(blobs, counts.file_counts, provenance)
    if len(rows) != expected_ids:
        raise InventoryError(f"per-locale ID count differs: {len(rows)} != {expected_ids}")
    records = []
    outputs = {}
    for path, category in selected.items():
        data = blobs[path]
        try:
            text = data.decode("utf-8")
        except UnicodeError as error:
            raise InventoryError(f"selected source is not UTF-8: {path}") from error
        snapshot = "sources/" + path if source_mode == "snapshots" else None
        if snapshot is not None:
            outputs[snapshot] = data
        records.append({
            "path": path, "category": category, "snapshot": snapshot,
            "source_url": source_url(path, provenance=provenance), "sha256": sha256(data), "bytes": len(data),
            "lines": len(text.splitlines()), "anchor": "source-" + sha256(path.encode())[:16],
            "review_status": REVIEW_STATUS,
            "coverage": "full-Fluent-file" if category == "fluent-catalog" else f"exact-source-{'snapshot' if source_mode == 'snapshots' else 'link'}-not-flattened",
        })
    outputs["catalogs.csv"] = catalog_csv(rows)
    outputs["catalogs.html"] = catalog_html(rows, provenance, source_mode)
    outputs["catalogs.json"] = json_bytes({"messages": rows, "files": catalog["parsed"]})
    outputs["discovery.json"] = json_bytes({
        "tracked_file_count": len(paths), "pattern": DISCOVERY.pattern,
        "excluded_prefix": "upstream/", "excluded_generated_prefix": "review/ja-localization/",
        "symlinks_followed": False, "matches": discovery,
    })
    outputs["sources.html"] = source_html(records, blobs, source_mode)
    outputs["disclosure-review.json"] = json_bytes(disclosure_review(blobs, provenance, source_mode))
    non_fluent = [{**r, "source_lines_or_symbol": "", "reviewer": "", "finding": "", "severity": "", "suggested_ja": "", "decision": ""}
                  for r in records if r["category"] != "fluent-catalog"]
    outputs["non-fluent.csv"] = csv_bytes(list(non_fluent[0]), non_fluent)
    allowlist = read_allowlist(blobs["scripts/direct-strings-allowlist.json"], paths)
    direct_rows = []
    for entry in allowlist:
        key = json.dumps([entry["file"], entry["kind"], entry["text"]], ensure_ascii=False)
        direct_rows.append({
            "record_id": "direct-" + sha256(key.encode())[:24], **entry,
            "source_url": source_url(entry["file"], provenance=provenance),
            "snapshot": "sources/" + entry["file"] if source_mode == "snapshots" else None,
            "review_status": REVIEW_STATUS, "source_lines_or_symbol": "", "reviewer": "",
            "finding": "", "severity": "", "suggested_ja": "", "decision": "",
        })
    outputs["direct-strings.csv"] = csv_bytes(list(direct_rows[0]), direct_rows)
    outputs["README.md"] = readme(catalog["counts"], rows, records, allowlist, provenance, source_mode, omitted)
    manifest = {
        "schema_version": 1, "repository": provenance.repository, "commit": provenance.commit,
        "source_requirement": "exact HEAD; clean tracked and untracked worktree before and after export",
        "review_status": REVIEW_STATUS, "locales": list(LOCALES),
        "disclosure_status": "requires disclosure review before publication; see disclosure-review.json",
        "source_mode": source_mode, "omitted_optional_context": omitted,
        "pin_count_contract": counts.to_dict(),
        "counts": catalog["counts"], "ids_per_locale": len(rows), "total_locale_entries": len(rows) * len(LOCALES),
        "same_as_english": {locale: sum(r["locales"][locale]["same_as_en"] for r in rows) for locale in LOCALES[1:]},
        "catalog_lock_version": lock["version"],
        "coverage_boundaries": {
            "fluent": f"all {len(rows)} IDs in each of four locale sets; not all hardcoded UI strings",
            "non_fluent": f"complete source {'snapshots' if source_mode == 'snapshots' else 'links at the pinned commit'}; not a flattened string table",
            "direct_strings": {
                "allowlist_entries": len(allowlist), "source_files": len({e["file"] for e in allowlist}),
                "source": source_url("scripts/direct-strings-allowlist.json", provenance=provenance),
                "checker": source_url("scripts/check-direct-strings.mjs", provenance=provenance),
                "detector_executed_by_exporter": False,
                "limitation": "allowlist keys can cover multiple sites; detector shapes do not cover all hardcoded strings",
            },
            "residual_english": source_url("packages/cli/src/release-surface-record.ts", provenance=provenance),
            "excluded": ["installed third-party text", "service screens", "user files", "live model responses", "binary files", "vendored Unicode/security data"],
        },
        "source_files": records,
        "exporter": {"path": "scripts/ja_review_inventory.py", "sha256": sha256(Path(__file__).read_bytes())},
        "output_sha256": {path: sha256(data) for path, data in sorted(outputs.items())},
        "digest_boundary": "manifest excludes its own digest and SHA256SUMS; SHA256SUMS covers the manifest and all other files except itself",
    }
    outputs["manifest.json"] = json_bytes(manifest)
    outputs["SHA256SUMS"] = "".join(f"{sha256(data)}  {path}\n" for path, data in sorted(outputs.items())).encode()
    verify_source(root, provenance.commit)
    return outputs


def save_outputs(output: Path, outputs: dict[str, bytes], check: bool = False) -> None:
    if output.is_symlink():
        raise InventoryError("output directory must not be a symlink")
    if output.exists() and not output.is_dir():
        raise InventoryError("output path is not a directory")
    present = {}
    if output.exists():
        for path in output.rglob("*"):
            if path.is_symlink():
                raise InventoryError(f"output contains a symlink: {path}")
            if path.is_file():
                present[path.relative_to(output).as_posix()] = path.read_bytes()
    if present or check:
        missing = sorted(outputs.keys() - present.keys())
        extra = sorted(present.keys() - outputs.keys())
        changed = sorted(path for path in present.keys() & outputs.keys() if present[path] != outputs[path])
        if missing or extra or changed:
            raise InventoryError(f"output differs; refusing to overwrite: missing={missing}, extra={extra}, changed={changed}")
        return
    output.mkdir(parents=True, exist_ok=True)
    for path, data in sorted(outputs.items()):
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Clean checkout at the expected candidate commit.")
    parser.add_argument("--repository", default=REPOSITORY, help="HTTPS GitHub repository URL for immutable source links.")
    parser.add_argument("--expected-commit", default=PIN, help="Required full commit ID; defaults to the configured candidate pin.")
    parser.add_argument("--expected-ids", type=int, default=PIN_COUNTS.ids_per_locale, help=f"Required Fluent ID total per locale; must match PIN_COUNTS (default: {PIN_COUNTS.ids_per_locale}).")
    parser.add_argument("--source-mode", choices=("snapshots", "links"), default=DEFAULT_SOURCE_MODE, help="Index immutable source links (default), or copy exact source files.")
    parser.add_argument("--output", type=Path, default=Path("review/ja-localization"), help="New/empty output directory, or identical generated output.")
    parser.add_argument("--check", action="store_true", help="Compare all outputs without writing; fail on any difference.")
    args = parser.parse_args(argv)
    try:
        root, output = args.source.resolve(), args.output.absolute()
        if output.resolve().is_relative_to(root) or root.is_relative_to(output.resolve()):
            raise InventoryError("source and output directories must not contain each other")
        provenance = SourcePin(args.repository, args.expected_commit)
        outputs = build_outputs(root, provenance, args.expected_ids, args.source_mode)
        save_outputs(output, outputs, args.check)
    except (InventoryError, OSError) as error:
        print(f"inventory: {error}", file=sys.stderr)
        return 1
    print(f"inventory: {'verified' if args.check else 'generated'} {len(outputs)} files; {args.expected_ids} IDs × 4 locales; {provenance.commit}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
