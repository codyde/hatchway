/** Merge a live project update without replacing the surrounding project list. */
export function mergeProjectUpdate<T extends { id: string }>(
  projects: T[],
  project: T,
): T[] {
  const projectIndex = projects.findIndex((candidate) => candidate.id === project.id);
  if (projectIndex === -1) return projects;

  const updatedProjects = [...projects];
  updatedProjects[projectIndex] = { ...updatedProjects[projectIndex], ...project };
  return updatedProjects;
}
