#!/usr/bin/env python3
"""Build and run the pinned Japanese review candidate without global installation.

Python 3.10+ on Linux, macOS, or WSL. See --help for commands and safety limits.
Only the build command downloads source/dependencies; check never sends a prompt.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

# Repin these four values together when selecting a new review candidate.
# Tests derive their fake repository identity from these constants.
PIN = "df12d20bb693d595f6814335d5b53082815342c7"
REPOSITORY = "shisa-ai/jouzu"
VERSION = "0.2.1"
PI_VERSION = "1.4.0"
SCHEMA = 1
MARKER = ".ja-review.json"
RECEIPT = "receipt.json"
ENTRYPOINT = "packages/cli/dist/cli.js"
BUILD_INFO = "packages/cli/dist/build-info.json"
REQUIRED_CHECKS = ("locales", "dist-fresh", "offline-startup")
TOOL_ARGS = {
    "git": ["--version"], "bash": ["--version"], "node": ["--version"],
    "npm": ["--version"], "go": ["env", "GOVERSION"],
}
SAFE_ENV = {
    "PATH", "LANG", "LANGUAGE", "TERM", "COLORTERM", "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION", "TZ", "SHELL", "SYSTEMROOT", "WINDIR",
    "NO_COLOR", "FORCE_COLOR",
}


TERMINATION_GRACE_SECONDS = 2
TERMINATION_KILL_SECONDS = 5
TERMINAL_RECOVERY = (
    "Terminal display cleanup may be incomplete. If input or echo is broken, "
    "type 'stty sane' and press Enter; run 'reset' if the display is still damaged."
)


class ReviewError(Exception):
    """A failure the reviewer can act on without a Python traceback."""


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    if path.is_symlink() or not path.is_file():
        raise ReviewError(f"Expected a regular JSON file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReviewError(f"Cannot read JSON at {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ReviewError(f"Expected a JSON object: {path}")
    return value


def write_json(path, value):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ReviewError(f"Refusing to replace a non-regular file: {path}")
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    temporary.replace(path)


def outside_git(path):
    for parent in (path, *path.parents):
        if (parent / ".git").exists():
            raise ReviewError(f"Review directory must be outside Git worktrees: {path}")


def managed(root, relative):
    """Reject redirected helper paths, including dangling symlinks."""
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise ReviewError(f"Path is outside the review directory: {relative}")
    path = root / relative
    if path != root and root not in path.parents:
        raise ReviewError(f"Path is outside the review directory: {path}")
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ReviewError(f"Refusing a symlink in a managed path: {part}")
    return path


def ensure_directory(root, relative):
    path = managed(root, relative)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise ReviewError(f"Expected a directory: {path}")
    return path


def open_workspace(directory, *, create=False, source=None):
    requested = Path(directory).expanduser().absolute()
    if requested.is_symlink():
        raise ReviewError(f"Review directory must not be a symlink: {requested}")
    root = requested.resolve()
    outside_git(root)
    if not root.exists():
        if not create:
            raise ReviewError(f"Review directory does not exist: {root}; run build first")
        if source and Path(source).expanduser().is_symlink():
            raise ReviewError(f"Source must not be a symlink: {source}")
        candidate = Path(source).expanduser().resolve() if source else root / "source"
        if candidate == root or candidate in root.parents:
            raise ReviewError("Source and review directory must be separate")
        root.mkdir(parents=True, mode=0o700)
        write_json(root / MARKER, {
            "schema": SCHEMA, "directory": str(root), "repository": REPOSITORY,
            "commit": PIN, "source": str(candidate), "external_source": source is not None,
        })
    if not root.is_dir():
        raise ReviewError(f"Not a review directory: {root}")
    marker = read_json(managed(root, MARKER))
    if any(marker.get(key) != value for key, value in {
        "schema": SCHEMA, "directory": str(root), "repository": REPOSITORY, "commit": PIN,
    }.items()) or type(marker.get("external_source")) is not bool:
        raise ReviewError(f"Invalid ownership marker: {root / MARKER}; choose a new directory")
    candidate = marker.get("source")
    if not isinstance(candidate, str) or str(Path(candidate).resolve()) != candidate:
        raise ReviewError("Ownership marker has an invalid source path")
    candidate = Path(candidate)
    if candidate == root or candidate in root.parents:
        raise ReviewError("Ownership marker places the review directory inside its source")
    if not marker["external_source"] and candidate != root / "source":
        raise ReviewError("Ownership marker redirects the managed source")
    if root in candidate.parents:
        managed(root, candidate.relative_to(root))
    if source and Path(source).expanduser().resolve() != candidate:
        raise ReviewError("--source differs from this directory's recorded source; use a new directory")
    if create and marker["external_source"] and source is None:
        raise ReviewError("This directory uses an external source; repeat --source explicitly to rebuild")
    return root, marker


@contextmanager
def workspace_lock(root):
    path = managed(root, ".review-lock")
    try:
        stream = path.open("x", encoding="utf-8")
    except FileExistsError as exc:
        raise ReviewError(f"Review command already running, or left a lock: {path}. "
                          "If its process has stopped, remove only that lock and retry.") from exc
    try:
        with stream:
            stream.write(str(os.getpid()) + "\n")
        yield
    finally:
        path.unlink()


def isolated_env(root, home_name="home", *, offline=False):
    # An allowlist avoids inheriting provider keys, NODE_OPTIONS, package config,
    # Git overrides, Jouzu/Pi state, and future provider-specific variables.
    env = {key: value for key, value in os.environ.items()
           if key in SAFE_ENV or key.startswith("LC_")}
    home = ensure_directory(root, home_name)
    user = ensure_directory(root, f"{home_name}/user")
    for name, relative in {
        "HOME": "", "USERPROFILE": "", "XDG_CONFIG_HOME": "config",
        "XDG_STATE_HOME": "state", "XDG_CACHE_HOME": "cache",
        "XDG_DATA_HOME": "data", "APPDATA": "config", "LOCALAPPDATA": "state",
    }.items():
        path = user if not relative else ensure_directory(root, f"{home_name}/user/{relative}")
        env[name] = str(path)
    temporary = ensure_directory(root, f"{home_name}/tmp")
    env.update({
        "JOUZU_HOME": str(home), "JOUZU_NO_UPDATE": "1", "JOUZU_NO_PI_IMPORT": "1",
        "PI_SKIP_VERSION_CHECK": "1", "PI_TELEMETRY": "0",
        "TMPDIR": str(temporary), "TMP": str(temporary), "TEMP": str(temporary),
        "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull, "GOTOOLCHAIN": "local",
    })
    if offline:
        env["PI_OFFLINE"] = "1"
    return env


def initialize_review(root):
    ensure_directory(root, "home")
    settings = managed(root, "home/localization.json")
    if not settings.exists():
        write_json(settings, {"schemaVersion": 2, "localization": {
            "uiLocale": "ja", "responseLanguage": "auto",
        }})
    else:
        read_json(settings)  # Never replace reviewer settings, even on rebuild.
    sample = ensure_directory(root, "sample-project")
    readme = managed(root, "sample-project/README.md")
    if not readme.exists():
        with readme.open("x", encoding="utf-8") as stream:
            stream.write("# Japanese review sample project\n\n"
                         "Use this directory to check display languages and Settings.\n"
                         "Sending prompts or authenticating may contact a provider and spend credit.\n\n"
                         "Japanese sample text: 日本語の表示と折り返しを確認します。\n")
    return sample


def signal_group(process, signum):
    try:
        os.killpg(process.pid, signum)
    except ProcessLookupError:
        pass


def terminate_group(process):
    """Allow cleanup, then kill survivors even if the group leader exited."""
    previous_interrupt = signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        try:
            signal_group(process, signal.SIGTERM)
            process.communicate(timeout=TERMINATION_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            pass
        finally:
            # An interactive child's descendants need not keep communicate()
            # waiting once the leader exits. Always signal the whole group.
            signal_group(process, signal.SIGKILL)
        try:
            process.communicate(timeout=TERMINATION_KILL_SECONDS)
        except subprocess.TimeoutExpired:
            return "Process cleanup exceeded its deadline; inspect child processes before retrying."
        return ""
    finally:
        signal.signal(signal.SIGINT, previous_interrupt)


def execute(argv, *, cwd, env, timeout, records=None, name="command", log=None, interactive=False):
    """Run bounded commands; relay terminal resize and restore terminal modes."""
    if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise ReviewError("Command timeout must be finite and greater than zero")
    argv = [str(item) for item in argv]
    record = {"name": name, "argv": argv, "cwd": str(cwd), "timeout_seconds": timeout,
              "started_at": now(), "status": "running"}
    if log:
        record["log"] = str(log)
    if records is not None:
        records.append(record)
    started = time.monotonic()
    output = None
    process = None
    terminal = None
    previous_resize = None
    resize_installed = False
    try:
        if interactive and os.isatty(0):
            import termios
            try:
                terminal = termios.tcgetattr(0)
            except termios.error as exc:
                raise ReviewError(f"Cannot save terminal settings; launch was cancelled: {exc}") from exc
        if log:
            output = log.open("x", encoding="utf-8")
        process = subprocess.Popen(
            argv, cwd=cwd, env=env, text=True, encoding="utf-8", errors="replace",
            stdin=None if interactive else subprocess.DEVNULL,
            stdout=output if output else (None if interactive else subprocess.PIPE),
            stderr=subprocess.STDOUT, start_new_session=True,
        )
        if interactive:
            def forward_resize(signum, frame):
                signal_group(process, signum)
            previous_resize = signal.signal(signal.SIGWINCH, forward_resize)
            resize_installed = True
        stdout, _ = process.communicate(timeout=timeout)
        record["returncode"] = process.returncode
        if process.returncode != 0:
            record["status"] = "failed"
            detail = f"; log: {log}" if log else f"\n{(stdout or '')[-4000:]}"
            if terminal is not None:
                detail += f"\n{TERMINAL_RECOVERY}"
            raise ReviewError(f"{name} exited {process.returncode}{detail}")
        record["status"] = "passed"
        return (stdout or "").strip()
    except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
        cleanup = terminate_group(process) if process is not None else ""
        record["status"] = "timeout" if isinstance(exc, subprocess.TimeoutExpired) else "interrupted"
        suffix = f"; log: {log}" if log else ""
        if cleanup:
            suffix += f"; {cleanup}"
        if terminal is not None:
            suffix += f"\n{TERMINAL_RECOVERY}"
        raise ReviewError(f"{name} {record['status']} (limit {timeout}s){suffix}") from exc
    except OSError as exc:
        record["status"] = "failed"
        raise ReviewError(f"Cannot run {name}: {exc}") from exc
    finally:
        if resize_installed:
            signal.signal(signal.SIGWINCH, previous_resize)
        if terminal is not None:
            try:
                termios.tcsetattr(0, termios.TCSANOW, terminal)
            except termios.error as exc:
                print(f"ja-review: Cannot restore terminal settings: {exc}. {TERMINAL_RECOVERY}",
                      file=sys.stderr, flush=True)
        record["elapsed_seconds"] = round(time.monotonic() - started, 3)
        if output:
            output.close()


def prerequisites(root, env):
    if os.name != "posix":
        raise ReviewError("Use Linux, macOS, or WSL; native Windows is not supported by this helper")
    tools = {}
    for name, args in TOOL_ARGS.items():
        executable = shutil.which(name, path=env.get("PATH"))
        if not executable:
            raise ReviewError(f"Missing prerequisite on PATH: {name}; install it before build")
        executable = str(Path(executable).absolute())
        version = execute([executable, *args], cwd=root, env=env, timeout=30, name=f"{name} version")
        tools[name] = {"path": executable, "version": version.splitlines()[0] if version else ""}
    node = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", tools["node"]["version"])
    go = re.fullmatch(r"go(\d+)\.(\d+)(?:\.\d+)?(?:-[A-Za-z0-9][A-Za-z0-9_.:+-]*)?", tools["go"]["version"])
    if not node or tuple(map(int, node.groups())) < (22, 19, 0):
        raise ReviewError(f"Node >=22.19.0 is required; found {tools['node']['version']}")
    if not go or tuple(map(int, go.groups())) < (1, 21):
        raise ReviewError(f"Go >=1.21 is required; found {tools['go']['version']}")
    tools["python"] = {"path": sys.executable, "version": platform.python_version()}
    return tools


def git(tools, source, env, *args):
    return execute([tools["git"]["path"], "-c", f"core.hooksPath={os.devnull}",
                    "-C", source, *args], cwd=source, env=env, timeout=60, name="source verification")


def verify_source(source, tools, env):
    if source.is_symlink() or not source.is_dir():
        raise ReviewError(f"Source must be an existing checkout, not a symlink: {source}")
    if git(tools, source, env, "rev-parse", "--show-toplevel") != str(source):
        raise ReviewError(f"Source must be the checkout root: {source}")
    actual = git(tools, source, env, "rev-parse", "HEAD")
    if actual != PIN:
        raise ReviewError(f"Wrong source commit: expected {PIN}, found {actual}; no reset was attempted")
    origin = git(tools, source, env, "remote", "get-url", "origin")
    if origin not in {f"https://github.com/{REPOSITORY}.git", f"https://github.com/{REPOSITORY}",
                      f"git@github.com:{REPOSITORY}.git", f"ssh://git@github.com/{REPOSITORY}.git"}:
        raise ReviewError(f"Source origin must be {REPOSITORY}; no replacement was attempted")
    flags = git(tools, source, env, "ls-files", "-v")
    if any(line and (line[0].islower() or line[0] == "S") for line in flags.splitlines()):
        raise ReviewError("Source uses assume-unchanged or skip-worktree flags; pristine status cannot be verified")
    dirty = git(tools, source, env, "status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        raise ReviewError(f"Source is dirty; no files were reset or removed:\n{dirty[:3000]}")
    package = read_json(source / "packages/cli/package.json")
    if package.get("version") != VERSION or not isinstance(package.get("dependencies"), dict) or package["dependencies"].get(
            "@earendil-works/pi-coding-agent") != PI_VERSION:
        raise ReviewError(f"Source package does not match Jouzu {VERSION} / Pi {PI_VERSION}")
    return {"path": str(source), "repository": REPOSITORY, "origin": origin, "commit": actual,
            "pristine": True, "jouzu_version": VERSION, "pi_version": PI_VERSION}


def acquire_source(root, tools, transport, records, timeout):
    # Source acquisition alone uses the caller's Git/GitHub credentials. Builds
    # and launches use isolated_env instead. Never run gh auth login/setup-git.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("GIT_") and key != "NODE_OPTIONS"}
    env["GIT_TERMINAL_PROMPT"] = "0"
    source = managed(root, "source")
    if source.exists():
        raise ReviewError(f"Refusing to clone over an existing path: {source}")
    transport = transport or ("gh" if shutil.which("gh") else "ssh")
    if transport == "gh":
        executable = shutil.which("gh")
        if not executable:
            raise ReviewError("gh is missing; authenticate gh, or select --transport ssh or https")
        command = [executable, "repo", "clone", REPOSITORY, str(source), "--", "--no-checkout"]
    else:
        url = f"git@github.com:{REPOSITORY}.git" if transport == "ssh" else f"https://github.com/{REPOSITORY}.git"
        command = [tools["git"]["path"], "-c", f"core.hooksPath={os.devnull}",
                   "clone", "--no-checkout", "--", url, str(source)]
    execute(command, cwd=root, env=env, timeout=timeout, records=records, name="clone")
    prefix = [tools["git"]["path"], "-c", f"core.hooksPath={os.devnull}", "-C", str(source)]
    execute([*prefix, "fetch", "--depth", "1", "origin", PIN], cwd=root, env=env,
            timeout=timeout, records=records, name="fetch-pin")
    execute([*prefix, "checkout", "--detach", PIN], cwd=root, env=env,
            timeout=60, records=records, name="checkout-pin")


def artifacts(source):
    info = read_json(source / BUILD_INFO)
    if info.get("schemaVersion") != 1 or info.get("gitCommit") != PIN or info.get("gitDirty") is not False:
        raise ReviewError("Built development identity does not match the pristine pinned source; rebuild")
    hashes = {}
    for relative in (ENTRYPOINT, BUILD_INFO, "package-lock.json", "packages/cli/package-lock.json",
                     "packages/cli/dist/locales/catalog.lock.json", "packages/cli/dist/pi.lock.json",
                     "packages/cli/dist/textguard/manifest.json"):
        path = source / relative
        if path.is_symlink() or not path.is_file():
            raise ReviewError(f"Missing or redirected build artifact: {path}; rebuild")
        hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    compiler = read_json(source / "packages/cli/dist/textguard/manifest.json").get("toolchain")
    expected = read_json(source / "upstream/textguard/source.lock.json").get("toolchain")
    if not isinstance(compiler, str) or not compiler or compiler != expected:
        raise ReviewError("Built TextGuard compiler does not match its source lock; rebuild")
    return {"sha256": hashes, "textguard_compiler": compiler, "build_identity": info}


def run_checks(root, source, tools, timeout, records, attempt):
    # Fresh home per check keeps review authentication and extensions out of
    # the no-prompt checks. The product smoke creates another temporary home.
    env = isolated_env(root, f"checks/{attempt}/home", offline=True)
    logs = ensure_directory(root, f"logs/{attempt}")
    commands = {
        "locales": [tools["node"]["path"], "scripts/check-locales.mjs"],
        "dist-fresh": [tools["node"]["path"], "scripts/check-dist-fresh.mjs"],
        "offline-startup": [tools["node"]["path"], "scripts/dev-smoke.mjs", ENTRYPOINT],
    }
    for name, command in commands.items():
        execute(command, cwd=source, env=env, timeout=timeout, records=records,
                name=name, log=logs / f"{name}.log")


def load_receipt(root, marker, tools, env):
    receipt = read_json(managed(root, RECEIPT))
    expected = {"schema": SCHEMA, "status": "passed", "directory": str(root),
                "commit": PIN, "repository": REPOSITORY}
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ReviewError("Receipt is invalid or the build did not pass; inspect receipt.json and run build")
    if receipt.get("tools") != tools:
        raise ReviewError("Tool paths or versions differ from the build receipt; run build again")
    records = receipt.get("commands")
    if not isinstance(records, list) or not records:
        raise ReviewError("Receipt has no command outcomes; run build")
    for record in records:
        if not isinstance(record, dict) or record.get("status") != "passed" or record.get("returncode") != 0:
            raise ReviewError("Receipt contains an invalid or failed command outcome; run build")
        limit = record.get("timeout_seconds")
        if type(limit) not in (int, float) or not math.isfinite(limit) or not 0 < limit <= 86400:
            raise ReviewError("Receipt contains an invalid command timeout")
    source = Path(marker["source"])
    required = {"build": [tools["bash"]["path"], "./dev-build.sh", "build"],
                "locales": [tools["node"]["path"], "scripts/check-locales.mjs"],
                "dist-fresh": [tools["node"]["path"], "scripts/check-dist-fresh.mjs"],
                "offline-startup": [tools["node"]["path"], "scripts/dev-smoke.mjs", ENTRYPOINT]}
    for name, argv in required.items():
        matches = [item for item in records if item.get("name") == name]
        if not matches or any(item.get("argv") != argv or item.get("cwd") != str(source) for item in matches):
            raise ReviewError(f"Receipt is missing the exact {name} command outcome; run build")
    verified = verify_source(source, tools, env)
    if receipt.get("source") != verified or receipt.get("artifacts") != artifacts(source):
        raise ReviewError("Source or build artifacts differ from the receipt; run build")
    return receipt


def build(args):
    directory = args.directory or str(Path(tempfile.gettempdir()) / f"jouzu-ja-review-{uuid.uuid4().hex[:12]}")
    root, marker = open_workspace(directory, create=True, source=args.source)
    print(f"Review directory: {root}", flush=True)
    with workspace_lock(root):
        initialize_review(root)
        env = isolated_env(root, "build-home", offline=True)
        tools = prerequisites(root, env)
        source = Path(marker["source"])
        attempt = uuid.uuid4().hex
        logs = ensure_directory(root, f"logs/{attempt}")
        receipt = {"schema": SCHEMA, "directory": str(root), "repository": REPOSITORY,
                   "commit": PIN, "status": "running", "started_at": now(), "tools": tools,
                   "platform": platform.platform(), "commands": []}
        # Source refusal precedes receipt replacement. Never repair a wrong or
        # dirty candidate automatically, including an interrupted clone.
        if source.exists():
            verify_source(source, tools, env)
        elif marker["external_source"]:
            raise ReviewError(f"External source is missing: {source}")
        write_json(managed(root, RECEIPT), receipt)
        try:
            if not source.exists():
                acquire_source(root, tools, args.transport, receipt["commands"], args.fetch_timeout)
            receipt["source"] = verify_source(source, tools, env)
            print(f"Building with a {args.timeout}s limit; log: {logs / 'build.log'}", flush=True)
            execute([tools["bash"]["path"], "./dev-build.sh", "build"], cwd=source, env=env,
                    timeout=args.timeout, records=receipt["commands"], name="build", log=logs / "build.log")
            receipt["source"] = verify_source(source, tools, env)
            receipt["artifacts"] = artifacts(source)
            run_checks(root, source, tools, args.check_timeout, receipt["commands"], attempt)
            receipt["status"] = "passed"
        except (ReviewError, OSError) as exc:
            receipt.update(status="failed", error=str(exc))
            raise
        finally:
            receipt["finished_at"] = now()
            write_json(managed(root, RECEIPT), receipt)
    print(f"Build and no-prompt checks passed. Receipt: {root / RECEIPT}")
    return 0


def check(args):
    root, marker = open_workspace(args.directory)
    with workspace_lock(root):
        env = isolated_env(root, "build-home", offline=True)
        tools = prerequisites(root, env)
        receipt = load_receipt(root, marker, tools, env)
        try:
            run_checks(root, Path(marker["source"]), tools, args.timeout, receipt["commands"], uuid.uuid4().hex)
            receipt["source"] = verify_source(Path(marker["source"]), tools, env)
            receipt["checked_at"] = now()
        except (ReviewError, OSError) as exc:
            receipt.update(status="failed", error=str(exc))
            raise
        finally:
            write_json(managed(root, RECEIPT), receipt)
    print(f"Receipt, source, locale catalogs, dist freshness, and offline startup passed: {root}")
    return 0


def is_update_command(args):
    """Match Jouzu's leading options, then its or Pi's command position.

    Jouzu stops at the first non-Jouzu option. Pi dispatches package commands
    only at args[0], before parsing its options; a later 'update' is a value or
    prompt. Keep this small dispatch model in sync when repinning the product.
    """
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--jouzu-ui-locale":
            index += 2
        elif token.startswith("--jouzu-ui-locale=") or token in {
                "--jouzu-textguard-files", "--jouzu-textguard-strict", "--jouzu-textguard-off"}:
            index += 1
        else:
            break
    if index >= len(args):
        return False
    if args[index] == "self-update":
        return True
    if args[index] in {"pi", "--"}:
        index += 1
    return index < len(args) and args[index] == "update"


def launch_arguments(source, tools, forwarded, locale=None):
    forwarded = list(forwarded)
    if forwarded[:1] == ["--"]:
        forwarded.pop(0)
    # Keep the dedicated home and no-update promise even with forwarded args.
    for arg in forwarded:
        if arg.split("=", 1)[0] in {
                "--jouzu-home", "--agent-dir", "--session-dir", "--jouzu-profile", "--session", "--fork"}:
            raise ReviewError(f"{arg.split('=', 1)[0]} would change review isolation; omit it")
    if is_update_command(forwarded):
        raise ReviewError("Updates are disabled for the pinned review build")
    argv = [tools["node"]["path"], str(source / ENTRYPOINT), "--jouzu-profile", "core"]
    if locale:
        argv += ["--jouzu-ui-locale", locale]
    return argv + forwarded


def run(args):
    root, marker = open_workspace(args.directory)
    with workspace_lock(root):
        env = isolated_env(root)
        tools = prerequisites(root, isolated_env(root, "build-home", offline=True))
        load_receipt(root, marker, tools, env)
        sample = initialize_review(root)
        argv = launch_arguments(Path(marker["source"]), tools, args.cli_args, args.ui_locale)
        print("Review home and sample project are separate from normal settings. Auto-update and Pi import are off.\n"
              "Prompts or authentication may contact a provider and spend credit. This is not a network sandbox.",
              file=sys.stderr, flush=True)
        execute(argv, cwd=sample, env=env, timeout=args.timeout, name="review session", interactive=True)
    return 0


def seconds(value):
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use an integer number of seconds") from exc
    if not 1 <= number <= 86400:
        raise argparse.ArgumentTypeError("timeout must be between 1 and 86400 seconds")
    return number


def parser():
    result = argparse.ArgumentParser(
        description=f"Build and review {REPOSITORY} at {PIN} (Jouzu {VERSION}, Pi {PI_VERSION}).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples (choose a NEW directory outside any Git worktree):
  python3 scripts/ja_review.py build --directory /tmp/jouzu-ja-review
  python3 scripts/ja_review.py check --directory /tmp/jouzu-ja-review
  python3 scripts/ja_review.py run --directory /tmp/jouzu-ja-review -- doctor
  python3 scripts/ja_review.py run --directory /tmp/jouzu-ja-review -- --help
  python3 scripts/ja_review.py run --directory /tmp/jouzu-ja-review
  python3 scripts/ja_review.py run --directory /tmp/jouzu-ja-review --ui-locale en -- --help

Requirements: Python 3.10+, Git, Bash, Node >=22.19.0, npm, Go >=1.21;
Linux, macOS, or WSL.
Build selects gh if installed, otherwise Git over SSH; --transport selects it explicitly.
Build runs the candidate's existing dev-build.sh build, never link. Dependencies
use its locked, lifecycle-disabled install. Network access is needed for downloads.
Check validates the receipt, locale catalogs, dist freshness, and offline RPC startup;
it does not send prompts or use review credentials. On timeout or interruption,
commands get 2 seconds to exit after SIGTERM, then the group is killed and reaped
with a 5-second limit. Interactive runs forward resize and restore terminal modes.
If input/echo or the display remains broken after a forced stop, run stty sane,
then reset. Logs and receipt.json stay in the review directory. A failed candidate is never reset
or deleted; fix the cause or choose another new directory. Rebuild preserves settings.

Run uses node directly, a disposable sample-project, and a dedicated Jouzu home.
It strips inherited provider credentials and Jouzu/Pi overrides. Sign in separately
inside the review home if needed. No normal settings or credentials are imported.
Explicit --session/--fork paths and home/session-directory overrides are refused.
NO_COLOR and FORCE_COLOR are preserved for display checks.
The initial saved UI locale is ja and response language is auto. Use Settings to
switch languages; no fixed UI env/CLI override is set by default. --ui-locale en,
ja, or auto is an explicit one-launch override. The core profile does not force a
response language. Auto-update is disabled. Entering prompts or authenticating can
contact a provider and spend credit. Offline flags are NOT network isolation;
use operating-system/container controls if a network sandbox is required.
Receipts record local evidence, not signed attestations of every dependency byte.
Do not share this directory: review logins and sessions may contain credentials.
""",
    )
    commands = result.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build", help="clone the pin, build, and record no-prompt checks")
    build_parser.add_argument("--directory", help="new outside-worktree path, or this helper's existing directory; default: unique temp directory")
    build_parser.add_argument("--source", help="integration testing only: explicitly build an existing clean pinned checkout")
    build_parser.add_argument("--transport", choices=("gh", "ssh", "https"), help="source access method; default: gh if installed, else ssh")
    build_parser.add_argument("--timeout", type=seconds, default=1800, help="build deadline in seconds (default: 1800)")
    build_parser.add_argument("--fetch-timeout", type=seconds, default=300, help="deadline per clone/fetch (default: 300)")
    build_parser.add_argument("--check-timeout", type=seconds, default=120, help="deadline per check (default: 120)")
    build_parser.set_defaults(action=build)
    check_parser = commands.add_parser("check", help="validate a build receipt and repeat no-prompt checks")
    check_parser.add_argument("--directory", required=True, help="directory created by build")
    check_parser.add_argument("--timeout", type=seconds, default=120, help="deadline per check (default: 120)")
    check_parser.set_defaults(action=check)
    run_parser = commands.add_parser("run", help="launch the built CLI without a global installation")
    run_parser.add_argument("--directory", required=True, help="directory created by build")
    run_parser.add_argument("--timeout", type=seconds, default=7200, help="session deadline in seconds (default: 7200)")
    run_parser.add_argument("--ui-locale", choices=("en", "ja", "auto"), help="explicit one-launch UI override; omit to test saved Settings changes")
    run_parser.add_argument("cli_args", nargs=argparse.REMAINDER, help="CLI arguments after -- (for example: -- doctor or -- --help)")
    run_parser.set_defaults(action=run)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return args.action(args)
    except (ReviewError, OSError) as exc:
        print(f"ja-review: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
