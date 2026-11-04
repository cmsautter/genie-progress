"""Exercise the actual static-site preparation step without GitHub or worker code."""
import io
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/pages.yml"


class StableReportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "site").mkdir()
        (self.root / "site/index.html").write_text("Dashboard")
        definitions = WORKFLOW.parents[2] / "site/checkpoint-checks.json"
        (self.root / "site/checkpoint-checks.json").write_bytes(definitions.read_bytes())
        (self.root / 'site/engine_reports.py').write_bytes((WORKFLOW.parents[2] / 'site/engine_reports.py').read_bytes())
        (self.root / 'site/engine_diagnostics.py').write_bytes((WORKFLOW.parents[2] / 'site/engine_diagnostics.py').read_bytes())
        self.bundle = self.root / "reports.tar.gz"
        step = WORKFLOW.read_text().split("- name: Prepare static website", 1)[1]
        self.prepare = textwrap.dedent(step.split("run: |\n", 1)[1].split("      - uses:", 1)[0])
        # Replace only the GitHub download location; execute the real workflow code.
        self.prepare = self.prepare.replace("pathlib.Path('/tmp/report')", "pathlib.Path('.')")

    def run_record(self, identifier, created, status="complete", **extra):
        return {"id": identifier, "sha": "commit-" + identifier, "created": created,
                "status": status, "pilot": False, "fixed": {"total": 1},
                "growing": {"total": 1}, **extra}

    def package(self, runs, corrupt_id=None, rows=None, extra_files=None, engine_lineage=None):
        self.reports = {}
        with tarfile.open(self.bundle, "w:gz") as archive:
            files = {"manifest.json": json.dumps({"generated": "2026-10-19T17:00:00+00:00", "runs": runs,
                                                 **({'engine_lineage': engine_lineage} if engine_lineage else {})}).encode()}
            for run in runs:
                report = {"run": {key: value for key, value in run.items() if key != 'files'}, "identity": {"engine_sha": run["sha"]},
                          "rows": rows if rows is not None else [{"match_id": "123", "sha256": "recording-hash", "fixed": True,
                                    "status": "complete", "total_checkpoints": 2,
                                    "checkpoints_passed": 2}]}
                if run["id"] == corrupt_id:
                    report["run"]["id"] = "wrong-run"
                raw = json.dumps(report, indent=2).encode()
                self.reports[run["id"]] = raw
                files["data/" + run["id"] + ".json"] = raw
            files.update(extra_files or {})
            for name, raw in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                archive.addfile(member, io.BytesIO(raw))

    def prepare_site(self):
        return subprocess.run(["bash", "-e", "-c", self.prepare], cwd=self.root,
                              env={**os.environ, "REPORT_ASSET": self.bundle.name},
                              capture_output=True, text=True, timeout=10)

    def pinned_run(self):
        run = self.run_record('pinned', '2026-10-20T12:00:00Z',
                              fixed={'total': 1, 'finished': 1}, growing={'total': 1, 'finished': 1})
        self.package([run])
        raw = self.reports['pinned']
        run['files'] = {'details': {'url': 'data/pinned.json', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}}
        return run

    def test_byte_pinned_report_and_publication_metadata_survive_deployment(self):
        run = self.pinned_run()
        self.package([run])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'dist/latest.json').read_bytes(), self.reports['pinned'])
        manifest = json.loads((self.root / 'dist/manifest.json').read_text())
        self.assertEqual(manifest['runs'][0]['files'], run['files'])

    def test_engine_endpoints_are_generated_by_the_real_deployment_step(self):
        a, b, c = (char * 40 for char in 'abc')
        runs = [self.run_record('old', '2026-10-20T00:00:00Z', sha=a),
                self.run_record('new', '2026-10-21T00:00:00Z', sha=c)]
        self.package(runs, engine_lineage={'schema': 1, 'parents': {a: [], b: [a], c: [b]}})
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        exact = json.loads((self.root / 'dist/engines' / (c + '.json')).read_text())
        fallback = json.loads((self.root / 'dist/engines' / (b + '.json')).read_text())
        self.assertEqual(exact['resolution']['match'], 'exact')
        self.assertEqual(fallback['resolution']['measured_sha'], c)
        self.assertEqual(fallback['resolution']['match'], 'first_tested_descendant')
        self.assertEqual(len(fallback['rows']), 1)

    def test_wrong_report_hash_is_rejected_before_deployment(self):
        run = self.pinned_run(); run['files']['details']['sha256'] = '0' * 64
        self.package([run]); result = self.prepare_site()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Report version hash differs', result.stderr)

    def test_correct_hash_does_not_allow_inconsistent_advertised_progress(self):
        run = self.pinned_run()
        run['fixed']['finished'] = 0
        self.package([run])
        raw = self.reports['pinned']
        run['files']['details'].update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
        self.package([run]); result = self.prepare_site()
        self.assertNotEqual(result.returncode, 0)

    def test_full_reports_select_newest_run_and_completed_run_independently(self):
        runs = [self.run_record("previous", "2026-10-19T11:00:00+00:00"),
                self.run_record("pilot", "2026-10-19T15:00:00+00:00", pilot=True),
                self.run_record("completed", "2026-10-19T12:00:00+00:00"),
                self.run_record("continued", "2026-10-19T16:00:00+00:00", "continued"),
                self.run_record("active", "2026-10-19T13:00:00+00:00", "running")]
        self.package(runs)
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "dist/latest.json").read_bytes(), self.reports["active"])
        self.assertEqual((self.root / "dist/latest-completed.json").read_bytes(), self.reports["completed"])
        self.assertEqual((self.root / "dist/latest-running.json").read_bytes(), self.reports["active"])
        stopping = json.loads((self.root / "dist/latest-stopping-simulation.json").read_bytes())
        self.assertEqual(stopping["run"]["id"], "active")
        self.assertEqual(len(list((self.root / "dist/data").glob("*.json"))), len(runs))

    def test_both_aliases_follow_latest_run_once_it_completes(self):
        self.package([self.run_record("older", "2026-10-19T12:00:00+00:00"),
                      self.run_record("newest", "2026-10-19T13:00:00+00:00")])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ("latest.json", "latest-completed.json"):
            self.assertEqual((self.root / "dist" / name).read_bytes(), self.reports["newest"])
        self.assertFalse((self.root / "dist/latest-running.json").exists())
        self.assertFalse((self.root / "dist/latest-running-stopping-simulation.json").exists())
        self.assertFalse((self.root / "dist/latest-running-stopping-simulation").exists())
        self.assertFalse((self.root / "dist/latest-running-simulated.json").exists())

    def test_latest_failure_stays_visible_without_replacing_completed_report(self):
        self.package([self.run_record("good", "2026-10-19T12:00:00+00:00"),
                      self.run_record("failed", "2026-10-19T13:00:00+00:00", "build_failed")])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / "dist/latest.json").read_bytes())["run"]["status"], "build_failed")
        self.assertEqual((self.root / "dist/latest-completed.json").read_bytes(), self.reports["good"])

    def test_no_completed_alias_before_a_run_finishes(self):
        self.package([self.run_record("active", "2026-10-19T13:00:00+00:00", "running")])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / "dist/latest.json").exists())
        self.assertFalse((self.root / "dist/latest-completed.json").exists())
        self.assertFalse((self.root / "dist/latest-completed-stopping-simulation.json").exists())
        self.assertFalse((self.root / "dist/latest-completed-simulated.json").exists())

    def test_manifest_order_and_timezone_do_not_determine_latest_run(self):
        self.package([self.run_record("earlier", "2026-10-19T13:00:00+02:00"),
                      self.run_record("later", "2026-10-19T12:00:00+00:00")])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "dist/latest.json").read_bytes(), self.reports["later"])

    def test_mismatched_report_is_rejected(self):
        self.package([self.run_record("newest", "2026-10-19T13:00:00+00:00")], corrupt_id="newest")
        result = self.prepare_site()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "dist/latest.json").exists())

    def changes(self, run):
        return json.dumps({'schema': 1, 'available': True, 'run': {'id': run['id'], 'sha': run['sha']},
                           'fixed': {'total_recordings': run['fixed']['total']},
                           'growing': {'total_recordings': run['growing']['total']}, 'rows': []}).encode()

    def test_replay_change_aliases_follow_the_exact_run_including_active_results(self):
        done = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        active = self.run_record('active', '2026-10-19T13:00:00+00:00', 'running')
        done_raw, active_raw = self.changes(done), self.changes(active)
        self.package([done, active], extra_files={'changes/completed.json': done_raw, 'changes/active.json': active_raw})
        result = self.prepare_site(); self.assertEqual(result.returncode, 0, result.stderr)
        for name, expected in [('latest', active_raw), ('latest-running', active_raw), ('latest-completed', done_raw)]:
            for suffix in ('.json', ''):
                self.assertEqual((self.root / 'dist' / (name + '-changes' + suffix)).read_bytes(), expected)

    def test_change_alias_rejects_wrong_recording_corpus(self):
        run = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        value = json.loads(self.changes(run)); value['growing']['total_recordings'] = 99
        self.package([run], extra_files={'changes/completed.json': json.dumps(value).encode()})
        self.assertNotEqual(self.prepare_site().returncode, 0)

    def test_absent_running_comparison_does_not_fall_back_to_completed(self):
        done = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        active = self.run_record('active', '2026-10-19T13:00:00+00:00', 'running')
        self.package([done, active], extra_files={'changes/completed.json': self.changes(done)})
        result = self.prepare_site(); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / 'dist/latest-running-changes.json').exists())
        self.assertFalse((self.root / 'dist/latest-changes.json').exists())

    def coverage(self, run):
        return json.dumps({'schema': 1, 'run': {'id': run['id'], 'sha': run['sha']},
                           'fixed': {'total_recordings': run['fixed']['total']},
                           'growing': {'total_recordings': run['growing']['total']}}).encode()

    def test_command_aliases_select_the_exact_corresponding_run(self):
        done = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        active = self.run_record('active', '2026-10-19T13:00:00+00:00', 'running')
        complete_raw, active_raw = self.coverage(done), self.coverage(active)
        self.package([done, active], extra_files={'coverage/completed.json': complete_raw,
                                               'coverage/active.json': active_raw})
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        for prefix, expected in [('latest', active_raw), ('latest-running', active_raw), ('latest-completed', complete_raw)]:
            for suffix in ('.json', ''):
                self.assertEqual((self.root / 'dist' / (prefix + '-command-coverage' + suffix)).read_bytes(), expected)

    def test_missing_running_census_does_not_fall_back_to_completed(self):
        done = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        active = self.run_record('active', '2026-10-19T13:00:00+00:00', 'running')
        self.package([done, active], extra_files={'coverage/completed.json': self.coverage(done)})
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'dist/latest-completed-command-coverage.json').is_file())
        self.assertFalse((self.root / 'dist/latest-command-coverage.json').exists())
        self.assertFalse((self.root / 'dist/latest-running-command-coverage.json').exists())

    def test_command_alias_rejects_wrong_engine_and_corpus_membership(self):
        run = self.run_record('completed', '2026-10-19T12:00:00+00:00')
        for change in ('sha', 'total'):
            with self.subTest(change=change):
                value = json.loads(self.coverage(run))
                if change == 'sha': value['run']['sha'] = 'other-commit'
                else: value['fixed']['total_recordings'] = 42
                self.package([run], extra_files={'coverage/completed.json': json.dumps(value).encode()})
                result = self.prepare_site()
                self.assertNotEqual(result.returncode, 0)
                import shutil
                shutil.rmtree(self.root / 'dist', ignore_errors=True)

    def test_frozen_cohorts_are_preserved_in_stopping_and_simulated_aliases(self):
        rows = [
            {'match_id': 'core', 'sha256': 'a' * 64, 'fixed': False, 'cohorts': ['core500', 'combined1000'],
             'status': 'unsupported', 'unsupported': [{'reason': 'Rare engine branch'}]},
            {'match_id': 'extra', 'sha256': 'b' * 64, 'fixed': True, 'cohorts': ['extension500', 'combined1000'],
             'status': 'complete', 'checkpoints_passed': 2}]
        run = self.run_record('cohorts', '2026-10-21T12:00:00Z', fixed={'total': 1}, growing={'total': 2},
                              core500={'total': 1}, extension500={'total': 1}, combined1000={'total': 2})
        self.package([run], rows=rows)
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads((self.root / 'dist/latest-stopping-simulation.json').read_text())
        self.assertEqual(summary['core500']['stopped_recordings'], 1)
        self.assertEqual(summary['extension500']['stopped_recordings'], 0)
        self.assertEqual(summary['combined1000']['measured_recordings'], 2)
        successful = json.loads((self.root / 'dist/latest-simulated.json').read_text())
        self.assertEqual(successful['rows'][0]['cohorts'], ['extension500', 'combined1000'])

    def test_stopping_reasons_rank_unique_recordings_and_preserve_other_failures(self):
        rows = [
            {"match_id": "1", "fixed": True, "status": "unsupported", "unsupported": [
                {"reason": "Missing gather", "freezes": [{"reason": "Missing path"}]},
                {"reason": "Missing gather", "freezes": [{"reason": "Missing path"}]}]},
            {"match_id": "2", "fixed": False, "status": "unsupported", "unsupported": [{"reason": "Missing gather"}]},
            {"match_id": "3", "fixed": True, "status": "checkpoint_mismatch"},
            {"match_id": "4", "fixed": False, "status": "parse_error", "reason": "Invalid recording header"},
            {"match_id": "5", "fixed": True, "status": "complete", "checkpoints_passed": 2},
            {"match_id": "6", "fixed": False, "status": "complete", "checkpoints_passed": 0},
            {"match_id": "7", "fixed": False, "status": "future_stop_type", "reason": "A newly reported condition"},
        ]
        run = self.run_record("active", "2026-10-19T13:00:00+00:00", "running",
                              fixed={"total": 3}, growing={"total": 9})
        self.package([run], rows=rows)
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        raw = (self.root / "dist/latest-stopping-simulation.json").read_bytes()
        summary = json.loads(raw)
        growing = summary["growing"]
        self.assertEqual(summary["source_report"], "data/active.json")
        self.assertEqual((growing["total_recordings"], growing["measured_recordings"],
                          growing["pending_recordings"], growing["stopped_recordings"]), (9, 7, 2, 5))
        self.assertEqual(growing["reasons"][0], {"status": "unsupported", "reason": "Missing gather", "count": 2,
                                               "percent_of_stopped": 40.0, "examples": ["1", "2"]})
        by_reason = {r["reason"]: r for r in growing["reasons"]}
        self.assertEqual(by_reason["Missing path"]["count"], 1)
        self.assertEqual(by_reason["Recorded checkpoint mismatch"]["count"], 1)
        self.assertEqual(by_reason["Invalid recording header"]["status"], "parse_error")
        self.assertEqual(by_reason["A newly reported condition"]["status"], "future_stop_type")
        self.assertEqual(growing["outcomes"]["complete"], 2)
        self.assertEqual(summary["fixed"]["stopped_recordings"], 2)
        self.assertEqual(summary["fixed"]["reasons"][0]["count"], 1)
        for name in ["latest-stopping-simulation", "latest-running-stopping-simulation.json", "latest-running-stopping-simulation"]:
            self.assertEqual((self.root / "dist" / name).read_bytes(), raw)

    def test_checkpoint_reasons_distinguish_checks_and_count_each_recording_once(self):
        rows = [
            {"match_id": "1", "fixed": True, "status": "checkpoint_mismatch", "build": 158041,
             "differences": [{"player": 1, "word": 7}, {"player": 2, "word": 7}, {"player": 2, "word": 9}]},
            {"match_id": "2", "fixed": False, "status": "checkpoint_mismatch", "build": 158041,
             "differences": [{"player": 1, "word": 7}, {"player": 1, "word": 1}]},
            {"match_id": "3", "fixed": True, "status": "checkpoint_mismatch", "build": 158041,
             "differences": [{"player": 1, "word": 42}]},
            {"match_id": "4", "fixed": True, "status": "checkpoint_mismatch", "build": 160062,
             "differences": [{"player": 1, "word": 7}]},
            {"match_id": "5", "fixed": True, "status": "checkpoint_mismatch"},
        ]
        self.package([self.run_record("complete", "2026-10-19T13:00:00+00:00",
                                      fixed={"total": 4}, growing={"total": 5})], rows=rows)
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads((self.root / "dist/latest-completed-stopping-simulation.json").read_bytes())
        by_reason = {r["reason"]: r for r in summary["growing"]["reasons"]}
        positions = by_reason["Checkpoint mismatch: Object positions"]
        self.assertEqual(positions["count"], 2)
        self.assertEqual(positions["examples"], ["1", "2"])
        self.assertEqual(positions["percent_of_stopped"], 40.0)
        self.assertEqual(positions["checkpoint_word"], 7)
        for reason in ("Actions and unit AI", "Combined resources", "Checkpoint word 42", "Checkpoint word 7"):
            self.assertEqual(by_reason["Checkpoint mismatch: " + reason]["count"], 1)
        self.assertEqual(by_reason["Recorded checkpoint mismatch"]["count"], 1)
        self.assertEqual(summary["fixed"]["reasons"][0]["count"], 1)
        self.assertEqual(summary["checkpoint_definitions"], "checkpoint-checks.json")
        self.assertEqual((self.root / "dist/latest-completed.json").read_bytes(), self.reports["complete"])

    def test_running_alias_selects_unfinished_run_even_when_a_newer_failure_exists(self):
        self.package([self.run_record("failed", "2026-10-19T16:00:00+00:00", "build_failed"),
                      self.run_record("complete", "2026-10-19T12:00:00+00:00"),
                      self.run_record("active", "2026-10-19T13:00:00+00:00", "running")])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "dist/latest.json").read_bytes(), self.reports["failed"])
        self.assertEqual((self.root / "dist/latest-running.json").read_bytes(), self.reports["active"])

    def test_preparation_phases_are_unfinished_and_terminal_failures_are_not(self):
        for status in ("queued", "building", "build_failed"):
            with self.subTest(status=status):
                self.package([self.run_record(status, "2026-10-19T13:00:00+00:00", status)])
                result = self.prepare_site()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((self.root / "dist/latest-running.json").exists(), status != "build_failed")
                self.assertEqual((self.root / "dist/latest-running-stopping-simulation.json").exists(), status != "build_failed")
                import shutil
                shutil.rmtree(self.root / "dist")

    def test_simulated_list_uses_latest_completed_run_and_includes_zero_checkpoints(self):
        rows = [
            {"match_id": "1", "sha256": "zero-hash", "fixed": True, "build": 158041,
             "status": "complete", "completed_ticks": 6, "total_ticks": 6,
             "checkpoints_passed": 0, "total_checkpoints": 0,
             "last_matching_checkpoint_tick": 0, "ignored_commands_to_stop": 0},
            {"match_id": "2", "sha256": "checked-hash", "fixed": False, "build": 158041,
             "status": "complete", "completed_ticks": 4899, "total_ticks": 4899,
             "checkpoints_passed": 9, "total_checkpoints": 9,
             "last_matching_checkpoint_tick": 4499, "ignored_commands_to_stop": 3},
            {"match_id": "3", "fixed": False, "status": "unsupported"},
            {"match_id": "4", "fixed": False, "status": "checkpoint_mismatch"},
            {"match_id": "5", "fixed": False, "status": "parse_error"},
        ]
        self.package([self.run_record("older", "2026-10-19T11:00:00+00:00"),
                      self.run_record("completed", "2026-10-19T12:00:00+00:00"),
                      self.run_record("active", "2026-10-19T13:00:00+00:00", "running")], rows=rows)
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        raw = (self.root / "dist/latest-completed-simulated.json").read_bytes()
        simulated = json.loads(raw)
        self.assertEqual(simulated["run"]["id"], "completed")
        self.assertEqual(simulated["run"]["sha"], "commit-completed")
        self.assertEqual(simulated["source_report"], "data/completed.json")
        self.assertEqual((simulated["scope"], simulated["count"]), ("growing", 2))
        self.assertEqual([row["match_id"] for row in simulated["rows"]], ["2", "1"])
        self.assertEqual(simulated["rows"][1], rows[0])
        self.assertEqual(simulated["rows"][0], rows[1])
        self.assertEqual((self.root / "dist/latest-completed-simulated").read_bytes(), raw)
        for prefix in ["latest", "latest-running"]:
            simulated = json.loads((self.root / "dist" / (prefix + "-simulated.json")).read_bytes())
            self.assertEqual(simulated["run"]["id"], "active")

    def test_simulated_list_is_empty_when_no_recording_reached_the_end(self):
        self.package([self.run_record("completed", "2026-10-19T12:00:00+00:00")],
                     rows=[{"match_id": "1", "fixed": True, "status": "unsupported"}])
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        simulated = json.loads((self.root / "dist/latest-completed-simulated.json").read_bytes())
        self.assertEqual((simulated["count"], simulated["rows"]), (0, []))

    def test_retained_history_can_exceed_previous_archive_budget(self):
        # Exercise the real byte-budget logic at 1/1024 scale without large disk fixtures.
        self.prepare = self.prepare.replace("MiB = 1024**2", "MiB = 1024")
        padding = json.dumps({"padding": "x" * (24 * 1024)}).encode()
        self.package([self.run_record("completed", "2026-10-19T12:00:00+00:00")],
                     extra_files={f"data/history-{i}.json": padding for i in range(12)})
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)
        history_bytes = sum(p.stat().st_size for p in (self.root / "dist/data").glob("*.json"))
        self.assertGreater(history_bytes, 250 * 1024)
        self.assertTrue((self.root / "dist/latest-completed-simulated.json").exists())

    def test_excessive_report_history_has_a_clear_failure_message(self):
        self.prepare = self.prepare.replace("MiB = 1024**2", "MiB = 1024")
        padding = json.dumps({"padding": "x" * (24 * 1024)}).encode()
        self.package([self.run_record("completed", "2026-10-19T12:00:00+00:00")],
                     extra_files={f"data/history-{i}.json": padding for i in range(35)})
        result = self.prepare_site()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Retained report JSON exceeds the 800 MiB archive budget", result.stderr)

    def test_full_corpus_report_with_dt_fits_expanded_individual_budget(self):
        self.prepare = self.prepare.replace("MiB = 1024**2", "MiB = 1024")
        padding = json.dumps({"padding": "x" * (28 * 1024)}).encode()
        self.package([self.run_record("completed", "2026-10-19T12:00:00+00:00")],
                     extra_files={"data/full-with-dt.json": padding})
        result = self.prepare_site()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_oversized_individual_report_has_a_clear_failure_message(self):
        self.prepare = self.prepare.replace("MiB = 1024**2", "MiB = 1024")
        padding = json.dumps({"padding": "x" * (34 * 1024)}).encode()
        self.package([self.run_record("completed", "2026-10-19T12:00:00+00:00")],
                     extra_files={"data/oversized.json": padding})
        result = self.prepare_site()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Report data/oversized.json exceeds the 32 MiB file budget", result.stderr)


if __name__ == "__main__":
    unittest.main()
