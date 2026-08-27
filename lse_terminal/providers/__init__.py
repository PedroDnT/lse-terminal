"""Built-in providers. These double as the reference implementations for the
Provider contract: `demo` shows the minimum viable shape (no network, no auth),
`lse` shows a real remote source with auth, catalog, and streaming, and the
Brazilian pair show what a source built on somebody else's public files looks
like: `b3` reads the exchange's own downloads, `bcb` the central bank's open
series API.
"""

from lse_terminal.providers.b3 import B3Provider
from lse_terminal.providers.bcb import BcbProvider
from lse_terminal.providers.demo import DemoProvider
from lse_terminal.providers.lse import LseProvider
from lse_terminal.providers.userdata import UserDataProvider

__all__ = ["B3Provider", "BcbProvider", "DemoProvider", "LseProvider",
           "UserDataProvider"]
