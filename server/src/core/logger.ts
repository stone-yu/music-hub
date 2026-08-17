import { pino } from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.log.level ?? 'info',
  base: { app: 'ro' },
})
