from __future__ import annotations

import json
import re
import subprocess
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "workflows" / "pulseops-api-reliability-control-tower.json"


def run_checked(*command: str) -> str:
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise AssertionError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout


def edge_count(connections: dict) -> int:
    return sum(
        len(group)
        for channels in connections.values()
        for groups in channels.values()
        for group in groups
    )


class RepositoryTests(unittest.TestCase):
    def test_static_workflow_validation(self) -> None:
        output = run_checked("python3", "scripts/validate_workflow.py")
        self.assertIn("69 nodes", output)
        self.assertIn("72 edges", output)

    def test_code_nodes_compile(self) -> None:
        output = run_checked("node", "scripts/check-code-syntax.mjs")
        self.assertIn("29 Code nodes", output)

    def test_offline_scenarios(self) -> None:
        output = run_checked("node", "scripts/run-demo-path.mjs")
        self.assertIn("all 29 production Code nodes", output)
        self.assertIn("one outage, one recovery, and one latency degradation", output)

    def test_manifest_matches_workflow(self) -> None:
        workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
        manifest = json.loads((ROOT / "workflow-manifest.json").read_text(encoding="utf-8"))
        inventory = manifest["inventory"]
        counts = Counter(node["type"] for node in workflow["nodes"])

        self.assertEqual(inventory["total_nodes"], len(workflow["nodes"]))
        self.assertEqual(
            inventory["functional_nodes"],
            len([node for node in workflow["nodes"] if node["type"] != "n8n-nodes-base.stickyNote"]),
        )
        self.assertEqual(inventory["sticky_notes"], counts["n8n-nodes-base.stickyNote"])
        self.assertEqual(inventory["connections"], edge_count(workflow["connections"]))
        self.assertEqual(inventory["code_nodes"], counts["n8n-nodes-base.code"])
        self.assertEqual(inventory["http_request_nodes"], counts["n8n-nodes-base.httpRequest"])
        self.assertEqual(inventory["telegram_nodes"], counts["n8n-nodes-base.telegram"])
        self.assertEqual(manifest["workflow_name"], workflow["name"])
        self.assertEqual(manifest["workflow_file"], str(WORKFLOW.relative_to(ROOT)))

    def test_required_files_and_sample_json(self) -> None:
        required = [
            "README.md",
            "README_RU.md",
            "LICENSE",
            "workflow-manifest.json",
            "docs/ARCHITECTURE.md",
            "docs/DATA_CONTRACTS.md",
            "docs/SETUP.md",
            ".github/workflows/validate.yml",
            ".env.example",
        ]
        for relative in required:
            self.assertTrue((ROOT / relative).is_file(), relative)

        samples = sorted((ROOT / "sample-data").glob("*.json"))
        self.assertEqual(len(samples), 5)
        for sample in samples:
            json.loads(sample.read_text(encoding="utf-8"))

    def test_local_markdown_links_exist(self) -> None:
        link_pattern = re.compile(r"\]\(([^)]+)\)")
        for markdown in ROOT.rglob("*.md"):
            text = markdown.read_text(encoding="utf-8")
            for raw_target in link_pattern.findall(text):
                target = raw_target.strip().split("#", 1)[0]
                if not target or target.startswith(("http://", "https://", "mailto:")):
                    continue
                resolved = (markdown.parent / target).resolve()
                self.assertTrue(resolved.exists(), f"Broken link in {markdown.relative_to(ROOT)}: {raw_target}")


if __name__ == "__main__":
    unittest.main()
