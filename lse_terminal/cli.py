"""`lset`: start the terminal and open it in the browser."""

from __future__ import annotations

import argparse
import threading
import webbrowser


def user_packages_dir():
    """Where libraries the user installs at runtime land.

    The MACHINE LEARNING tab's heavy extras (torch above all) are NOT shipped
    in the desktop bundle: torch alone is 360 MB frozen, and only a handful of
    catalog models need it. They are pip-installed on demand instead, and they
    cannot go into the bundle's own _internal, because that directory lives
    inside the install location (Program Files on Windows, so writing needs
    admin) and every update replaces it wholesale, which would silently delete
    whatever the user installed. This path sits beside the rest of the user's
    terminal state, so an install survives app updates.
    """
    from lse_terminal.engine.config import config_dir
    return config_dir() / "python-packages"


def _enable_user_packages(sys_mod) -> None:
    """Put user_packages_dir() on sys.path for this process.

    Every entry point below calls it, not just the server: an ML script runs
    in a child process (--run-script) and must see exactly the libraries the
    engine reported as installed.

    APPENDED, never prepended. pip brings a package's dependencies along with
    it (torch pulls jinja2, typing_extensions, setuptools, sympy), and those
    must not shadow the copies this bundle was built and tested against.
    """
    path = str(user_packages_dir())
    if path not in sys_mod.path:
        sys_mod.path.append(path)


def _teach_distlib_its_resource_finder() -> None:
    """Let the bundled pip actually install something.

    pip's vendored distlib maps module-loader types to resource finders and has
    never heard of PyInstaller's loader, so the moment pip prepares to install a
    wheel it imports distlib.scripts and dies with "Unable to locate finder for
    'pip._vendor.distlib'". Nothing about that message points at the real cause,
    and it fires before any package is fetched, so every install fails.

    In onedir mode the files distlib is reaching for (the t32/t64/w32/w64 script
    launchers) are real files sitting next to the frozen module, so the stock
    filesystem finder is the right one. It only has to be registered against
    whatever loader class this PyInstaller build uses.
    """
    try:
        import pip._vendor.distlib as distlib
        from pip._vendor.distlib import resources
    except Exception:
        return  # no bundled pip to teach
    loader = getattr(distlib, "__loader__", None)
    if loader is not None:
        # register_finder takes an INSTANCE and keys the registry on its type.
        resources.register_finder(loader, resources.ResourceFinder)


def _run_module(sys_mod, module: str, rest: list[str]) -> int:
    """`-m <module> [args]` for the frozen build (see main()).

    Only pip needs shaping: the engine asks for a plain `install <packages>`
    and this is the single place that knows where a frozen app is allowed to
    put them, so the destination is added here rather than at each call site.
    """
    import runpy

    # Only the frozen build needs any of this. A source install runs inside a
    # real, writable environment, where pip's own default destination is the
    # right one, distlib already knows the loader, and a source build is
    # perfectly able to complete.
    if module == "pip" and getattr(sys_mod, "frozen", False):
        _teach_distlib_its_resource_finder()
        if rest and rest[0] == "install":
            target = user_packages_dir()
            target.mkdir(parents=True, exist_ok=True)
            if not any(a == "--target" or a.startswith("--target=") for a in rest):
                rest = [rest[0], "--target", str(target)] + rest[1:]
            if not any(a.startswith("--only-binary") for a in rest):
                # A frozen app carries no compiler, and a PEP 517 source build
                # would re-enter this executable expecting a real interpreter,
                # so it cannot finish. Refusing sdists outright turns that into
                # an immediate "no wheel available for this platform", which
                # the install panel can show, instead of a build that dies
                # half way.
                rest = rest + ["--only-binary=:all:"]

    sys_mod.argv = [module] + rest
    try:
        runpy.run_module(module, run_name="__main__", alter_sys=True)
    except SystemExit as e:
        # pip finishes by raising SystemExit. The ML install endpoint branches
        # on the child's return code, so hand the code back rather than
        # letting it unwind and lose the distinction between 0 and a failure.
        return int(e.code or 0)
    return 0


def _utf8_streams(sys_mod) -> None:
    """stdout/stderr in UTF-8 whatever the console code page says.

    The frozen Windows build starts Python in isolated mode, so PYTHONUTF8 /
    PYTHONIOENCODING are ignored and a child re-entered through this exe
    writes text in the console code page (cp1252). The first non-Latin
    character a model script prints, "\u2192" in xgboost's progress line,
    then raised UnicodeEncodeError and the whole training run failed
    (seen sweeping all 21 models on the installed exe). Reconfigure
    the streams here, on every entry point, and read children as UTF-8.
    """
    for stream in (sys_mod.stdout, sys_mod.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass  # not a real text stream (pythonw, a closed fd)


def main(argv: list[str] | None = None) -> int:
    import sys

    raw = list(sys.argv[1:] if argv is None else argv)
    _utf8_streams(sys)

    # Optional ML libraries are installed by the user at runtime rather than
    # shipped, so the directory they land in has to be importable before ANY
    # branch below runs, the server and every re-entry alike.
    _enable_user_packages(sys)

    # `-m <module> [args]` and `-c <code>`: the frozen desktop build ships no
    # python.exe, so anything that would normally shell out to one has to
    # re-enter this executable. The engine relies on both: `-m pip` for the ML
    # tab's one-click library install, and `-c` for the CUDA probe in
    # ml/env.py. Without these branches argparse treats the flags as lset's
    # own and exits 2, which is why neither used to work on desktop:
    # the install button could never install anything, and the
    # GPU probe always reported an error.
    if raw and raw[0] == "-m" and len(raw) > 1:
        return _run_module(sys, raw[1], raw[2:])
    if raw and raw[0] == "-c" and len(raw) > 1:
        # Match `python -c`: argv[0] is "-c" and the code runs as __main__.
        sys.argv = ["-c"] + raw[2:]
        exec(compile(raw[1], "<string>", "exec"), {"__name__": "__main__"})
        return 0

    # `--run-script file.py [args...]` is handled BEFORE argparse on purpose:
    # the script's own flags (--dataset, --epochs, even a --port) must reach
    # the script, not be parsed as lset's. This is the frozen desktop build's
    # substitute for `python file.py` (it ships no python.exe), used by the
    # WORKSPACE terminal, the Python IDE's RUN and the ML job runner.
    if "--run-script" in raw:
        i = raw.index("--run-script")
        if i + 1 < len(raw):
            import os
            import runpy
            script = raw[i + 1]
            # Say plainly when the file is not there. runpy.run_path on a
            # missing path inside a PyInstaller bundle does not raise
            # FileNotFoundError: the frozen path hook claims every path
            # under _internal, run_path treats it as a package and dies
            # with "can't find '__main__' module in <path>", which is how a
            # model script the spec forgot to ship once read.
            if not os.path.isfile(script):
                sys.stderr.write(f"lset --run-script: no such file: {script}\n")
                return 2
            # Behave like `python file.py args`: argv[0] is the script, cwd
            # stays where the caller spawned us.
            sys.argv = [script] + raw[i + 2:]
            try:
                runpy.run_path(script, run_name="__main__")
            except SystemExit as e:
                # sys.exit() in a user script is an ending, not a crash.
                code = e.code
                return code if isinstance(code, int) else (0 if code is None else 1)
            except BaseException:
                # A script error must print as the SCRIPT's traceback, the
                # way `python file.py` shows it. Left to propagate it unwinds
                # into sidecar_entry, where PyInstaller stamps "[PYI-...]
                # Failed to execute script 'sidecar_entry'" onto it, and a
                # user's own NameError reads as the app crashing (every
                # fresh install's first RUN used to hit exactly that).
                # Trim the harness frames (this call, runpy) so the printed
                # traceback starts inside the script itself.
                import traceback
                et, ev, tb = sys.exc_info()
                t = tb
                while t is not None and t.tb_frame.f_code.co_filename != script:
                    t = t.tb_next
                if t is None and issubclass(et, SyntaxError):
                    # Compile-time error: no script frame exists, and the
                    # SyntaxError display already carries file/line/caret.
                    tb = None
                traceback.print_exception(et, ev, t or tb)
                return 1
            return 0

    ap = argparse.ArgumentParser(
        prog="lset",
        description="LSE Terminal: open-source market research terminal.",
    )
    # Loopback by default on purpose: the server carries the user's API key,
    # so exposing it beyond the machine must be an explicit decision.
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7787)
    ap.add_argument("--no-browser", action="store_true",
                    help="don't open the browser (headless / server use)")
    # Hidden re-entry: the AI rail's permission bridge (see
    # engine/approve_bridge.py). Spawned BY the claude CLI as an MCP server,
    # so it must branch before the heavy engine imports below.
    ap.add_argument("--approve-bridge", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--engine-port", type=int, default=0, help=argparse.SUPPRESS)
    ap.add_argument("--engine-token", default="", help=argparse.SUPPRESS)
    ap.add_argument("--bridge-role", default="approve", help=argparse.SUPPRESS)
    # Hidden re-entries for the WORKSPACE terminal (engine/server.py
    # /api/term/pty). The frozen desktop build ships no standalone python
    # binary, so an interactive REPL and a run-this-file both have to enter
    # through the app's own executable; branching here, before the heavy
    # engine imports, keeps them as light as a bare interpreter.
    ap.add_argument("--repl", action="store_true", help=argparse.SUPPRESS)
    # --run-script never reaches argparse; it is intercepted at the top of
    # main() so the target script's own flags cannot collide with lset's.
    args = ap.parse_args(argv)

    if args.approve_bridge:
        from lse_terminal.engine.approve_bridge import main as bridge_main
        return bridge_main(args.engine_port, args.engine_token, args.bridge_role)

    if args.repl:
        import code
        import sys
        try:
            import readline  # noqa: F401  history + line editing on posix
        except ImportError:
            pass  # windows: pywinpty handles echo, editing is basic
        from lse_terminal import __version__
        banner = (
            f"Python {sys.version.split()[0]} - LSE Terminal {__version__}\n"
            "Your strategy workspace is the current directory.\n"
            "  import pandas as pd  # strategies are plain Python; nothing\n"
            "  df = pd.read_csv(...)  # to import from us")
        code.interact(banner=banner, local={"__name__": "__main__"}, exitmsg="")
        return 0

    import uvicorn

    from lse_terminal.engine.server import create_app

    url = f"http://{args.host}:{args.port}"
    if not args.no_browser:
        # webbrowser is a no-op on headless boxes; on desktops it picks the
        # platform browser, so no DISPLAY sniffing (it doesn't exist on
        # mac/windows and would wrongly suppress the open there).
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"LSE Terminal -> {url}")
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
