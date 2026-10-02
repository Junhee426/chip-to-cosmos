/** Small deterministic LRU cache (Map insertion order); no external dependency. */
export class Lru<K, V> {
  private map = new Map<K, V>();
  hits = 0;
  misses = 0;
  constructor(private readonly capacity: number) {}

  get(key: K, make: () => V): V {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.hits++;
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    this.misses++;
    const nv = make();
    this.map.set(key, nv);
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as K);
    return nv;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.hits = this.misses = 0;
  }
}
