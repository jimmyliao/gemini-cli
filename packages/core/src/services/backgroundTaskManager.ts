/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellExecutionHandle } from './shellExecutionService.js';
import { randomUUID } from 'node:crypto';

/**
 * Represents the status of a background task
 */
export type BackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed';

/**
 * Represents a background task with all its metadata
 */
export interface BackgroundTask {
  /** Unique identifier for the task */
  id: string;

  /** The command that was executed */
  command: string;

  /** Working directory where the command runs */
  cwd: string;

  /** Process ID of the spawned shell */
  pid: number | undefined;

  /** Timestamp when the task was started */
  startTime: Date;

  /** Current status of the task */
  status: BackgroundTaskStatus;

  /** Output buffer storing command output line by line */
  outputBuffer: string[];

  /** Position of last read operation (for incremental reads) */
  lastReadPosition: number;

  /** Handle to the shell execution */
  handle: ShellExecutionHandle;

  /** Exit code when task completes */
  exitCode: number | null;

  /** Error if task failed */
  error: Error | null;

  /** Signal that terminated the process */
  signal: number | null;
}

/**
 * Configuration options for the background task manager
 */
export interface BackgroundTaskManagerConfig {
  /** Maximum number of lines to buffer per task (default: 10000) */
  maxBufferLines?: number;

  /** Auto-cleanup completed tasks after this many milliseconds (default: 1 hour) */
  cleanupAfterMs?: number;

  /** Maximum number of concurrent tasks (default: 50) */
  maxConcurrentTasks?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<BackgroundTaskManagerConfig> = {
  maxBufferLines: 10000,
  cleanupAfterMs: 3600000, // 1 hour
  maxConcurrentTasks: 50,
};

/**
 * Service for managing background tasks
 *
 * This service provides centralized management for shell commands running in the background,
 * including output buffering, status tracking, and task lifecycle management.
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private config: Required<BackgroundTaskManagerConfig>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: BackgroundTaskManagerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startAutoCleanup();
  }

  /**
   * Register a new background task
   *
   * @param command - The command being executed
   * @param cwd - Working directory
   * @param handle - Shell execution handle
   * @returns The registered task with its unique ID
   * @throws Error if maximum concurrent tasks limit is reached
   */
  registerTask(
    command: string,
    cwd: string,
    handle: ShellExecutionHandle,
  ): BackgroundTask {
    // Check concurrent task limit
    const runningTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    );
    if (runningTasks.length >= this.config.maxConcurrentTasks) {
      throw new Error(
        `Maximum concurrent tasks limit reached (${this.config.maxConcurrentTasks})`,
      );
    }

    const id = randomUUID();
    const task: BackgroundTask = {
      id,
      command,
      cwd,
      pid: handle.pid,
      startTime: new Date(),
      status: 'running',
      outputBuffer: [],
      lastReadPosition: 0,
      handle,
      exitCode: null,
      error: null,
      signal: null,
    };

    this.tasks.set(id, task);

    // Monitor task completion
    this.monitorTask(task);

    return task;
  }

  /**
   * Get a task by its ID
   *
   * @param id - The task ID
   * @returns The task or undefined if not found
   */
  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get output from a task, optionally from a specific position
   *
   * @param id - The task ID
   * @param fromPosition - Starting position (default: 0)
   * @returns Array of output lines, or null if task not found
   */
  getOutput(id: string, fromPosition: number = 0): string[] | null {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    return task.outputBuffer.slice(fromPosition);
  }

  /**
   * Append output to a task's buffer
   *
   * @param id - The task ID
   * @param output - Output line to append
   * @returns true if successful, false if task not found
   */
  appendOutput(id: string, output: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    // Apply buffer size limit
    if (task.outputBuffer.length >= this.config.maxBufferLines) {
      // Remove oldest lines (FIFO)
      const removeCount =
        task.outputBuffer.length - this.config.maxBufferLines + 1;
      task.outputBuffer.splice(0, removeCount);
      // Adjust read position
      task.lastReadPosition = Math.max(0, task.lastReadPosition - removeCount);
    }

    task.outputBuffer.push(output);
    return true;
  }

  /**
   * Kill a background task
   *
   * @param id - The task ID
   * @returns true if task was killed, false if not found or already completed
   * @throws Error if kill operation fails
   */
  async killTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    // Cannot kill already completed tasks
    if (task.status !== 'running') {
      return false;
    }

    if (!task.pid) {
      throw new Error('Task has no PID');
    }

    try {
      // Try graceful shutdown first (SIGTERM)
      process.kill(task.pid, 'SIGTERM');

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check if process is still running
      try {
        process.kill(task.pid, 0); // Signal 0 just checks if process exists
        // Process still running, force kill
        process.kill(task.pid, 'SIGKILL');
      } catch {
        // Process already terminated
      }

      // Update task status
      task.status = 'killed';
      task.signal = 15; // SIGTERM

      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        // Process doesn't exist (already terminated)
        task.status = 'completed';
        return false;
      }
      throw new Error(`Failed to kill task ${id}: ${(error as Error).message}`);
    }
  }

  /**
   * List all tasks
   *
   * @param statusFilter - Optional filter by status
   * @returns Array of tasks
   */
  listTasks(statusFilter?: BackgroundTaskStatus): BackgroundTask[] {
    const tasks = Array.from(this.tasks.values());
    if (statusFilter) {
      return tasks.filter((t) => t.status === statusFilter);
    }
    return tasks;
  }

  /**
   * Remove a task from the manager
   *
   * @param id - The task ID
   * @returns true if task was removed, false if not found
   */
  removeTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * Clean up completed tasks older than the configured threshold
   *
   * @returns Number of tasks cleaned up
   */
  cleanup(): number {
    const now = Date.now();
    const threshold = this.config.cleanupAfterMs;
    let cleanedCount = 0;

    for (const [id, task] of this.tasks.entries()) {
      // Only cleanup non-running tasks
      if (task.status !== 'running') {
        const taskAge = now - task.startTime.getTime();
        if (taskAge > threshold) {
          this.tasks.delete(id);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Destroy the task manager and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Kill all running tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        this.killTask(task.id).catch(() => {
          // Ignore errors during cleanup
        });
      }
    }

    this.tasks.clear();
  }

  /**
   * Monitor a task and update its status when it completes
   *
   * @param task - The task to monitor
   */
  private async monitorTask(task: BackgroundTask): Promise<void> {
    try {
      const result = await task.handle.result;

      // Update task status based on result
      if (result.aborted) {
        task.status = 'killed';
      } else if (result.error) {
        task.status = 'failed';
        task.error = result.error;
      } else {
        task.status = 'completed';
      }

      task.exitCode = result.exitCode;
      task.signal = result.signal;

      // Store final output if not already buffered
      if (result.output && result.output.trim()) {
        const lines = result.output.split('\n');
        for (const line of lines) {
          this.appendOutput(task.id, line);
        }
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error as Error;
    }
  }

  /**
   * Start automatic cleanup of old tasks
   */
  private startAutoCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 3600000);

    // Don't keep the process alive just for cleanup
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
}

/**
 * Singleton instance of the background task manager
 */
let globalTaskManager: BackgroundTaskManager | null = null;

/**
 * Get the global background task manager instance
 *
 * @returns The global task manager instance
 */
export function getBackgroundTaskManager(): BackgroundTaskManager {
  if (!globalTaskManager) {
    globalTaskManager = new BackgroundTaskManager();
  }
  return globalTaskManager;
}

/**
 * Reset the global task manager (primarily for testing)
 */
export function resetBackgroundTaskManager(): void {
  if (globalTaskManager) {
    globalTaskManager.destroy();
    globalTaskManager = null;
  }
}
