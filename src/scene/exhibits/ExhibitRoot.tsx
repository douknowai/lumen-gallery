/**
 * ExhibitRoot.tsx — 展品根组件：读配置分发到五种 mount 构件，
 * 并挂载 FocusRing、ExhibitSpot、点击/悬停交互。
 *
 * 交互规则（gallery.md §10/§13）：
 * - 左键点击 / 触屏点按展品 → 射线命中即打开详情（无需先聚焦）；
 * - 打开详情前请求"观赏位"运镜（0.8s），由相机系统执行。
 */
import { useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Exhibit } from '@/config/schema';
import { markExhibitClick, openExhibit } from '@/state/exhibitActions';
import WallFrame from './WallFrame';
import Pedestal from './Pedestal';
import Vitrine from './Vitrine';
import Screen from './Screen';
import Panel from './Panel';
import FocusRing from '@/scene/FocusRing';
import ExhibitSpot from '@/scene/lighting/ExhibitSpot';

export default function ExhibitRoot({ exhibit: e }: { exhibit: Exhibit }) {
  const rotY = ((e.rotationDeg ?? 0) * Math.PI) / 180;

  const onClick = useCallback(
    (ev: ThreeEvent<MouseEvent>) => {
      ev.stopPropagation();
      markExhibitClick();
      openExhibit(e);
    },
    [e],
  );
  const onOver = useCallback((ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    document.body.style.cursor = 'pointer';
  }, []);
  const onOut = useCallback(() => {
    document.body.style.cursor = 'default';
  }, []);

  const isWall = e.mount === 'wall-frame' || e.mount === 'screen' || e.mount === 'panel';

  return (
    <group
      position={e.position}
      rotation={[0, rotY, 0]}
      userData={{ exhibitId: e.id }}
      onClick={onClick}
      onPointerOver={onOver}
      onPointerOut={onOut}
    >
      {e.mount === 'wall-frame' && <WallFrame exhibit={e} />}
      {e.mount === 'pedestal' && <Pedestal exhibit={e} big={e.id === 'C-01'} />}
      {e.mount === 'vitrine' && <Vitrine exhibit={e} />}
      {e.mount === 'screen' && <Screen exhibit={e} />}
      {e.mount === 'panel' && <Panel exhibit={e} />}

      {/* 聚焦地环：墙面件在墙前 0.75m，座地件环绕基座 */}
      {isWall ? (
        <group position={[0, 0.02 - e.position[1], 0.75]}>
          <FocusRing exhibitId={e.id} radius={0.55} />
        </group>
      ) : (
        <FocusRing exhibitId={e.id} radius={e.mount === 'pedestal' && e.id === 'C-01' ? 0.85 : 0.62} />
      )}

      {/* 轨道射灯（按需激活） */}
      {e.spotlight && <ExhibitSpot exhibit={e} />}
    </group>
  );
}
