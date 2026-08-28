import { loadConfig } from './config.js';
import { JsonStore } from './store.js';
import { createMockWeekOneState } from './mock-week.js';

const config = loadConfig();
if (config.storageProvider !== 'json') throw new Error('mock:reset is only for local JSON mode');
const store = new JsonStore(config.dataFile);
store.write(createMockWeekOneState(config.baseUrl));
console.log(`Mock Week 1 ready: ${config.baseUrl}/p/mock-week-1`);
