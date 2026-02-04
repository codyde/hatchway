import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { readFile } from "fs/promises";
import { join } from "path";

// Template interfaces
interface Template {
  id: string;
  name: string;
  description: string;
  repository: string;
  branch: string;
  selection: {
    keywords: string[];
    useCases: string[];
    examples: string[];
  };
  tech: {
    framework: string;
    version: string;
    language: string;
    styling: string;
    uiLibrary?: string;
    packageManager: string;
    nodeVersion: string;
  };
  setup: {
    defaultPort: number;
    installCommand: string;
    devCommand: string;
    buildCommand: string;
  };
  ai: {
    systemPromptAddition: string;
    includedFeatures: string[];
  };
}

interface TemplateConfig {
  version: string;
  templates: Template[];
}

// TodoItem interface matching agent-core
interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// Load templates from templates.json
async function loadTemplates(): Promise<Template[]> {
  const templatesPath = join(process.cwd(), "templates.json");
  const content = await readFile(templatesPath, "utf-8");
  const config: TemplateConfig = JSON.parse(content);
  return config.templates;
}

// Select template based on keyword matching
async function selectTemplateFromPrompt(userPrompt: string): Promise<{
  template: Template;
  confidence: number;
  matchedKeywords: string[];
}> {
  const templates = await loadTemplates();
  const prompt = userPrompt.toLowerCase();

  // Score each template based on keyword matches
  const scores = templates.map((template) => {
    const keywords = template.selection.keywords;
    const matches = keywords.filter((keyword) =>
      prompt.includes(keyword.toLowerCase())
    );

    return {
      template,
      score: matches.length,
      matchedKeywords: matches,
    };
  });

  // Sort by score (highest first)
  scores.sort((a, b) => b.score - a.score);

  // Return best match if score > 0, otherwise default to react-vite
  const bestMatch = scores[0].score > 0 ? scores[0] : {
    template: templates.find((t) => t.id === "react-vite") ?? templates[0],
    score: 0,
    matchedKeywords: [],
  };

  return {
    template: bestMatch.template,
    confidence: Math.min(100, bestMatch.score * 20), // Convert score to percentage
    matchedKeywords: bestMatch.matchedKeywords,
  };
}

// Create MCP handler with tools
const handler = createMcpHandler(
  (server) => {
    // Tool 1: template-selection
    server.tool(
      "template-selection",
      "Select the best project template based on an application description. Analyzes keywords and use cases to recommend the most suitable starter template.",
      {
        applicationDescription: z
          .string()
          .min(10)
          .describe("Description of the application to build"),
      },
      async ({ applicationDescription }) => {
        const { template, confidence, matchedKeywords } =
          await selectTemplateFromPrompt(applicationDescription);

        // Generate rationale
        let rationale = `Selected ${template.name} based on `;
        if (matchedKeywords.length > 0) {
          rationale += `keyword matches: ${matchedKeywords.join(", ")}. `;
        } else {
          rationale += `default selection for simple applications. `;
        }
        rationale += `Best for: ${template.selection.useCases[0]}`;

        const result = {
          templateId: template.id,
          templateName: template.name,
          repository: template.repository,
          degitCommand: `npx degit ${template.repository.replace("github:", "")}#${template.branch} my-app`,
          confidence,
          rationale,
          techStack: {
            framework: template.tech.framework,
            version: template.tech.version,
            language: template.tech.language,
            styling: template.tech.styling,
            uiLibrary: template.tech.uiLibrary,
          },
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );

    // Tool 2: todo-list-tool (formatter for new tasks)
    server.tool(
      "todo-list-tool",
      "Format AI-generated task descriptions into structured TodoItem objects. Converts task strings into the proper format with status and activeForm fields.",
      {
        tasks: z
          .array(
            z.union([
              z.string().describe("Task description as a string"),
              z.object({
                content: z.string().describe("Task description"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .optional()
                  .describe("Task status (defaults to pending)"),
              }),
            ])
          )
          .min(1)
          .describe("Array of task descriptions (strings or objects with content/status)"),
      },
      async ({ tasks }) => {
        const todos: TodoItem[] = tasks.map((task, index) => {
          let content: string;
          let status: "pending" | "in_progress" | "completed";

          if (typeof task === "string") {
            content = task;
            status = index === 0 ? "in_progress" : "pending";
          } else {
            content = task.content;
            status = task.status ?? (index === 0 ? "in_progress" : "pending");
          }

          // Generate activeForm (present continuous) from content
          // Remove "Create", "Build", "Add", "Implement" prefixes and convert to -ing form
          let activeForm = content;
          const verbReplacements: Record<string, string> = {
            "Create ": "Creating ",
            "Build ": "Building ",
            "Add ": "Adding ",
            "Implement ": "Implementing ",
            "Set up ": "Setting up ",
            "Install ": "Installing ",
            "Configure ": "Configuring ",
            "Write ": "Writing ",
            "Design ": "Designing ",
            "Develop ": "Developing ",
            "Test ": "Testing ",
            "Deploy ": "Deploying ",
            "Fix ": "Fixing ",
            "Update ": "Updating ",
          };

          for (const [verb, replacement] of Object.entries(verbReplacements)) {
            if (activeForm.startsWith(verb)) {
              activeForm = replacement + activeForm.slice(verb.length);
              break;
            }
          }

          // If no replacement was made, try to add -ing to first word
          if (activeForm === content) {
            const words = content.split(" ");
            if (words.length > 0) {
              const firstWord = words[0].toLowerCase();
              // Simple -ing conversion
              if (!firstWord.endsWith("ing")) {
                words[0] = firstWord.endsWith("e")
                  ? firstWord.slice(0, -1) + "ing"
                  : firstWord + "ing";
                words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
              }
              activeForm = words.join(" ");
            }
          }

          return {
            content,
            status,
            activeForm,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  todos,
                  summary: `Formatted ${todos.length} tasks into TodoItem structure`,
                  counts: {
                    inProgress: todos.filter((t) => t.status === "in_progress").length,
                    pending: todos.filter((t) => t.status === "pending").length,
                    completed: todos.filter((t) => t.status === "completed").length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool 3: todo-update-tool (update status of existing tasks)
    server.tool(
      "todo-update-tool",
      "Update the status of existing TodoItem objects. Pass the complete updated todo list and this tool will validate and normalize it.",
      {
        todos: z
          .array(
            z.object({
              content: z.string().describe("Task description"),
              status: z
                .enum(["pending", "in_progress", "completed"])
                .describe("Updated task status"),
              activeForm: z
                .string()
                .optional()
                .describe("Optional activeForm (will be auto-generated if missing)"),
            })
          )
          .min(1)
          .describe("Complete array of todos with updated statuses"),
      },
      async ({ todos }) => {
        // Validate and normalize each todo
        const normalizedTodos: TodoItem[] = todos.map((todo) => {
          let activeForm = todo.activeForm || "";

          // Auto-generate activeForm if missing or validate/fix if provided
          if (!activeForm || activeForm === todo.content) {
            activeForm = todo.content;
            const verbReplacements: Record<string, string> = {
              "Create ": "Creating ",
              "Build ": "Building ",
              "Add ": "Adding ",
              "Implement ": "Implementing ",
              "Set up ": "Setting up ",
              "Install ": "Installing ",
              "Configure ": "Configuring ",
              "Write ": "Writing ",
              "Design ": "Designing ",
              "Develop ": "Developing ",
              "Test ": "Testing ",
              "Deploy ": "Deploying ",
              "Fix ": "Fixing ",
              "Update ": "Updating ",
            };

            for (const [verb, replacement] of Object.entries(verbReplacements)) {
              if (activeForm.startsWith(verb)) {
                activeForm = replacement + activeForm.slice(verb.length);
                break;
              }
            }

            // Fallback: try to add -ing to first word
            if (activeForm === todo.content) {
              const words = todo.content.split(" ");
              if (words.length > 0) {
                const firstWord = words[0].toLowerCase();
                if (!firstWord.endsWith("ing")) {
                  words[0] = firstWord.endsWith("e")
                    ? firstWord.slice(0, -1) + "ing"
                    : firstWord + "ing";
                  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
                }
                activeForm = words.join(" ");
              }
            }
          }

          return {
            content: todo.content,
            status: todo.status,
            activeForm,
          };
        });

        // Calculate status counts
        const counts = {
          inProgress: normalizedTodos.filter((t) => t.status === "in_progress").length,
          pending: normalizedTodos.filter((t) => t.status === "pending").length,
          completed: normalizedTodos.filter((t) => t.status === "completed").length,
        };

        // Detect changes (compare to what would be a typical pattern)
        const hasMultipleInProgress = counts.inProgress > 1;
        const warnings: string[] = [];

        if (hasMultipleInProgress) {
          warnings.push(
            `Warning: ${counts.inProgress} tasks marked as 'in_progress'. Typically only one task should be in progress at a time.`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  todos: normalizedTodos,
                  summary: `Updated ${normalizedTodos.length} todos`,
                  counts,
                  warnings: warnings.length > 0 ? warnings : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  },
  {},
  {
    basePath: "/api/mcp",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST };

