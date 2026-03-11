import { resolveMarkdownFileWithMetadata } from '../flows/markdownFileResolver.js';
import { append } from '../logStore.js';

import type {
  AgentCommandItem,
  AgentCommandMessageItem,
  AgentCommandReingestItem,
} from './commandsSchema.js';

export type CommandItemInstructionSource = 'content' | 'markdownFile';

export type ExecuteCommandItemInstruction = {
  instruction: string;
  instructionSource: CommandItemInstructionSource;
  markdownFile?: string;
  resolvedSourceId?: string;
};

export type ExecuteCommandItemReingestResult = {
  status: 'completed' | 'cancelled' | 'error';
  sourceId: string;
  callId: string;
  continuedToNextItem: boolean;
  stopAfter: boolean;
};

type ExecuteCommandMessageResult<T> = ExecuteCommandItemInstruction & {
  itemType: 'message';
  result: T;
};

type ExecuteCommandReingestOutcome = {
  itemType: 'reingest';
  result: ExecuteCommandItemReingestResult;
};

export function executeCommandItem<T>(params: {
  item: AgentCommandMessageItem;
  itemIndex: number;
  commandName: string;
  sourceId?: string;
  flowSourceId?: string;
  flowContext?: {
    flowName: string;
    stepIndex: number;
  };
  executeInstruction: (
    instruction: ExecuteCommandItemInstruction,
  ) => Promise<T>;
  executeReingest?: never;
}): Promise<ExecuteCommandMessageResult<T>>;

export function executeCommandItem<T>(params: {
  item: AgentCommandItem;
  itemIndex: number;
  commandName: string;
  sourceId?: string;
  flowSourceId?: string;
  flowContext?: {
    flowName: string;
    stepIndex: number;
  };
  executeInstruction?: (
    instruction: ExecuteCommandItemInstruction,
  ) => Promise<T>;
  executeReingest?: (
    item: AgentCommandReingestItem,
  ) => Promise<ExecuteCommandItemReingestResult>;
}): Promise<ExecuteCommandMessageResult<T> | ExecuteCommandReingestOutcome>;

export async function executeCommandItem<T>(params: {
  item: AgentCommandItem;
  itemIndex: number;
  commandName: string;
  sourceId?: string;
  flowSourceId?: string;
  flowContext?: {
    flowName: string;
    stepIndex: number;
  };
  executeInstruction?: (
    instruction: ExecuteCommandItemInstruction,
  ) => Promise<T>;
  executeReingest?: (
    item: AgentCommandReingestItem,
  ) => Promise<ExecuteCommandItemReingestResult>;
}): Promise<ExecuteCommandMessageResult<T> | ExecuteCommandReingestOutcome> {
  if (params.item.type === 'reingest') {
    if (!params.executeReingest) {
      throw new Error('Reingest execution is not configured for this command.');
    }
    const result = await params.executeReingest(params.item);
    if (params.flowContext) {
      append({
        level: 'info',
        message: 'DEV-0000045:T11:flow_command_reingest_recorded',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName: params.flowContext.flowName,
          stepIndex: params.flowContext.stepIndex,
          commandName: params.commandName,
          itemIndex: params.itemIndex,
          sourceId: result.sourceId,
          status: result.status,
          callId: result.callId,
          continuedToNextItem: result.continuedToNextItem,
        },
      });
    }
    return {
      itemType: 'reingest',
      result,
    };
  }

  if (!params.executeInstruction) {
    throw new Error(
      'Instruction execution is not configured for this command.',
    );
  }

  let instruction: ExecuteCommandItemInstruction;
  if ('content' in params.item) {
    instruction = {
      instruction: params.item.content.join('\n'),
      instructionSource: 'content',
      markdownFile: undefined,
      resolvedSourceId: undefined,
    };
  } else {
    const markdownFile = params.item.markdownFile;
    const resolved = await resolveMarkdownFileWithMetadata({
      markdownFile,
      sourceId: params.sourceId,
      flowSourceId: params.flowSourceId,
    });
    instruction = {
      instruction: resolved.content,
      instructionSource: 'markdownFile',
      markdownFile,
      resolvedSourceId: resolved.resolvedSourceId,
    };
  }

  if (params.flowContext) {
    append({
      level: 'info',
      message: 'DEV-0000045:T6:flow_command_message_item_executed',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        flowName: params.flowContext.flowName,
        stepIndex: params.flowContext.stepIndex,
        commandName: params.commandName,
        itemIndex: params.itemIndex,
        instructionSource: instruction.instructionSource,
        resolvedSourceId: instruction.resolvedSourceId,
      },
    });
  }

  const result = await params.executeInstruction(instruction);
  return {
    itemType: 'message',
    ...instruction,
    result,
  };
}
