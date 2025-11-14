/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type {
  ToolInvocation,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,

  ToolConfirmationOutcome} from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from './tools.js';
import { getBackgroundTaskManager } from '../services/backgroundTaskManager.js';
import { getErrorMessage } from '../utils/errors.js';
import { KILL_SHELL_TOOL_NAME } from './tool-names.js';

export interface KillShellParams {
  shell_id: string;
}

export class KillShellInvocation extends BaseToolInvocation<
  KillShellParams,
  ToolResult
> {
  constructor(params: KillShellParams, messageBus?: MessageBus) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `Terminate background task: ${this.params.shell_id}`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const taskManager = getBackgroundTaskManager();
    const task = taskManager.getTask(this.params.shell_id);

    if (!task) {
      return false; // Task not found, will handle in execute
    }

    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Terminate Background Task',
      command: task.command,
      rootCommand: 'kill',
      onConfirm: async (_outcome: ToolConfirmationOutcome) => {
        // No special handling needed
      },
    };
    return confirmationDetails;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const taskManager = getBackgroundTaskManager();
    const task = taskManager.getTask(this.params.shell_id);

    if (!task) {
      return {
        llmContent: `Background task not found: ${this.params.shell_id}. Task may have already completed or been cleaned up.`,
        returnDisplay: `Error: Task ${this.params.shell_id} not found.`,
      };
    }

    if (task.status !== 'running') {
      return {
        llmContent: `Task ${this.params.shell_id} is not running (status: ${task.status}). No need to kill.`,
        returnDisplay: `Task already ${task.status}.`,
      };
    }

    try {
      const killed = await taskManager.killTask(this.params.shell_id);

      if (!killed) {
        return {
          llmContent: `Failed to kill task ${this.params.shell_id}. Task may have already terminated.`,
          returnDisplay: 'Failed to kill task.',
        };
      }

      return {
        llmContent: `Successfully terminated background task ${this.params.shell_id} (command: ${task.command})`,
        returnDisplay: `Task ${this.params.shell_id} terminated.`,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error terminating background task ${this.params.shell_id}: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }
}

export class KillShellTool extends BaseDeclarativeTool<
  KillShellParams,
  ToolResult
> {
  static readonly Name = KILL_SHELL_TOOL_NAME;

  constructor(messageBus?: MessageBus) {
    super(
      KillShellTool.Name,
      'Kill Shell',
      'Terminate a background shell task started with run_in_background=true parameter. Use the shell_id from the original Shell tool response to kill the task.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          shell_id: {
            type: 'string',
            description:
              'The shell_id returned by the Shell tool when running a background command.',
          },
        },
        required: ['shell_id'],
      },
      false, // output is not markdown
      false, // output cannot be updated
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: KillShellParams,
  ): string | null {
    if (!params.shell_id || params.shell_id.trim().length === 0) {
      return 'shell_id is required and cannot be empty.';
    }

    return null;
  }

  protected createInvocation(
    params: KillShellParams,
    messageBus?: MessageBus,
  ): ToolInvocation<KillShellParams, ToolResult> {
    return new KillShellInvocation(params, messageBus);
  }
}
