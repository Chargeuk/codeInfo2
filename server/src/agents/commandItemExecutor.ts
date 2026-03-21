import { prepareMarkdownInstruction } from '../flows/markdownFileResolver.js';
import type { RepositoryCandidateLookupSummary } from '../flows/repositoryCandidateOrder.js';
import type {
  ReingestExecutionBatchResult,
  ReingestExecutionSingleResult,
} from '../ingest/reingestExecution.js';
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
  lookupSummary?: RepositoryCandidateLookupSummary;
  resolvedSourceId?: string;
};

export type ExecuteCommandItemSingleReingestResult =
  ReingestExecutionSingleResult & {
    callId: string;
    continuedToNextItem: boolean;
    stopAfter: boolean;
  };

export type ExecuteCommandItemBatchReingestResult =
  ReingestExecutionBatchResult & {
    continuedToNextItem: boolean;
    stopAfter: boolean;
  };

export type ExecuteCommandItemReingestResult =
  | ExecuteCommandItemSingleReingestResult
  | ExecuteCommandItemBatchReingestResult;

type ExecuteCommandMessageResult<T> = ExecuteCommandItemInstruction & {
  itemType: 'message';
  result: T;
};

export type ExecuteCommandItemSkippedResult = {
  itemType: 'skip';
  instructionSource: 'markdownFile';
  lookupSummary?: RepositoryCandidateLookupSummary;
  markdownFile: string;
  reason: 'empty_markdown';
  resolvedPath: string;
  resolvedSourceId: string;
};

type ExecuteCommandReingestOutcome = {
  itemType: 'reingest';
  result: ExecuteCommandItemReingestResult;
};

const buildReingestRequestLogContext = (params: {
  item: AgentCommandReingestItem;
  commandName: string;
  itemIndex: number;
  flowContext?: {
    flowName: string;
    stepIndex: number;
  };
}) => ({
  surface: params.flowContext ? 'flow_command' : 'command',
  targetMode: 'sourceId' in params.item ? 'sourceId' : params.item.target,
  requestedSelector: 'sourceId' in params.item ? params.item.sourceId : null,
  schemaSource: 'command',
  commandName: params.commandName,
  itemIndex: params.itemIndex,
  flowName: params.flowContext?.flowName ?? null,
  flowStepIndex: params.flowContext?.stepIndex ?? null,
});

export function executeCommandItem<T>(params: {
  item: AgentCommandMessageItem;
  itemIndex: number;
  commandName: string;
  workingRepositoryPath?: string;
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
}): Promise<ExecuteCommandMessageResult<T> | ExecuteCommandItemSkippedResult>;

export function executeCommandItem<T>(params: {
  item: AgentCommandItem;
  itemIndex: number;
  commandName: string;
  workingRepositoryPath?: string;
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
}): Promise<
  | ExecuteCommandMessageResult<T>
  | ExecuteCommandItemSkippedResult
  | ExecuteCommandReingestOutcome
>;

export async function executeCommandItem<T>(params: {
  item: AgentCommandItem;
  itemIndex: number;
  commandName: string;
  workingRepositoryPath?: string;
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
}): Promise<
  | ExecuteCommandMessageResult<T>
  | ExecuteCommandItemSkippedResult
  | ExecuteCommandReingestOutcome
> {
  if (params.item.type === 'reingest') {
    if (!params.executeReingest) {
      throw new Error('Reingest execution is not configured for this command.');
    }
    append({
      level: 'info',
      message: 'DEV-0000050:T01:reingest_request_shape_accepted',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: buildReingestRequestLogContext({
        item: params.item,
        commandName: params.commandName,
        itemIndex: params.itemIndex,
        flowContext: params.flowContext,
      }),
    });

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
          targetMode: result.targetMode,
          requestedSelector: result.requestedSelector,
          sourceId: result.kind === 'single' ? result.outcome.sourceId : null,
          status: result.kind === 'single' ? result.outcome.status : null,
          repositoryCount:
            result.kind === 'batch' ? result.repositories.length : 1,
          repositories: result.kind === 'batch' ? result.repositories : null,
          callId: result.kind === 'single' ? result.callId : null,
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
      lookupSummary: undefined,
      markdownFile: undefined,
      resolvedSourceId: undefined,
    };
  } else {
    const prepared = await prepareMarkdownInstruction({
      markdownFile: params.item.markdownFile,
      workingRepositoryPath: params.workingRepositoryPath,
      sourceId: params.sourceId,
      flowSourceId: params.flowSourceId,
      surface: params.flowContext ? 'flow_command' : 'command',
      commandName: params.commandName,
      itemIndex: params.itemIndex,
      flowName: params.flowContext?.flowName,
      stepIndex: params.flowContext?.stepIndex,
    });
    if (prepared.kind === 'skip') {
      return {
        itemType: 'skip',
        instructionSource: 'markdownFile',
        lookupSummary: prepared.lookupSummary,
        markdownFile: prepared.markdownFile,
        reason: prepared.reason,
        resolvedPath: prepared.resolvedPath,
        resolvedSourceId: prepared.resolvedSourceId,
      };
    }
    instruction = {
      instruction: prepared.instruction,
      instructionSource: 'markdownFile',
      lookupSummary: prepared.lookupSummary,
      markdownFile: prepared.markdownFile,
      resolvedSourceId: prepared.resolvedSourceId,
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
