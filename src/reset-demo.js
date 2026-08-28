import { loadConfig } from './config.js';
import { JsonStore } from './store.js';
import { createSampleState } from './sample-data.js';

const config = loadConfig();
const store = new JsonStore(config.dataFile);
store.write(createSampleState());
console.log(`Demo reset: ${config.dataFile}`);
