import { db } from '@hatchway/agent-core';
import { railwayConnections } from '@hatchway/agent-core/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptToken, decryptToken } from './encryption';
import { refreshAccessToken } from './oauth';
import type {
  RailwayWorkspace,
  RailwayProject,
  RailwayService,
  RailwayEnvironment,
  RailwayDeploymentInfo,
  RailwayDomain,
  RailwayDomainsResponse,
  RailwayServiceInstance,
  RailwayServiceInstanceUpdateInput,
  RailwayServiceDomain,
} from './types';

const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';

/**
 * Railway GraphQL client with automatic token refresh
 */
export class RailwayClient {
  private userId: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: Date | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string> {
    // Check if we have a cached valid token
    if (this.accessToken && this.accessTokenExpiresAt) {
      // Refresh 5 minutes before expiry
      const bufferMs = 5 * 60 * 1000;
      if (this.accessTokenExpiresAt.getTime() - bufferMs > Date.now()) {
        return this.accessToken;
      }
    }

    // Fetch connection from database
    const connection = await db.query.railwayConnections.findFirst({
      where: eq(railwayConnections.userId, this.userId),
    });

    if (!connection) {
      throw new Error('Railway connection not found. Please connect your Railway account.');
    }

    if (connection.status !== 'active') {
      throw new Error('Railway connection is not active. Please reconnect your Railway account.');
    }

    // Check if token needs refresh
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

    if (
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - bufferMs > now.getTime()
    ) {
      // Token is still valid
      this.accessToken = decryptToken(connection.accessTokenEncrypted);
      this.accessTokenExpiresAt = connection.accessTokenExpiresAt;
      return this.accessToken;
    }

    // Need to refresh the token
    if (!connection.refreshTokenEncrypted) {
      // No refresh token, mark connection as expired
      await db.update(railwayConnections)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(railwayConnections.userId, this.userId));
      
      throw new Error('Railway session expired. Please reconnect your Railway account.');
    }

    try {
      const refreshToken = decryptToken(connection.refreshTokenEncrypted);
      const tokens = await refreshAccessToken(refreshToken);

      // Update stored tokens
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      
      await db.update(railwayConnections)
        .set({
          accessTokenEncrypted: encryptToken(tokens.access_token),
          accessTokenExpiresAt: expiresAt,
          refreshTokenEncrypted: tokens.refresh_token 
            ? encryptToken(tokens.refresh_token) 
            : connection.refreshTokenEncrypted,
          updatedAt: new Date(),
        })
        .where(eq(railwayConnections.userId, this.userId));

      this.accessToken = tokens.access_token;
      this.accessTokenExpiresAt = expiresAt;
      
      return tokens.access_token;
    } catch (error) {
      // Refresh failed, mark connection as expired
      await db.update(railwayConnections)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(railwayConnections.userId, this.userId));
      
      throw new Error('Failed to refresh Railway token. Please reconnect your Railway account.');
    }
  }

  /**
   * Execute a GraphQL query/mutation
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const accessToken = await this.getValidAccessToken();

    const response = await fetch(RAILWAY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (!response.ok || (result.errors && result.errors.length > 0)) {
      const errorMessage = result.errors?.[0]?.message || `HTTP ${response.status}`;
      console.error('[Railway API] Error:', {
        status: response.status,
        errors: result.errors,
        query: query.trim().substring(0, 100),
        variables,
      });
      throw new Error(`Railway API error: ${errorMessage}`);
    }

    if (!result.data) {
      throw new Error('No data returned from Railway API');
    }

    return result.data;
  }

  /**
   * Get workspaces the user granted access to
   */
  async getWorkspaces(): Promise<RailwayWorkspace[]> {
    const query = `
      query {
        me {
          workspaces {
            id
            name
          }
        }
      }
    `;

    const data = await this.graphql<{ me: { workspaces: RailwayWorkspace[] } }>(query);
    return data.me.workspaces;
  }

  /**
   * Get projects in a workspace
   */
  async getProjects(workspaceId: string): Promise<RailwayProject[]> {
    const query = `
      query workspaceProjects($workspaceId: String!) {
        projects(workspaceId: $workspaceId) {
          edges {
            node {
              id
              name
              description
              createdAt
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      projects: { edges: Array<{ node: RailwayProject }> };
    }>(query, { workspaceId });

    return data.projects.edges.map((e) => e.node);
  }

  /**
   * Create a new project
   */
  async createProject(name: string, workspaceId: string): Promise<RailwayProject> {
    const query = `
      mutation projectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          id
          name
          description
          createdAt
        }
      }
    `;

    const data = await this.graphql<{ projectCreate: RailwayProject }>(query, {
      input: { name, workspaceId },
    });

    return data.projectCreate;
  }

  /**
   * Get a project by ID
   */
  async getProject(projectId: string): Promise<{
    project: RailwayProject;
    services: RailwayService[];
    environments: RailwayEnvironment[];
  }> {
    const query = `
      query project($id: String!) {
        project(id: $id) {
          id
          name
          description
          createdAt
          services {
            edges {
              node {
                id
                name
                icon
              }
            }
          }
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      project: RailwayProject & {
        services: { edges: Array<{ node: RailwayService }> };
        environments: { edges: Array<{ node: RailwayEnvironment }> };
      };
    }>(query, { id: projectId });

    return {
      project: {
        id: data.project.id,
        name: data.project.name,
        description: data.project.description,
        createdAt: data.project.createdAt,
      },
      services: data.project.services.edges.map((e) => e.node),
      environments: data.project.environments.edges.map((e) => e.node),
    };
  }

  /**
   * Create a service from a GitHub repo
   */
  async createServiceFromGitHub(
    projectId: string,
    name: string,
    repo: string,
    branch?: string,
    environmentId?: string
  ): Promise<RailwayService> {
    const query = `
      mutation serviceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `;

    const input: Record<string, unknown> = {
      projectId,
      name,
      source: { repo },
    };

    if (branch) {
      input.branch = branch;
    }

    if (environmentId) {
      input.environmentId = environmentId;
    }

    const data = await this.graphql<{ serviceCreate: RailwayService }>(query, { input });
    return data.serviceCreate;
  }

  /**
   * Create a Railway domain for a service
   */
  async createDomain(
    serviceId: string,
    environmentId: string
  ): Promise<RailwayDomain> {
    const query = `
      mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          domain
        }
      }
    `;

    const data = await this.graphql<{ serviceDomainCreate: RailwayDomain }>(query, {
      input: { serviceId, environmentId },
    });

    return data.serviceDomainCreate;
  }

  /**
   * Trigger a deployment for a service
   */
  async triggerDeployment(
    serviceId: string,
    environmentId: string
  ): Promise<string> {
    const query = `
      mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `;

    const data = await this.graphql<{ serviceInstanceDeployV2: string }>(query, {
      serviceId,
      environmentId,
    });

    return data.serviceInstanceDeployV2; // Returns deployment ID
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<RailwayDeploymentInfo> {
    const query = `
      query deployment($id: String!) {
        deployment(id: $id) {
          id
          status
          url
          staticUrl
          createdAt
        }
      }
    `;

    const data = await this.graphql<{ deployment: RailwayDeploymentInfo }>(query, {
      id: deploymentId,
    });

    return data.deployment;
  }

  /**
   * Get latest deployments for a service
   */
  async getDeployments(
    projectId: string,
    serviceId: string,
    environmentId: string,
    limit: number = 5
  ): Promise<RailwayDeploymentInfo[]> {
    const query = `
      query deployments($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) {
          edges {
            node {
              id
              status
              url
              staticUrl
              createdAt
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      deployments: { edges: Array<{ node: RailwayDeploymentInfo }> };
    }>(query, {
      input: { projectId, serviceId, environmentId },
      first: limit,
    });

    return data.deployments.edges.map((e) => e.node);
  }

  /**
   * Set environment variables for a service
   */
  async setVariables(
    projectId: string,
    environmentId: string,
    serviceId: string,
    variables: Record<string, string>
  ): Promise<void> {
    const query = `
      mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `;

    await this.graphql(query, {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables,
      },
    });
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<void> {
    const query = `
      mutation projectDelete($id: String!) {
        projectDelete(id: $id)
      }
    `;

    await this.graphql(query, { id: projectId });
  }

  /**
   * Get environment variables for a service
   */
  async getVariables(
    projectId: string,
    environmentId: string,
    serviceId: string
  ): Promise<Record<string, string>> {
    const query = `
      query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
        variables(
          projectId: $projectId
          environmentId: $environmentId
          serviceId: $serviceId
        )
      }
    `;

    const data = await this.graphql<{ variables: Record<string, string> }>(query, {
      projectId,
      environmentId,
      serviceId,
    });

    return data.variables || {};
  }

  /**
   * Delete a single environment variable
   */
  async deleteVariable(
    projectId: string,
    environmentId: string,
    serviceId: string,
    name: string
  ): Promise<void> {
    const query = `
      mutation variableDelete($input: VariableDeleteInput!) {
        variableDelete(input: $input)
      }
    `;

    await this.graphql(query, {
      input: {
        projectId,
        environmentId,
        serviceId,
        name,
      },
    });
  }

  /**
   * Get all domains for a service
   */
  async getDomains(
    projectId: string,
    environmentId: string,
    serviceId: string
  ): Promise<RailwayDomainsResponse> {
    const query = `
      query domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(
          projectId: $projectId
          environmentId: $environmentId
          serviceId: $serviceId
        ) {
          serviceDomains {
            id
            domain
            suffix
            targetPort
          }
          customDomains {
            id
            domain
            status {
              dnsRecords {
                hostlabel
                requiredValue
                currentValue
                status
              }
              certificateStatus
            }
          }
        }
      }
    `;

    const data = await this.graphql<{ domains: RailwayDomainsResponse }>(query, {
      projectId,
      environmentId,
      serviceId,
    });

    return data.domains || { serviceDomains: [], customDomains: [] };
  }

  /**
   * Delete a Railway-provided service domain
   */
  async deleteServiceDomain(domainId: string): Promise<void> {
    const query = `
      mutation serviceDomainDelete($id: String!) {
        serviceDomainDelete(id: $id)
      }
    `;

    await this.graphql(query, { id: domainId });
  }

  /**
   * Introspect a GraphQL input type to see its fields
   * Useful for debugging Railway's undocumented API
   */
  async introspectInputType(typeName: string): Promise<unknown> {
    const query = `
      query IntrospectType($name: String!) {
        __type(name: $name) {
          name
          inputFields {
            name
            type {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{ __type: unknown }>(query, { name: typeName });
    return data.__type;
  }

  /**
   * Update a service domain subdomain
   * Returns true on success
   * 
   * Required fields from ServiceDomainUpdateInput:
   * - domain: String! (the full domain, e.g., "myapp.up.railway.app")
   * - environmentId: String!
   * - serviceDomainId: String!
   * - serviceId: String!
   * - targetPort: Int (optional)
   */
  async updateServiceDomain(
    serviceDomainId: string,
    serviceId: string,
    environmentId: string,
    domain: string,
    targetPort?: number
  ): Promise<boolean> {
    const query = `
      mutation serviceDomainUpdate($input: ServiceDomainUpdateInput!) {
        serviceDomainUpdate(input: $input)
      }
    `;

    const input: Record<string, unknown> = {
      serviceDomainId,
      serviceId,
      environmentId,
      domain,
    };

    if (targetPort !== undefined) {
      input.targetPort = targetPort;
    }

    const data = await this.graphql<{ serviceDomainUpdate: boolean }>(
      query,
      { input }
    );

    return data.serviceDomainUpdate;
  }

  /**
   * Delete a service
   */
  async deleteService(serviceId: string): Promise<void> {
    const query = `
      mutation serviceDelete($id: String!) {
        serviceDelete(id: $id)
      }
    `;

    await this.graphql(query, { id: serviceId });
  }

  /**
   * Get service instance settings
   */
  async getServiceInstance(
    serviceId: string,
    environmentId: string
  ): Promise<RailwayServiceInstance> {
    const query = `
      query serviceInstance($serviceId: String!, $environmentId: String!) {
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          id
          serviceName
          startCommand
          buildCommand
          rootDirectory
          healthcheckPath
          healthcheckTimeout
          region
          numReplicas
          restartPolicyType
          restartPolicyMaxRetries
          cronSchedule
          sleepApplication
          latestDeployment {
            id
            status
            createdAt
          }
        }
      }
    `;

    const data = await this.graphql<{ serviceInstance: RailwayServiceInstance }>(query, {
      serviceId,
      environmentId,
    });

    return data.serviceInstance;
  }

  /**
   * Update service instance settings
   */
  async updateServiceInstance(
    serviceId: string,
    environmentId: string,
    input: RailwayServiceInstanceUpdateInput
  ): Promise<void> {
    const query = `
      mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
      }
    `;

    await this.graphql(query, {
      serviceId,
      environmentId,
      input,
    });
  }

  /**
   * Redeploy a service (redeploys the latest deployment)
   */
  async redeployService(serviceId: string, environmentId: string): Promise<void> {
    const query = `
      mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }
    `;

    await this.graphql(query, {
      serviceId,
      environmentId,
    });
  }

  /**
   * Update service name
   */
  async updateService(serviceId: string, name: string): Promise<RailwayService> {
    const query = `
      mutation serviceUpdate($id: String!, $input: ServiceUpdateInput!) {
        serviceUpdate(id: $id, input: $input) {
          id
          name
          icon
        }
      }
    `;

    const data = await this.graphql<{ serviceUpdate: RailwayService }>(query, {
      id: serviceId,
      input: { name },
    });

    return data.serviceUpdate;
  }
}

/**
 * Create a Railway client for a user
 */
export function createRailwayClient(userId: string): RailwayClient {
  return new RailwayClient(userId);
}
