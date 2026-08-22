/**
 * useThirdPersonObstacle.ts — 第三人称相机避障 hook。
 * 每帧从角色锚点向后投射线段，按命中比例收紧相机距离（写入 hitTRef），
 * 恢复时 lerp .15 防弹跳；命中时立即收紧。供 CameraDirector 使用。
 */
import { useFrame } from '@react-three/fiber';
import { castSegment } from '@/systems/collision';
import { CAMERA } from '@/config/site';
import { playerRef } from '@/state/store';
import { lookDir } from './rigMath';

export function useThirdPersonObstacle(hitTRef: { current: number }) {
  useFrame(() => {
    const d = lookDir(playerRef.camYaw, playerRef.camPitch);
    const ax = playerRef.x;
    const az = playerRef.z;
    // 从锚点向后投射
    const dist = playerRef.camDistance;
    const tx = ax - d.x * dist;
    const tz = az - d.z * dist;
    const t = castSegment(ax, az, tx, tz, CAMERA.obstacleRadius);
    // 恢复时 lerp .15 防弹跳；命中时立即收紧
    hitTRef.current = t < hitTRef.current ? t : hitTRef.current + (t - hitTRef.current) * 0.15;
  });
}