"""Built-in providers. These double as the reference implementations for the
Provider contract: `demo` shows the minimum viable shape (no network, no auth),
`lse` shows a real remote source with auth, catalog, and streaming.
"""

from lse_terminal.providers.demo import DemoProvider
from lse_terminal.providers.lse import LseProvider
from lse_terminal.providers.userdata import UserDataProvider

__all__ = ["DemoProvider", "LseProvider", "UserDataProvider"]
