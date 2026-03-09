import { publicProcedure, trpc } from '@shared/routers/trpc'
import { z } from 'zod'
import type { AnalyzeInput } from '../types/ffmpeg-types'
import { analyzeMedia } from '@main/services/ffmpeg'

export const ffmpegRouter = trpc.router({
  analyze: publicProcedure
    .input(z.object({ path: z.string(), header: z.record(z.string(), z.string()).optional() }))
    .query(async ({ input }) => analyzeMedia(input as AnalyzeInput))
})
