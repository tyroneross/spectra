// src/computer-use/index.ts
//
// Public surface of the AX-first, vision-fallback computer-use capability slice.
//
// SPDX-License-Identifier: Apache-2.0

export { ComputerUse } from './computer-use.js'
export type { ComputerUseOptions } from './computer-use.js'
export { NativeAxBridgePort } from './native-port.js'
export {
  AxPermissionError,
  isPermissionMessage,
} from './port.js'
export type {
  AxBridgePort,
  RawAxSnapshot,
  RawActRequest,
  RawActResult,
  RawClickAtRequest,
  RawKeyRequest,
  RawTypeTextRequest,
  RawVisionAvailability,
  RawVisionGrounding,
} from './port.js'
export {
  NativeVisionFallback,
  StubVisionFallback,
  VisionFallbackUnavailableError,
} from './vision-fallback.js'
export type { VisionFallback, VisionContext } from './vision-fallback.js'
export type {
  AxNode,
  AxWindow,
  AxStatus,
  AxSnapshot,
  AxTarget,
  ComputerUseAction,
  ActOutcome,
  FieldResult,
  FillFormResult,
} from './types.js'
