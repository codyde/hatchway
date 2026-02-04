import { NextResponse } from 'next/server';
import { reconcileProjectsWithFilesystem } from '@hatchway/agent-core/lib/reconciliation';

// GET /api/reconcile - Check DB vs filesystem sync status
export async function GET() {
  try {
    console.log('🔄 Running reconciliation check...');
    const result = await reconcileProjectsWithFilesystem();

    console.log('📊 Reconciliation Results:');
    console.log(`   Synced: ${result.summary.synced}`);
    console.log(`   Orphaned in DB: ${result.summary.orphanedDb}`);
    console.log(`   Untracked in FS: ${result.summary.untracked}`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error during reconciliation:', error);
    return NextResponse.json(
      {
        error: 'Failed to reconcile projects',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
