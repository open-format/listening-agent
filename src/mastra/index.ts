import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { summaryAgent } from './agents/index.js';
import { summaryWorkflow, taskWorkflow, rewardsWorkflow } from './workflows/index.js';

export const mastra = new Mastra({
  agents: { summaryAgent },
  workflows: { summaryWorkflow, taskWorkflow, rewardsWorkflow },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});