import { NextResponse } from 'next/server';
import { listRunnerConnections } from '@hatchway/agent-core/lib/runner/broker-state';
import { buildWebSocketServer } from '@hatchway/agent-core';
import { getSession, isLocalMode } from '@/lib/auth-helpers';

export async function GET() {
  // Get current user session for multi-tenancy filtering
  const session = await getSession();
  const userId = session?.user?.id;
  
  // In local mode or if not authenticated, we don't filter runners
  // In SaaS mode with authentication, filter to only show user's runners
  const shouldFilter = !isLocalMode() && userId;
  
  const stats = buildWebSocketServer.getStats();
  
  // Filter runners by userId in multi-tenant (SaaS) mode
  const connections = (await listRunnerConnections(shouldFilter ? userId : undefined)).map((connection) => ({
    runnerId: connection.runnerId,
    lastHeartbeat: connection.lastHeartbeat,
    lastHeartbeatAge: connection.lastHeartbeatAge,
  }));

  return NextResponse.json({
    connections,
    stats: {
      totalRunners: stats.totalRunners,
      runnerMetrics: stats.runnerMetrics,
    },
  });
}
