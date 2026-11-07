import { AIR, EGG, TORCH, isCrop } from './blocks.js';
import { growCrops, supportedBy } from './farming.js';
import { Fluids } from './fluid.js';
import { computeLight, computeSkyLight, updateBlockLight, updateSkyLight } from './light.js';

// 把“改方块”串起来：改数据、火把失去支撑会掉、通知水流、重算光照，
// 最后告诉调用的人哪些区块需要重建网格。
export class Sim {
  constructor(world) {
    this.world = world;
    this.fluids = new Fluids(world);
    // 所有庄稼所在的格子（长大要用）
    this.crops = new Set();
    for (let i = 0; i < world.data.length; i++) if (isCrop(world.data[i])) this.crops.add(i);
    computeLight(world);
    computeSkyLight(world);
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

    if (isCrop(id)) this.crops.add(world.index(x, y, z));
    else this.crops.delete(world.index(x, y, z));

    // 脚下的方块没了，上面的火把掉下来；耕地没了，上面的庄稼也没了
    const above = world.get(x, y + 1, z);
    const loseTorch = (above === TORCH || above === EGG) && !world.isSolidBlock(x, y, z); // 火把和蛋要放在实心方块上
    const loseCrop = isCrop(above) && !supportedBy(above, world.get(x, y, z));
    if (loseTorch || loseCrop) {
      world.set(x, y + 1, z, AIR);
      changed.push(world.index(x, y + 1, z));
      this.fluids.schedule(x, y + 1, z);
    }
    this.fluids.schedule(x, y, z);

    const dirty = this.chunkKeysFor(changed);
    // 放下或挖掉不透明的方块也会改变光的走向：重算附近的火把光和天光（只有光变了的区块才重建）
    this.chunkKeysFor(updateBlockLight(world, x, z), dirty);
    this.chunkKeysFor(updateSkyLight(world, x, z), dirty);
    return dirty;
  }

  // 庄稼生长：返回要重建的区块，没长就是 null
  grow(rand) {
    if (!this.crops.size) return null;
    const grown = growCrops(this.world, this.crops, rand);
    return grown.length ? this.chunkKeysFor(grown) : null;
  }

  // 推进一步水流
  tick() {
    if (!this.fluids.busy) return null;
    const { changed, removedTorches } = this.fluids.tick();
    if (!changed.length) return null;
    const dirty = this.chunkKeysFor(changed);
    for (const i of removedTorches) {
      const [x, , z] = this.world.coords(i);
      this.chunkKeysFor(updateBlockLight(this.world, x, z), dirty);
    }
    return dirty;
  }
}

