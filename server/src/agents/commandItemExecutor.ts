import { resolveMarkdownFileWithMetadata } from '../flows/markdownFileResolver.js';
import { append } from '../logStore.js';

import type { AgentCommandMessageItem } from './commandsSchema.js';

export type CommandItemInstructionSource = 'content' | 'markdownFile';

export type ExecuteCommandItemInstruction = {
  instruction: string;
  instructionSource: CommandItemInstructionSource;
  markdownFile?: string;
  resolvedSourceId?: string;
};

export async function executeCommandItem<T>(params: {
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
}): Promise<ExecuteCommandItemInstruction & { result: T }> {
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
    ...instruction,
    result,
  };
}
