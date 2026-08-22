/**
 * ThirdPersonRig.tsx — 第三人称 rig（默认）。
 * 位姿由 rigMath.thirdPersonPose 给出，每帧避障比例平滑已下沉至 useThirdPersonObstacle；
 * 实际写相机由 CameraDirector 统一执行。
 */
import { useThirdPersonObstacle } from './useThirdPersonObstacle';

export default function ThirdPersonRig({ hitTRef }: { hitTRef: { current: number } }) {
  useThirdPersonObstacle(hitTRef);
  return null;
}