import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { createRailwayClient } from '@/lib/railway';

/**
 * GET /api/debug/railway-schema?type=ServiceDomainUpdateInput
 * Introspect Railway GraphQL schema types
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const url = new URL(req.url);
    const typeName = url.searchParams.get('type') || 'ServiceDomainUpdateInput';

    const railway = createRailwayClient(userId);
    const typeInfo = await railway.introspectInputType(typeName);

    return NextResponse.json({ type: typeName, schema: typeInfo });
  } catch (error) {
    console.error('[Debug] Error introspecting schema:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to introspect schema' },
      { status: 500 }
    );
  }
}
