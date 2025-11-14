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
} from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { getBackgroundTaskManager } from '../services/backgroundTaskManager.js';
import { BASH_OUTPUT_TOOL_NAME } from './tool-names.js';

export interface BashOutputParams {
  bash_id: string;
  filter?: string;
}

export class BashOutputInvocation extends BaseToolInvocation<
  BashOutputParams,
  ToolResult
> {
  constructor(params: BashOutputParams, messageBus?: MessageBus) {
    super(params, messageBus);
  }

  getDescription(): string {
    let description = `Get output from background task: ${this.params.bash_id}`;
    if (this.params.filter) {
      description += ` (filter: ${this.params.filter})`;
    }
    return description;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return false; // No confirmation needed for read-only operation
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const taskManager = getBackgroundTaskManager();
    const task = taskManager.getTask(this.params.bash_id);

    if (!task) {
      return {
        llmContent: `Background task not found: ${this.params.bash_id}. Task may have been cleaned up.`,
        returnDisplay: `Error: Task ${this.params.bash_id} not found.`,
      };
    }

    // Get all output from the task
    const allOutput = taskManager.getOutput(this.params.bash_id, 0);
    if (!allOutput) {
      return {
        llmContent: `Failed to retrieve output for task ${this.params.bash_id}.`,
        returnDisplay: 'Error: Failed to retrieve output.',
      };
    }

    // Apply filter if provided
    let filteredOutput = allOutput;
    if (this.params.filter) {
      try {
        const regex = new RegExp(this.params.filter);
        filteredOutput = allOutput.filter((line) => regex.test(line));
      } catch (error) {
        return {
          llmContent: `Invalid filter regex: ${this.params.filter}. Error: ${(error as Error).message}`,
          returnDisplay: 'Error: Invalid filter pattern.',
        };
      }
    }

    // Format output
    const outputText = filteredOutput.join('\n');
    const statusText = `Status: ${task.status}`;
    const pidText = task.pid ? `PID: ${task.pid}` : '';
    const lines = [statusText];
    if (pidText) lines.push(pidText);
    lines.push(`Lines buffered: ${allOutput.length}`);
    if (this.params.filter) {
      lines.push(`Matched lines: ${filteredOutput.length}`);
    }

    const llmContent = [lines.join('\n'), '', 'Output:', outputText].join('\n');

    return {
      llmContent,
      returnDisplay: `${lines.join(' | ')}\n${outputText}`,
    };
  }
}

export class BashOutputTool extends BaseDeclarativeTool<
  BashOutputParams,
  ToolResult
> {
  static readonly Name = BASH_OUTPUT_TOOL_NAME;

  constructor(messageBus?: MessageBus) {
    super(
      BashOutputTool.Name,
      'Bash Output',
      'Retrieve output from a background shell task started with run_in_background=true parameter. Use the shell_id from the original Shell tool response to fetch output.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          bash_id: {
            type: 'string',
            description:
              'The shell_id returned by the Shell tool when running a background command.',
          },
          filter: {
            type: 'string',
            description:
              '(OPTIONAL) Regular expression pattern to filter output lines. Only lines matching this pattern will be returned.',
          },
        },
        required: ['bash_id'],
      },
      false, // output is not markdown
      false, // output cannot be updated
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: BashOutputParams,
  ): string | null {
    if (!params.bash_id || params.bash_id.trim().length === 0) {
      return 'bash_id is required and cannot be empty.';
    }

    if (params.filter) {
      try {
        new RegExp(params.filter);
      } catch (error) {
        return `Invalid regex pattern in filter: ${(error as Error).message}`;
      }
    }

    return null;
  }

  protected createInvocation(
    params: BashOutputParams,
    messageBus?: MessageBus,
  ): ToolInvocation<BashOutputParams, ToolResult> {
    return new BashOutputInvocation(params, messageBus);
  }
}
