import { DataStreamString, formatDataStreamPart } from '@ai-sdk/ui-utils'
import { DataStreamWriter } from './data-stream-writer'

export function createDataStream({
  execute,
  onError = () => 'An error occurred.', // mask error messages for safety by default
}: {
  execute: (dataStream: DataStreamWriter) => Promise<void> | void
  onError?: (error: unknown) => string
}): ReadableStream<DataStreamString> {
  let controller!: ReadableStreamDefaultController<string>

  const ongoingStreamPromises: Promise<void>[] = []

  const stream = new ReadableStream({
    start(controllerArg) {
      controller = controllerArg
    },
  })

  function safeEnqueue(data: DataStreamString) {
    try {
      controller.enqueue(data)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // suppress errors when the stream has been closed
    }
  }

  try {
    const result = execute({
      write(data: DataStreamString) {
        safeEnqueue(data)
      },
      writeData(data) {
        safeEnqueue(formatDataStreamPart('data', [data]))
      },
      writeMessageAnnotation(annotation) {
        safeEnqueue(formatDataStreamPart('message_annotations', [annotation]))
      },
      writeSource(source) {
        safeEnqueue(formatDataStreamPart('source', source))
      },
      merge(streamArg) {
        ongoingStreamPromises.push(
          (async () => {
            const reader = streamArg.getReader()
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              safeEnqueue(value)
            }
          })().catch((error) => {
            safeEnqueue(formatDataStreamPart('error', onError(error)))
          }),
        )
      },
      onError,
    })

    if (result) {
      ongoingStreamPromises.push(
        result.catch((error) => {
          safeEnqueue(formatDataStreamPart('error', onError(error)))
        }),
      )
    }
  } catch (error) {
    safeEnqueue(formatDataStreamPart('error', onError(error)))
  }

  // Wait until all ongoing streams are done. This approach enables merging
  // streams even after execute has returned, as long as there is still an
  // open merged stream. This is important to e.g. forward new streams and
  // from callbacks.
  // eslint-disable-next-line no-async-promise-executor
  const waitForStreams: Promise<void> = new Promise(async (resolve) => {
    while (ongoingStreamPromises.length > 0) {
      await ongoingStreamPromises.shift()
    }
    resolve()
  })

  waitForStreams.finally(() => {
    try {
      controller.close()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // suppress errors when the stream has been closed
    }
  })

  return stream
}
