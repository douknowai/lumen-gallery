/**
 * TopBar.tsx — HUD 顶栏：左字标 / 右视角切换·帮助·全屏按钮（overlay.md §4）。
 */
import { motion } from 'framer-motion';
import { PersonStanding, Eye, HelpCircle, Maximize, Settings, AudioLines } from 'lucide-react';
import { useStore } from '@/state/store';
import { IconButton } from './primitives';
import { useI18n } from '@/lib/i18n';

export default function TopBar() {
  const cameraMode = useStore((s) => s.cameraMode);
  const toggleCameraMode = useStore((s) => s.toggleCameraMode);
  const toggleHelp = useStore((s) => s.toggleHelp);
  const toggleCharacters = useStore((s) => s.toggleCharacters);
  const isMobile = useStore((s) => s.isMobile);
  const appState = useStore((s) => s.appState);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const toggleAi = useStore((s) => s.toggleAi);
  const { lang, setLang, t } = useI18n();
  if (appState === 'modal' || appState === 'lightbox') {
    // 弹窗时顶栏保留可用（帮助/视角仍可切），不变
  }
  // 角色入口：仅探索态/角色选择态显示（弹窗、灯箱、帮助中不出入口）
  const showCharacters = appState === 'explore' || appState === 'characters';
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between p-4">
      <motion.div
        className="flex items-center gap-2"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
      >
        <img src="assets/logo.svg" alt="" className="h-6 w-6" />
        <span className="font-serif-lumen text-[15px] font-medium tracking-[0.18em]">
          LUMEN{!isMobile && <span className="ml-1">流明</span>}
        </span>
      </motion.div>
      <motion.div
        className="pointer-events-auto flex items-center gap-2"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28, delay: 0.08 }}
      >
        <IconButton
          title={cameraMode === 'third' ? t('nav.firstPerson') : t('nav.thirdPerson')}
          onClick={toggleCameraMode}
          active={cameraMode === 'first'}
        >
          <motion.span
            key={cameraMode}
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex"
          >
            {cameraMode === 'third' ? <PersonStanding size={20} strokeWidth={1.5} /> : <Eye size={20} strokeWidth={1.5} />}
          </motion.span>
        </IconButton>
        {showCharacters && (
          <IconButton
            title={t('nav.settings')}
            onClick={toggleCharacters}
            active={appState === 'characters'}
          >
            <Settings size={20} strokeWidth={1.5} />
          </IconButton>
        )}
        <IconButton
          title={aiEnabled ? t('nav.aiOff') : t('nav.aiOn')}
          onClick={toggleAi}
          active={aiEnabled}
        >
          <AudioLines size={20} strokeWidth={1.5} />
        </IconButton>
        <IconButton
          title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        >
          <span className="font-mono-lumen text-[11px] font-medium tracking-wider">
            {lang === 'zh' ? 'EN' : '中'}
          </span>
        </IconButton>
        <IconButton title={t('nav.help')} onClick={toggleHelp}>
          <HelpCircle size={20} strokeWidth={1.5} />
        </IconButton>
        {!isMobile && (
          <IconButton
            title={t('nav.fullscreen')}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            }}
          >
            <Maximize size={20} strokeWidth={1.5} />
          </IconButton>
        )}
      </motion.div>
    </div>
  );
}
