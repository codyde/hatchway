import { resolve, relative, isAbsolute } from 'node:path';

/**
 * Permission result type compatible with both native SDK and community provider
 * We define our own type to avoid version conflicts between packages
 */
type PermissionResult = 
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/**
 * Permission handler function type compatible with both implementations
 */
type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; suggestions?: unknown }
) => Promise<PermissionResult>;

/**
 * Creates a permission handler that restricts Claude to a specific project directory
 *
 * This provides defense-in-depth security by:
 * 1. Blocking file operations outside the project directory
 * 2. Preventing directory traversal attacks (../)
 * 3. Blocking dangerous bash commands (rm -rf /, sudo, etc.)
 * 4. Preventing directory changes that escape the project
 *
 * @param projectDirectory Absolute path to the project directory (e.g., /Users/codydearkland/hatchway-workspace/codyscoolnewapp)
 * @returns Permission handler function for use with Claude Agent SDK
 */
export function createProjectScopedPermissionHandler(projectDirectory: string): CanUseToolFn {
  const normalizedProjectDir = resolve(projectDirectory);

  return async (toolName, input, { signal, suggestions }) => {
    // Helper: Check if a path is within the project directory
    const isWithinProject = (filePath: string): boolean => {
      const absPath = resolve(normalizedProjectDir, filePath);
      const relPath = relative(normalizedProjectDir, absPath);

      // Path is within project if:
      // 1. Relative path doesn't start with '..' (not going up)
      // 2. Relative path is not absolute (not escaping to root)
      const isWithin = !relPath.startsWith('..') && !isAbsolute(relPath);

      return isWithin;
    };

    // 1️⃣ FILE OPERATIONS - Restrict to project directory
    if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(toolName)) {
      const filePath = (input.file_path || input.notebook_path) as string | undefined;

      if (!filePath) {
        // No path provided - allow (will use cwd)
        return { behavior: 'allow', updatedInput: input };
      }

      if (!isWithinProject(filePath)) {
        console.warn(`[permissions] DENIED ${toolName} - File outside project boundary: ${filePath}`);
        return {
          behavior: 'deny',
          message: `Access denied: File "${filePath}" is outside the project directory. You can only access files within ${normalizedProjectDir}`,
          interrupt: true,
        };
      }
    }

    // 2️⃣ SEARCH OPERATIONS - Restrict to project directory
    if (['Glob', 'Grep'].includes(toolName)) {
      const searchPath = input.path as string | undefined;

      if (searchPath && !isWithinProject(searchPath)) {
        console.warn(`[permissions] DENIED ${toolName} - Search outside project boundary: ${searchPath}`);
        return {
          behavior: 'deny',
          message: `Search denied: Path "${searchPath}" is outside the project directory. You can only search within ${normalizedProjectDir}`,
          interrupt: true,
        };
      }
    }

    // 3️⃣ BASH COMMANDS - Block dangerous operations
    if (toolName === 'Bash') {
      const command = input.command as string;

      // Block dangerous command patterns
      const dangerousPatterns = [
        { pattern: /rm\s+-rf\s+[\/~]/, message: 'Recursive deletion of root or home directory' },
        { pattern: /sudo/, message: 'Sudo commands' },
        { pattern: /chmod\s+777/, message: 'Insecure permission changes' },
        { pattern: />\s*\/dev\/sd/, message: 'Writing to disk devices' },
        { pattern: /dd\s+if=/, message: 'Direct disk operations' },
        { pattern: /mkfs/, message: 'Filesystem formatting' },
        { pattern: /shutdown|reboot/, message: 'System power commands' },
      ];

      for (const { pattern, message } of dangerousPatterns) {
        if (pattern.test(command)) {
          console.warn(`[permissions] BLOCKED dangerous bash command: ${message} - ${command}`);
          return {
            behavior: 'deny',
            message: `Command blocked for safety: ${message}. Command: "${command}"`,
            interrupt: true,
          };
        }
      }

      // Block cd commands that escape project directory
      const cdMatch = command.match(/cd\s+([^\s;|&]+)/);
      if (cdMatch) {
        const targetPath = cdMatch[1];
        if (!isWithinProject(targetPath)) {
          console.warn(`[permissions] BLOCKED cd outside project: ${targetPath}`);
          return {
            behavior: 'deny',
            message: `Cannot change directory outside project. You are restricted to ${normalizedProjectDir}`,
            interrupt: false, // Let Claude try another approach
          };
        }
      }
    }

    // Default: Allow all other operations
    return { behavior: 'allow', updatedInput: input };
  };
}
