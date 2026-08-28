import { createPoolServer } from '../src/server.js';

const app = createPoolServer();

export default app.handler;
