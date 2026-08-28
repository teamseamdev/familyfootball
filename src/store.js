import fs from 'node:fs';
import path from 'node:path';
import { createSampleState } from './sample-data.js';

export class JsonStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) this.write(createSampleState());
  }

  read() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  write(state) {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.file);
    return state;
  }

  update(mutator) {
    const state = this.read();
    const result = mutator(state) ?? state;
    this.write(state);
    return result;
  }
}

export function audit(state, type, detail) {
  state.audit ||= [];
  state.audit.unshift({ at: new Date().toISOString(), type, detail });
  state.audit = state.audit.slice(0, 100);
}
