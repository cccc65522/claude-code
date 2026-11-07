import { AIR, TORCH } from './blocks.js';
import { Fluids } from './fluid.js';
import { computeLight, relight } from './light.js';

// 把“改方块”串起来：改数据、火把失去支撑会掉、通知水流、重算光照，
// 最后告诉调用的人哪些区块需要重建网格。
export class Sim {
  constructor(world) {
    this.world = world;
    this.fluids = new Fluids(world);
    computeLight(world);
    // 读档后，改过的地方可能还有没流完的水
    for (const key of world.edits.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      this.fluids.schedule(x, y, z);
    }
  }

  chunkKeysFor(indices, out = new Set()) {
    for (const i of indices) {
      const [x, , z] = this.world.coords(i);
      for (const [cx, cz] of this.world.affectedChunks(x, z)) out.add(`${cx},${cz}`);
    }
    return out;
  }

  /**
   * 玩家改一个方块。返回需要重建的区块（"cx,cz" 的集合），没改动返回 null。
   */
  edit(x, y, z, id) {
    const world = this.world;
    if (!world.set(x, y, z, id)) return null;
    const changed = [world.index(x, y, z)];

    // 脚下的方块没了，上面的火把掉下来
    if (world.get(x, y + 1, z) === TORCH && !world.isSolidBlock(x, y, z)) {
      world.set(x, y + 1, z, AIR);
      changed.push(world.index(x, y + 1, z));
      this.fluids.schedule(x, y + 1, z);
    }
    this.fluids.schedule(x, y, z);

    const dirty = this.chunkKeysFor(changed);
    // 放下或挖掉不透明的方块也会改变光的走向，所以每次都重算（只有光变了的区块才重建）
    this.chunkKeysFor(relight(world), dirty);
    return dirty;
  }

  // 推进一步水流
  tick() {
    if (!this.fluids.busy) return null;
    const { changed, removedTorch } = this.fluids.tick();
    if (!changed.length) return null;
    const dirty = this.chunkKeysFor(changed);
    if (removedTorch) this.chunkKeysFor(relight(this.world), dirty);
    return dirty;
  }
}

