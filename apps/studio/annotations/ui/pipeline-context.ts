/**
 * @file       annotations/ui/pipeline-context.ts — the layer's pointer pipeline, for its chrome
 * @scope      apps/studio/annotations/ui/pipeline-context.ts
 * @purpose    Components the annotation layer renders (the resize overlay's
 *             handles) start their gestures on the layer's one pipeline
 *             (pointer-pipeline.ts) instead of adding document listeners of
 *             their own.
 */

import { createContext, useContext } from 'react';
import type { PointerPipeline } from './pointer-pipeline.ts';

export const AnnotationPipelineContext = createContext<PointerPipeline | null>(null);

export function useAnnotationPipeline(): PointerPipeline | null {
  return useContext(AnnotationPipelineContext);
}
