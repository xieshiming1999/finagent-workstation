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

from finagent_orchestration import (
    ContractError,
    build_evidence_ledger,
    intervention_run_request,
    task_run_request,
    validate_arbitration,
    validate_intervention,
    validate_revision,
    validate_task_brief,
)


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
        request = urllib.request.Request(
            self.endpoint + path,
            data=data,
            method=method,
            headers={"content-type": "application/json", "accept": "application/json"},
        )
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
        health = self.request("GET", "/health")
        service = self.request("GET", "/runs/capabilities")
        adapter = self.request("GET", "/adapter/capabilities")
        return {"endpoint": self.endpoint, "health": health, "service": service, "adapter": adapter}

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
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        if pathlib.PurePath(value).is_absolute():
            return "<runtime-path>"
        value = re.sub(r"/(?:Users|home|workspace)/[^\s\"']+", "<runtime-path>", value)
    return value


def emit(value):
    print(json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":")), flush=True)


def emit_stream(events, compact=False):
    assistant = []
    first_sequence = None
    last_sequence = None
    run_id = None
    turn_id = None

    def flush_assistant():
        nonlocal assistant, first_sequence, last_sequence
        if assistant:
            emit({"type": "assistant.message", "runId": run_id, "turnId": turn_id, "firstSequence": first_sequence, "lastSequence": last_sequence, "text": "".join(assistant)})
            assistant = []
            first_sequence = None
            last_sequence = None

    for envelope in events:
        event = envelope.get("event", envelope)
        if compact and event.get("type") == "assistant.delta":
            run_id = event.get("runId", run_id)
            turn_id = event.get("turnId", turn_id)
            first_sequence = event.get("sequence") if first_sequence is None else first_sequence
            last_sequence = event.get("sequence", last_sequence)
            assistant.append(str(event.get("payload", {}).get("text", "")))
            continue
        flush_assistant()
        emit(envelope)
    flush_assistant()


def until_terminal(events):
    for event in events:
        yield event
        if event.get("type") in TERMINAL_EVENTS or event.get("type") == "terminal":
            return


def parse_json(value: str):
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise ClientError(f"invalid JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise ClientError("JSON value must be an object")
    return parsed


def run_path(run_id: str, suffix: str) -> str:
    return f"/runs/{urllib.parse.quote(run_id, safe='')}/{suffix}"


def typed_request(args):
    arguments = parse_json(args.arguments)
    return {
        "contract": "finagent.finance-operation.v1",
        "category": args.category,
        "operation": args.operation,
        "arguments": arguments,
        "payload": arguments,
        "sessionMode": args.session_mode,
        "uiRuntime": args.ui_runtime,
        **({"sessionId": args.session_id} if args.session_id else {}),
    }


def compact_result(value):
    events = value.get("events", []) if isinstance(value, dict) else []
    terminal = next((event for event in reversed(events) if event.get("type") in TERMINAL_EVENTS), {})
    payload = terminal.get("payload", {})
    artifacts = [event.get("payload", {}) for event in events if event.get("type") == "artifact.created"]
    errors = [event.get("payload", {}) for event in events if event.get("type") in {"tool.error", "run.failed"}]
    return {
        "ok": value.get("ok"), "kind": value.get("kind"), "runId": value.get("runId"),
        "status": value.get("status"), "sessionId": value.get("sessionId"), "turnId": value.get("turnId"),
        "finalAnswer": str(payload.get("finalAnswer") or "")[:12000],
        "error": payload.get("error"), "category": payload.get("category"), "recovery": payload.get("recovery"),
        "artifacts": artifacts[:20], "errors": errors[:20], "eventCount": len(events),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="finagent-client")
    parser.add_argument("--endpoint", default=os.environ.get("FINAGENT_ENDPOINT") or os.environ.get("FINAGENT_RUN_SERVICE_ENDPOINT") or DEFAULT_ENDPOINT)
    parser.add_argument("--timeout", type=float, default=120.0)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health")
    commands.add_parser("discover")
    commands.add_parser("capabilities")
    start = commands.add_parser("start")
    start.add_argument("--request", required=True, help="Typed run request JSON object")
    stream = commands.add_parser("stream")
    stream.add_argument("run_id")
    stream.add_argument("--after", type=int, default=0)
    stream.add_argument("--compact", action="store_true")
    sync = commands.add_parser("run-sync")
    sync.add_argument("--request", required=True)
    sync.add_argument("--compact", action="store_true")
    operation = commands.add_parser("operation")
    operation.add_argument("category", choices=("data", "analysis", "strategy", "execution"))
    operation.add_argument("operation")
    operation.add_argument("--arguments", default="{}")
    operation.add_argument("--session-mode", choices=("new", "resume", "preload", "ephemeral", "attached"), default="new")
    operation.add_argument("--session-id")
    operation.add_argument("--ui-runtime", choices=("visible", "headless", "mirror"), default="headless")
    for name in ("state", "pending"):
        command = commands.add_parser(name)
        command.add_argument("run_id")
    result = commands.add_parser("result")
    result.add_argument("run_id")
    result.add_argument("--compact", action="store_true")
    wait = commands.add_parser("wait")
    wait.add_argument("run_id")
    wait.add_argument("--after", type=int, default=0)
    wait.add_argument("--wait-ms", type=int, default=DEFAULT_WAIT_MS)
    messages = commands.add_parser("messages")
    messages.add_argument("run_id")
    messages.add_argument("--after", type=int, default=0)
    events = commands.add_parser("events")
    events.add_argument("run_id")
    events.add_argument("--after", type=int, default=0)
    answer = commands.add_parser("answer")
    answer.add_argument("run_id")
    answer.add_argument("--response", required=True, help="Exact response JSON with request coordinates")
    permission = commands.add_parser("permission")
    permission.add_argument("run_id")
    permission.add_argument("--response", required=True, help="Exact permission JSON with request coordinates")
    interrupt = commands.add_parser("interrupt")
    interrupt.add_argument("run_id")
    interrupt.add_argument("--reason", default="code-agent-request")
    commands.add_parser("sessions")
    commands.add_parser("session-current")
    session_create = commands.add_parser("session-create")
    session_create.add_argument("--title")
    artifacts = commands.add_parser("artifacts")
    artifacts.add_argument("--limit", type=int, default=20)
    artifact = commands.add_parser("artifact")
    artifact.add_argument("artifact_id")
    paper_state = commands.add_parser("paper-state")
    paper_state.add_argument("--market", choices=("cn", "us", "hk"), default="cn")
    receipt = commands.add_parser("execution-receipt")
    receipt.add_argument("idempotency_key")
    receipt.add_argument("--market", choices=("cn", "us", "hk"), default="cn")
    arm_failure = commands.add_parser("arm-failure")
    arm_failure.add_argument("--mode", default="next-llm-call")
    task_validate = commands.add_parser("task-validate")
    task_validate.add_argument("--brief", required=True)
    orchestrate = commands.add_parser("orchestrate-start")
    orchestrate.add_argument("--brief", required=True)
    intervene = commands.add_parser("intervene")
    intervene.add_argument("--request", required=True)
    intervene.add_argument("--ui-runtime", choices=("visible", "headless", "mirror"), default="headless")
    ledger = commands.add_parser("ledger")
    ledger.add_argument("run_id")
    ledger.add_argument("--brief", required=True)
    ledger.add_argument("--assignments", default="{}")
    arbitrate = commands.add_parser("arbitrate")
    arbitrate.add_argument("--record", required=True)
    revise = commands.add_parser("revise-report")
    revise.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    client = Client(args.endpoint, args.timeout)

    if args.command == "health":
        emit(client.request("GET", "/health"))
    elif args.command == "discover":
        emit(client.probe())
    elif args.command == "capabilities":
        emit({"service": client.request("GET", "/runs/capabilities"), "adapter": client.request("GET", "/adapter/capabilities")})
    elif args.command == "start":
        emit(client.request("POST", "/runs/start", parse_json(args.request)))
    elif args.command == "operation":
        emit(client.request("POST", "/runs/start", typed_request(args)))
    elif args.command == "stream":
        emit_stream(client.stream(args.run_id, args.after), args.compact)
    elif args.command == "run-sync":
        admitted = client.request("POST", "/runs/start", parse_json(args.request))
        run_id = str(admitted.get("runId") or admitted.get("run", {}).get("runId") or "")
        if not run_id:
            raise ClientError("start response did not include runId")
        emit({"type": "run.admitted", "runId": run_id, "admission": admitted})
        emit_stream(until_terminal(client.stream(run_id, 0)), args.compact)
        emit(client.request("GET", run_path(run_id, "result")))
    elif args.command in {"state", "pending"}:
        emit(client.request("GET", run_path(args.run_id, args.command)))
    elif args.command == "result":
        value = client.request("GET", run_path(args.run_id, "result"))
        emit(compact_result(value) if args.compact else value)
    elif args.command == "events":
        emit(client.request("GET", run_path(args.run_id, f"events?after={args.after}")))
    elif args.command == "wait":
        bounded = max(1, min(args.wait_ms, 30_000))
        emit(client.request("GET", run_path(args.run_id, f"wait?after={args.after}&timeoutMs={bounded}")))
    elif args.command == "messages":
        emit(client.request("GET", run_path(args.run_id, f"messages?after={args.after}")))
    elif args.command == "answer":
        emit(client.request("POST", run_path(args.run_id, "responses"), parse_json(args.response)))
    elif args.command == "permission":
        emit(client.request("POST", run_path(args.run_id, "permissions"), parse_json(args.response)))
    elif args.command == "interrupt":
        emit(client.request("POST", run_path(args.run_id, "interrupt"), {"reason": args.reason}))
    elif args.command == "sessions":
        emit(client.request("GET", "/sessions"))
    elif args.command == "session-current":
        emit(client.request("GET", "/sessions/current"))
    elif args.command == "session-create":
        emit(client.request("POST", "/sessions", {"title": args.title} if args.title else {}))
    elif args.command == "artifacts":
        emit(client.request("GET", f"/artifacts?limit={max(1, min(args.limit, 200))}"))
    elif args.command == "artifact":
        emit(client.request("GET", f"/artifacts/{urllib.parse.quote(args.artifact_id, safe='')}"))
    elif args.command == "paper-state":
        emit(client.request("GET", f"/execution/paper/state?market={args.market}"))
    elif args.command == "execution-receipt":
        key = urllib.parse.quote(args.idempotency_key, safe="")
        emit(client.request("GET", f"/execution/receipts/{key}?market={args.market}"))
    elif args.command == "arm-failure":
        emit(client.request("POST", "/test/run-service/failure", {"mode": args.mode}))
    elif args.command == "task-validate":
        emit(validate_task_brief(parse_json(args.brief), "workstation"))
    elif args.command == "orchestrate-start":
        emit(client.request("POST", "/runs/start", task_run_request(parse_json(args.brief), "workstation")))
    elif args.command == "intervene":
        request = parse_json(args.request)
        intervention = validate_intervention(request, "workstation")
        if intervention["intent"] == "stop":
            run_id = urllib.parse.quote(intervention["target"]["runId"], safe="")
            emit(client.request("POST", f"/runs/{run_id}/interrupt", {"reason": intervention["rationale"]}))
        else:
            emit(client.request("POST", "/runs/start", intervention_run_request(request, "workstation", args.ui_runtime)))
    elif args.command == "ledger":
        events = client.request("GET", run_path(args.run_id, "events?after=0"))
        result = client.request("GET", run_path(args.run_id, "result"))
        emit(build_evidence_ledger(parse_json(args.brief), "workstation", events, result, parse_json(args.assignments)))
    elif args.command == "arbitrate":
        emit(validate_arbitration(parse_json(args.record)))
    elif args.command == "revise-report":
        emit(client.request("POST", "/artifacts/revisions", validate_revision(parse_json(args.request))))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ClientError, ContractError) as error:
        emit({"ok": False, "error": {"category": "client", "message": str(error), "recovery": "Check the endpoint, request coordinates, and capability descriptor."}})
        raise SystemExit(2)
