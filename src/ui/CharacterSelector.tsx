/**
 * CharacterSelector.tsx — 角色选择器（overlay 层，z 40）。
 * 桌面居中卡片 / 移动端底部弹层：每个角色一张卡片（名称 + 标签 + 一句描述），
 * 当前选中黄铜描边 + 角标勾。点击即时切换（面板保持打开可继续预览），
 * 遮罩点击 / Esc / 右上 X 关闭（返回进入前的状态：explore 或 ready）。
 */
import { motion } from 'framer-motion';
import { X, Check, PersonStanding, AudioLines, Mic, Sparkles, ShieldCheck } from 'lucide-react';
import { useStore } from '@/state/store';
import { VOICE_OPTIONS } from '@/config/voices';
import { useI18n } from '@/lib/i18n';

export default function CharacterSelector() {
  const characters = useStore((s) => s.characters);
  const characterId = useStore((s) => s.characterId);
  const setCharacterId = useStore((s) => s.setCharacterId);
  const voiceId = useStore((s) => s.voiceId);
  const setVoiceId = useStore((s) => s.setVoiceId);
  const callMode = useStore((s) => s.callMode);
  const setCallMode = useStore((s) => s.setCallMode);
  const closeCharacters = useStore((s) => s.closeCharacters);
  const isMobile = useStore((s) => s.isMobile);
  const proactiveEnabled = useStore((s) => s.proactiveEnabled);
  const setProactiveEnabled = useStore((s) => s.setProactiveEnabled);
  const sensingEnabled = useStore((s) => s.sensingEnabled);
  const setSensingEnabled = useStore((s) => s.setSensingEnabled);
  const sensingStatus = useStore((s) => s.sensingStatus);
  const { t, lang } = useI18n();

  /* 摄像头感知运行状态的文案与颜色（黄铜 = 正常，黄铜红 = 异常） */
  const sensingStatusLabel = t(`sensing.status.${sensingStatus}`);
  const sensingStatusColor =
    sensingStatus === 'active'
      ? 'var(--brass)'
      : sensingStatus === 'denied' || sensingStatus === 'unavailable'
        ? '#a63d2f'
        : 'var(--stone)';

  const inputModes = [
    { id: 'push' as const, icon: Mic, name: t('settings.pushName'), label: t('settings.pushLabel'), desc: t('settings.pushDesc') },
    { id: 'vad' as const, icon: AudioLines, name: t('settings.vadName'), label: t('settings.vadLabel'), desc: t('settings.vadDesc') },
  ];

  const currentId = characterId ?? characters?.default;

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* 遮罩（点击关闭） */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(20,18,15,.4)', backdropFilter: 'blur(4px)' }}
        onClick={closeCharacters}
      />
      <motion.div
        className={
          isMobile
            ? 'lumen-scroll absolute bottom-0 left-0 right-0 max-h-[92vh] overflow-y-auto rounded-t-2xl p-6'
            : 'lumen-scroll relative max-h-[80vh] w-[640px] overflow-y-auto rounded-[14px] p-8'
        }
        style={{ background: 'var(--paper)', boxShadow: '0 24px 60px -24px rgba(34,31,26,.35)' }}
        initial={isMobile ? { y: '100%' } : { opacity: 0, y: 24 }}
        animate={isMobile ? { y: 0 } : { opacity: 1, y: 0 }}
        exit={isMobile ? { y: '100%' } : { opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-serif-lumen text-[22px] font-medium">{t('settings.title')}</h2>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={closeCharacters}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--paper-dim)]"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className={isMobile ? 'space-y-3' : 'grid grid-cols-2 gap-3'}>
          {(characters?.characters ?? []).map((c) => {
            const selected = c.id === currentId;
            return (
              <motion.button
                key={c.id}
                type="button"
                onClick={() => setCharacterId(c.id)}
                whileTap={{ scale: 0.97 }}
                className="relative flex items-start gap-3 rounded-[12px] border p-4 text-left"
                style={{
                  borderColor: selected ? 'var(--brass)' : 'var(--line)',
                  background: selected ? 'rgba(166,124,61,.06)' : 'transparent',
                  boxShadow: selected ? '0 8px 24px -14px rgba(166,124,61,.5)' : 'none',
                  transition: 'border-color .18s ease, background .18s ease',
                }}
              >
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: selected ? 'var(--brass)' : 'var(--paper-dim)',
                    color: selected ? 'var(--paper)' : 'var(--ink-60)',
                  }}
                >
                  <PersonStanding size={18} strokeWidth={1.5} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="font-serif-lumen text-[16px] font-medium">{lang === 'zh' ? c.name : c.nameEn ?? c.name}</span>
                    <span className="text-[12px]" style={{ color: 'var(--stone)' }}>
                      {lang === 'zh' ? c.label : c.labelEn ?? c.label}
                    </span>
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-[1.6]" style={{ color: 'var(--ink-60)' }}>
                    {lang === 'zh' ? c.desc : c.descEn ?? c.desc}
                  </span>
                </span>
                {selected && (
                  <span
                    className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                  >
                    <Check size={13} strokeWidth={2.5} />
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {/* 讲解音色选择 */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <AudioLines size={16} strokeWidth={1.5} style={{ color: 'var(--brass)' }} />
            <h3 className="font-serif-lumen text-[15px] font-medium">{t('settings.voice')}</h3>
            <span className="font-mono-lumen text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--stone)' }}>
              AI Voice
            </span>
          </div>
          <div className={isMobile ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2.5'}>
            {VOICE_OPTIONS.map((v) => {
              const selected = v.id === voiceId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVoiceId(v.id)}
                  className="relative flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3 text-left transition-colors"
                  style={{
                    borderColor: selected ? 'var(--brass)' : 'var(--line)',
                    background: selected ? 'rgba(166,124,61,.06)' : 'transparent',
                  }}
                >
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-serif-lumen text-[15px] font-medium">{v.name}</span>
                      <span className="text-[11.5px]" style={{ color: 'var(--stone)' }}>
                        {lang === 'zh' ? v.label : v.labelEn ?? v.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px]" style={{ color: 'var(--ink-60)' }}>
                      {lang === 'zh' ? v.desc : v.descEn ?? v.desc}
                    </span>
                  </span>
                  {selected && (
                    <span
                      className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                    >
                      <Check size={11} strokeWidth={2.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 通话输入方式选择 */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Mic size={16} strokeWidth={1.5} style={{ color: 'var(--brass)' }} />
            <h3 className="font-serif-lumen text-[15px] font-medium">{t('settings.input')}</h3>
            <span className="font-mono-lumen text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--stone)' }}>
              Input
            </span>
          </div>
          <div className={isMobile ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2.5'}>
            {inputModes.map((opt) => {
              const selected = opt.id === callMode;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCallMode(opt.id)}
                  className="relative flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3 text-left transition-colors"
                  style={{
                    borderColor: selected ? 'var(--brass)' : 'var(--line)',
                    background: selected ? 'rgba(166,124,61,.06)' : 'transparent',
                  }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: selected ? 'var(--brass)' : 'var(--paper-dim)',
                      color: selected ? 'var(--paper)' : 'var(--stone)',
                    }}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-serif-lumen text-[14px] font-medium">{opt.name}</span>
                      <span className="text-[11px]" style={{ color: 'var(--stone)' }}>
                        {opt.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug" style={{ color: 'var(--ink-60)' }}>
                      {opt.desc}
                    </span>
                  </span>
                  {selected && (
                    <span
                      className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                    >
                      <Check size={11} strokeWidth={2.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主动导览（AGENT 自检测：行为信号为主，视觉感知消歧） */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} strokeWidth={1.5} style={{ color: 'var(--brass)' }} />
            <h3 className="font-serif-lumen text-[15px] font-medium">{t('settings.proactive')}</h3>
            <span className="font-mono-lumen text-[11px] uppercase tracking-[0.1em]" style={{ color: 'var(--stone)' }}>
              Agent
            </span>
          </div>

          {/* 主动导览开关 */}
          <button
            type="button"
            role="switch"
            aria-checked={proactiveEnabled}
            onClick={() => setProactiveEnabled(!proactiveEnabled)}
            className="flex w-full items-center justify-between rounded-[12px] border px-3.5 py-3 text-left transition-colors"
            style={{
              borderColor: proactiveEnabled ? 'var(--brass)' : 'var(--line)',
              background: proactiveEnabled ? 'rgba(166,124,61,.06)' : 'transparent',
            }}
          >
            <span className="min-w-0 pr-3">
              <span className="font-serif-lumen text-[14px] font-medium">{t('settings.proactive')}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug" style={{ color: 'var(--ink-60)' }}>
                {t('settings.proactiveDesc')}
              </span>
            </span>
            <span
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              style={{ background: proactiveEnabled ? 'var(--brass)' : 'var(--line)' }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                style={{ left: proactiveEnabled ? '1.375rem' : '0.125rem' }}
              />
            </span>
          </button>

          {/* 摄像头感知开关（桌面端可用；全本地推理，绝不上传） */}
          <button
            type="button"
            role="switch"
            aria-checked={sensingEnabled}
            disabled={isMobile}
            onClick={() => setSensingEnabled(!sensingEnabled)}
            className="mt-2 flex w-full items-center justify-between rounded-[12px] border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              borderColor: sensingEnabled ? 'var(--brass)' : 'var(--line)',
              background: sensingEnabled ? 'rgba(166,124,61,.06)' : 'transparent',
            }}
          >
            <span className="min-w-0 pr-3">
              <span className="flex items-baseline gap-2">
                <span className="font-serif-lumen text-[14px] font-medium">{t('settings.sensing')}</span>
                <span
                  className="font-mono-lumen text-[10.5px] uppercase tracking-[0.08em]"
                  style={{ color: sensingStatusColor }}
                >
                  {sensingStatusLabel}
                </span>
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug" style={{ color: 'var(--ink-60)' }}>
                {isMobile ? t('settings.sensingDesktopOnly') : t('settings.sensingDesc')}
              </span>
              {!isMobile && sensingEnabled && (
                <span className="mt-1 flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--stone)' }}>
                  <ShieldCheck size={12} strokeWidth={1.5} />
                  {t('settings.sensingPrivacy')}
                </span>
              )}
            </span>
            <span
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              style={{ background: sensingEnabled ? 'var(--brass)' : 'var(--line)' }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                style={{ left: sensingEnabled ? '1.375rem' : '0.125rem' }}
              />
            </span>
          </button>
        </div>

        <div className="mt-5 text-center text-[12.5px]" style={{ color: 'var(--stone)' }}>
          {t('settings.footer')}
        </div>
      </motion.div>
    </motion.div>
  );
}
