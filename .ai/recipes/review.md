# Review Recipe

## When to Use

Before merging any sub-Agent branch or completing a non-trivial task.

## Checklist

1. **Scope**: Is the change scoped to the task? No unrelated modifications?
2. **Correctness**: Does it meet the acceptance criteria?
3. **Tests**: Are there tests for new logic? Do existing tests still pass?
4. **Docs alignment**: If behavior changed, are docs updated?
5. **No coupling**: Does the change introduce unnecessary shared-code coupling?
6. **No secrets**: No hardcoded credentials, API keys, or sensitive data?
7. **Error handling**: Are edge cases handled at system boundaries?

## Output

Record review outcome in `dev/review/` with:
- Task ID
- Pass/Fail
- Issues found (if any)
- Action items
