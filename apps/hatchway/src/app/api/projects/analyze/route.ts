/**
 * Project Analysis API Endpoint
 * 
 * This endpoint handles the analyze-project flow:
 * 1. Sends analyze-project command to the runner
 * 2. Waits for project-metadata event with AI-generated analysis
 * 3. Returns the analysis result to the frontend
 * 
 * This allows the frontend to get AI-generated project names, icons,
 * descriptions, and template selection BEFORE creating the project.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { sendCommandToRunner } from '@hatchway/agent-core/lib/runner/broker-state';
import { addRunnerEventSubscriber, removeRunnerEventSubscriber } from '@hatchway/agent-core/lib/runner/event-stream';
import type { RunnerEvent, AnalyzeProjectCommand, ProjectMetadataEvent } from '@hatchway/agent-core/shared/runner/messages';
import { isLocalMode, getSession } from '@/lib/auth-helpers';
import type { AppliedTag } from '@hatchway/agent-core/types/tags';
import type { AgentId, ClaudeModelId } from '@hatchway/agent-core/types/agent';

interface AnalyzeRequestBody {
  prompt: string;
  agent: AgentId;
  claudeModel?: ClaudeModelId;
  tags?: AppliedTag[];
  runnerId?: string;
}

interface AnalysisResult {
  slug: string;
  friendlyName: string;
  description: string;
  icon: string;
  template: {
    id: string;
    name: string;
    framework: string;
    port: number;
    runCommand: string;
    repository: string;
    branch: string;
  };
}

const ANALYSIS_TIMEOUT_MS = 60000; // 60 seconds

export async function POST(request: Request) {
  try {
    // Require authentication (but not project ownership since project doesn't exist yet)
    if (!isLocalMode()) {
      const session = await getSession();
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
    }

    const body = (await request.json()) as AnalyzeRequestBody;
    const { prompt, agent, claudeModel, tags, runnerId } = body;

    if (!prompt || !agent) {
      return NextResponse.json({ error: 'Missing required fields: prompt, agent' }, { status: 400 });
    }

    const effectiveRunnerId = runnerId ?? process.env.RUNNER_DEFAULT_ID ?? 'default';
    const commandId = randomUUID();

    console.log(`[analyze] Starting analysis for prompt: "${prompt.substring(0, 50)}..."`);
    console.log(`[analyze] Command ID: ${commandId}`);
    console.log(`[analyze] Runner: ${effectiveRunnerId}`);

    // Create a promise that resolves when we receive project-metadata
    const analysisPromise = new Promise<AnalysisResult>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      const handler = (event: RunnerEvent) => {
        console.log(`[analyze] Received event: ${event.type}`);

        if (event.type === 'project-metadata') {
          const metadataEvent = event as ProjectMetadataEvent;
          const payload = metadataEvent.payload;

          if (payload.slug && payload.friendlyName && payload.template) {
            clearTimeout(timeoutId);
            removeRunnerEventSubscriber(commandId, handler);

            console.log(`[analyze] Analysis complete: ${payload.friendlyName} (${payload.slug})`);
            
            resolve({
              slug: payload.slug,
              friendlyName: payload.friendlyName,
              description: payload.description || '',
              icon: payload.icon || 'Code',
              template: payload.template,
            });
          }
        } else if (event.type === 'error') {
          clearTimeout(timeoutId);
          removeRunnerEventSubscriber(commandId, handler);
          reject(new Error((event as { error?: string }).error || 'Analysis failed'));
        }
      };

      // Set timeout for analysis
      timeoutId = setTimeout(() => {
        removeRunnerEventSubscriber(commandId, handler);
        reject(new Error('Analysis timed out'));
      }, ANALYSIS_TIMEOUT_MS);

      // Subscribe to events for this command
      addRunnerEventSubscriber(commandId, handler);
    });

    // Send the analyze-project command
    const command: AnalyzeProjectCommand = {
      id: commandId,
      type: 'analyze-project',
      timestamp: new Date().toISOString(),
      payload: {
        prompt,
        operationType: 'initial-build',
        agent,
        claudeModel,
        tags,
        runnerId: effectiveRunnerId,
      },
    };

    await sendCommandToRunner(effectiveRunnerId, command);
    console.log(`[analyze] Command sent to runner`);

    // Wait for the analysis result
    const result = await analysisPromise;

    return NextResponse.json({ analysis: result });
  } catch (error) {
    console.error('[analyze] Analysis failed:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Analysis timed out') {
        return NextResponse.json({ error: 'Analysis timed out. Please try again.' }, { status: 504 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
