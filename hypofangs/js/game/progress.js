// DaggerBreakProgress (5 consecutive dagger cycles break a door or glass) and DaggerReloadProgress (permanent knife reload bonus).
import { Component, Time, Mathf } from "../engine/core.js";
import { Prefs } from "./common.js";

export class DaggerBreakProgress extends Component {
  constructor() { super(); this.owner = null; this.pendingCycle = -1; this.completedCycle = -1; this.lastCompletion = 0; this.direction = { x: 1, y: 0 }; this.CompletedHits = 0; }
  get ReadyToBreak() { return this.CompletedHits >= 5; }
  contact(player, cycle, dir) {
    if (this.ReadyToBreak) return false;
    if (this.owner !== player || (this.CompletedHits > 0 && Time.time - this.lastCompletion > 2)) this.resetChain();
    this.owner = player; this.pendingCycle = cycle; this.direction = dir;
    return true;
  }
  complete(player, cycle) {
    if (this.owner !== player || this.pendingCycle !== cycle || this.completedCycle === cycle || this.ReadyToBreak) return;
    this.completedCycle = cycle; this.pendingCycle = -1; this.lastCompletion = Time.time;
    this.CompletedHits++;
    if (this.ReadyToBreak) {
      const door = this.node.getComponent("HypoFangs.Door");
      if (door) door.kick(this.direction.x >= 0 ? 1 : -1);
      const glass = this.node.getComponent("HypoFangs.Glass");
      if (glass) glass.shatter(this.direction);
    }
  }
  resetChain() {
    if (!this.ReadyToBreak) { this.CompletedHits = 0; this.owner = null; this.pendingCycle = this.completedCycle = -1; }
  }
}
DaggerBreakProgress.typeName = "DaggerBreakProgress";

export const DaggerReloadProgress = {
  get collectedCount() { return Math.max(0, Prefs.getInt("hypofangs_dagger_reload_pickups_v1", 0)); },
  reloadSeconds(base = 3.5) { return Math.max(0.25, base - this.collectedCount * 0.25); },
  collect(id) {
    if (!id) return false;
    const key = "hypofangs_dagger_reload_claim_v1_" + id;
    if (Prefs.getInt(key, 0) !== 0) return false;
    Prefs.setInt(key, 1);
    Prefs.setInt("hypofangs_dagger_reload_pickups_v1", this.collectedCount + 1);
    return true;
  },
};
