#!/usr/bin/env python3
"""Deterministic local client for the FinAgent run-service v1 HTTP contract."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_ENDPOINT = "http://127.0.0.1:39173"
TERMINAL_EVENTS = {"run.completed", "run.failed", "run.cancelled"}
DEFAULT_WAIT_MS = 25_000


class ClientError(RuntimeError):
    pass


class Client:
    def __init__(self, endpoint: str, timeout: float = 120.0):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ClientError("endpoint must be loopback HTTP")
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    def request(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(self.endpoint + path, data=data, method=method, headers={"content-type": "application/json", "accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8", errors="replace")
            raise ClientError(f"HTTP {error.code} {method} {path}: {payload}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ClientError(f"transport error for {method} {path}: {error}") from error

    def probe(self):
        return {"endpoint": self.endpoint, "health": self.request("GET", "/health"), "service": self.request("GET", "/runs/capabilities"), "adapter": self.request("GET", "/adapter/capabilities")}

    def stream(self, run_id: str, after: int = 0):
        path = f"/runs/{urllib.parse.quote(run_id, safe='')}/stream?after={after}"
        request = urllib.request.Request(self.endpoint + path, headers={"accept": "application/x-ndjson"})
        try:
            with urllib.request.urlopen(request, timeout=None) as response:
                for raw in response:
                    if raw.strip():
                        yield json.loads(raw)
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8", errors="replace")
            raise ClientError(f"HTTP {error.code} GET {path}: {payload}") from error
        except urllib.error.URLError as error:
            raise ClientError(f"stream transport error for run {run_id}: {error}") from error


def sanitize(value):
    if isinstance(value, dict): return {key: sanitize(item) for key, item in value.items()}
    if isinstance(value, list): return [sanitize(item) for item in value]
    if isinstance(value, str):
        if pathlib.PurePath(value).is_absolute(): return "<runtime-path>"
        value = re.sub(r"/(?:Users|home|workspace)/[^\s\"']+", "<runtime-path>", value)
    return value


def emit(value): print(json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":")), flush=True)


def emit_stream(events, compact=False):
    assistant = []; first_sequence = None; last_sequence = None; run_id = None; turn_id = None
    def flush_assistant():
        nonlocal assistant, first_sequence, last_sequence
        if assistant:
            emit({"type": "assistant.message", "runId": run_id, "turnId": turn_id, "firstSequence": first_sequence, "lastSequence": last_sequence, "text": "".join(assistant)})
            assistant = []; first_sequence = None; last_sequence = None
    for envelope in events:
        event = envelope.get("event", envelope)
        if compact and event.get("type") == "assistant.delta":
            run_id = event.get("runId", run_id); turn_id = event.get("turnId", turn_id)
            first_sequence = event.get("sequence") if first_sequence is None else first_sequence; last_sequence = event.get("sequence", last_sequence)
            assistant.append(str(event.get("payload", {}).get("text", ""))); continue
        flush_assistant(); emit(envelope)
    flush_assistant()


def until_terminal(events):
    for event in events:
        yield event
        if event.get("type") in TERMINAL_EVENTS or event.get("type") == "terminal": return


def parse_json(value: str):
    try: parsed = json.loads(value)
    except json.JSONDecodeError as error: raise ClientError(f"invalid JSON: {error}") from error
    if not isinstance(parsed, dict): raise ClientError("JSON value must be an object")
    return parsed


def run_path(run_id: str, suffix: str) -> str: return f"/runs/{urllib.parse.quote(run_id, safe='')}/{suffix}"


def typed_request(args):
    arguments = parse_json(args.arguments)
    return {"contract": "finagent.finance-operation.v1", "category": args.category, "operation": args.operation, "arguments": arguments, "payload": arguments, "sessionMode": args.session_mode, "uiRuntime": args.ui_runtime, **({"sessionId": args.session_id} if args.session_id else {})}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="finagent-client")
    parser.add_argument("--endpoint", default=os.environ.get("FINAGENT_ENDPOINT") or os.environ.get("FINAGENT_RUN_SERVICE_ENDPOINT") or DEFAULT_ENDPOINT)
    parser.add_argument("--timeout", type=float, default=120.0)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health"); commands.add_parser("discover"); commands.add_parser("capabilities")
    start = commands.add_parser("start"); start.add_argument("--request", required=True)
    stream = commands.add_parser("stream"); stream.add_argument("run_id"); stream.add_argument("--after", type=int, default=0); stream.add_argument("--compact", action="store_true")
    sync = commands.add_parser("run-sync"); sync.add_argument("--request", required=True); sync.add_argument("--compact", action="store_true")
    operation = commands.add_parser("operation"); operation.add_argument("category", choices=("data", "analysis", "strategy", "execution")); operation.add_argument("operation"); operation.add_argument("--arguments", default="{}"); operation.add_argument("--session-mode", choices=("new", "resume", "preload", "ephemeral", "attached"), default="ephemeral"); operation.add_argument("--session-id"); operation.add_argument("--ui-runtime", choices=("visible", "headless", "mirror"), default="headless")
    for name in ("state", "pending", "result"):
        command = commands.add_parser(name); command.add_argument("run_id")
    wait = commands.add_parser("wait"); wait.add_argument("run_id"); wait.add_argument("--after", type=int, default=0); wait.add_argument("--wait-ms", type=int, default=DEFAULT_WAIT_MS)
    messages = commands.add_parser("messages"); messages.add_argument("run_id"); messages.add_argument("--after", type=int, default=0)
    events = commands.add_parser("events"); events.add_argument("run_id"); events.add_argument("--after", type=int, default=0)
    answer = commands.add_parser("answer"); answer.add_argument("run_id"); answer.add_argument("--response", required=True)
    permission = commands.add_parser("permission"); permission.add_argument("run_id"); permission.add_argument("--response", required=True)
    interrupt = commands.add_parser("interrupt"); interrupt.add_argument("run_id"); interrupt.add_argument("--reason", default="code-agent-request")
    commands.add_parser("sessions")
    commands.add_parser("session-current")
    session_create = commands.add_parser("session-create"); session_create.add_argument("--title")
    artifacts = commands.add_parser("artifacts"); artifacts.add_argument("--limit", type=int, default=20)
    artifact = commands.add_parser("artifact"); artifact.add_argument("artifact_id")
    paper_state = commands.add_parser("paper-state"); paper_state.add_argument("--market", choices=("cn", "us", "hk"), default="cn")
    receipt = commands.add_parser("execution-receipt"); receipt.add_argument("idempotency_key"); receipt.add_argument("--market", choices=("cn", "us", "hk"), default="cn")
    args = parser.parse_args(argv); client = Client(args.endpoint, args.timeout)
    if args.command == "health": emit(client.request("GET", "/health"))
    elif args.command == "discover": emit(client.probe())
    elif args.command == "capabilities": emit({"service": client.request("GET", "/runs/capabilities"), "adapter": client.request("GET", "/adapter/capabilities")})
    elif args.command == "start": emit(client.request("POST", "/runs/start", parse_json(args.request)))
    elif args.command == "operation": emit(client.request("POST", "/runs/start", typed_request(args)))
    elif args.command == "stream":
        emit_stream(client.stream(args.run_id, args.after), args.compact)
    elif args.command == "run-sync":
        admitted = client.request("POST", "/runs/start", parse_json(args.request)); run_id = str(admitted.get("runId") or admitted.get("run", {}).get("runId") or "")
        if not run_id: raise ClientError("start response did not include runId")
        emit({"type": "run.admitted", "runId": run_id, "admission": admitted})
        emit_stream(until_terminal(client.stream(run_id, 0)), args.compact)
        emit(client.request("GET", run_path(run_id, "result")))
    elif args.command in {"state", "pending", "result"}: emit(client.request("GET", run_path(args.run_id, args.command)))
    elif args.command == "events": emit(client.request("GET", run_path(args.run_id, f"events?after={args.after}")))
    elif args.command == "wait": emit(client.request("GET", run_path(args.run_id, f"wait?after={args.after}&timeoutMs={max(1, min(args.wait_ms, 30_000))}")))
    elif args.command == "messages": emit(client.request("GET", run_path(args.run_id, f"messages?after={args.after}")))
    elif args.command == "answer": emit(client.request("POST", run_path(args.run_id, "responses"), parse_json(args.response)))
    elif args.command == "permission": emit(client.request("POST", run_path(args.run_id, "permissions"), parse_json(args.response)))
    elif args.command == "interrupt": emit(client.request("POST", run_path(args.run_id, "interrupt"), {"reason": args.reason}))
    elif args.command == "sessions": emit(client.request("GET", "/sessions"))
    elif args.command == "session-current": emit(client.request("GET", "/sessions/current"))
    elif args.command == "session-create": emit(client.request("POST", "/sessions", {"title": args.title} if args.title else {}))
    elif args.command == "artifacts": emit(client.request("GET", f"/artifacts?limit={max(1, min(args.limit, 200))}"))
    elif args.command == "artifact": emit(client.request("GET", f"/artifacts/{urllib.parse.quote(args.artifact_id, safe='')}"))
    elif args.command == "paper-state": emit(client.request("GET", f"/execution/paper/state?market={args.market}"))
    elif args.command == "execution-receipt": emit(client.request("GET", f"/execution/receipts/{urllib.parse.quote(args.idempotency_key, safe='')}?market={args.market}"))
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except ClientError as error:
        emit({"ok": False, "error": {"category": "client", "message": str(error), "recovery": "Check the endpoint, request coordinates, and capability descriptor."}}); raise SystemExit(2)
