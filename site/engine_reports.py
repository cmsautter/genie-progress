"""Generate static, version-specific simulation JSON from sanitized reports.

Used by both the local preview and Pages. No engine execution or network access.
"""
from collections import Counter, deque
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import runpy

diagnostics = runpy.run_path(str(Path(__file__).with_name('engine_diagnostics.py')))


SHA = re.compile(r'[0-9a-f]{40}')
SCOPES = ('fixed', 'growing', 'core500', 'extension500', 'combined1000')


def resolve(manifest):
    """Exact completed run, otherwise nearest tested descendant by parent edges."""
    by_sha = {}
    completed = [run for run in manifest['runs'] if run['status'] == 'complete'
                 and not run.get('pilot') and SHA.fullmatch(run['sha'])]
    for run in sorted(completed, key=lambda r: (r.get('build_profile') == 'release',
                                               dt.datetime.fromisoformat(r['created']), r['id'])):
        by_sha[run['sha']] = run
    parents = manifest.get('engine_lineage', {}).get('parents', {})
    assert all(SHA.fullmatch(sha) and isinstance(values, list)
               and all(SHA.fullmatch(p) for p in values) for sha, values in parents.items())
    # Restrict fallback to history at/after a retained measured ancestor. Older
    # commits outside that coverage window must not silently use a modern build.
    children = {}
    for sha, values in parents.items():
        for parent in values:
            children.setdefault(parent, []).append(sha)
    covered = set(by_sha)
    queue = deque(by_sha)
    while queue:
        for child in children.get(queue.popleft(), []):
            if child not in covered:
                covered.add(child)
                queue.append(child)
    choices = {}
    for sha, run in by_sha.items():
        queue = deque([(sha, 0)])
        seen = {sha}
        while queue:
            requested, distance = queue.popleft()
            # Restored large historical reports offer exact-version APIs. Do
            # not multiply each 13k payload across long archival commit chains.
            # Ordinary retained measurements keep their descendant resolution.
            if distance and run.get('historical_full_corpus'):
                continue
            if requested in covered:
                rank = (distance, dt.datetime.fromisoformat(run['created']), sha)
                if requested not in choices or rank < choices[requested][0]:
                    choices[requested] = (rank, run)
            for parent in parents.get(requested, []):
                if parent not in seen:
                    seen.add(parent)
                    queue.append((parent, distance + 1))
    return {sha: (run, rank[0]) for sha, (rank, run) in choices.items()}


def progress_report(report):
    groups, row_reasons = {}, []
    for row in report['rows']:
        reasons = set()
        if row['status'] != 'complete':
            reasons = {(item.get('engine_error', {}).get('kind'), str(item['reason']))
                       for item in diagnostics['conditions'](row) if item.get('reason')}
            if row['status'] == 'checkpoint_mismatch':
                reasons.update((None, 'Checkpoint mismatch: word ' + str(d['word']))
                               for d in row.get('differences', []))
            if not reasons:
                reasons.add((None, str(row.get('reason') or row.get('error') or row['status'])))
        identifiers = []
        for kind, reason in sorted(reasons, key=lambda item: (item[0] or '', item[1])):
            key = (row['status'], kind, reason)
            if key not in groups:
                groups[key] = {'id': len(groups), 'status': key[0], 'reason': reason,
                               **({'engine_kind': kind} if kind else {}),
                               'count': 0, 'examples': []}
            entry = groups[key]
            entry['count'] += 1
            if len(entry['examples']) < 5:
                entry['examples'].append(row['match_id'])
            identifiers.append(entry['id'])
        row_reasons.append(identifiers)
    fields = ('match_id', 'sha256', 'status', 'completed_ticks', 'attempted_ticks',
              'total_ticks', 'progress_percent', 'checkpoints_passed', 'total_checkpoints',
              'last_matching_checkpoint_tick', 'first_failure_tick', 'cohorts', 'fixed')
    return {
        'run': {key: report['run'].get(key) for key in
                ('id', 'sha', 'status', 'created', 'finished', 'build_profile', 'architecture')},
        'game_build': report['identity'].get('game_build'),
        'progress': {scope: report['run'][scope] for scope in SCOPES if scope in report['run']},
        'abort_reasons': sorted(groups.values(), key=lambda g: (-g['count'], g['id'])),
        'definitions': {
            'abort_reason_ids': 'Row IDs refer to abort_reasons[].id; counts are distinct recordings per condition and can overlap.',
            'completed_ticks': 'Engine steps reached before the first stopping condition; checkpoint counts are separate correctness evidence.',
        },
        'rows': [{**{key: row[key] for key in fields if key in row}, 'abort_reason_ids': reasons,
                  **({'engine_error_kinds': sorted({e['kind'] for e in diagnostics['structured'](row)})}
                     if diagnostics['structured'](row) else {})}
                 for row, reasons in zip(report['rows'], row_reasons)],
    }


def build(directory):
    root = Path(directory)
    manifest = json.loads((root / 'manifest.json').read_text())
    choices = resolve(manifest)
    destination = root / 'engines'
    destination.mkdir(exist_ok=True)
    fingerprint = hashlib.sha256(json.dumps([
        [(sha, run['id'], distance, run.get('files', {}).get('details'))
         for sha, (run, distance) in sorted(choices.items())],
        hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        hashlib.sha256(Path(__file__).with_name('engine_diagnostics.py').read_bytes()).hexdigest(),
    ], sort_keys=True).encode()).hexdigest()
    index_path = destination / 'index.json'
    if index_path.exists():
        previous = json.loads(index_path.read_text())
        if previous.get('fingerprint') == fingerprint and all((destination / (sha + '.json')).is_file() for sha in choices):
            return previous
    reports, entries = {}, {}
    for requested, (run, distance) in sorted(choices.items()):
        assert re.fullmatch(r'[A-Za-z0-9_-]+', run['id'])
        source = 'data/' + run['id'] + '.json'
        if run['id'] not in reports:
            raw = (root / source).read_bytes()
            descriptor = run.get('files', {}).get('details')
            if descriptor:
                assert descriptor['sha256'] == hashlib.sha256(raw).hexdigest()
                assert descriptor['bytes'] == len(raw) and descriptor['url'] == source
            report = json.loads(raw)
            assert report['run']['id'] == run['id'] and report['run']['sha'] == run['sha']
            assert report['run']['status'] == 'complete' and report['identity']['engine_sha'] == run['sha']
            reports[run['id']] = progress_report(report)
        resolution = {'requested_sha': requested, 'measured_sha': run['sha'],
                      'match': 'exact' if distance == 0 else 'first_tested_descendant',
                      'commits_ahead': distance, 'source_report': source}
        payload = {'schema': 1, 'resolution': resolution, **reports[run['id']]}
        target = destination / (requested + '.json')
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
        temporary.replace(target)
        entries[requested] = {**resolution, 'url': 'engines/' + target.name}
    for stale in destination.glob('*.json'):
        if stale.name != 'index.json' and stale.stem not in choices:
            stale.unlink()
    index = {'schema': 1, 'fingerprint': fingerprint,
             'selection': 'Completed retained runs only. Exact revision first; otherwise the tested descendant with the fewest Git parent edges, ties by earliest run creation. Restored historical full-corpus runs provide exact-version endpoints only. No sibling-branch or older-build fallback.',
             'coverage': 'Known commits at or after a retained measured ancestor; unknown, newer and out-of-window revisions have no endpoint.',
             'versions': entries}
    temporary = index_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(index_path)
    return index


if __name__ == '__main__':
    import sys
    index = build(sys.argv[1])
    print('Versioned engine reports:', len(index['versions']))
