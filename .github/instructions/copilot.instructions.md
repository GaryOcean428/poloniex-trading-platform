.claude/CLAUDE.md - treat as your instructions

Additional repository guardrails for Copilot cloud-agent runs:

- Do not run `python -m pytest` from the repository root (it can exceed the `copilot` job time budget).
- Run Python tests only from `ml-worker` and scope them to the monkey-kernel suite:
  - `cd ml-worker && python -m pip install -r requirements.txt pytest && python -m pytest tests/monkey_kernel -q`
