"""PyInstaller entry for the frozen terminal engine (the desktop sidecar).
Identical to running `lset ...`; exists because PyInstaller wants a script,
not a console-script shim."""
import multiprocessing
import sys

multiprocessing.freeze_support()

from lse_terminal.cli import main

if __name__ == "__main__":
    sys.exit(main())
