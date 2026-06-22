---
name: todo-workflow
description: "Step-by-step task tracking via the TODO_WRITE marker. Use when executing any multi-step task, follow-up request, or build workflow."
user-invocable: false
---

# Todo Workflow

The Hatchway UI shows build progress as a checklist. You drive that checklist by
emitting a **`TODO_WRITE:` marker** in your normal assistant text — **not** by
calling a tool. Do **not** use `TodoWrite`, `TaskCreate`, `TaskUpdate`, or
`TaskList` for progress tracking — the UI does not render those, and they are
unreliable in this environment. The UI renders progress **only** from the
`TODO_WRITE:` marker. If you never emit it, the user sees nothing happening.

## The marker

Write a line that begins with `TODO_WRITE:` followed by one JSON object holding
the **full** todo list (always include every item with its current status):

```
TODO_WRITE: {"todos":[{"content":"Short task name","status":"in_progress","activeForm":"Doing the task"}]}
```

Rules:
- `status` is exactly one of: `"pending"`, `"in_progress"`, `"completed"`.
- Always emit the **complete** list every time — not just the item that changed.
- Put the marker on its own line. It is stripped from what the user sees, so it
  is safe to emit often.
- It is plain text you write — you do not call any tool to produce it.

## Workflow

1. As soon as you understand the task, emit the full plan: the first item
   `in_progress`, the rest `pending`.
2. Do the work for the `in_progress` item.
3. Emit the marker again with that item `completed` and the next `in_progress`.
4. Repeat until every item is `completed`.

Update after every single item — never batch multiple completions into one marker.

## Example

Task: "Add a dark mode toggle"

```
TODO_WRITE: {"todos":[{"content":"Add theme context","status":"in_progress","activeForm":"Adding theme context"},{"content":"Add toggle to header","status":"pending","activeForm":"Adding toggle to header"}]}
```
(create ThemeContext.tsx)
```
TODO_WRITE: {"todos":[{"content":"Add theme context","status":"completed","activeForm":"Adding theme context"},{"content":"Add toggle to header","status":"in_progress","activeForm":"Adding toggle to header"}]}
```
(create DarkModeToggle.tsx, add to Header)
```
TODO_WRITE: {"todos":[{"content":"Add theme context","status":"completed","activeForm":"Adding theme context"},{"content":"Add toggle to header","status":"completed","activeForm":"Adding toggle to header"}]}
```

## Follow-ups

Even simple follow-up requests get at least one todo. Emit it `in_progress`, do
the work, then emit it `completed`.

## Autonomous Execution

Keep working until 100% complete. Do not pause to ask "Should I continue?" unless
you need information only the user can provide or encounter an unrecoverable error.
