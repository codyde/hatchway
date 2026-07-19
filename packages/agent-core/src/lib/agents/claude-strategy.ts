import type { AgentStrategy, AgentStrategyContext } from './strategy';
import { MOOD_GUIDANCE } from '../../types/design';
import { resolveTags, generatePromptFromTags } from '../tags/resolver';

function buildClaudeSections(context: AgentStrategyContext): string[] {
  const sections: string[] = [];

  // PRIORITY 1: User-specified tags (must be first so AI sees them immediately)
  // Use tag-based configuration if available, otherwise fall back to designPreferences
  if (context.tags && context.tags.length > 0) {
    const resolved = resolveTags(context.tags);
    const tagPrompt = generatePromptFromTags(resolved, context.projectName, context.isNewProject);
    if (tagPrompt) {
      sections.push(tagPrompt);
    }
  } else if (context.designPreferences) {
    const prefs = context.designPreferences;
    const moodGuidance = prefs.mood
      .map(m => `- ${m}: ${MOOD_GUIDANCE[m] || ''}`)
      .join('\n');

    sections.push(`## Design Constraints (User-Specified)

CRITICAL: The user has specified EXACT design preferences. Follow these specifications precisely:

**Color Palette (MANDATORY - DO NOT DEVIATE):**
- Primary: ${prefs.colors.primary} (use for CTAs, primary buttons, brand elements)
- Secondary: ${prefs.colors.secondary} (use for secondary actions, supporting elements)
- Accent: ${prefs.colors.accent} (use for highlights, badges, important elements)
- Neutral Light: ${prefs.colors.neutralLight} (use for light backgrounds, cards, containers)
- Neutral Dark: ${prefs.colors.neutralDark} (use for text, dark backgrounds, borders)

You MUST use ONLY these colors. Define them as CSS custom properties in your design system:

\`\`\`css
:root {
  --color-primary: ${prefs.colors.primary};
  --color-secondary: ${prefs.colors.secondary};
  --color-accent: ${prefs.colors.accent};
  --color-neutral-light: ${prefs.colors.neutralLight};
  --color-neutral-dark: ${prefs.colors.neutralDark};
}
\`\`\`

**Typography (MANDATORY):**
- Heading Font: ${prefs.typography.heading} (use for all h1, h2, h3, h4, h5, h6)
- Body Font: ${prefs.typography.body} (use for paragraphs, labels, body text, UI elements)

Import these fonts from Google Fonts or use system fonts as specified.

**Style Direction:**
The user wants a design that feels: ${prefs.mood.join(', ')}

Interpret these mood descriptors to guide your design decisions:
${moodGuidance}

**Critical Reminders:**
- Do NOT add any colors outside the specified 5-color palette
- Do NOT use any fonts other than the 2 specified
- Match the mood descriptors in your typography scale, spacing, and component design
- Define colors as CSS variables, never use hex values directly in components`);
  }

  // PRIORITY 2: Project context and workspace rules
  if (context.isNewProject) {
    sections.push(`## New Project: Template Prepared

- Project name: ${context.projectName}
- Location: ${context.workingDirectory}
- Operation type: ${context.operationType}

The template has already been downloaded. Customize the scaffold to satisfy the request; follow the dependency-state instructions below for installation.`);
  } else {
    // EXISTING PROJECT - Include conversation history for context
    let existingProjectSection = `## Existing Project Context

- Project location: ${context.workingDirectory}
- Operation type: ${context.operationType}

Review the current codebase and apply the requested changes without re-scaffolding.`;

    // Add conversation history if available
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      existingProjectSection += `\n\n**Recent Conversation History:**\n`;
      existingProjectSection += `You have access to the recent conversation history. Use this to understand the context and what has been discussed:\n\n`;
      
      context.conversationHistory.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        const timestamp = msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp;
        // Truncate very long messages for readability
        const content = msg.content.length > 500 
          ? msg.content.substring(0, 500) + '...[truncated]'
          : msg.content;
        existingProjectSection += `${index + 1}. ${roleLabel} (${timestamp}):\n${content}\n\n`;
      });
      
      existingProjectSection += `Use this conversation history to understand:
- What has been built or discussed so far
- The user's preferences and requirements
- References to "it", "the app", "the project", etc.
- Any previous decisions or implementations

Apply the current request in the context of this conversation.`;
    }

    sections.push(existingProjectSection);
  }

  sections.push(`## Workspace Rules
- Use relative paths within the project.
- Work inside the existing project structure.
- Provide complete updates without placeholders.`);

  if (context.fileTree) {
    sections.push(`## Project Manifest
${context.fileTree}`);
  }

  if (context.templateName) {
    sections.push(`## Template Details
- Template: ${context.templateName}
- Framework: ${context.templateFramework ?? 'unknown'}`);
  }

  return sections;
}

function buildFullPrompt(context: AgentStrategyContext, basePrompt: string): string {
  if (!context.isNewProject) {
    if (context.operationType === 'autofix') {
      return `${basePrompt}

## Autofix Speed Rules
1. Diagnose from the error first; only open files implicated by the stack/log.
2. Make the smallest fix that restores startup; avoid refactors and design changes.
3. Re-run the failing command once, fix remaining errors, then stop.`;
    }
    return basePrompt;
  }
  return `${basePrompt}

CRITICAL: The template has already been prepared in ${context.workingDirectory}. Do not scaffold a new project.

## Speed Rules
1. First tool call: TodoWrite with ≤6 concrete implementation todos, one in_progress.
2. Implement with Write/Edit next — do not spend early turns only researching.
3. Do not use WebSearch/WebFetch on initial builds unless you are blocked without external docs.
4. One dependency install after package.json changes; ONE build/typecheck; fix blocking errors once; then stop.
5. Ship the minimum coherent app that satisfies the request. Prefer fewer files over exhaustive page sets.
6. Mark todos completed as you finish them. When implementation + one verification pass are done, stop immediately — no polish turns.`;
}

const claudeStrategy: AgentStrategy = {
  buildSystemPromptSections: buildClaudeSections,
  buildFullPrompt,
  shouldDownloadTemplate(context) {
    return context.isNewProject && !context.skipTemplates;
  },
  postTemplateSelected(context, template) {
    context.templateName = template.name;
    context.templateFramework = template.framework;
    context.fileTree = template.fileTree;
  },
};

export default claudeStrategy;
