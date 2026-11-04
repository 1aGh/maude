import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Callout } from '@/components/mdcc/callout';
import { CodeBlock } from '@/components/mdcc/code-block';
import {
  ArchitectureMap,
  CommandFlow,
  CommandTree,
  DevServerSchema,
  FileTree,
  InspectorDiagram,
  LoopDiagram,
  StatPanel,
} from '@/components/mdcc/diagrams';
import { DownloadNative } from '@/components/mdcc/download-native';
import { FlowLoop } from '@/components/mdcc/flow-loop';
import { CloudPrice } from '@/components/v2/cloud-price';
import { DocsDoors } from '@/components/v2/docs-doors';
import './mdcc/diagrams/_diagrams.css';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    pre: CodeBlock,
    Callout,
    FlowLoop,
    DownloadNative,
    DocsDoors,
    CloudPrice,
    // phase-17 docs diagram primitives — auto-available in every .mdx
    ArchitectureMap,
    CommandFlow,
    LoopDiagram,
    CommandTree,
    FileTree,
    StatPanel,
    InspectorDiagram,
    DevServerSchema,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
