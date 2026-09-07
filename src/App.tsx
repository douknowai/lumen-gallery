/**
 * App.tsx — LUMEN 流明 · 虚拟美术馆（单页沉浸式应用）。
 * 视图层：LoadingOverlay(70) > Lightbox(60) > ExhibitModal(50) > HelpPanel(40)
 *        > Toasts(30) > HUD(20) > Gallery Canvas(10)。
 */
import { AnimatePresence } from 'framer-motion';
import Gallery from '@/scene/Gallery';
import LoadingOverlay from '@/ui/LoadingOverlay';
import HUD from '@/ui/HUD';
import HelpPanel from '@/ui/HelpPanel';
import CharacterSelector from '@/ui/CharacterSelector';
import ExhibitModal from '@/ui/ExhibitModal';
import ExhibitCall from '@/ui/ExhibitCall';
import GuideAssistant from '@/ui/GuideAssistant';
import PresenceMonitor from '@/systems/sensing/PresenceMonitor';
import ProactiveNudge from '@/ui/ProactiveNudge';
import Lightbox from '@/ui/Lightbox';
import Toasts from '@/ui/Toasts';
import { useStore } from '@/state/store';
import { useGalleryLoader } from '@/hooks/useGalleryLoader';
import { useKeyboard } from '@/systems/controls/useKeyboard';
import { useCmsPreview } from '@/hooks/useCmsPreview';

export default function App() {
  useGalleryLoader();
  useKeyboard();
  useCmsPreview();
  const appState = useStore((s) => s.appState);
  const callExhibitId = useStore((s) => s.callExhibitId);

  return (
    <>
      <Gallery />
      <HUD />
      <Toasts />
      <AnimatePresence>{appState === 'help' && <HelpPanel key="help" />}</AnimatePresence>
      <AnimatePresence>{appState === 'characters' && <CharacterSelector key="characters" />}</AnimatePresence>
      <ExhibitModal />
      {callExhibitId && <ExhibitCall key={callExhibitId} />}
      <GuideAssistant />
      {/* AGENT 自检测：摄像头感知（opt-in）+ 主动导览触发器 */}
      <PresenceMonitor />
      <ProactiveNudge />
      <Lightbox />
      <LoadingOverlay />
    </>
  );
}
