"""File decoders: any supported file becomes a raw table (DataFrame), then
the normal import brain (time detection, candles vs alternative data) takes
over. Detection prefers magic bytes over the extension so a mislabeled file
still opens.

Adding a format = one function + one register() call. Nothing else in the
pipeline knows formats exist.
"""

from __future__ import annotations

from io import BytesIO, StringIO
from typing import Callable

import pandas as pd


class DecodeError(Exception):
    """User-facing: what the file is and why it could not be read."""


_DECODERS: dict[str, Callable[[bytes], pd.DataFrame]] = {}


def register(name: str, fn: Callable[[bytes], pd.DataFrame]) -> None:
    _DECODERS[name] = fn


def supported() -> list[str]:
    return sorted(_DECODERS)


def _decode_csv(data: bytes) -> pd.DataFrame:
    text = data.decode("utf-8-sig", errors="replace")
    # sniff the delimiter from the header line: comma, semicolon or tab
    header = text.splitlines()[0] if text.splitlines() else ""
    sep = max((",", ";", "\t"), key=header.count)
    try:
        return pd.read_csv(StringIO(text), sep=sep)
    except Exception as e:
        raise DecodeError(f"could not parse the CSV: {e}") from e


def _decode_parquet(data: bytes) -> pd.DataFrame:
    try:
        return pd.read_parquet(BytesIO(data))
    except ImportError as e:
        raise DecodeError("Parquet support needs pyarrow installed") from e
    except Exception as e:
        raise DecodeError(f"could not read the Parquet file: {e}") from e


def _decode_excel(data: bytes) -> pd.DataFrame:
    try:
        return pd.read_excel(BytesIO(data), sheet_name=0)
    except ImportError as e:
        raise DecodeError("Excel support needs openpyxl installed") from e
    except Exception as e:
        raise DecodeError(f"could not read the Excel file: {e}") from e


def _decode_json(data: bytes) -> pd.DataFrame:
    text = data.decode("utf-8-sig", errors="replace")
    for orient in (None, "records", "index"):
        try:
            df = pd.read_json(StringIO(text)) if orient is None else \
                 pd.read_json(StringIO(text), orient=orient)
            if len(df):
                return df
        except Exception:
            continue
    raise DecodeError("could not read the JSON (expected an array of objects "
                      "or a column/row table)")


register("csv", _decode_csv)
register("parquet", _decode_parquet)
register("excel", _decode_excel)
register("json", _decode_json)

_EXT_MAP = {
    "csv": "csv", "tsv": "csv", "txt": "csv",
    "parquet": "parquet", "pq": "parquet", "feather": "parquet",
    "xlsx": "excel", "xls": "excel",
    "json": "json",
}


def detect_format(filename: str, data: bytes) -> str:
    """Magic bytes first, extension second: files lie less than names."""
    if data[:4] == b"PAR1":
        return "parquet"
    if data[:2] == b"PK" and filename.lower().endswith((".xlsx", ".xls")):
        return "excel"
    head = data[:256].lstrip()
    if head[:1] in (b"[", b"{"):
        return "json"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_MAP.get(ext, "csv")


def decode(filename: str, data: bytes) -> pd.DataFrame:
    """filename + raw bytes -> raw table, or DecodeError with a clear why."""
    if not data:
        raise DecodeError(f"{filename} is empty")
    fmt = detect_format(filename, data)
    df = _DECODERS[fmt](data)
    if df is None or df.empty:
        raise DecodeError(f"{filename} decoded to an empty table")
    return df
