import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  XR,
  XROrigin,
  useXR,
  useXRControllerLocomotion,
  useXRControllerButtonEvent,
  useXRInputSourceState,
  TeleportTarget,
} from '@react-three/xr';
import { useStore, playerRef } from '@/state/store';
import { MOVE } from '@/config/site';
import { xrStore } from './xrStore';

/** WebXR 标准手柄扳机按钮 ID */
const TRIGGER_BUTTON = 'xr-standard-trigger';

/**
 * 同步 XR 会话状态到全局 store，并接管渲染循环。
 * 项目 Canvas 使用 frameloop="never"（桌面由 FrameDriver 的 rAF 手动 advance），
 * 但 XR 会话必须由 three.js 的 XRFrame 驱动，因此进入会话时切换到 setAnimationLoop，
 * 退出会话时清空，交还给 FrameDriver。
 */
function XRSessionSync() {
  const advance = useThree((s) => s.advance);
  const gl = useThree((s) => s.gl);
  const session = useXR((s) => s.session);
  const setXrActive = useStore((s) => s.setXrActive);

  useEffect(() => {
    setXrActive(!!session);
    if (session) {
      gl.setAnimationLoop((time: number) => advance(time));
    } else {
      gl.setAnimationLoop(null);
    }
    return () => {
      gl.setAnimationLoop(null);
    };
  }, [session, gl, advance, setXrActive]);

  return null;
}

/**
 * 手柄射线交互：射线指向展品时聚焦（显示 FocusRing），扣扳机打开对应展品弹窗。
 * 复用现有 store 的 setFocused / openModal，桌面输入零影响。
 */
function XRInteraction() {
  const right = useXRInputSourceState('controller', 'right');
  const left = useXRInputSourceState('controller', 'left');
  const controller = right ?? left;
  const scene = useThree((s) => s.scene);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);

  useXRControllerButtonEvent(controller, TRIGGER_BUTTON, (state) => {
    if (state !== 'pressed') return;
    const st = useStore.getState();
    if (st.appState === 'explore' && st.focusedId) st.openModal(st.focusedId);
  });

  useFrame(() => {
    const st = useStore.getState();
    if (!controller?.object || !st.data || st.appState !== 'explore') return;
    dir.set(0, 0, -1).applyQuaternion(controller.object.quaternion);
    controller.object.getWorldPosition(origin);
    raycaster.set(origin, dir);
    raycaster.far = 50;
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj && !(obj.userData.exhibitId as string | undefined)) obj = obj.parent;
      if (obj) {
        st.setFocused(obj.userData.exhibitId as string);
        return;
      }
    }
    st.setFocused(null);
  });

  return null;
}

/** 运动：右手摇杆平滑移动 + 快转（snap turn），降低 VR 眩晕。 */
function XRLocomotion({ originRef }: { originRef: RefObject<THREE.Group | null> }) {
  useXRControllerLocomotion(
    originRef,
    { speed: MOVE.walkSpeed },
    { type: 'snap', degrees: 45, deadZone: 0.3 },
    'right',
  );
  return null;
}

/** 把 XROrigin 世界坐标同步回 playerRef，供 Minimap 等系统复用；yaw 朝向待真机校准后追加。
 *  仅 XR 会话激活时同步——桌面模式下 originRef 停留在出生点，若无条件写入会把键盘移动每帧拽回原点。 */
function XROriginSync({ originRef }: { originRef: RefObject<THREE.Group | null> }) {
  const session = useXR((s) => s.session);
  useFrame(() => {
    if (!session) return;
    const g = originRef.current;
    if (!g) return;
    playerRef.x = g.position.x;
    playerRef.z = g.position.z;
  });
  return null;
}

/**
 * WebXR 能力层：进入 VR 后由头显接管相机，手柄承担「指向聚焦 + 扳机对话 + 平滑移动 + 快转」，
 * 地面瞬移负责远距离换位。桌面（无 XR 会话）模式下所有逻辑早退，零影响。
 */
export default function XRManager() {
  const originRef = useRef<THREE.Group | null>(null);
  const spawn = useStore((s) => s.data?.gallery.spawn);

  // 出生点写入 XROrigin（玩家脚点），使 VR 出生位置与桌面一致
  useEffect(() => {
    const g = originRef.current;
    if (!g || !spawn) return;
    g.position.set(spawn.position[0], 0, spawn.position[2]);
    g.rotation.y = (spawn.headingDeg * Math.PI) / 180;
  }, [spawn]);

  return (
    <XR store={xrStore}>
      <XROrigin ref={originRef} />
      <XRSessionSync />
      <XRInteraction />
      <XRLocomotion originRef={originRef} />
      <XROriginSync originRef={originRef} />
      {/* 地面瞬移目标：透明大平面承接 teleport 射线（不可见但可被射线命中） */}
      <TeleportTarget
        onTeleport={(point) => {
          const g = originRef.current;
          if (g) g.position.set(point.x, 0, point.z);
        }}
      >
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </TeleportTarget>
    </XR>
  );
}

export { xrStore };