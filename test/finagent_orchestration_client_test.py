import importlib.util
import pathlib
import unittest


MODULE_PATH = (
    pathlib.Path(__file__).parents[1]
    / "skills/finagent-workstation-service/scripts/finagent_orchestration.py"
)
SPEC = importlib.util.spec_from_file_location("finagent_orchestration", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EvidenceLedgerMetadataTest(unittest.TestCase):
    def test_lifts_structured_provenance_and_artifact_metadata(self):
        brief = {
            "contract": "finagent.task-brief.v1",
            "taskId": "metadata-test",
            "request": "Retrieve quote provenance.",
            "product": "workstation",
            "category": "data",
            "operation": "query",
            "arguments": {},
            "evidenceRequirements": [
                {"id": "quote", "description": "Canonical quote"},
                {"id": "artifact", "description": "Managed artifact"},
            ],
            "uiRuntime": "headless",
            "allowedSideEffect": "read-only",
            "interactionPolicy": "caller-mediated",
            "completionConditions": ["Evidence is retrievable"],
        }
        events = {"events": [
            {
                "sequence": 1,
                "runId": "run-1",
                "type": "tool.result",
                "payload": {
                    "toolUseId": "tool-1",
                    "result": '{"interfaceId":"stock.quote","canonicalSchema":"quote_snapshot",'
                              '"provider":"local","sourceDataTime":"2026-07-13",'
                              '"fetchedAt":"2026-07-13T01:00:00Z","cacheStatus":"cache-hit"}',
                },
            },
            {
                "sequence": 2,
                "runId": "run-1",
                "type": "artifact.created",
                "payload": {
                    "kind": "analysis",
                    "artifactId": "analysis:artifact-1",
                    "stableRef": "artifact:analysis:artifact-1",
                },
            },
        ]}
        ledger = MODULE.build_evidence_ledger(
            brief,
            "workstation",
            events,
            {"runId": "run-1"},
            {"quote": [{"sequence": 1}], "artifact": [{"sequence": 2}]},
        )

        quote = ledger["entries"][0]["evidenceMetadata"]
        artifact = ledger["entries"][1]["evidenceMetadata"]
        self.assertEqual(quote["sourceDataTime"], "2026-07-13")
        self.assertEqual(quote["cacheStatus"], "cache-hit")
        self.assertEqual(artifact["artifactId"], "analysis:artifact-1")

    def test_does_not_parse_prose_or_malformed_result(self):
        metadata = MODULE._evidence_metadata({"result": "not JSON"})
        self.assertEqual(metadata, {})


if __name__ == "__main__":
    unittest.main()
