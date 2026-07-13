"""Caller-owned FinAgent orchestration and arbitration contracts."""

from __future__ import annotations

import json


TASK_CONTRACT = "finagent.task-brief.v1"
LEDGER_CONTRACT = "finagent.evidence-ledger.v1"
INTERVENTION_CONTRACT = "finagent.intervention.v1"
REVISION_CONTRACT = "finagent.report-revision.v1"
ARBITRATION_CONTRACT = "finagent.arbitration-v1"
PRODUCTS = {"mobile", "workstation"}
UI_MODES = {"visible", "headless", "mirror"}
SIDE_EFFECTS = {"read-only": 0, "preparation": 1, "simulated": 2}
OPERATIONS = {
    "data.query": "read-only",
    "analysis.run": "read-only",
    "strategy.review": "preparation",
    "execution.preview": "preparation",
    "execution.simulate": "simulated",
}
INTERVENTIONS = {
    "retrieve_detail",
    "clarify_result",
    "retry_tool",
    "refresh_data",
    "fill_evidence_gap",
    "revise_report",
    "compare_results",
    "stop",
}
DISPOSITIONS = {"accepted", "qualified", "rejected", "needs-user-input", "incomplete"}


class ContractError(ValueError):
    pass


def validate_task_brief(value, selected_product=None):
    brief = _object(value, "task brief")
    _contract(brief, TASK_CONTRACT)
    category = _enum(brief, "category", {"data", "analysis", "strategy", "execution"})
    operation = _string(brief, "operation")
    operation_id = f"{category}.{operation}"
    if operation_id not in OPERATIONS:
        raise ContractError(f"unsupported finance operation {operation_id}")
    product = _enum(brief, "product", PRODUCTS | {"auto"})
    if selected_product and product not in {"auto", selected_product}:
        raise ContractError(f"task brief product {product} does not match {selected_product}")
    allowed = _enum(brief, "allowedSideEffect", set(SIDE_EFFECTS))
    actual = OPERATIONS[operation_id]
    if SIDE_EFFECTS[actual] > SIDE_EFFECTS[allowed]:
        raise ContractError(f"{operation_id} side effect {actual} exceeds {allowed}")
    if brief.get("interactionPolicy") != "caller-mediated":
        raise ContractError("interactionPolicy must be caller-mediated")
    requirements = _object_list(brief, "evidenceRequirements")
    if not requirements:
        raise ContractError("evidenceRequirements must not be empty")
    ids = set()
    normalized_requirements = []
    for requirement in requirements:
        requirement_id = _string(requirement, "id")
        if requirement_id in ids:
            raise ContractError(f"duplicate evidence requirement id {requirement_id}")
        ids.add(requirement_id)
        normalized_requirements.append({
            "id": requirement_id,
            "description": _string(requirement, "description"),
            "required": requirement.get("required") is not False,
            **({"freshness": requirement["freshness"]} if isinstance(requirement.get("freshness"), dict) else {}),
        })
    completion = _string_list(brief, "completionConditions")
    if not completion:
        raise ContractError("completionConditions must not be empty")
    limits = brief.get("limits") if isinstance(brief.get("limits"), dict) else {}
    return {
        "contract": TASK_CONTRACT,
        "taskId": _string(brief, "taskId"),
        "request": _string(brief, "request"),
        "product": product,
        "category": category,
        "operation": operation,
        "arguments": _object(brief.get("arguments"), "arguments"),
        "evidenceRequirements": normalized_requirements,
        "uiRuntime": _enum(brief, "uiRuntime", UI_MODES),
        "allowedSideEffect": allowed,
        "interactionPolicy": "caller-mediated",
        "completionConditions": completion,
        "limits": {
            "maxInterventions": _positive_int(limits.get("maxInterventions"), 3, 20),
            "maxDurationSeconds": _positive_int(limits.get("maxDurationSeconds"), 1800, 14400),
        },
    }


def task_run_request(value, selected_product):
    brief = validate_task_brief(value, selected_product)
    return {**brief, "sessionMode": "new", "payload": {"taskBrief": brief}}


def validate_intervention(value, selected_product=None):
    request = _object(value, "intervention")
    _contract(request, INTERVENTION_CONTRACT)
    target = _object(request.get("target"), "target")
    product = _enum(target, "product", PRODUCTS)
    if selected_product and product != selected_product:
        raise ContractError(f"intervention product {product} does not match {selected_product}")
    intent = _enum(request, "intent", INTERVENTIONS)
    change = _object(request.get("changeRequest"), "changeRequest")
    if not change and intent != "stop":
        raise ContractError(f"changeRequest is required for intervention {intent}")
    normalized_target = {
        "product": product,
        "runId": _string(target, "runId"),
        "sessionId": _string(target, "sessionId"),
        "turnId": _string(target, "turnId"),
    }
    for key in ("toolCallId", "artifactId"):
        if _optional_string(target.get(key)):
            normalized_target[key] = _optional_string(target.get(key))
    return {
        "contract": INTERVENTION_CONTRACT,
        "taskId": _string(request, "taskId"),
        "intent": intent,
        "target": normalized_target,
        "rationale": _string(request, "rationale"),
        "expectedContract": _string(request, "expectedContract"),
        "changeRequest": change,
    }


def intervention_run_request(value, selected_product, ui_runtime):
    intervention = validate_intervention(value, selected_product)
    return {
        **intervention,
        "sessionMode": "resume",
        "sessionId": intervention["target"]["sessionId"],
        "uiRuntime": ui_runtime,
        "payload": {"intervention": intervention},
    }


def build_evidence_ledger(brief_value, product, events_value, result_value, assignments=None):
    brief = validate_task_brief(brief_value, product)
    events_body = events_value if isinstance(events_value, dict) else {}
    result = result_value if isinstance(result_value, dict) else {}
    events = events_body.get("events") if isinstance(events_body.get("events"), list) else []
    assignments = assignments if isinstance(assignments, dict) else {}
    entries = []
    for event in events:
        if not isinstance(event, dict):
            continue
        event_type = str(event.get("type") or "")
        if event_type not in {"tool.call", "tool.result", "tool.error", "artifact.created", "artifact.updated", "run.failed", "run.completed"}:
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        sequence = event.get("sequence")
        artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
        artifact_id = payload.get("artifactId") or payload.get("id") or artifact.get("id")
        tool_call_id = payload.get("toolCallId") or payload.get("toolUseId") or payload.get("requestId")
        requirement_id = _assigned_requirement(assignments, sequence, event_type, tool_call_id, artifact_id)
        status = "success"
        if event_type in {"tool.error", "run.failed"} or payload.get("isError") is True:
            status = "error"
        if requirement_id == "_unmapped" and status == "success" and event_type in {"tool.call", "tool.result"}:
            continue
        entries.append({
            "id": f"event:{sequence}",
            "requirementId": requirement_id,
            "status": status,
            "kind": event_type,
            "coordinates": {
                "runId": event.get("runId") or result.get("runId"),
                "sessionId": event.get("sessionId") or result.get("sessionId"),
                "turnId": event.get("turnId") or result.get("turnId"),
                "sequence": sequence,
                **({"toolCallId": tool_call_id} if tool_call_id else {}),
                **({"artifactId": artifact_id} if artifact_id else {}),
            },
            "preview": _bounded(payload, 4000),
        })
        if len(entries) == 200:
            entries.append({
                "id": "ledger:truncated",
                "requirementId": "_ledger",
                "status": "unsupported",
                "kind": "ledger-limit",
                "coordinates": {"runId": result.get("runId"), "sessionId": result.get("sessionId")},
                "preview": "Evidence ledger reached its 200-entry bound; narrow selectors or retrieve artifact detail.",
            })
            break
    covered = {entry["requirementId"] for entry in entries if entry["status"] == "success"}
    for requirement in brief["evidenceRequirements"]:
        if requirement["required"] and requirement["id"] not in covered:
            entries.append({
                "id": f"missing:{requirement['id']}",
                "requirementId": requirement["id"],
                "status": "missing",
                "kind": "requirement",
                "coordinates": {
                    "runId": result.get("runId"),
                    "sessionId": result.get("sessionId"),
                    "turnId": result.get("turnId"),
                },
                "preview": requirement["description"],
            })
    return validate_evidence_ledger({
        "contract": LEDGER_CONTRACT,
        "taskId": brief["taskId"],
        "product": product,
        "entries": entries,
    })


def validate_evidence_ledger(value):
    ledger = _object(value, "evidence ledger")
    _contract(ledger, LEDGER_CONTRACT)
    ids = set()
    entries = _object_list(ledger, "entries")
    for entry in entries:
        entry_id = _string(entry, "id")
        if entry_id in ids:
            raise ContractError(f"duplicate evidence entry id {entry_id}")
        ids.add(entry_id)
        _string(entry, "requirementId")
        _enum(entry, "status", {"success", "error", "missing", "stale", "conflicting", "unsupported"})
        _object(entry.get("coordinates"), "coordinates")
    return {
        "contract": LEDGER_CONTRACT,
        "taskId": _string(ledger, "taskId"),
        "product": _enum(ledger, "product", PRODUCTS),
        "entries": entries,
    }


def validate_arbitration(value):
    record = _object(value, "arbitration")
    _contract(record, ARBITRATION_CONTRACT)
    claims = _object_list(record, "claims")
    for claim in claims:
        _string(claim, "claim")
        if not _string_list(claim, "evidenceEntryIds"):
            raise ContractError("each arbitration claim needs evidenceEntryIds")
    return {
        **record,
        "contract": ARBITRATION_CONTRACT,
        "taskId": _string(record, "taskId"),
        "product": _enum(record, "product", PRODUCTS),
        "disposition": _enum(record, "disposition", DISPOSITIONS),
        "coordinates": _object_list(record, "coordinates"),
        "claims": claims,
        "conflicts": _object_list(record, "conflicts"),
        "interventions": _object_list(record, "interventions"),
        "safetyState": _object(record.get("safetyState"), "safetyState"),
        "remainingUncertainty": _string_list(record, "remainingUncertainty"),
        "finalSummary": _string(record, "finalSummary"),
        "artifactIds": _string_list(record, "artifactIds"),
    }


def validate_revision(value):
    revision = _object(value, "report revision")
    _contract(revision, REVISION_CONTRACT)
    if "content" not in revision:
        raise ContractError("content is required")
    return {
        "contract": REVISION_CONTRACT,
        "logicalReportId": _string(revision, "logicalReportId"),
        "title": _string(revision, "title"),
        "source": _string(revision, "source"),
        "content": revision["content"],
        "changeSummary": _string(revision, "changeSummary"),
        "evidenceEntryIds": _string_list(revision, "evidenceEntryIds"),
        "sourceCoordinates": _object(revision.get("sourceCoordinates"), "sourceCoordinates"),
        **({"parentArtifactId": _optional_string(revision.get("parentArtifactId"))} if _optional_string(revision.get("parentArtifactId")) else {}),
    }


def _assigned_requirement(assignments, sequence, event_type, tool_call_id, artifact_id):
    for requirement_id, selectors in assignments.items():
        if not isinstance(selectors, list):
            continue
        for selector in selectors:
            if not isinstance(selector, dict):
                continue
            checks = {
                "sequence": sequence,
                "type": event_type,
                "toolCallId": tool_call_id,
                "artifactId": artifact_id,
            }
            if selector and all(checks.get(key) == value for key, value in selector.items()):
                return str(requirement_id)
    return "_unmapped"


def _bounded(value, limit=12000):
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value if len(text) <= limit else {"truncated": True, "preview": text[:limit]}


def _contract(value, expected):
    if value.get("contract") != expected:
        raise ContractError(f"contract must be {expected}")


def _object(value, label):
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    return value


def _object_list(value, key):
    items = value.get(key)
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ContractError(f"{key} must be an array of objects")
    return items


def _string(value, key):
    text = _optional_string(value.get(key))
    if not text:
        raise ContractError(f"{key} is required")
    return text


def _optional_string(value):
    text = "" if value is None else str(value).strip()
    return text or None


def _string_list(value, key):
    items = value.get(key)
    if not isinstance(items, list):
        raise ContractError(f"{key} must be an array")
    result = [_optional_string(item) for item in items]
    if any(item is None for item in result):
        raise ContractError(f"{key} items must be non-empty")
    return result


def _enum(value, key, allowed):
    text = _string(value, key)
    if text not in allowed:
        raise ContractError(f"{key} must be one of {', '.join(sorted(allowed))}")
    return text


def _positive_int(value, fallback, maximum):
    if value in (None, ""):
        return fallback
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ContractError(f"limit must be between 1 and {maximum}") from error
    if parsed <= 0 or parsed > maximum:
        raise ContractError(f"limit must be between 1 and {maximum}")
    return parsed
