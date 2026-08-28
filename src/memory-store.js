export class MemoryStore {
  constructor(initialState) {
    this.state = structuredClone(initialState);
  }

  async read() {
    return structuredClone(this.state);
  }

  async write(state) {
    this.state = structuredClone(state);
    return state;
  }

  async update(mutator) {
    const state = await this.read();
    const result = await mutator(state) ?? state;
    await this.write(state);
    return result;
  }
}
