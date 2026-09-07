/**
 * PresenceMonitor.tsx — 摄像头感知（opt-in，默认关闭）。
 *
 * MediaPipe FaceLandmarker 全本地 WASM 推理：
 * - 在场 presence / 注视 attention / 氛围 mood / 疲劳 drowsy；
 * - 模型与 wasm 全部从 public/assets/ 本地加载，不依赖外网 CDN；
 * - 采样约 9fps（110ms），独立于 3D 渲染循环，不抢帧预算；
 * - 画面绝不上传、不落盘；权限拒绝 / 模型不可用时优雅降级并回退开关。
 * - 移动端不启用（性能 + 前后摄问题），行为信号照常工作。
 */
import { useEffect } from 'react';
import { useStore } from '@/state/store';
import { sensing, MoodTracker, headPoseFromMatrix, ATTENTION, type MoodState } from './sensing';
import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

/** 单帧检测间隔：约 9fps，足够「氛围级」感知且开销极低 */
const SAMPLE_INTERVAL_MS = 110;

export default function PresenceMonitor() {
  const sensingEnabled = useStore((s) => s.sensingEnabled);
  const isMobile = useStore((s) => s.isMobile);

  useEffect(() => {
    if (!sensingEnabled || isMobile) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let landmarker: FaceLandmarker | null = null;
    const tracker = new MoodTracker();
    const { setSensingStatus, setSensingEnabled } = useStore.getState();

    const fail = (err: unknown) => {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setSensingStatus(denied ? 'denied' : 'unavailable');
      setSensingEnabled(false);
      sensing.reset();
    };

    const run = async () => {
      try {
        setSensingStatus('requesting');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
          audio: false,
        });
        if (stopped) return;

        // 动态 import：仅开启感知时才加载 tasks-vision chunk，不影响首屏
        const vision = await import('@mediapipe/tasks-vision');
        if (stopped) return;
        const fileset = await vision.FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');
        if (stopped) return;

        const create = async (delegate: 'GPU' | 'CPU') =>
          vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/assets/models/face_landmarker.task', delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          });
        try {
          landmarker = await create('GPU');
        } catch {
          landmarker = await create('CPU'); // 部分 GPU 环境降级
        }
        if (stopped) return;

        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        // 隐藏但保持可解码（display:none 可能导致停帧）
        video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
        video.srcObject = stream;
        document.body.appendChild(video);
        await video.play();
        if (stopped) return;

        sensing.setVisual({ available: true });
        setSensingStatus('active');

        const scoreOf = (cats: { categoryName?: string; score: number }[] | undefined, name: string): number => {
          if (!cats) return 0;
          const hit = cats.find((c) => c.categoryName === name);
          return hit ? hit.score : 0;
        };

        const tick = () => {
          if (stopped || !video || !landmarker) return;
          try {
            if (video.readyState >= 2) {
              const res: FaceLandmarkerResult = landmarker.detectForVideo(video, performance.now());
              const face = res.faceLandmarks?.[0];
              const present = Array.isArray(face) && face.length > 0;

              // 注视：头部朝向大致正对画面（宽松阈值吸收矩阵估计误差）
              let attention = false;
              const matrix = res.facialTransformationMatrixes?.[0]?.data;
              if (present && matrix) {
                const { yaw, pitch } = headPoseFromMatrix(matrix);
                attention = Math.abs(yaw) <= ATTENTION.YAW_MAX && Math.abs(pitch) <= ATTENTION.PITCH_MAX;
              }

              // 氛围 / 疲劳：blendshapes 持续判定（离场帧喂 0 以重置计时）
              const cats = present ? res.faceBlendshapes?.[0]?.categories : undefined;
              const smile = (scoreOf(cats, 'mouthSmileLeft') + scoreOf(cats, 'mouthSmileRight')) / 2;
              const blink = (scoreOf(cats, 'eyeBlinkLeft') + scoreOf(cats, 'eyeBlinkRight')) / 2;
              const browDown = (scoreOf(cats, 'browDownLeft') + scoreOf(cats, 'browDownRight')) / 2;
              const { mood, drowsy }: { mood: MoodState; drowsy: boolean } = tracker.update({
                smile,
                blink,
                browDown,
                now: performance.now(),
              });

              sensing.setVisual({ available: true, presence: present, attention, drowsy, mood });
            }
          } catch {
            /* 单帧失败忽略，下帧重试 */
          }
          timer = setTimeout(tick, SAMPLE_INTERVAL_MS);
        };
        tick();
      } catch (err) {
        fail(err);
      }
    };
    void run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      try {
        landmarker?.close();
      } catch {
        /* 忽略释放异常 */
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
      sensing.reset();
      setSensingStatus('off');
    };
  }, [sensingEnabled, isMobile]);

  return null;
}
