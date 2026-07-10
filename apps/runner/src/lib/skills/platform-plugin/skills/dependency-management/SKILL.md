---
name: dependency-management
description: "Batch project dependency changes and install once. Use when starting a new feature, scaffolding a project, or when any npm/pnpm package installation is needed."
user-invocable: false
---

# Dependency Management

Identify every package the feature needs, finish code and manifest edits, then install once before verification.

## Workflow

1. Read the requirements and identify ALL needed packages
2. Add them all to package.json in one edit
3. Implement the feature and finish all dependency-manifest edits
4. Run install once (`pnpm install --prefer-offline` or `npm install --prefer-offline --no-audit --no-fund`)
5. Verify the build

## Example

Task: "Add a chart dashboard with date filtering"

Identify upfront: recharts, date-fns, @types/recharts

```json
// One package.json edit with all three
"dependencies": {
  "recharts": "^2.12.0",
  "date-fns": "^3.6.0"
},
"devDependencies": {
  "@types/recharts": "^2.0.0"
}
```

After implementation, run one `npm install --prefer-offline --no-audit --no-fund`, then verify.

## Avoid

- Writing code, discovering a missing import, installing, repeat
- Running multiple install commands throughout the build
- Installing packages one at a time as you discover them
