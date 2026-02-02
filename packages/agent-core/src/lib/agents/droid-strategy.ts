import type { AgentStrategy, AgentStrategyContext } from './strategy';
import { resolveTags, generatePromptFromTags } from '../tags/resolver';

function buildDroidSections(context: AgentStrategyContext): string[] {
  const sections: string[] = [];

  // Use tag-based configuration if available
  if (context.tags && context.tags.length > 0) {
    const resolved = resolveTags(context.tags);
    const tagPrompt = generatePromptFromTags(resolved, context.projectName, context.isNewProject);
    if (tagPrompt) {
      sections.push(tagPrompt);
    }
  }

  // Project context
  if (context.isNewProject) {
    sections.push(`## New Project Setup

- Project name: ${context.projectName}
- Location: ${context.workingDirectory}
- Operation type: ${context.operationType}

The template has already been downloaded. Install dependencies and customize the scaffold to satisfy the request.`);
  } else {
    let existingProjectSection = `## Existing Project Context

- Project location: ${context.workingDirectory}
- Operation type: ${context.operationType}

Review the current codebase and apply the requested changes without re-scaffolding.`;

    // Add conversation history if available
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      existingProjectSection += `\n\n**Recent Conversation History:**\n`;
      
      context.conversationHistory.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        const content = msg.content.length > 500 
          ? msg.content.substring(0, 500) + '...[truncated]'
          : msg.content;
        existingProjectSection += `${index + 1}. ${roleLabel}:\n${content}\n\n`;
      });
    }

    sections.push(existingProjectSection);
  }

  sections.push(`## Workspace Rules
- Use relative paths within the project.
- Work inside the existing project structure.
- Provide complete file contents without placeholders.`);

  if (context.fileTree) {
    sections.push(`## Project Structure
${context.fileTree}`);
  }

  if (context.templateName) {
    sections.push(`## Template
- Name: ${context.templateName}
- Framework: ${context.templateFramework ?? 'unknown'}`);
  }

  return sections;
}

function buildFullPrompt(context: AgentStrategyContext, basePrompt: string): string {
  if (!context.isNewProject) {
    return basePrompt;
  }
  return `${basePrompt}

CRITICAL: The template has already been prepared in ${context.workingDirectory}. Do not scaffold a new project.`;
}

const droidStrategy: AgentStrategy = {
  buildSystemPromptSections: buildDroidSections,
  buildFullPrompt,
  shouldDownloadTemplate(context) {
    // Factory Droid handles templates the same way as Claude - pre-download
    return context.isNewProject && !context.skipTemplates;
  },
  postTemplateSelected(context, template) {
    context.templateName = template.name;
    context.templateFramework = template.framework;
    context.fileTree = template.fileTree;
  },
};

export default droidStrategy;
