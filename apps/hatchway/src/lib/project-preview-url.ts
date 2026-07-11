export interface PreviewableProject {
  tunnelUrl?: string | null;
  executionMode?: 'local' | 'sandbox' | null;
  devServerPort?: number | null;
  port?: number | null;
}

export function getProjectPreviewUrl(project: PreviewableProject): string | null {
  const tunnelUrl = project.tunnelUrl?.trim();
  if (tunnelUrl) return tunnelUrl;

  if (project.executionMode === 'sandbox') return null;

  const port = project.devServerPort ?? project.port;
  return port ? `http://localhost:${port}` : null;
}
