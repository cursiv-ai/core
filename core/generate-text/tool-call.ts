import { inferParameters } from '../tool/tool'
import { ValueOf } from '../util/value-of'
import { ToolSet } from './tool-set'

export type { CoreToolCall, ToolCall } from '@ai-sdk/provider-utils'

// transforms the tools into a tool call union
export type ToolCallUnion<TOOLS extends ToolSet> = ValueOf<{
  [NAME in keyof TOOLS]: {
    type: 'tool-call'
    toolCallId: string
    toolName: NAME & string
    args: inferParameters<TOOLS[NAME]['parameters']>
  }
}>

/**
 * @deprecated Use `ToolCallUnion` instead.
 */
// TODO remove in v5
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type CoreToolCallUnion<TOOLS extends ToolSet> = ToolCallUnion<ToolSet>

export type ToolCallArray<TOOLS extends ToolSet> = Array<ToolCallUnion<TOOLS>>
