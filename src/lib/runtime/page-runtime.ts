import type {
  AbortControllerPort,
  BroadcastChannelPort,
  CapabilityPort,
  ClockPort,
  FileAccessPort,
  IdPort,
  KeyValueStoragePort,
  ObjectUrlPort,
  WorkerPort
} from './ports';
import { ResourceScope } from './resource-scope';

export interface PageRuntimePorts {
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly capabilities: CapabilityPort;
  readonly storage: KeyValueStoragePort;
  readonly files: FileAccessPort;
  readonly workers: WorkerPort;
  readonly abortControllers: AbortControllerPort;
  readonly broadcastChannels: BroadcastChannelPort;
  readonly objectUrls: ObjectUrlPort;
}

export interface PageRuntime extends PageRuntimePorts {
  readonly scope: ResourceScope;
}

export function createPageRuntime(label: string, ports: PageRuntimePorts): PageRuntime {
  return { ...ports, scope: new ResourceScope(label, ports.clock, ports.ids) };
}
