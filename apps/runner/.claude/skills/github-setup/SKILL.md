---
name: github-setup
description: |
  Push project code to an existing GitHub repository.
  Use this skill when the user wants to:
  - Push their project code to GitHub (after repository was created via API)
  - Sync changes to an existing GitHub repository
  
  Note: Repository creation is now handled via the Hatchway API, not this skill.
  This skill focuses only on git operations (init, commit, push).
---

# GitHub Push Skill

You are helping push code to an existing GitHub repository for a Hatchway project. The repository has already been created via the Hatchway API - your job is to initialize git, commit the code, and push it.

## MANDATORY: You MUST Output GITHUB_RESULT

**YOUR RESPONSE IS NOT COMPLETE WITHOUT THIS LINE.**

After completing the GitHub push, your FINAL message MUST include this exact line (with real values):

```
GITHUB_RESULT:{"success":true,"repo":"owner/repo-name","url":"https://github.com/owner/repo-name","branch":"main","action":"push"}
```

This line:
- Must be on its own line
- Must start with `GITHUB_RESULT:` (no spaces before)
- Must contain valid JSON with actual repo info
- Must appear in your final response text

**If you don't output this line, the UI will not update properly.**

### Result Schema

```typescript
{
  success: boolean;        // Whether the operation succeeded
  repo?: string;           // Repository in "owner/repo" format
  url?: string;            // Full GitHub URL
  branch?: string;         // Default branch name (usually "main")
  action: "setup" | "push" | "sync" | "error";  // What action was performed
  error?: string;          // Error message if success is false
  commitSha?: string;      // For push operations
}
```

## Initial Push Flow (Repository Already Created)

When the user wants to push code to a newly created repository:

The user's message will contain the repository URL and clone URL. Extract these from the message.

1. **Initialize git if needed:**
   ```bash
   git init
   ```

2. **Update the README.md:**
   Before creating the initial commit, update the project's README.md with relevant information:
   - Project name and brief description
   - Tech stack / framework used
   - Basic setup instructions (npm install, npm run dev, etc.)
   - Any other relevant project details
   
   If README.md doesn't exist, create one. Keep it concise but informative.

3. **Add remote origin:**
   Use the clone URL from the user's message:
   ```bash
   git remote add origin <clone-url>
   ```
   
   If origin already exists, update it:
   ```bash
   git remote set-url origin <clone-url>
   ```

4. **Create initial commit:**
   ```bash
   git add .
   git commit -m "Initial commit from Hatchway"
   ```

5. **Push to GitHub:**
   ```bash
   git push -u origin main
   ```
   
   If the branch is named differently, adjust accordingly:
   ```bash
   git branch -M main  # Rename to main if needed
   git push -u origin main
   ```

6. **Get the commit SHA:**
   ```bash
   git rev-parse --short HEAD
   ```

7. **Return structured result:**
   ```json
   GITHUB_RESULT:{"success":true,"repo":"username/project-name","url":"https://github.com/username/project-name","branch":"main","action":"push","commitSha":"abc1234"}
   ```

## Sync Changes Flow (Subsequent Pushes)

When the user wants to push changes to an existing repository:

1. **Stage and commit changes:**
   ```bash
   git add .
   git commit -m "Update from Hatchway"
   ```

2. **Push to remote:**
   ```bash
   git push origin main
   ```

3. **Get the commit info:**
   ```bash
   git rev-parse --short HEAD
   ```

4. **Return structured result:**
   ```json
   GITHUB_RESULT:{"success":true,"action":"sync","commitSha":"abc1234"}
   ```

## Error Handling

Always return a structured error result:

```json
GITHUB_RESULT:{"success":false,"action":"error","error":"Description of what went wrong"}
```

Common errors to handle:
- **Remote already exists:** Use `git remote set-url origin` instead of `git remote add`
- **Nothing to commit:** This is not an error - return success with a note
- **Push rejected:** May need to pull first or force push (warn user)
- **No internet connection:** Inform them to check their connection
- **Permission denied:** Token may have expired or lack permissions

## Cleanup After Success

After successfully pushing code, delete this skill file to keep the project clean:

```bash
rm -rf .claude/skills/github-setup
```

If the `.claude/skills` directory is now empty, remove it too:

```bash
rmdir .claude/skills 2>/dev/null
rmdir .claude 2>/dev/null
```

## Example Complete Response

After successfully pushing code, your response should look like:

```
I've pushed your project code to GitHub. Here's what I did:

1. Initialized git repository
2. Updated README.md with project info
3. Added remote origin
4. Created initial commit with all project files
5. Pushed to GitHub
6. Cleaned up setup files

Your code is now live at: https://github.com/username/project-name

GITHUB_RESULT:{"success":true,"repo":"username/project-name","url":"https://github.com/username/project-name","branch":"main","action":"push","commitSha":"a1b2c3d"}
```

## REMINDER: Don't Forget GITHUB_RESULT!

Your response MUST end with the `GITHUB_RESULT:{...}` line. Without it, the Hatchway UI cannot update to show the GitHub connection properly.
