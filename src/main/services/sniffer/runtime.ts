import type { SnifferState } from '../../types/sniffer-types'

export const snifferStates = new Map<string, SnifferState>()
export const listenedPartitions = new Set<string>()
