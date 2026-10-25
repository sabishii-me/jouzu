#!/usr/bin/env python3
"""Deterministic reviewer-helper tests; no GitHub, installs, or provider calls.

Run: python3 -m unittest discover -s scripts -p 'test_ja_review.py' -v
The end-to-end fixture uses temporary fake Git/Bash/Node/npm/Go executables.
"""

from contextlib import redirect_stderr, redirect_stdout
import copy
import fcntl
import io
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import textwrap
import time
import unittest
from unittest.mock import patch

import ja_review as review


# This program simulates the supported tool interfaces, not the product. No
# source checkout, package install, or network request occurs in these tests.
FAKE_TOOL = r'''
import json
import os
from pathlib import Path
import sys

PIN = __PIN__
REPOSITORY = __REPOSITORY__
VERSION = __VERSION__
PI_VERSION = __PI_VERSION__
name = Path(sys.argv[0]).name
args = sys.argv[1:]
versions = {"git": "git version 2.50.0", "bash": "GNU bash, version 5.2.0",
            "node": "v24.16.0", "npm": "11.16.0", "go": "go1.27.1"}
if args == ["--version"] or (name == "go" and args == ["env", "GOVERSION"]):
    print(versions[name])
    sys.exit(0)

def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value) if not isinstance(value, str) else value)

def source(path):
    path.mkdir(parents=True, exist_ok=True)
    (path / ".git").mkdir(exist_ok=True)
    put(path / "packages/cli/package.json", {"version": VERSION, "dependencies": {
        "@earendil-works/pi-coding-agent": PI_VERSION}})
    put(path / "package-lock.json", {"lockfileVersion": 3})
    put(path / "packages/cli/package-lock.json", {"lockfileVersion": 3})
    put(path / "dev-build.sh", "# Fake build fixture\n")

if name in ("git", "gh"):
    if "clone" in args:
        target = Path(args[-3] if name == "gh" else args[-1])
        source(target)
        print("cloned fixture")
        sys.exit(0)
    root = Path(args[args.index("-C") + 1])
    args = args[args.index("-C") + 2:]
    config = root / ".fake-control.json"
    state = json.loads(config.read_text()) if config.exists() else {}
    if args == ["rev-parse", "--show-toplevel"]:
        print(root)
    elif args == ["rev-parse", "HEAD"]:
        print(state.get("head", PIN))
    elif args == ["remote", "get-url", "origin"]:
        print(state.get("origin", f"git@github.com:{REPOSITORY}.git"))
    elif args == ["ls-files", "-v"]:
        print(state.get("flags", "H package.json"))
    elif args and args[0] == "status":
        print(state.get("dirty", ""))
    elif args and args[0] in ("fetch", "checkout"):
        print("pinned fixture")
    else:
        sys.exit(91)
    sys.exit(0)

root = Path.cwd()
control = root / ".fake-control.json"
state = json.loads(control.read_text()) if control.exists() else {}
if name == "bash":
    if args != ["./dev-build.sh", "build"]:
        sys.exit(92)
    if state.get("fail_build"):
        print("fake build failure")
        sys.exit(7)
    put(root / "packages/cli/dist/cli.js", "// fake compiled entrypoint\n")
    put(root / "packages/cli/dist/build-info.json", {
        "schemaVersion": 1, "gitCommit": PIN, "gitDirty": False, "builtAt": "2026-10-23T00:00:00Z"})
    put(root / "packages/cli/dist/locales/catalog.lock.json", {"locales": ["en", "ja"]})
    put(root / "packages/cli/dist/pi.lock.json", {"version": PI_VERSION})
    put(root / "packages/cli/dist/textguard/manifest.json", {"toolchain": "go1.26.1"})
    put(root / "upstream/textguard/source.lock.json", {"toolchain": "go1.26.1"})
    put(root / "fake-build-env.json", dict(os.environ))
    print("fake build passed")
elif name == "node":
    if args[0] in ("scripts/check-locales.mjs", "scripts/check-dist-fresh.mjs", "scripts/dev-smoke.mjs"):
        assert os.environ.get("PI_OFFLINE") == "1"
        assert "API_KEY" not in os.environ and "OPENAI_API_KEY" not in os.environ
        assert os.environ.get("JOUZU_NO_PI_IMPORT") == "1"
        assert "checks" in os.environ["JOUZU_HOME"]
        if state.get("fail_check") == args[0]:
            print("fake check failure")
            sys.exit(8)
        print("fake check passed")
    else:
        put(root / "launched.json", {"argv": args, "cwd": str(root), "env": dict(os.environ)})
        print("fake launch passed")
else:
    sys.exit(93)
'''


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ja-review-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        fake_tool = FAKE_TOOL
        for key in ("PIN", "REPOSITORY", "VERSION", "PI_VERSION"):
            fake_tool = fake_tool.replace(f"__{key}__", repr(getattr(review, key)))
        for tool in (*review.TOOL_ARGS, "gh"):
            path = self.bin / tool
            path.write_text(f"#!{sys.executable}\n" + fake_tool, encoding="utf-8")
            path.chmod(0o755)
        self.root = self.base / "review 日本語 space"
        self.environ = patch.dict(os.environ, {
            "PATH": str(self.bin), "HOME": str(self.base / "normal-home"),
            "OPENAI_API_KEY": "do-not-inherit", "ANTHROPIC_API_KEY": "do-not-inherit",
            "JOUZU_HOME": "/normal-jouzu", "PI_CODING_AGENT_DIR": "/normal-pi",
            "JOUZU_UI_LOCALE": "en", "NODE_OPTIONS": "--require=/unsafe-file",
            "GIT_DIR": "/wrong-repository", "GIT_WORK_TREE": "/wrong-tree",
        }, clear=True)
        self.environ.start()
        self.addCleanup(self.environ.stop)

    def invoke(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = review.main(list(args))
        return status, stdout.getvalue(), stderr.getvalue()

    def build(self, *extra):
        result = self.invoke("build", "--directory", str(self.root), "--transport", "ssh", *extra)
        self.assertEqual(result[0], 0, result)
        return self.root / "source"

    def prepare_source(self, path=None):
        path = path or self.base / "candidate"
        subprocess.run([str(self.bin / "git"), "clone", "--", "fake", str(path)],
                       check=True, capture_output=True, timeout=5)
        return path

    def environment_and_tools(self):
        self.root, _ = review.open_workspace(self.root, create=True)
        env = review.isolated_env(self.root, "build-home", offline=True)
        return env, review.prerequisites(self.root, env)

    def change_source(self, source, **values):
        (source / ".fake-control.json").write_text(json.dumps(values), encoding="utf-8")

    def receipt(self):
        return review.read_json(self.root / review.RECEIPT)


class OwnershipTests(Fixture):
    def test_refuse_existing_unowned_directory_without_modification(self):
        self.root.mkdir()
        sentinel = self.root / "keep.txt"
        sentinel.write_text("user content")
        result = self.invoke("build", "--directory", str(self.root))
        self.assertEqual(result[0], 1)
        self.assertEqual(list(self.root.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), "user content")

    def test_refuse_directory_inside_git_worktree_including_ignored_paths(self):
        repository = self.base / "repository"
        repository.mkdir()
        (repository / ".git").write_text("gitdir: somewhere")
        with self.assertRaisesRegex(review.ReviewError, "outside Git"):
            review.open_workspace(repository / "ignored" / "review", create=True)
        self.assertFalse((repository / "ignored").exists())

    def test_refuse_root_symlink_and_managed_symlink(self):
        target = self.base / "target"
        target.mkdir()
        self.root.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(review.ReviewError, "symlink"):
            review.open_workspace(self.root, create=True)
        self.root.unlink()
        root, _ = review.open_workspace(self.root, create=True)
        (root / "home").symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(review.ReviewError, "symlink"):
            review.initialize_review(root)
        self.assertEqual(list(target.iterdir()), [])

    def test_refuse_managed_traversal_and_absolute_path(self):
        root, _ = review.open_workspace(self.root, create=True)
        for name in ("../outside", str(self.base / "outside")):
            with self.subTest(name=name), self.assertRaisesRegex(review.ReviewError, "outside"):
                review.managed(root, name)

    def test_refuse_marker_source_redirect_and_directory_move(self):
        root, _ = review.open_workspace(self.root, create=True)
        marker = review.read_json(root / review.MARKER)
        marker["source"] = str(self.base / "different")
        review.write_json(root / review.MARKER, marker)
        with self.assertRaisesRegex(review.ReviewError, "redirects"):
            review.open_workspace(root)
        marker["directory"] = str(self.base / "other")
        review.write_json(root / review.MARKER, marker)
        with self.assertRaisesRegex(review.ReviewError, "ownership"):
            review.open_workspace(root)

    def test_lock_blocks_overlapping_commands_and_cleans_own_lock(self):
        root, _ = review.open_workspace(self.root, create=True)
        with review.workspace_lock(root):
            with self.assertRaisesRegex(review.ReviewError, "already running"):
                with review.workspace_lock(root):
                    self.fail("second lock acquired")
        self.assertFalse((root / ".review-lock").exists())

    def test_external_source_requires_explicit_same_path_to_rebuild(self):
        source = self.prepare_source()
        root, _ = review.open_workspace(self.root, create=True, source=source)
        with self.assertRaisesRegex(review.ReviewError, "repeat --source"):
            review.open_workspace(root, create=True)
        with self.assertRaisesRegex(review.ReviewError, "differs"):
            review.open_workspace(root, create=True, source=self.base / "other")
        review.open_workspace(root, create=True, source=source)


class SourceTests(Fixture):
    def test_pin_dirty_origin_and_hidden_changes_refused(self):
        source = self.prepare_source()
        env, tools = self.environment_and_tools()
        for state, expected in (
            ({"head": "0" * 40}, "Wrong source commit"),
            ({"dirty": " M packages/cli/src/cli.ts"}, "Source is dirty"),
            ({"dirty": "?? private.txt"}, "Source is dirty"),
            ({"origin": "https://github.com/other/repo.git"}, "Source origin"),
            ({"flags": "h package.json"}, "assume-unchanged"),
            ({"flags": "S package.json"}, "skip-worktree"),
        ):
            with self.subTest(state=state):
                self.change_source(source, **state)
                before = (source / ".fake-control.json").read_bytes()
                with self.assertRaisesRegex(review.ReviewError, expected):
                    review.verify_source(source, tools, env)
                self.assertEqual((source / ".fake-control.json").read_bytes(), before)

    def test_build_refuses_wrong_external_source_before_build(self):
        source = self.prepare_source()
        self.change_source(source, head="f" * 40)
        result = self.invoke("build", "--directory", str(self.root), "--source", str(source))
        self.assertEqual(result[0], 1)
        self.assertIn("Wrong source commit", result[2])
        self.assertFalse((source / "packages/cli/dist").exists())
        self.assertFalse((self.root / review.RECEIPT).exists())

    def test_wrong_product_version_and_invalid_dependency_type_refused(self):
        source = self.prepare_source()
        env, tools = self.environment_and_tools()
        package = source / "packages/cli/package.json"
        for data in ({"version": "not-the-candidate"}, {"version": review.VERSION, "dependencies": []}):
            package.write_text(json.dumps(data))
            with self.assertRaisesRegex(review.ReviewError, "does not match"):
                review.verify_source(source, tools, env)


class EnvironmentAndArgumentsTests(Fixture):
    def test_environment_has_dedicated_homes_and_no_credentials_or_ui_override(self):
        root, _ = review.open_workspace(self.root, create=True)
        with patch.dict(os.environ, {"FUTURE_PROVIDER_TOKEN": "secret", "AWS_PROFILE": "default",
                                     "XDG_CONFIG_HOME": "/normal/config", "PI_OFFLINE": "0"}):
            env = review.isolated_env(root, offline=True)
        for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "FUTURE_PROVIDER_TOKEN", "AWS_PROFILE",
                    "JOUZU_UI_LOCALE", "PI_CODING_AGENT_DIR", "NODE_OPTIONS", "GIT_DIR"):
            self.assertNotIn(key, env)
        for key in ("HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
                    "XDG_DATA_HOME", "APPDATA", "LOCALAPPDATA", "JOUZU_HOME", "TMPDIR"):
            self.assertTrue(Path(env[key]).is_relative_to(root), (key, env[key]))
        self.assertEqual(env["JOUZU_NO_UPDATE"], "1")
        self.assertEqual(env["JOUZU_NO_PI_IMPORT"], "1")
        self.assertEqual(env["PI_OFFLINE"], "1")
        self.assertNotIn("PI_OFFLINE", review.isolated_env(root))
        self.assertFalse((self.base / "normal-home").exists())

    def test_settings_default_and_rebuild_preservation(self):
        root, _ = review.open_workspace(self.root, create=True)
        sample = review.initialize_review(root)
        self.assertIn("Use this directory to check display languages and Settings.",
                      (sample / "README.md").read_text(encoding="utf-8"))
        settings = root / "home/localization.json"
        data = review.read_json(settings)
        self.assertEqual(data["localization"], {"uiLocale": "ja", "responseLanguage": "auto"})
        data["localization"]["uiLocale"] = "en"
        review.write_json(settings, data)
        before = settings.read_bytes()
        (sample / "README.md").write_text("reviewer edits")
        review.initialize_review(root)
        self.assertEqual(settings.read_bytes(), before)
        self.assertEqual((sample / "README.md").read_text(), "reviewer edits")

    def test_forwarding_preserves_argument_boundaries_and_has_no_default_locale(self):
        tools = {"node": {"path": "/node path/node"}}
        forwarded = ["--", "--model", "provider/model", "日本語 ; $(do-not-run)"]
        command = review.launch_arguments(Path("/source path"), tools, forwarded)
        self.assertEqual(command, ["/node path/node", "/source path/" + review.ENTRYPOINT,
                                   "--jouzu-profile", "core", *forwarded[1:]])
        self.assertEqual(forwarded[0], "--")
        self.assertNotIn("--jouzu-ui-locale", command)
        for locale in ("en", "ja", "auto"):
            command = review.launch_arguments(Path("/source"), tools, ["--", "--help"], locale)
            self.assertEqual(command[-3:], ["--jouzu-ui-locale", locale, "--help"])

    def test_forwarding_rejects_home_profile_and_update_escape(self):
        tools = {"node": {"path": "/node"}}
        for args in (["--jouzu-home", "/user"], ["--jouzu-home=/user"],
                     ["--agent-dir=/user"], ["--session-dir", "/user"],
                     ["--jouzu-profile", "ja"], ["self-update"],
                     ["--jouzu-ui-locale", "en", "self-update"]):
            with self.subTest(args=args), self.assertRaises(review.ReviewError):
                review.launch_arguments(Path("/source"), tools, args)

    def test_color_controls_survive_without_provider_credentials(self):
        root, _ = review.open_workspace(self.root, create=True)
        for controls in ({"NO_COLOR": "1"}, {"FORCE_COLOR": "0"},
                         {"NO_COLOR": "", "FORCE_COLOR": "3"}):
            with self.subTest(controls=controls), patch.dict(os.environ, controls):
                env = review.isolated_env(root)
                for key, value in controls.items():
                    self.assertEqual(env.get(key), value)
                self.assertNotIn("OPENAI_API_KEY", env)
                self.assertNotIn("ANTHROPIC_API_KEY", env)
                self.assertNotIn("NODE_OPTIONS", env)

    def test_session_path_and_fork_options_are_refused(self):
        tools = {"node": {"path": "/node"}}
        for option in ("--session", "--fork"):
            for args in ([option, "/outside/normal.jsonl"], [option + "=/outside/normal.jsonl"],
                         ["pi", option, "/outside/normal.jsonl"],
                         ["--jouzu-ui-locale", "ja", option, "/outside/normal.jsonl"]):
                with self.subTest(args=args), self.assertRaisesRegex(review.ReviewError, "isolation"):
                    review.launch_arguments(Path("/source"), tools, args)
        # Pi's --session-id accepts a validated UUID, not a path; -c and -r
        # select from the dedicated session directory rather than aliasing --session.
        for args in (["--session-id", "01234567-89ab-cdef-0123-456789abcdef"], ["-c"], ["-r"]):
            self.assertEqual(review.launch_arguments(Path("/source"), tools, args)[-len(args):], args)

    def test_only_update_commands_are_refused_not_values_or_messages(self):
        tools = {"node": {"path": "/node"}}
        rejected = (["update"], ["self-update", "apply"], ["pi", "update", "--extensions"],
                    ["--", "--", "update"], ["--jouzu-ui-locale=ja", "self-update"],
                    ["--jouzu-textguard-files", "--jouzu-ui-locale", "en", "pi", "update"])
        for args in rejected:
            with self.subTest(args=args), self.assertRaisesRegex(review.ReviewError, "Updates are disabled"):
                review.launch_arguments(Path("/source"), tools, args)
        accepted = (["--name", "update"], ["-n", "self-update"], ["--model", "update"],
                    ["--model=self-update"], ["--print", "update"], ["prompt", "self-update"],
                    ["pi", "--", "update"], ["pi", "self-update"],
                    ["--jouzu-ui-locale", "ja", "--name", "self-update"])
        for args in accepted:
            with self.subTest(args=args):
                self.assertEqual(review.launch_arguments(Path("/source"), tools, args)[-len(args):], args)

    def test_parser_separates_helper_options_and_product_help(self):
        args = review.parser().parse_args(["run", "--directory", "/review", "--ui-locale", "auto",
                                          "--", "--help", "日本語 space"])
        self.assertEqual(args.ui_locale, "auto")
        self.assertEqual(args.cli_args, ["--", "--help", "日本語 space"])
        self.assertEqual(args.timeout, 7200)


class SubprocessTests(Fixture):
    def test_nonzero_exit_and_output_are_reported(self):
        records = []
        with self.assertRaisesRegex(review.ReviewError, "exited 9.*"):
            review.execute([sys.executable, "-c", "print('fixture failed');raise SystemExit(9)"],
                           cwd=self.base, env={}, timeout=5, records=records, name="fixture")
        self.assertEqual(records[0]["returncode"], 9)
        self.assertEqual(records[0]["status"], "failed")

    def test_missing_executable_is_actionable(self):
        with self.assertRaisesRegex(review.ReviewError, "Cannot run"):
            review.execute([str(self.base / "missing")], cwd=self.base, env={}, timeout=1)

    def test_timeout_is_bounded_and_recorded(self):
        records = []
        started = time.monotonic()
        # Block on an event, not a polling loop. The helper must kill it.
        with self.assertRaisesRegex(review.ReviewError, "timeout"):
            review.execute([sys.executable, "-c", "import threading;threading.Event().wait()"],
                           cwd=self.base, env={}, timeout=0.15, records=records)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(records[0]["status"], "timeout")

    def test_timeout_kills_descendants(self):
        pid_file = self.base / "descendant.pid"
        code = ("import subprocess,sys,threading; "
                "p=subprocess.Popen([sys.executable,'-c','import threading;threading.Event().wait()']); "
                f"open({str(pid_file)!r},'w').write(str(p.pid));threading.Event().wait()")
        with self.assertRaisesRegex(review.ReviewError, "timeout"):
            review.execute([sys.executable, "-c", code], cwd=self.base, env={}, timeout=0.5)
        self.assertTrue(pid_file.exists())
        pid = int(pid_file.read_text())
        # Linux can retain a dead grandchild as a zombie until init reaps it.
        stat = Path(f"/proc/{pid}/stat")
        try:
            state = stat.read_text().split()[2]
        except (FileNotFoundError, ProcessLookupError):
            # init can reap the process between opening and reading /proc.
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        else:
            self.assertIn(state, ("Z", "X"))

    def test_no_shell_interpretation(self):
        sentinel = self.base / "must-not-exist"
        value = f"Japanese 日本語; touch {sentinel}"
        output = review.execute([sys.executable, "-c", "import sys;print(sys.argv[1])", value],
                                cwd=self.base, env={}, timeout=5)
        self.assertEqual(output, value)
        self.assertFalse(sentinel.exists())

    def test_timeouts_reject_nonfinite_zero_and_excessive_values(self):
        for value in (float("inf"), float("nan"), 0, -1):
            with self.subTest(value=value), self.assertRaises(review.ReviewError):
                review.execute(["unused"], cwd=self.base, env={}, timeout=value)
        for value in ("0", "-1", "nan", "86401"):
            with self.subTest(value=value), self.assertRaises(Exception):
                review.seconds(value)

    def test_go_toolchain_suffix_preserves_version_floor(self):
        env, _ = self.environment_and_tools()
        for version, accepted in (("go1.27.1-X:nodwarf5", True), ("go1.21.0-custom", True),
                                  ("go1.20.9-custom", False), ("go1.27rc1", False),
                                  ("go1.27.1 trailing", False)):
            with self.subTest(version=version), patch.object(review, "execute", side_effect=lambda argv, **kw: {
                    "node": "v22.19.0", "go": version}.get(Path(argv[0]).name, "version")):
                if accepted:
                    self.assertEqual(review.prerequisites(self.root, env)["go"]["version"], version)
                else:
                    with self.assertRaisesRegex(review.ReviewError, "Go >=1.21"):
                        review.prerequisites(self.root, env)

    def test_missing_and_old_prerequisites(self):
        env, _ = self.environment_and_tools()
        (self.bin / "go").unlink()
        with self.assertRaisesRegex(review.ReviewError, "Missing prerequisite.*go"):
            review.prerequisites(self.root, env)
        with patch.object(review, "execute", side_effect=lambda argv, **kw: {
            "node": "v22.18.0", "go": "go1.27.1"}.get(Path(argv[0]).name, "version")):
            (self.bin / "go").write_text("placeholder")
            (self.bin / "go").chmod(0o755)
            with self.assertRaisesRegex(review.ReviewError, "Node >=22.19.0"):
                review.prerequisites(self.root, env)


class TerminalTests(Fixture):
    """A real controlling PTY delivers resize to the wrapper, not its child."""

    def start_terminal_case(self, child, *, timeout=5):
        master, slave = pty.openpty()
        before = termios.tcgetattr(slave)
        child_path = self.base / "terminal-child.py"
        child_path.write_text(textwrap.dedent(child), encoding="utf-8")
        report = self.base / "terminal-result.json"
        wrapper = textwrap.dedent(f'''\
            import fcntl, json, os, signal, sys, termios
            from pathlib import Path
            sys.path.insert(0, {str(Path(review.__file__).parent)!r})
            import ja_review as review
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
            os.tcsetpgrp(0, os.getpgrp())
            initial = termios.tcgetattr(0)
            previous = lambda signum, frame: None
            signal.signal(signal.SIGWINCH, previous)
            records = []
            error = None
            try:
                review.execute([sys.executable, {str(child_path)!r}], cwd=Path({str(self.base)!r}),
                               env={{}}, timeout={timeout!r}, interactive=True, records=records)
            except review.ReviewError as exc:
                error = str(exc)
            Path({str(report)!r}).write_text(json.dumps({{
                "error": error, "records": records,
                "attributes_restored": termios.tcgetattr(0) == initial,
                "resize_handler_restored": signal.getsignal(signal.SIGWINCH) is previous,
            }}))
            print("WRAPPER_DONE", flush=True)
        ''')
        process = subprocess.Popen([sys.executable, "-c", wrapper], cwd=self.base, env={},
                                   stdin=slave, stdout=slave, stderr=slave, start_new_session=True)

        def cleanup():
            pids_file = self.base / "terminal-pids.json"
            if pids_file.exists():
                group = json.loads(pids_file.read_text())["child"]
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
            termios.tcsetattr(slave, termios.TCSANOW, before)
            os.close(master)
            os.close(slave)

        self.addCleanup(cleanup)
        return process, master, slave, report, before

    def read_until(self, fd, marker, timeout=5):
        # Wait for actual PTY output; no sleep or status polling.
        data = b""
        deadline = time.monotonic() + timeout
        while marker not in data:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([fd], [], [], remaining)[0]:
                self.fail(f"PTY did not emit {marker!r}; received {data!r}")
            chunk = os.read(fd, 65536)
            if not chunk:
                self.fail(f"PTY closed before {marker!r}; received {data!r}")
            data += chunk
        return data

    def assert_process_stopped(self, pid):
        stat = Path(f"/proc/{pid}/stat")
        try:
            state = stat.read_text().split()[2]
        except (FileNotFoundError, ProcessLookupError):
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        else:
            self.assertIn(state, ("Z", "X"))

    def test_resize_reaches_child_group_and_restores_previous_handler(self):
        process, master, slave, report, before = self.start_terminal_case('''
            import json, os, signal
            from pathlib import Path
            Path("terminal-pids.json").write_text(json.dumps({"child": os.getpid()}))
            def resized(signum, frame):
                size = os.get_terminal_size(0)
                print(f"RESIZED:{size.columns}x{size.lines}", flush=True)
                raise SystemExit(0)
            signal.signal(signal.SIGWINCH, resized)
            print("CHILD_READY", flush=True)
            signal.pause()
        ''')
        self.read_until(master, b"CHILD_READY")
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 41, 123, 0, 0))
        self.read_until(master, b"RESIZED:123x41", timeout=2)
        self.assertEqual(process.wait(timeout=5), 0)
        result = review.read_json(report)
        self.assertIsNone(result["error"])
        self.assertTrue(result["resize_handler_restored"])
        self.assertEqual(termios.tcgetattr(slave), before)

    def raw_blocking_child(self):
        return '''
            import json, os, signal, subprocess, sys, tty
            from pathlib import Path
            child_code = "import os,signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);print('READY',flush=True);signal.pause()"
            descendant = subprocess.Popen([sys.executable, "-c", child_code], stdout=subprocess.PIPE)
            assert descendant.stdout.readline() == b"READY\\n"
            Path("terminal-pids.json").write_text(json.dumps({"child": os.getpid(), "descendant": descendant.pid}))
            signal.signal(signal.SIGTERM, lambda signum, frame: os.write(1, b"TERM_RECEIVED\\n"))
            tty.setraw(0)
            print("CHILD_READY", flush=True)
            while True:
                signal.pause()
        '''

    def assert_stopped_terminal(self, process, master, slave, report, before, expected):
        output = self.read_until(master, b"WRAPPER_DONE", timeout=10)
        self.assertEqual(process.wait(timeout=5), 0)
        result = review.read_json(report)
        self.assertIn(expected, result["error"])
        self.assertIn("stty sane", result["error"])
        self.assertIn(b"TERM_RECEIVED", output)
        self.assertTrue(result["attributes_restored"])
        self.assertTrue(result["resize_handler_restored"])
        self.assertEqual(termios.tcgetattr(slave), before)
        pids = review.read_json(self.base / "terminal-pids.json")
        self.assert_process_stopped(pids["child"])
        self.assert_process_stopped(pids["descendant"])
        self.assertEqual(result["records"][0]["status"], expected)

    def test_timeout_restores_raw_terminal_and_kills_descendants_after_grace(self):
        case = self.start_terminal_case(self.raw_blocking_child(), timeout=1)
        process, master, slave, report, before = case
        self.read_until(master, b"CHILD_READY")
        self.assertFalse(termios.tcgetattr(slave)[3] & (termios.ICANON | termios.ECHO))
        self.assert_stopped_terminal(*case, "timeout")

    def test_normal_exit_restores_terminal_modes_and_resize_handler(self):
        process, master, slave, report, before = self.start_terminal_case('''
            import tty
            tty.setraw(0)
        ''')
        self.read_until(master, b"WRAPPER_DONE")
        self.assertEqual(process.wait(timeout=5), 0)
        result = review.read_json(report)
        self.assertIsNone(result["error"])
        self.assertTrue(result["attributes_restored"])
        self.assertTrue(result["resize_handler_restored"])
        self.assertEqual(termios.tcgetattr(slave), before)

    def test_failed_exit_restores_terminal_and_reports_display_recovery(self):
        process, master, slave, report, before = self.start_terminal_case('''
            import tty
            tty.setraw(0)
            raise SystemExit(7)
        ''')
        self.read_until(master, b"WRAPPER_DONE")
        self.assertEqual(process.wait(timeout=5), 0)
        result = review.read_json(report)
        self.assertIn("exited 7", result["error"])
        self.assertIn("stty sane", result["error"])
        self.assertTrue(result["attributes_restored"])
        self.assertTrue(result["resize_handler_restored"])
        self.assertEqual(termios.tcgetattr(slave), before)

    def test_graceful_leader_exit_still_kills_resistant_descendant(self):
        child = self.raw_blocking_child().replace(
            'lambda signum, frame: os.write(1, b"TERM_RECEIVED\\n")',
            'lambda signum, frame: (os.write(1, b"TERM_RECEIVED\\n"), sys.exit(0))')
        self.assertIn("sys.exit(0)", child)
        case = self.start_terminal_case(child, timeout=1)
        self.read_until(case[1], b"CHILD_READY")
        self.assert_stopped_terminal(*case, "timeout")

    def test_interrupt_restores_raw_terminal_and_kills_descendants_after_grace(self):
        case = self.start_terminal_case(self.raw_blocking_child(), timeout=15)
        process, master, slave, report, before = case
        self.read_until(master, b"CHILD_READY")
        self.assertFalse(termios.tcgetattr(slave)[3] & (termios.ICANON | termios.ECHO))
        os.kill(process.pid, signal.SIGINT)
        self.assert_stopped_terminal(*case, "interrupted")


class FlowAndReceiptTests(Fixture):
    def test_fake_build_check_run_and_rebuild(self):
        source = self.build()
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "passed")
        self.assertEqual(receipt["source"]["commit"], review.PIN)
        self.assertTrue(receipt["source"]["pristine"])
        self.assertEqual(receipt["tools"]["node"]["version"], "v24.16.0")
        self.assertEqual(receipt["artifacts"]["textguard_compiler"], "go1.26.1")
        self.assertEqual(receipt["source"]["jouzu_version"], review.VERSION)
        self.assertEqual(receipt["source"]["pi_version"], review.PI_VERSION)
        names = [item["name"] for item in receipt["commands"]]
        self.assertEqual(names, ["clone", "fetch-pin", "checkout-pin", "build", *review.REQUIRED_CHECKS])
        self.assertTrue(all(item["status"] == "passed" for item in receipt["commands"]))
        self.assertTrue(all(item["timeout_seconds"] > 0 for item in receipt["commands"]))
        build_env = review.read_json(source / "fake-build-env.json")
        self.assertNotIn("OPENAI_API_KEY", build_env)
        self.assertNotIn("JOUZU_REPO", build_env)
        self.assertEqual(self.invoke("check", "--directory", str(self.root))[0], 0)
        result = self.invoke("run", "--directory", str(self.root), "--", "doctor", "--json")
        self.assertEqual(result[0], 0, result)
        launched = review.read_json(self.root / "sample-project/launched.json")
        self.assertEqual(launched["argv"][-2:], ["doctor", "--json"])
        self.assertEqual(launched["cwd"], str(self.root / "sample-project"))
        self.assertEqual(launched["env"]["JOUZU_HOME"], str(self.root / "home"))
        self.assertNotIn("JOUZU_UI_LOCALE", launched["env"])
        settings = self.root / "home/localization.json"
        settings.write_text('{"schemaVersion":2,"localization":{"uiLocale":"en","responseLanguage":"auto"}}')
        before = settings.read_bytes()
        self.build()
        self.assertEqual(settings.read_bytes(), before)
        self.assertNotIn("clone", [item["name"] for item in self.receipt()["commands"]])

    def test_default_build_creates_own_directory(self):
        with patch.object(review.tempfile, "gettempdir", return_value=str(self.base)):
            result = self.invoke("build", "--transport", "ssh")
        self.assertEqual(result[0], 0, result)
        roots = list(self.base.glob("jouzu-ja-review-*"))
        self.assertEqual(len(roots), 1)
        self.assertEqual(review.read_json(roots[0] / review.RECEIPT)["status"], "passed")

    def test_https_transport_uses_candidate_repository(self):
        result = self.invoke("build", "--directory", str(self.root), "--transport", "https")
        self.assertEqual(result[0], 0, result)
        command = self.receipt()["commands"][0]["argv"]
        self.assertEqual(command[-2], f"https://github.com/{review.REPOSITORY}.git")
        self.assertEqual(command[-1], str(self.root / "source"))

    def test_gh_transport_and_external_source(self):
        result = self.invoke("build", "--directory", str(self.root))
        self.assertEqual(result[0], 0, result)
        self.assertEqual(Path(self.receipt()["commands"][0]["argv"][0]).name, "gh")
        other = self.base / "external-review"
        source = self.prepare_source()
        result = self.invoke("build", "--directory", str(other), "--source", str(source))
        self.assertEqual(result[0], 0, result)
        receipt = review.read_json(other / review.RECEIPT)
        self.assertNotIn("clone", [item["name"] for item in receipt["commands"]])
        self.assertEqual(receipt["source"]["path"], str(source))

    def test_build_failure_has_failed_receipt_and_preserves_source(self):
        source = self.prepare_source()
        self.change_source(source, fail_build=True)
        result = self.invoke("build", "--directory", str(self.root), "--source", str(source))
        self.assertEqual(result[0], 1)
        self.assertIn("exited 7", result[2])
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "failed")
        self.assertEqual(receipt["commands"][-1]["status"], "failed")
        self.assertTrue(source.is_dir())
        result = self.invoke("run", "--directory", str(self.root), "--", "--help")
        self.assertEqual(result[0], 1)
        self.assertIn("did not pass", result[2])

    def test_check_failure_invalidates_receipt(self):
        source = self.build()
        self.change_source(source, fail_check="scripts/check-locales.mjs")
        result = self.invoke("check", "--directory", str(self.root))
        self.assertEqual(result[0], 1)
        self.assertEqual(self.receipt()["status"], "failed")
        self.assertEqual(self.receipt()["commands"][-1]["status"], "failed")

    def test_invalid_receipts_are_refused_before_launch(self):
        self.build()
        original = self.receipt()
        mutations = []
        for key, value in (("schema", 99), ("status", "failed"), ("commit", "f" * 40),
                           ("directory", "/other"), ("tools", {}), ("commands", []),
                           ("artifacts", {}), ("source", {})):
            changed = copy.deepcopy(original)
            changed[key] = value
            mutations.append(changed)
        for key, value in (("argv", ["true"]), ("returncode", 1), ("timeout_seconds", 0),
                           ("timeout_seconds", float("inf")), ("cwd", "/other")):
            changed = copy.deepcopy(original)
            changed["commands"][-1][key] = value
            mutations.append(changed)
        for changed in mutations:
            with self.subTest(changed=changed):
                review.write_json(self.root / review.RECEIPT, changed)
                result = self.invoke("run", "--directory", str(self.root), "--", "--help")
                self.assertEqual(result[0], 1, result)
                self.assertFalse((self.root / "sample-project/launched.json").exists())
        (self.root / review.RECEIPT).write_text("{ invalid JSON")
        result = self.invoke("check", "--directory", str(self.root))
        self.assertEqual(result[0], 1)
        self.assertIn("Cannot read JSON", result[2])

    def test_changed_artifact_and_dirty_source_refuse_run(self):
        source = self.build()
        entrypoint = source / review.ENTRYPOINT
        original = entrypoint.read_bytes()
        entrypoint.write_text("changed")
        result = self.invoke("run", "--directory", str(self.root), "--", "--help")
        self.assertEqual(result[0], 1)
        self.assertIn("differ from the receipt", result[2])
        entrypoint.write_bytes(original)
        self.change_source(source, dirty="?? user-file")
        result = self.invoke("run", "--directory", str(self.root), "--", "--help")
        self.assertEqual(result[0], 1)
        self.assertIn("Source is dirty", result[2])

    def test_build_identity_must_be_clean_and_pinned(self):
        source = self.build()
        info_path = source / review.BUILD_INFO
        info = review.read_json(info_path)
        for key, value in (("gitCommit", "0" * 40), ("gitDirty", True), ("schemaVersion", 9)):
            changed = dict(info, **{key: value})
            review.write_json(info_path, changed)
            with self.subTest(key=key), self.assertRaisesRegex(review.ReviewError, "development identity"):
                review.artifacts(source)


if __name__ == "__main__":
    unittest.main()
