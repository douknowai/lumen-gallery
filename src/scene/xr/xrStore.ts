import { createXRStore } from '@react-three/xr';

/**
 * 全局 WebXR store：负责进入/退出 VR 会话、读取会话状态。
 * 由画布内的 <XR store={xrStore}> 连接，画布外的入口按钮可直接操作本 store。
 *
 * emulate: false —— 关闭 @pmndrs/xr 内置的「浏览器 WebXR 模拟器」。
 * 否则 createXRStore 默认会在 localhost 且不支持 WebXR 时动态 import 模拟器，
 * 连带把 @iwer/* 的一堆示例房间模型（living_room/music_room 等 2MB+）打进产物。
 * 正式 VR 走真机（Quest 等），无需模拟器。
 */
export const xrStore = createXRStore({ emulate: false });