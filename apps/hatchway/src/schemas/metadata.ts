/**
 * Re-export schemas from shared package
 * These schemas are now managed in @hatchway/agent-core for use by both frontend and runner
 */
export {
  ProjectMetadataSchema,
  ProjectNamingSchema,
  TemplateAnalysisSchema,
  AVAILABLE_ICONS,
  type ProjectMetadata,
  type ProjectNaming,
  type TemplateAnalysis,
  type ProjectIcon,
} from '@hatchway/agent-core';
