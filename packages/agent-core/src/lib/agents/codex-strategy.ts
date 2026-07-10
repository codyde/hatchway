import { buildCodexTemplateCatalogSection } from './codex/template-catalog';
import type { AgentStrategy, AgentStrategyContext } from './strategy';
import { processCodexEvent } from './codex/events';
import type { CodexSessionState } from '@/types/generation';
import { loadTemplateSelectionContext } from '../templates/load-template-context';
import { resolveTags, generatePromptFromTags } from '../tags/resolver';

function getParentDirectory(filePath: string): string {
  if (!filePath) return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  const trimmed = normalized.replace(/\/+$|\/+$|\/*$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return trimmed.slice(0, lastSlash);
}

function buildCodexSections(context: AgentStrategyContext): string[] {
  const sections: string[] = [];

  // PRIORITY 1: User-specified tags (must be first so AI sees them immediately)
  if (context.tags && context.tags.length > 0) {
    const resolved = resolveTags(context.tags);
    const tagPrompt = generatePromptFromTags(resolved, context.projectName, context.isNewProject);
    if (tagPrompt) {
      sections.push(tagPrompt);
    }
  }

  // PRIORITY 2: Project context and setup instructions
  if (context.isNewProject) {
    // NEW: Check if template was pre-selected by frontend
    if (context.templateMetadata) {
      sections.push(`## Template Already Selected

- Template: ${context.templateName ?? 'Selected template'}
- Repository: ${context.templateMetadata.repository}#${context.templateMetadata.branch}
- The template has been chosen based on your analysis of the user's request
- Clone command: npx degit ${context.templateMetadata.repository}#${context.templateMetadata.branch} ${context.projectName}
- CRITICAL: After cloning, prefix EVERY bash command with "cd ${context.projectName} &&"
- Follow the setup instructions exactly before implementing the request`);
    } else {
      sections.push(`## Template Selection and Setup

- Codex selects the appropriate template using the provided catalog
- After cloning, prefix EVERY bash command with "cd ${context.projectName} &&"
- Remember: bash commands run in fresh shells - cd does not persist
- Follow the setup instructions exactly before implementing the request`);
    }
  } else {
    // EXISTING PROJECT - Include conversation history for context
    let existingProjectSection = `## Existing Project Context

- Project location: ${context.workingDirectory}
- Modify the existing codebase to satisfy the request.`;

    // Add conversation history if available
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      existingProjectSection += `\n\n**Recent Conversation History:**\n`;
      existingProjectSection += `You have access to recent conversation history. Use this to understand context:\n\n`;
      
      context.conversationHistory.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        const timestamp = msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp;
        // Truncate very long messages for readability
        const content = msg.content.length > 500 
          ? msg.content.substring(0, 500) + '...[truncated]'
          : msg.content;
        existingProjectSection += `${index + 1}. ${roleLabel} (${timestamp}):\n${content}\n\n`;
      });
      
      existingProjectSection += `Use this history to understand:
- What has been built or discussed
- User preferences and requirements
- References to "it", "the app", "the project"
- Previous decisions or implementations

Apply the current request in context of this conversation.`;
    }

    sections.push(existingProjectSection);
  }

  sections.push(`## Workspace Rules
- ${context.isNewProject ? `After cloning, prefix ALL bash commands with "cd ${context.projectName} &&"` : 'Operate inside the workspace directory'}
- Each bash command runs in a fresh shell - cd does not persist between commands
- ${context.isNewProject ? `Example: bash -lc 'cd ${context.projectName} && npm install --prefer-offline --no-audit --no-fund'` : 'Use relative paths for file operations'}
- Provide complete file contents for every modification`);

  sections.push(`## Task Tracking - Internal System (NOT A TOOL)

IMPORTANT: Task tracking is done by including JSON in your text responses.
This is NOT a tool to call, NOT a command to run, NOT something to install.

Simply include a JSON code block in your response like this:

\`\`\`json
{"todos":[
  {"content":"Clone template","status":"completed","activeForm":"Cloned template"},
  {"content":"Implement features","status":"in_progress","activeForm":"Implementing features"},
  {"content":"Install dependencies once","status":"pending","activeForm":"Installing dependencies"}
]}
\`\`\`

The system automatically extracts this from your response text.
DO NOT try to call it as a tool, run it as a command, or install it as a binary.
Just include the JSON code block in your message.`);

  // NEW: Only include template catalog if template wasn't pre-selected
  if (context.templateSelectionContext && !context.templateMetadata) {
    sections.push(buildCodexTemplateCatalogSection(context.templateSelectionContext));
  }

  return sections;
}

function buildFullPrompt(context: AgentStrategyContext, basePrompt: string): string {
  if (!context.isNewProject) {
    return basePrompt;
  }

  // NEW: If template was pre-selected by frontend, provide specific clone command
  if (context.templateMetadata) {
    const { repository, branch } = context.templateMetadata;
    return `USER REQUEST: ${basePrompt}

WORKFLOW INSTRUCTIONS:

You will complete this request in ONE continuous session by following these exact steps:

STEP 1: CREATE TASK BREAKDOWN
First, analyze the request and determine what specific tasks need to be done.

Create AS MANY TASKS AS NEEDED to properly build the MVP. This could be:
- Simple request: 3-4 tasks
- Medium request: 5-8 tasks
- Complex request: 10-15+ tasks

Think through ALL the work required.

Then include a JSON code block in your response:
\`\`\`json
{"todos":[
  {"content":"Clone and configure template","status":"in_progress","activeForm":"Cloning and configuring template"},
  {"content":"Implement features","status":"pending","activeForm":"Implementing features"},
  {"content":"Install dependencies once","status":"pending","activeForm":"Installing dependencies"},
  ...as many as needed...
  {"content":"Verify build","status":"pending","activeForm":"Verifying build"}
]}
\`\`\`

The system will automatically extract this. Do NOT try to call it as a tool or command.

STEP 2: CLONE AND CONFIGURE
   bash -lc 'npx degit ${repository}#${branch} ${context.projectName}'
   bash -lc 'ls ${context.projectName}'
   bash -lc 'cd ${context.projectName} && cat > .npmrc << EOF
save-exact=true
legacy-peer-deps=false
engine-strict=true
EOF'
   bash -lc 'cd ${context.projectName} && npm pkg set name="${context.projectName}"'

After setup, include updated JSON code block (mark setup as "completed")

STEP 3: IMPLEMENT ALL FEATURES AND DEPENDENCY CHANGES
   - Modify template files to deliver the requested functionality
   - Use: bash -lc 'cd ${context.projectName} && cat > filepath << EOF\n...\nEOF'
   - Implement EVERY requested feature completely
   - Finish all package.json dependency changes before installing
   - After each major feature, include updated JSON code block

STEP 4: INSTALL DEPENDENCIES ONCE
   bash -lc 'cd ${context.projectName} && npm install --prefer-offline --no-audit --no-fund'

After installing, include updated JSON code block

STEP 5: VERIFY BUILD
   bash -lc 'cd ${context.projectName} && npm run build'

After successful build, include final JSON code block with all tasks "completed"

CRITICAL: You MUST complete ALL 5 steps in this single session.
Each bash command runs in a fresh shell - prefix with "cd ${context.projectName} &&"
Only respond "Implementation complete" after ALL steps are verified.`;
  }

  // Fallback: Template not pre-selected - need to choose from catalog
  return `USER REQUEST: ${basePrompt}

WORKFLOW INSTRUCTIONS:

You will complete this request in ONE continuous session by following these exact steps:

STEP 1: CREATE TASK BREAKDOWN
First, analyze the request and determine what tasks are needed.

Create AS MANY TASKS AS NEEDED to properly build the MVP. This could be:
- Simple request: 3-4 tasks
- Medium request: 5-8 tasks
- Complex request: 10-15+ tasks

Think through ALL the work required.

Then include a JSON code block in your response:
\`\`\`json
{"todos":[
  {"content":"Select and clone template","status":"in_progress","activeForm":"Selecting and cloning template"},
  ...as many tasks as needed...
  {"content":"Install dependencies once","status":"pending","activeForm":"Installing dependencies"},
  {"content":"Verify build","status":"pending","activeForm":"Verifying build"}
]}
\`\`\`

The system automatically extracts this. Do NOT try to call it as a tool or command.

STEP 2: CLONE AND CONFIGURE
   Choose appropriate template from available options
   bash -lc 'npx degit <repository>#<branch> ${context.projectName}'
   bash -lc 'ls ${context.projectName}'
   bash -lc 'cd ${context.projectName} && cat > .npmrc << EOF\nsave-exact=true\nEOF'
   bash -lc 'cd ${context.projectName} && npm pkg set name="${context.projectName}"'

After setup, include updated JSON code block (mark setup as "completed")

STEP 3: IMPLEMENT ALL FEATURES AND DEPENDENCY CHANGES
   - Modify template files to deliver requested functionality
   - ALL commands: bash -lc 'cd ${context.projectName} && ...'
   - Implement EVERY requested feature completely
   - Finish all package.json dependency changes before installing
   - After each major feature, include updated JSON code block

STEP 4: INSTALL DEPENDENCIES ONCE
   bash -lc 'cd ${context.projectName} && npm install --prefer-offline --no-audit --no-fund'

After installing, include updated JSON code block

STEP 5: VERIFY BUILD
   bash -lc 'cd ${context.projectName} && npm run build'

After successful build, include final JSON code block with all tasks "completed"

CRITICAL: Complete ALL 5 steps in this single session.
Each bash command runs in a fresh shell - prefix with "cd ${context.projectName} &&"
Only respond "Implementation complete" after ALL steps are verified.`;
}

const codexStrategy: AgentStrategy = {
  buildSystemPromptSections: buildCodexSections,
  buildFullPrompt,
  shouldDownloadTemplate() {
    return false;
  },
  resolveWorkingDirectory(context) {
    if (!context.isNewProject) {
      return context.workingDirectory;
    }
    return getParentDirectory(context.workingDirectory);
  },
  async getTemplateSelectionContext(context) {
    return loadTemplateSelectionContext(context);
  },
  processRunnerEvent<State>(state: State, event) {
    if (!state || typeof state !== 'object') {
      return state;
    }

    const codexLike = state as unknown as CodexSessionState;
    if (!Array.isArray(codexLike?.phases)) {
      return state;
    }

    const next = processCodexEvent(codexLike, event);
    return next as unknown as State;
  },
};

export default codexStrategy;
