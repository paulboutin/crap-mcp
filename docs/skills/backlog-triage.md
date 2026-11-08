# Backlog triage

Use this skill when you need to choose what to work on. It ranks existing findings using complexity, nesting, measured coverage and change risk. You can ask the agent to prioritize frequently changed files or configured critical paths.

```text
Use $crap-backlog-triage to pick one maintenance task. Show the function,
the evidence that put it on the list, and how we will know the fix worked.
```

The agent checks the suite and scope, inspects the candidate, and identifies the finding and starting snapshot. A function with missing coverage can merit an evidence-gathering task. An uncovered line tells you where to look, while the branch behavior tells you what to assert.

The output is a proposed task with a location, reason and completion check. Carry its finding ID and snapshot into [development review](development-review.md) when you start the patch.
