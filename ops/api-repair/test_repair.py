"""Network-free tests for manual Stabilize credential repair."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).with_name("repair.py")
SPEC = importlib.util.spec_from_file_location("stabilize_api_repair", MODULE)
repair = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repair)


class RepairTests(unittest.TestCase):
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
        reads = iter([{"old"}, {"old", "new"}])
        def fake_cf(method, path, key, payload=None):
            changed.append((method, path, payload))
            if method == "GET" and "deployments?" in path:
                return {"result": {"deployments": [{"versions": [
                    {"version_id": "new", "percentage": 100}
                ]}]}}
            return {"success": True}
        env = {
            "REPAIR_CONFIRMATION": "APPLY-STABILIZE-REPAIR",
            "REPAIR_CREATE_SERVICE_ACCOUNT": "false",
            "OPENAI_ORG_ID": "org-test",
            "OPENAI_PROJECT_API_KEY": "sk-example",
            "OPENAI_USAGE_ADMIN_KEY": "admin-example",
            "CF_API_TOKEN": "cf-example",
            "CF_ACCOUNT_ID": "a" * 32,
        }
        with patch.dict(os.environ, env, clear=True), \
             patch.object(repair, "validate_repo_budget"), \
             patch.object(repair, "validate_usage"), \
             patch.object(repair, "validate_worker"), \
             patch.object(repair, "validate_project_key"), \
             patch.object(repair, "version_ids", side_effect=lambda *x: next(reads)), \
             patch.object(repair, "cf_api", side_effect=fake_cf), \
             patch.object(repair, "run_chat_probe"):
            repair.repair()
        patch_calls = [v for v in changed if v[0] == "PATCH"]
        self.assertEqual(len(patch_calls), 1)
        payload = patch_calls[0][2]
        self.assertEqual(set(payload["secrets"]),
            {"OPENAI_ORGANIZATION_ID", "OPENAI_API_KEY", "OPENAI_USAGE_ADMIN_KEY"})
        self.assertEqual(payload["secrets"]["OPENAI_API_KEY"]["text"], "sk-example")
        self.assertNotIn("OPENAI_FREE_TOKENS_ONLY", payload["secrets"])
        deployments = [v for v in changed if v[0] == "POST"]
        self.assertEqual(deployments[0][2]["versions"],
                         [{"version_id": "new", "percentage": 100}])

    def test_usage_failure_halts_before_secret_patch(self):
        env = {
            "REPAIR_CONFIRMATION": "APPLY-STABILIZE-REPAIR",
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


if __name__ == "__main__":
    unittest.main()
