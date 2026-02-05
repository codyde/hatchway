/**
 * Railway OAuth and API types
 */

// OAuth token response from Railway
export interface RailwayTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds
  refresh_token?: string;
  id_token?: string;
  scope: string;
}

// User info from Railway /oauth/me endpoint
export interface RailwayUserInfo {
  sub: string; // User ID
  email?: string;
  name?: string;
  picture?: string;
}

// Workspace from Railway API
export interface RailwayWorkspace {
  id: string;
  name: string;
}

// Project from Railway API
export interface RailwayProject {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

// Service from Railway API
export interface RailwayService {
  id: string;
  name: string;
  icon?: string;
}

// Environment from Railway API
export interface RailwayEnvironment {
  id: string;
  name: string;
}

// Deployment from Railway API
export interface RailwayDeploymentInfo {
  id: string;
  status: RailwayDeploymentStatus;
  url?: string;
  staticUrl?: string;
  createdAt: string;
}

// Railway deployment status values
export type RailwayDeploymentStatus = 
  | 'BUILDING'
  | 'DEPLOYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CRASHED'
  | 'REMOVED'
  | 'SLEEPING'
  | 'SKIPPED'
  | 'WAITING'
  | 'QUEUED';

// Domain from Railway API
export interface RailwayDomain {
  domain: string;
}

// Service domain (Railway-provided *.railway.app)
export interface RailwayServiceDomain {
  id: string;
  domain: string;
  suffix?: string;
  targetPort?: number;
}

// Custom domain with DNS status
export interface RailwayCustomDomain {
  id: string;
  domain: string;
  status?: {
    dnsRecords?: Array<{
      hostlabel: string;
      requiredValue: string;
      currentValue?: string;
      status: 'PENDING' | 'VALID' | 'INVALID';
    }>;
    certificateStatus?: 'PENDING' | 'ISSUED' | 'FAILED';
  };
}

// Combined domains response
export interface RailwayDomainsResponse {
  serviceDomains: RailwayServiceDomain[];
  customDomains: RailwayCustomDomain[];
}

// Service instance settings
export interface RailwayServiceInstance {
  id: string;
  serviceName?: string;
  startCommand?: string;
  buildCommand?: string;
  rootDirectory?: string;
  healthcheckPath?: string;
  healthcheckTimeout?: number;
  region?: string;
  numReplicas?: number;
  restartPolicyType?: 'ON_FAILURE' | 'ALWAYS' | 'NEVER';
  restartPolicyMaxRetries?: number;
  cronSchedule?: string;
  sleepApplication?: boolean;
  latestDeployment?: RailwayDeploymentInfo;
}

// Service instance update input
export interface RailwayServiceInstanceUpdateInput {
  startCommand?: string;
  buildCommand?: string;
  rootDirectory?: string;
  healthcheckPath?: string;
  healthcheckTimeout?: number;
  region?: string;
  numReplicas?: number;
  restartPolicyType?: 'ON_FAILURE' | 'ALWAYS' | 'NEVER';
  restartPolicyMaxRetries?: number;
  cronSchedule?: string;
  sleepApplication?: boolean;
}

// Webhook payload from Railway
export interface RailwayWebhookPayload {
  type: string; // e.g., "Deployment.failed", "Deployment.success"
  details: {
    id: string;
    source: string;
    status: string;
    branch?: string;
    commitHash?: string;
    commitAuthor?: string;
    commitMessage?: string;
  };
  resource: {
    workspace: { id: string; name: string };
    project: { id: string; name: string };
    environment: { id: string; name: string; isEphemeral: boolean };
    service: { id: string; name: string };
    deployment: { id: string };
  };
  severity: 'INFO' | 'WARNING' | 'ERROR';
  timestamp: string;
}

// Railway connection status for UI
export interface RailwayConnectionStatus {
  isConnected: boolean;
  railwayUserId?: string;
  railwayEmail?: string;
  railwayName?: string;
  defaultWorkspace?: RailwayWorkspace;
  grantedWorkspaces?: RailwayWorkspace[];
  status: 'active' | 'disconnected' | 'expired';
}

// Railway deployment status for a project
export interface ProjectRailwayStatus {
  isDeployed: boolean;
  railwayProjectId?: string;
  railwayServiceId?: string;
  railwayEnvironmentId?: string;
  railwayDomain?: string;
  deploymentStatus?: string;
  lastDeployedAt?: Date;
}

// OAuth state stored in cookie/session
export interface RailwayOAuthState {
  state: string;
  codeVerifier: string;
  redirectTo?: string;
}
