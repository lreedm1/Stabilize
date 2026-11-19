"""Network-free tests for manual Stabilize credential repair."""
import importlib.util
import copy
import io
import json
import os
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("repair.py")
SPEC = importlib.util.spec_from_file_location("stabilize_api_repair", MODULE)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)

OLD = "11111111-1111-1111-1111-111111111111"
NEW = "22222222-2222-2222-2222-222222222222"
ENV = {
    "REPAIR_CONFIRMATION": "APPLY-STABILIZE-REPAIR",
    "REPAIR_EXPECTED_VERSION": OLD,
    "REPAIR_CREATE_SERVICE_ACCOUNT": "false",
    "OPENAI_ORG_ID": "org-test",
    "OPENAI_PROJECT_API_KEY": "sk-example",
    "OPENAI_USAGE_ADMIN_KEY": "admin-example",
    "CF_API_TOKEN": "cf-example",
    "CF_ACCOUNT_ID": "a" * 32,
}
RESOURCES = {
    "script": {"etag": "reviewed-code-hash"},
    "script_runtime": {"compatibility_date": "2026-08-01"},
    "bindings": [
        *[{"name": name, "type": "plain_text", "text": value}
          for name, value in {**repair.APPROVED_BUDGET, "DEMO_MODE": "false"}.items()],
        {"name": "OPENAI_TOKEN_BUDGET", "type": "durable_object_namespace", "namespace_id": "same-ledger"},
        {"name": "AUTH_SECRET", "type": "secret_text"},
        *[{"name": name, "type": "secret_text"} for name in repair.REPAIR_SECRETS],
    ],
}


class ProbeResponse(io.BytesIO):
    def __init__(self, body, content_type="application/x-ndjson"):
        super().__init__(body)
        self.headers = Message()
        self.headers["Content-Type"] = content_type


def stream_events():
    return [
        {"type": "meta", "route": "ORDINARY"},
        {"type": "delta", "delta": "Hello!"},
        {"type": "done", "route": "ORDINARY", "reply": "Hello!", "analytics": {
            "model": "gpt-5.4", "inputTokens": 10, "outputTokens": 2, "actualServiceTier": "default",
        }},
    ]


class RepairTests(unittest.TestCase):
    def setUp(self):
        # Mock repair calls must not look like real credential/deployment changes
        # in the same Actions log as the later production diagnostic.
        output = patch("sys.stdout", new_callable=io.StringIO)
        output.start()
        self.addCleanup(output.stop)

    def test_confirmation_required_before_any_access(self):
        with patch.dict(os.environ, {"REPAIR_CONFIRMATION": "wrong"}, clear=True):
            with self.assertRaisesRegex(repair.SafeError, "explicit workflow confirmation"):
                repair.repair()

    def test_diagnostic_types_are_constrained(self):
        self.assertEqual(repair.safe_code("budget_input_count_http_401"),
                         "budget_input_count_http_401")
        self.assertEqual(repair.safe_code("Bearer sk-private-key"), "unknown")

    def test_project_key_validates_both_models(self):
        models = []
        def fake_api(method, url, key, payload, org):
            models.append(payload["model"])
            return {"object": "response.input_tokens", "input_tokens": 5}
        with patch.object(repair, "api", side_effect=fake_api):
            repair.validate_project_key("org-test", "sk-test")
        self.assertEqual(models, ["gpt-5.4", "gpt-5.6-sol"])

    def test_repair_replaces_only_three_secrets_and_preserves_budget(self):
        changed = []
        reads = iter([{OLD}, {OLD, NEW}])
        def fake_cf(method, path, key, payload=None):
            changed.append((method, path, payload))
            if method == "PATCH":
                return {"success": True, "result": {"id": NEW}}
            if method == "GET" and "deployments?" in path:
                return {"result": {"deployments": [{"versions": [
                    {"version_id": NEW, "percentage": 100}
                ]}]}}
            return {"success": True}
        context = ("org-test", "admin-example", "cf-example", "/worker", "sk-example", OLD, RESOURCES)
        with patch.dict(os.environ, ENV, clear=True), \
             patch.object(repair, "preflight", return_value=context), \
             patch.object(repair, "deployed_version", return_value=OLD), \
             patch.object(repair, "version_resources", return_value=RESOURCES), \
             patch.object(repair, "version_ids", side_effect=lambda *x, **kw: next(reads)), \
             patch.object(repair, "cf_api", side_effect=fake_cf), \
             patch.object(repair, "run_chat_probe"):
            repair.repair()
        patch_calls = [v for v in changed if v[0] == "PATCH"]
        self.assertEqual(len(patch_calls), 1)
        payload = patch_calls[0][2]
        self.assertEqual(set(payload["env"]),
            {"OPENAI_ORGANIZATION_ID", "OPENAI_API_KEY", "OPENAI_USAGE_ADMIN_KEY"})
        self.assertEqual(payload["env"]["OPENAI_API_KEY"]["text"], "sk-example")
        self.assertNotIn("OPENAI_FREE_TOKENS_ONLY", payload["env"])
        self.assertTrue(patch_calls[0][1].endswith("/versions/latest"))
        self.assertNotIn("secrets-bulk", patch_calls[0][1])
        deployments = [v for v in changed if v[0] == "POST"]
        self.assertEqual(deployments[0][2]["versions"],
                         [{"version_id": NEW, "percentage": 100}])

    def test_usage_failure_halts_before_secret_patch(self):
        env = {
            "REPAIR_CONFIRMATION": "APPLY-STABILIZE-REPAIR",
            "REPAIR_EXPECTED_VERSION": OLD,
            "OPENAI_ORG_ID": "org-test",
            "OPENAI_USAGE_ADMIN_KEY": "admin-example",
            "CF_API_TOKEN": "cf-example",
            "CF_ACCOUNT_ID": "a" * 32,
        }
        with patch.dict(os.environ, env, clear=True), \
             patch.object(repair, "validate_repo_budget"), \
             patch.object(repair, "validate_usage", side_effect=repair.SafeError("HTTP 403")), \
             patch.object(repair, "cf_api") as remote:
            with self.assertRaises(repair.SafeError):
                repair.repair()
            remote.assert_not_called()

    def test_read_only_preflight_never_mutates_or_generates(self):
        def fake_cf(method, path, key, payload=None):
            self.assertEqual(method, "GET")
            if path.endswith("/secrets"):
                return {"result": [{"name": name} for name in repair.REPAIR_SECRETS]}
            if "/deployments?" in path:
                return {"result": {"deployments": [{"versions": [{"version_id": OLD, "percentage": 100}]}]}}
            if path.endswith("/versions/" + OLD):
                return {"result": {"id": OLD, "resources": RESOURCES}}
            if path.endswith("/versions"):
                return {"result": {"items": [{"id": OLD}]}}
            self.fail("Unexpected Cloudflare request")
        def fake_openai(method, url, key, payload=None, org=None):
            self.assertEqual(org, "org-test")
            if "/organization/usage/" in url:
                self.assertEqual(method, "GET")
                return {"object": "page", "data": [], "has_more": False}
            self.assertTrue(url.endswith("/responses/input_tokens"))
            self.assertEqual(method, "POST")
            return {"object": "response.input_tokens", "input_tokens": 5}
        with patch.dict(os.environ, ENV, clear=True), \
             patch.object(repair, "cf_api", side_effect=fake_cf), \
             patch.object(repair, "api", side_effect=fake_openai), \
             patch.object(repair, "run_chat_probe") as chat:
            self.assertEqual(repair.preflight()[5], OLD)
            chat.assert_not_called()

    def test_changed_live_version_blocks_mutation(self):
        context = ("org-test", "admin-example", "cf-example", "/worker", "sk-example", NEW, RESOURCES)
        with patch.dict(os.environ, ENV, clear=True), \
             patch.object(repair, "preflight", return_value=context), \
             patch.object(repair, "cf_api") as remote:
            with self.assertRaisesRegex(repair.SafeError, "version changed"):
                repair.repair()
            remote.assert_not_called()

    def test_unreviewed_latest_version_blocks_repair(self):
        with patch.object(repair, "cf_api", return_value={"result": {"items": [{"id": NEW}, {"id": OLD}]}}):
            with self.assertRaisesRegex(repair.SafeError, "pending releases"):
                repair.version_ids("/worker", "cf-test", expected_latest=OLD)

    def test_changed_patch_resources_block_deployment(self):
        context = ("org-test", "admin-example", "cf-example", "/worker", "sk-example", OLD, RESOURCES)
        after = copy.deepcopy(RESOURCES)
        after["script"]["etag"] = "unreviewed-code"
        with patch.dict(os.environ, ENV, clear=True), \
             patch.object(repair, "preflight", return_value=context), \
             patch.object(repair, "version_ids", side_effect=[{OLD}, {OLD, NEW}]), \
             patch.object(repair, "deployed_version", return_value=OLD), \
             patch.object(repair, "version_resources", return_value=after), \
             patch.object(repair, "cf_api", return_value={"result": {"id": NEW}}) as remote:
            with self.assertRaisesRegex(repair.SafeError, "changed code"):
                repair.repair()
            self.assertEqual([c.args[0] for c in remote.call_args_list], ["PATCH"])

    def test_live_budget_and_ledger_must_be_verified(self):
        for name in [*repair.APPROVED_BUDGET, "OPENAI_TOKEN_BUDGET"]:
            with self.subTest(binding=name):
                resources = copy.deepcopy(RESOURCES)
                resources["bindings"] = [b for b in resources["bindings"] if b["name"] != name]
                with patch.object(repair, "cf_api", return_value={"result": {"id": OLD, "resources": resources}}):
                    with self.assertRaises(repair.SafeError):
                        repair.version_resources("/worker", "cf-test", OLD)

    def test_unrelated_bindings_and_ledger_namespace_cannot_change(self):
        for name in ["AUTH_SECRET", "OPENAI_TOKEN_BUDGET"]:
            after = copy.deepcopy(RESOURCES)
            next(b for b in after["bindings"] if b["name"] == name)["namespace_id"] = "changed"
            self.assertFalse(repair.unchanged_resources(RESOURCES, after))

    def test_invalid_token_counts_are_rejected(self):
        for count in [True, -1, 1.5, None]:
            with self.subTest(count=count), patch.object(repair, "api", return_value={
                "object": "response.input_tokens", "input_tokens": count,
            }):
                with self.assertRaises(repair.SafeError):
                    repair.validate_project_key("org-test", "sk-test")

    def probe(self, events, content_type="application/x-ndjson"):
        body = "\n".join(json.dumps(e) for e in events).encode()
        with patch.object(repair.urllib.request, "urlopen", return_value=ProbeResponse(body, content_type)):
            repair.run_chat_probe()

    def test_completed_model_stream_succeeds(self):
        self.probe(stream_events())

    def test_error_after_done_is_not_hidden(self):
        with self.assertRaisesRegex(repair.SafeError, "stabilize_token_budget_unavailable"):
            self.probe(stream_events() + [{"type": "error", "diagnostic": {
                "code": "stabilize_token_budget_unavailable", "type": "budget_organization_credentials",
            }}])

    def test_done_without_streamed_text_fails(self):
        with self.assertRaisesRegex(repair.SafeError, "complete streamed"):
            self.probe([stream_events()[-1]])

    def test_demo_or_missing_usage_cannot_pass(self):
        for change in [{"model": "demo"}, {"outputTokens": 0}, {"inputTokens": True}, {"actualServiceTier": "fast"}]:
            with self.subTest(change=change):
                events = stream_events()
                events[-1]["analytics"].update(change)
                with self.assertRaises(repair.SafeError):
                    self.probe(events)

    def test_non_stream_content_type_fails(self):
        with self.assertRaisesRegex(repair.SafeError, "NDJSON"):
            self.probe(stream_events(), "text/html")

    def test_http_failure_reports_status_without_response_contents(self):
        failure = repair.urllib.error.HTTPError(
            "https://stabilize.info/api/chat", 403,
            "private upstream detail", Message(), io.BytesIO(b"private response"),
        )
        with patch.object(repair.urllib.request, "urlopen", side_effect=failure):
            with self.assertRaises(repair.SafeError) as caught:
                repair.run_chat_probe()
        self.assertEqual(str(caught.exception), "Live chat HTTP 403")

    def test_truncated_or_oversize_stream_cannot_pass(self):
        for body in [b'{"type":', b'x' * (repair.MAX_PROBE_BYTES + 1)]:
            with patch.object(repair.urllib.request, "urlopen", return_value=ProbeResponse(body)):
                with self.assertRaises(repair.SafeError):
                    repair.run_chat_probe()

    def test_preflight_cannot_create_service_account(self):
        with patch.dict(os.environ, {"REPAIR_MODE": "preflight", "REPAIR_CREATE_SERVICE_ACCOUNT": "true"}, clear=True), \
             patch.object(repair, "preflight") as check:
            with self.assertRaisesRegex(repair.SafeError, "cannot provision"):
                repair.main()
            check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
