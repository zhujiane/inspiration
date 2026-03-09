import { publicProcedure, trpc } from '@shared/routers/trpc'
import { z } from 'zod'
import {
  downloadToLibrary,
  getSnifferStats,
  mergeSelectedToLibrary,
  registerSnifferIpc,
  resetInterception,
  startInterception,
  stopInterception
} from '../services/sniffer'

registerSnifferIpc()

const snifferDownloadResourceSchema = z.object({
  id: z.string(),
  type: z.enum(['video', 'audio', 'image']),
  url: z.string().url(),
  title: z.string(),
  capturedAt: z.number().optional(),
  pageUrl: z.string().optional(),
  contentType: z.string().optional(),
  duration: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  resolution: z.string().optional(),
  size: z.string().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional()
})

const snifferMergeTaskSchema = z.object({
  id: z.string(),
  video: snifferDownloadResourceSchema,
  audio: snifferDownloadResourceSchema
})

export const snifferRouter = trpc.router({
  start: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    startInterception(input.partition)
    return { success: true }
  }),

  stop: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    stopInterception(input.partition)
    return { success: true }
  }),

  reset: publicProcedure.input(z.object({ partition: z.string() })).mutation(({ input }) => {
    resetInterception(input.partition)
    return { success: true }
  }),

  getStats: publicProcedure.input(z.object({ partition: z.string() })).query(({ input }) => {
    return getSnifferStats(input.partition)
  }),

  download: publicProcedure.input(z.object({ resource: snifferDownloadResourceSchema })).mutation(async ({ input }) => {
    const result = await downloadToLibrary(input.resource)
    return { success: true, filePath: result.filePath, libraryItem: result.libraryItem }
  }),

  mergeSelected: publicProcedure
    .input(z.object({ tasks: z.array(snifferMergeTaskSchema).min(1) }))
    .mutation(async ({ input }) => {
      return mergeSelectedToLibrary(input.tasks)
    })
})
