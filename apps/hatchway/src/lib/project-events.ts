import { EventEmitter } from 'events';

/**
 * In-memory event emitter for real-time project status updates
 * Replaces database polling with instant event propagation
 */
class ProjectEventEmitter extends EventEmitter {
  /**
   * Emit a project status update
   */
  emitProjectUpdate(projectId: string, project: any) {
    this.emit(`project:${projectId}`, project);
    console.log(`📡 Event emitted for project ${projectId}`);
  }

  /**
   * Subscribe to project updates
   */
  onProjectUpdate(projectId: string, callback: (project: any) => void) {
    this.on(`project:${projectId}`, callback);
    console.log(`👂 Listener added for project ${projectId}`);
  }

  /**
   * Unsubscribe from project updates
   */
  offProjectUpdate(projectId: string, callback: (project: any) => void) {
    this.off(`project:${projectId}`, callback);
    console.log(`🔇 Listener removed for project ${projectId}`);
  }

  /**
   * Get count of active listeners for a project
   */
  getListenerCount(projectId: string): number {
    return this.listenerCount(`project:${projectId}`);
  }
}

// Singleton instance
export const projectEvents = new ProjectEventEmitter();

// Set max listeners to handle multiple concurrent SSE connections
projectEvents.setMaxListeners(100);
