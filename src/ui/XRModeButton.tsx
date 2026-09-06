import { useEffect, useState } from 'react';
import { Glasses } from 'lucide-react';
import { xrStore } from '@/scene/xr/xrStore';
import { IconButton } from './primitives';

/**
 * WebXR 入口按钮：检测 immersive-vr 支持（需 6DoF 头显 + HTTPS），不支持则自动隐藏。
 * 点击进入 VR 会话；再次点击或由头显系统 UI 退出会话。
 */
export default function XRModeButton() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState<boolean>(() => !!xrStore.getState().session);

  useEffect(() => {
    const nav = navigator as Navigator & {
      xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
    };
    if (!nav.xr?.isSessionSupported) return;
    let mounted = true;
    nav.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        if (mounted) setSupported(ok);
      })
      .catch(() => {
        if (mounted) setSupported(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return xrStore.subscribe((s) => setActive(!!s.session));
  }, []);

  if (!supported) return null;

  const onToggle = () => {
    const session = xrStore.getState().session;
    if (session) {
      void session.end();
    } else {
      void xrStore.enterVR();
    }
  };

  return (
    <IconButton title={active ? '退出 VR' : '进入 VR'} onClick={onToggle} active={active}>
      <Glasses size={20} strokeWidth={1.5} />
    </IconButton>
  );
}