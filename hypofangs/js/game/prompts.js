// InputPrompts: control names shown in hints, tutorials and menus (keyboard + mouse or touch buttons).
import { Input } from "../engine/input.js";
import { G } from "./common.js";

const KB = {
  Move: "A / D or arrows", MoveShort: "A / D", Jump: "Space / W / Up", Roll: "C", Katana: "J / left click", Dagger: "F / K / middle click", Knife: "Q / L",
  PickUp: "E / right click", Down: "S / Down", Pause: "Esc / P", Map: "M", SkipStory: "Tab", Accept: "Enter / Space", Back: "Esc", Select: "Enter",
  Retry: "R / Enter / left click  Retry", DeviceName: "Keyboard + mouse",
};
const TOUCH = {
  Move: "Left / right buttons", MoveShort: "< / >", Jump: "JUMP", Roll: "ROLL", Katana: "KATANA", Dagger: "DAGGER", Knife: "KNIFE", PickUp: "GRAB", Down: "DOWN",
  Pause: "II", Map: "MAP", SkipStory: "SKIP", Accept: "Tap", Back: "Back", Select: "Tap", Retry: "Tap  Retry", DeviceName: "Touch screen",
};

export const InputPrompts = {
  get touch() { return G.touch && Input.lastDevice === "touch"; },
  get T() { return this.touch ? TOUCH : KB; },
  get signature() { return this.touch ? "touch" : "keyboard"; },
  get Move() { return this.T.Move; }, get MoveShort() { return this.T.MoveShort; }, get Jump() { return this.T.Jump; }, get Roll() { return this.T.Roll; },
  get Katana() { return this.T.Katana; }, get Dagger() { return this.T.Dagger; }, get Knife() { return this.T.Knife; }, get PickUp() { return this.T.PickUp; },
  get Down() { return this.T.Down; }, get Pause() { return this.T.Pause; }, get Map() { return this.T.Map; }, get SkipStory() { return this.T.SkipStory; },
  get Accept() { return this.T.Accept; }, get Back() { return this.T.Back; }, get Select() { return this.T.Select; }, get Retry() { return this.T.Retry; },
  get DeviceName() { return this.T.DeviceName; },
  get MenuHelp() { return this.Accept + " select   |   " + this.Back + " back"; },
  get GameplaySummary() {
    if (!this.touch) return "Space Jump   C Roll   J Katana   F Dagger   Q Knife   E Throw   S Down";
    return "JUMP   ROLL   KATANA   DAGGER   KNIFE   GRAB   DOWN";
  },
  controlsTable(withMap) {
    const rows = [["Move", this.Move], ["Jump", this.Jump], ["Roll", this.Roll], ["Katana", this.Katana], ["Dagger", this.Dagger], ["Throwing knife", this.Knife],
      ["Pick up / throw", this.PickUp], ["Down / drop", this.Down], ["Pause", this.Pause]];
    if (withMap) rows.push(["Level map", this.Map]);
    return rows;
  },
  key(v) { return "[" + v + "]"; },
  worldHint(o) {
    switch (o) {
      case "RUN INTO DOORS TO KICK": return this.Dagger + " x5\nBREAK DOORS / GLASS";
      case "C  ROLL THROUGH LASERS": case "S / CTRL  ROLL THROUGH LASERS": return this.Roll + "  ROLL THROUGH LASERS";
      case "A/D MOVE   SPACE JUMP": return this.MoveShort + " MOVE   " + this.Jump + " JUMP";
      case "CLICK  SLASH": return this.Katana + "  SLASH";
      case "RIGHT CLICK  PICK UP / THROW - STAGGERS SHIELDS": return this.PickUp + "  PICK UP / THROW - STAGGERS SHIELDS";
      case "JUMP INTO WALLS TO WALL-JUMP": return this.Jump + " TOWARD WALLS TO WALL-JUMP";
    }
    return o;
  },
};
