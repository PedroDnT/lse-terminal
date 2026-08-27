"""Provider registry + plugin discovery.

Third-party packages plug in through two entry-point groups:

    [project.entry-points."lse_terminal.providers"]
    mysource = "my_pkg:MyProvider"          # class or instance

    [project.entry-points."lse_terminal.indicators"]
    myindicators = "my_pkg.indicators"      # module; import registers

A broken plugin must never take the terminal down, so load errors are
collected and reported, not raised.
"""

from __future__ import annotations

import inspect
import logging
from importlib.metadata import entry_points

from lse_terminal.contracts import Provider

log = logging.getLogger("lse_terminal")


class Registry:
    def __init__(self):
        self._providers: dict[str, Provider] = {}
        self._engines: dict = {}
        self.plugin_errors: list[str] = []

    def register(self, provider: Provider) -> None:
        if not provider.name:
            raise ValueError(f"{type(provider).__name__} has an empty name")
        self._providers[provider.name] = provider

    def get(self, name: str) -> Provider:
        try:
            return self._providers[name]
        except KeyError:
            raise ValueError(f"unknown provider: {name}") from None

    def unregister(self, name: str) -> None:
        # Deleting a user-configured source at runtime; unknown name is fine
        # (already gone).
        self._providers.pop(name, None)

    def all(self) -> list[Provider]:
        return list(self._providers.values())

    def register_engine(self, engine) -> None:
        if not engine.name:
            raise ValueError(f"{type(engine).__name__} has an empty name")
        self._engines[engine.name] = engine

    def engine(self, name: str):
        try:
            return self._engines[name]
        except KeyError:
            raise ValueError(f"unknown backtest engine: {name}") from None

    def engines(self) -> list:
        return list(self._engines.values())


def load_builtins(reg: Registry) -> None:
    from lse_terminal.backtest.runner import PythonRunner
    from lse_terminal.providers import (B3Provider, BcbProvider, DemoProvider,
                                        LseProvider, UserDataProvider)

    reg.register(UserDataProvider())
    reg.register(DemoProvider())
    reg.register(LseProvider())
    # The Brazilian sources. Registered unconditionally because neither
    # needs an account at all -- they read what B3 and the central bank
    # publish -- and constructing one costs nothing: they only reach the
    # network when a caller asks them to.
    reg.register(B3Provider())
    reg.register(BcbProvider())
    # One engine, and it runs the user's plain Python. Brue was removed as a
    # strategy language (it is an execution language now); the previous
    # Strategy-subclass engine went with it. Both are archived under
    # archive/ (the strategy-framework snapshot).
    reg.register_engine(PythonRunner())
    # Importing the package runs every built-in @indicator decorator.
    import lse_terminal.indicators  # noqa: F401


def load_plugins(reg: Registry) -> None:
    for ep in entry_points(group="lse_terminal.providers"):
        try:
            obj = ep.load()
            provider = obj() if inspect.isclass(obj) else obj
            reg.register(provider)
        except Exception as e:
            msg = f"provider plugin {ep.name!r} failed to load: {e}"
            log.warning(msg)
            reg.plugin_errors.append(msg)
    for ep in entry_points(group="lse_terminal.indicators"):
        try:
            ep.load()
        except Exception as e:
            msg = f"indicator plugin {ep.name!r} failed to load: {e}"
            log.warning(msg)
            reg.plugin_errors.append(msg)
    for ep in entry_points(group="lse_terminal.engines"):
        try:
            obj = ep.load()
            reg.register_engine(obj() if inspect.isclass(obj) else obj)
        except Exception as e:
            msg = f"engine plugin {ep.name!r} failed to load: {e}"
            log.warning(msg)
            reg.plugin_errors.append(msg)
