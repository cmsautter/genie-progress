"""Additive interpretation of legacy and structured engine diagnostics."""
from collections import Counter


def conditions(row):
    result = []
    for item in row.get('unsupported') or []:
        result.extend([item, *(item.get('freezes') or [])])
    if row.get('engine_error'):
        result.append(row)
    return result


def structured(row):
    return [item['engine_error'] for item in conditions(row)
            if isinstance(item.get('engine_error'), dict) and item['engine_error'].get('schema') == 2]


def summary(rows):
    kinds, phases = Counter(), Counter()
    enriched = legacy = 0
    for row in rows:
        errors = structured(row)
        if errors:
            enriched += 1
            kinds.update({error['kind'] for error in errors})
            phases.update({error['phase'] for error in errors})
        elif row['status'] not in ('complete', 'empty'):
            legacy += 1
    return {'schema': 2, 'structured_recordings': enriched, 'legacy_or_non_engine_stops': legacy,
            'kinds': dict(sorted(kinds.items())), 'phases': dict(sorted(phases.items()))}
