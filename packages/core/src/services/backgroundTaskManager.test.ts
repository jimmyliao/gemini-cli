/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BackgroundTaskManager,
  getBackgroundTaskManager,
  resetBackgroundTaskManager,
} from './backgroundTaskManager.js';
import type { ShellExecutionHandle } from './shellExecutionService.js';

describe('BackgroundTaskManager', () => {
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    manager = new BackgroundTaskManager({
      maxBufferLines: 100,
      cleanupAfterMs: 1000,
      maxConcurrentTasks: 5,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('registerTask', () => {
    it('should register a new task with unique ID', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      expect(task.id).toBeDefined();
      expect(task.command).toBe('echo test');
      expect(task.cwd).toBe('/tmp');
      expect(task.pid).toBe(12345);
      expect(task.status).toBe('running');
      expect(task.outputBuffer).toEqual([]);
      expect(task.lastReadPosition).toBe(0);
    });

    it('should generate unique task IDs', () => {
      const mockHandle1: ShellExecutionHandle = {
        pid: 111,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 111,
          executionMethod: 'child_process',
        }),
      };

      const mockHandle2: ShellExecutionHandle = {
        pid: 222,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 222,
          executionMethod: 'child_process',
        }),
      };

      const task1 = manager.registerTask('cmd1', '/tmp', mockHandle1);
      const task2 = manager.registerTask('cmd2', '/tmp', mockHandle2);

      expect(task1.id).not.toBe(task2.id);
    });

    it('should throw error when max concurrent tasks limit is reached', () => {
      // Register 5 tasks (the limit)
      for (let i = 0; i < 5; i++) {
        const mockHandle: ShellExecutionHandle = {
          pid: 1000 + i,
          result: new Promise(() => {}), // Never resolves
        };
        manager.registerTask(`cmd${i}`, '/tmp', mockHandle);
      }

      // Try to register 6th task
      const mockHandle: ShellExecutionHandle = {
        pid: 9999,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 9999,
          executionMethod: 'child_process',
        }),
      };

      expect(() => {
        manager.registerTask('cmd6', '/tmp', mockHandle);
      }).toThrow('Maximum concurrent tasks limit reached');
    });

    it('should update task status when command completes successfully', async () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from('test output'),
          output: 'test output',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      // Wait for task to complete
      await mockHandle.result;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedTask = manager.getTask(task.id);
      expect(updatedTask?.status).toBe('completed');
      expect(updatedTask?.exitCode).toBe(0);
    });

    it('should update task status when command fails', async () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 1,
          signal: null,
          error: new Error('Command failed'),
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('failing-cmd', '/tmp', mockHandle);

      await mockHandle.result;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedTask = manager.getTask(task.id);
      expect(updatedTask?.status).toBe('failed');
      expect(updatedTask?.error).toBeDefined();
    });
  });

  describe('getTask', () => {
    it('should return task by ID', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);
      const retrieved = manager.getTask(task.id);

      expect(retrieved).toBe(task);
    });

    it('should return undefined for non-existent task', () => {
      const retrieved = manager.getTask('non-existent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getOutput', () => {
    it('should return all output when fromPosition is 0', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      manager.appendOutput(task.id, 'line 1');
      manager.appendOutput(task.id, 'line 2');
      manager.appendOutput(task.id, 'line 3');

      const output = manager.getOutput(task.id, 0);
      expect(output).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('should return only new output when fromPosition > 0', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      manager.appendOutput(task.id, 'line 1');
      manager.appendOutput(task.id, 'line 2');
      manager.appendOutput(task.id, 'line 3');

      const output = manager.getOutput(task.id, 2);
      expect(output).toEqual(['line 3']);
    });

    it('should return null for non-existent task', () => {
      const output = manager.getOutput('non-existent-id');
      expect(output).toBeNull();
    });

    it('should handle empty output', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);
      const output = manager.getOutput(task.id);

      expect(output).toEqual([]);
    });
  });

  describe('appendOutput', () => {
    it('should append output to task buffer', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      const success = manager.appendOutput(task.id, 'test line');
      expect(success).toBe(true);

      const output = manager.getOutput(task.id);
      expect(output).toEqual(['test line']);
    });

    it('should return false for non-existent task', () => {
      const success = manager.appendOutput('non-existent-id', 'test');
      expect(success).toBe(false);
    });

    it('should respect maxBufferLines limit', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      // Append 150 lines (limit is 100)
      for (let i = 0; i < 150; i++) {
        manager.appendOutput(task.id, `line ${i}`);
      }

      const output = manager.getOutput(task.id);
      expect(output?.length).toBeLessThanOrEqual(100);
      // Should keep the most recent lines
      expect(output?.[output.length - 1]).toBe('line 149');
    });
  });

  describe('killTask', () => {
    it('should kill running task', async () => {
      // Mock process.kill
      const killSpy = vi.spyOn(process, 'kill');
      killSpy.mockImplementation(() => true);

      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: new Promise(() => {}), // Never resolves
      };

      const task = manager.registerTask('sleep 100', '/tmp', mockHandle);

      const result = await manager.killTask(task.id);
      expect(result).toBe(true);

      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');

      const updatedTask = manager.getTask(task.id);
      expect(updatedTask?.status).toBe('killed');

      killSpy.mockRestore();
    });

    it('should return false for non-existent task', async () => {
      const result = await manager.killTask('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for already completed task', async () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      // Wait for completion
      await mockHandle.result;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await manager.killTask(task.id);
      expect(result).toBe(false);
    });

    it('should force kill with SIGKILL if SIGTERM fails', async () => {
      const killSpy = vi.spyOn(process, 'kill');

      // First call (check if alive) succeeds
      // Second call (SIGTERM) succeeds
      // Third call (check if alive) succeeds - process still running
      // Fourth call (SIGKILL) succeeds
      killSpy.mockImplementation(() => true);

      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: new Promise(() => {}),
      };

      const task = manager.registerTask('stubborn-process', '/tmp', mockHandle);

      await manager.killTask(task.id);

      // Should eventually call SIGKILL
      const killCalls = killSpy.mock.calls;
      const hasSigkill = killCalls.some((call) => call[1] === 'SIGKILL');
      expect(hasSigkill).toBe(true);

      killSpy.mockRestore();
    });
  });

  describe('listTasks', () => {
    it('should return all tasks', () => {
      const mockHandle1: ShellExecutionHandle = {
        pid: 111,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 111,
          executionMethod: 'child_process',
        }),
      };

      const mockHandle2: ShellExecutionHandle = {
        pid: 222,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 222,
          executionMethod: 'child_process',
        }),
      };

      manager.registerTask('cmd1', '/tmp', mockHandle1);
      manager.registerTask('cmd2', '/tmp', mockHandle2);

      const tasks = manager.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it('should return empty array when no tasks', () => {
      const tasks = manager.listTasks();
      expect(tasks).toEqual([]);
    });

    it('should filter tasks by status', async () => {
      const mockHandle1: ShellExecutionHandle = {
        pid: 111,
        result: new Promise(() => {}), // Never resolves - stays running
      };

      const mockHandle2: ShellExecutionHandle = {
        pid: 222,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 222,
          executionMethod: 'child_process',
        }),
      };

      manager.registerTask('running-cmd', '/tmp', mockHandle1);
      manager.registerTask('completed-cmd', '/tmp', mockHandle2);

      // Wait for second task to complete
      await mockHandle2.result;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const runningTasks = manager.listTasks('running');
      expect(runningTasks).toHaveLength(1);
      expect(runningTasks[0]?.command).toBe('running-cmd');

      const completedTasks = manager.listTasks('completed');
      expect(completedTasks).toHaveLength(1);
      expect(completedTasks[0]?.command).toBe('completed-cmd');
    });
  });

  describe('removeTask', () => {
    it('should remove task from manager', () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      const removed = manager.removeTask(task.id);
      expect(removed).toBe(true);

      const retrieved = manager.getTask(task.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false for non-existent task', () => {
      const removed = manager.removeTask('non-existent-id');
      expect(removed).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove completed tasks older than threshold', async () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: Promise.resolve({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        }),
      };

      const task = manager.registerTask('echo test', '/tmp', mockHandle);

      // Wait for completion
      await mockHandle.result;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Manually modify the start time to make it old
      const retrievedTask = manager.getTask(task.id);
      if (retrievedTask) {
        retrievedTask.startTime = new Date(Date.now() - 2000);
      }

      const cleaned = manager.cleanup();
      expect(cleaned).toBe(1);

      const retrieved = manager.getTask(task.id);
      expect(retrieved).toBeUndefined();
    });

    it('should keep running tasks', async () => {
      const mockHandle: ShellExecutionHandle = {
        pid: 12345,
        result: new Promise(() => {}), // Never completes
      };

      const task = manager.registerTask('long-running', '/tmp', mockHandle);

      // Manually modify the start time to make it old
      const retrievedTask = manager.getTask(task.id);
      if (retrievedTask) {
        retrievedTask.startTime = new Date(Date.now() - 2000);
      }

      const cleaned = manager.cleanup();
      expect(cleaned).toBe(0);

      const retrieved = manager.getTask(task.id);
      expect(retrieved).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should kill all running tasks and clear resources', async () => {
      const killSpy = vi.spyOn(process, 'kill');
      killSpy.mockImplementation(() => true);

      const mockHandle1: ShellExecutionHandle = {
        pid: 111,
        result: new Promise(() => {}),
      };

      const mockHandle2: ShellExecutionHandle = {
        pid: 222,
        result: new Promise(() => {}),
      };

      manager.registerTask('cmd1', '/tmp', mockHandle1);
      manager.registerTask('cmd2', '/tmp', mockHandle2);

      manager.destroy();

      const tasks = manager.listTasks();
      expect(tasks).toHaveLength(0);

      killSpy.mockRestore();
    });
  });

  describe('global instance', () => {
    afterEach(() => {
      resetBackgroundTaskManager();
    });

    it('should return singleton instance', () => {
      const instance1 = getBackgroundTaskManager();
      const instance2 = getBackgroundTaskManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset global instance', () => {
      const instance1 = getBackgroundTaskManager();
      resetBackgroundTaskManager();
      const instance2 = getBackgroundTaskManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});
