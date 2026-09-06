// 空实现：替换 @iwer/devui / @iwer/sem / iwer（WebXR 浏览器内模拟器）。
// 真机（Quest 等 6DoF 头显）无需模拟器；此 shim 避免 rollup 把模拟器及其约 5MB 房间模型
// （office/meeting_room/living_room/music_room 等）打包进产物。
// 注意：仅当 createXRStore({ emulate: false }) 时该模块才会被动态加载，正常运行时不会实例化。

export const DevUI = null

export const SyntheticEnvironmentModule = null

export class XRDevice {
  constructor() {}
  installRuntime() {}
  installDevUI() {}
  installSEM() {}
}

export const metaQuest3 = null
export const metaQuest2 = null
export const metaQuestPro = null
export const oculusQuest1 = null