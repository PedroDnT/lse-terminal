"""
Local ML training job runner for the MACHINE LEARNING tab.

Runs the ported ML Studio training scripts as subprocesses on the user's own
machine (their CPU or GPU; nothing is uploaded anywhere). The contract with a
script is the same one the hosted workers use:

  - dataset arrives as a file, path in env LSE_ML_DATA_FILE
  - parameters arrive as --key value CLI arguments
  - progress is whatever the script prints to stdout
  - final results are a JSON block between [RESULTS_JSON] and [/RESULTS_JSON]

Jobs are held in memory while the terminal runs; finished jobs are persisted
to <config_dir>/ml/history.json (last MAX_HISTORY entries) so past results
survive a restart.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from lse_terminal.ml.env import python_argv

SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"

# Hard ceiling per training run; matches the hosted worker script timeout so
# a diverging model cannot wedge the terminal forever.
DEFAULT_TIMEOUT_S = int(os.environ.get("LSE_ML_TIMEOUT", "1800"))
MAX_HISTORY = 100
MAX_LINES = 4000  # ring buffer per job; training logs can be chatty


@dataclass
class MLJob:
    id: str
    model_key: str
    model_name: str
    dataset_label: str
    params: Dict[str, Any]
    status: str = "running"  # running | done | error | cancelled
    created: float = field(default_factory=time.time)
    finished: Optional[float] = None
    lines: deque = field(default_factory=lambda: deque(maxlen=MAX_LINES))
    line_count: int = 0  # total lines ever appended (cursor base for streaming)
    results: Optional[Any] = None
    error: Optional[str] = None
    returncode: Optional[int] = None
    proc: Optional[subprocess.Popen] = None
    # Signalled on every appended line and on completion so websocket
    # streamers can wait instead of busy-polling.
    event: threading.Event = field(default_factory=threading.Event)

    def public(self, with_results: bool = False) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "model_key": self.model_key,
            "model_name": self.model_name,
            "dataset": self.dataset_label,
            "params": self.params,
            "status": self.status,
            "created": self.created,
            "finished": self.finished,
            "error": self.error,
        }
        if with_results:
            d["results"] = self.results
            d["lines"] = list(self.lines)
        return d


class MLJobManager:
    def __init__(self, ml_dir: Path):
        self.ml_dir = Path(ml_dir)
        self.jobs_dir = self.ml_dir / "jobs"
        self.weights_dir = self.ml_dir / "weights"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.weights_dir.mkdir(parents=True, exist_ok=True)
        self.jobs: Dict[str, MLJob] = {}
        self.lock = threading.Lock()
        self.history_path = self.ml_dir / "history.json"

    # ---- history -----------------------------------------------------------

    def history(self) -> List[Dict[str, Any]]:
        try:
            return json.loads(self.history_path.read_text())
        except Exception:
            return []

    def _append_history(self, job: MLJob) -> None:
        entries = self.history()
        entries.insert(0, job.public())
        del entries[MAX_HISTORY:]
        tmp = self.history_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(entries, default=str))
        tmp.replace(self.history_path)

    def saved_results(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Results of a finished job, from memory or from disk after restart."""
        job = self.jobs.get(job_id)
        if job is not None:
            return job.public(with_results=True)
        path = self.jobs_dir / f"{job_id}.json"
        if path.exists():
            try:
                return json.loads(path.read_text())
            except Exception:
                return None
        return None

    # ---- job lifecycle -----------------------------------------------------

    def running_count(self) -> int:
        return sum(1 for j in self.jobs.values() if j.status == "running")

    def start(
        self,
        model: Dict[str, Any],
        df: pd.DataFrame,
        dataset_label: str,
        params: Dict[str, Any],
        features: Optional[List[str]] = None,
        econ_df: Optional[pd.DataFrame] = None,
        timeframe: str = "1h",
        timeout_s: int = DEFAULT_TIMEOUT_S,
    ) -> MLJob:
        job_id = uuid.uuid4().hex[:12]
        job_dir = self.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        # The chart/provider frame uses 'ts' (epoch seconds); scripts expect
        # 'timestamp'. utils._load_local_frame accepts either, but exporting
        # the canonical name keeps user-visible files self-describing.
        out = df.rename(columns={"ts": "timestamp"})
        data_file = job_dir / "data.csv"
        out.to_csv(data_file, index=False)

        env = dict(os.environ)
        env["LSE_ML_DATA_FILE"] = str(data_file)
        env["LSE_ML_WEIGHTS_DIR"] = str(self.weights_dir)
        env["PYTHONUNBUFFERED"] = "1"
        if econ_df is not None and not econ_df.empty:
            econ_file = job_dir / "econ.csv"
            econ_df.to_csv(econ_file, index=False)
            env["LSE_ML_ECON_FILE"] = str(econ_file)

        script = SCRIPTS_DIR / model["script"]
        # python_argv, not a bare sys.executable: in the frozen desktop
        # build the latter is the lset app and rejects the script (exit 2).
        cmd = python_argv(script,
                          "--dataset", dataset_label,
                          "--timeframe", timeframe or "1h",
                          "--job_id", job_id)
        param_ids = {p["id"]: p for p in model.get("params", [])}
        for key, value in params.items():
            if key not in param_ids or value is None:
                continue
            if param_ids[key].get("type") in ("boolean", "toggle"):
                # No script in the tree uses store_true; booleans arrive as
                # string-typed --key true/false args (kalman --smoothing).
                cmd += [f"--{key}", "true" if value in (True, "true", "True", 1, "1") else "false"]
            else:
                cmd += [f"--{key}", str(value)]
        if features and model.get("features_arg"):
            cmd += ["--features", *features]

        job = MLJob(
            id=job_id,
            model_key=model["key"],
            model_name=model["name"],
            dataset_label=dataset_label,
            params={k: v for k, v in params.items() if k in param_ids},
        )
        with self.lock:
            self.jobs[job_id] = job

        # cwd = scripts dir so the scripts' `sys.path` tricks and relative
        # artefacts (catboost_info etc.) stay inside the job sandbox area.
        job.proc = subprocess.Popen(
            cmd,
            cwd=str(job_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self._pump, args=(job, timeout_s, job_dir),
                         daemon=True, name=f"ml-job-{job_id}").start()
        return job

    def start_code(self, code: str, timeout_s: int = DEFAULT_TIMEOUT_S) -> MLJob:
        """
        Run a blueprint script (the code-first ML section): plain Python that
        calls lse_terminal.ml.blueprint. Same streaming/results contract as
        start(): blueprint.train() re-emits the model script's
        [RESULTS_JSON] block, which _pump parses for the results pane.
        """
        job_id = uuid.uuid4().hex[:12]
        job_dir = self.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        script = job_dir / "blueprint_run.py"
        script.write_text(code, encoding="utf-8")

        # Display name from the template's first comment line ("# LSTM
        # Price Forecast: ..."), so history rows read like model runs.
        first = next((l[1:].strip() for l in code.splitlines()
                      if l.startswith("#")), "")
        name = (first.split(":", 1)[0].strip() or "Blueprint")[:60]

        env = dict(os.environ)
        env["LSE_ML_WEIGHTS_DIR"] = str(self.weights_dir)
        env["PYTHONUNBUFFERED"] = "1"

        job = MLJob(id=job_id, model_key="blueprint", model_name=name,
                    dataset_label="blueprint code", params={})
        with self.lock:
            self.jobs[job_id] = job
        # python_argv: the frozen desktop build cannot run scripts through a
        # bare sys.executable (that is the lset app itself, exit 2). This is
        # the Python IDE's RUN button, so the bug hit every desktop run.
        job.proc = subprocess.Popen(
            python_argv(script),
            cwd=str(job_dir), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1)
        threading.Thread(target=self._pump, args=(job, timeout_s, job_dir),
                         daemon=True, name=f"ml-job-{job_id}").start()
        return job

    def _pump(self, job: MLJob, timeout_s: int, job_dir: Path) -> None:
        """Reader thread: stream stdout, enforce timeout, parse results."""
        deadline = time.time() + timeout_s
        killer = threading.Timer(timeout_s, self._timeout_kill, args=(job,))
        killer.daemon = True
        killer.start()
        in_results = False
        results_buf: List[str] = []
        try:
            assert job.proc is not None and job.proc.stdout is not None
            for line in job.proc.stdout:
                line = line.rstrip("\n")
                if line == "[RESULTS_JSON]":
                    in_results = True
                    continue
                if line == "[/RESULTS_JSON]":
                    in_results = False
                    continue
                if in_results:
                    results_buf.append(line)
                    continue
                job.lines.append(line)
                job.line_count += 1
                job.event.set()
            job.returncode = job.proc.wait()
        except Exception as e:  # reader must never die silently
            job.error = f"runner error: {e}"
        finally:
            killer.cancel()

        if results_buf:
            try:
                job.results = json.loads("\n".join(results_buf))
            except Exception as e:
                job.error = f"could not parse results JSON: {e}"

        if job.status == "cancelled":
            pass
        elif job.error:
            job.status = "error"
        elif job.returncode == 0 and job.results is not None:
            job.status = "done"
        elif job.returncode == 0:
            # A blueprint may legitimately end without training (e.g. it
            # only built a dataset); a bare model script may not.
            if job.model_key == "blueprint":
                job.status = "done"
            else:
                job.status = "error"
                job.error = "script finished without a results block"
        else:
            job.status = "error"
            tail = [l for l in list(job.lines)[-15:] if l.strip()]
            job.error = (f"script exited with code {job.returncode}"
                         + (": " + tail[-1] if tail else ""))
            if time.time() >= deadline:
                job.error = f"timed out after {timeout_s}s and was stopped"

        job.finished = time.time()
        job.event.set()

        # Persist full record for later viewing, then drop the bulky dataset
        # copy; weights stay under weights_dir.
        try:
            (self.jobs_dir / f"{job.id}.json").write_text(
                json.dumps(job.public(with_results=True), default=str))
            self._append_history(job)
            shutil.rmtree(job_dir, ignore_errors=True)
        except Exception:
            pass

    def _timeout_kill(self, job: MLJob) -> None:
        if job.proc is not None and job.proc.poll() is None:
            job.lines.append(f"[ERROR] Training exceeded the time limit and was stopped")
            job.line_count += 1
            job.proc.kill()

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if job is None or job.status != "running":
            return False
        job.status = "cancelled"
        if job.proc is not None and job.proc.poll() is None:
            job.proc.kill()
        return True

    def wait_lines(self, job: MLJob, cursor: int, timeout: float = 20.0):
        """
        Block (in a worker thread) until the job has lines beyond `cursor` or
        finishes. Returns (new_lines, new_cursor, finished). Event-driven so
        websocket streaming does not busy-poll the process.
        """
        if cursor >= job.line_count and job.status == "running":
            job.event.clear()
            # Re-check after clear to close the race with the reader thread.
            if cursor >= job.line_count and job.status == "running":
                job.event.wait(timeout)
        buffered = list(job.lines)
        start = job.line_count - len(buffered)
        new = buffered[max(0, cursor - start):]
        return new, job.line_count, job.status != "running"
