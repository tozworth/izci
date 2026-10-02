declare module 'butterchurn' {
  export interface MilkDropVisualizer {
    loadPreset(preset: object, blendSeconds: number): void;
    setRendererSize(width: number, height: number, options?: { pixelRatio: number }): void;
    render(options: {
      elapsedTime: number;
      audioLevels: {
        timeByteArray: Uint8Array;
        timeByteArrayL: Uint8Array;
        timeByteArrayR: Uint8Array;
      };
    }): void;
  }

  const butterchurn: {
    createVisualizer(context: BaseAudioContext | null, canvas: HTMLCanvasElement, options: {
      width: number;
      height: number;
      pixelRatio: number;
    }): MilkDropVisualizer;
  };
  export default butterchurn;
}

declare module 'virtual:milkdrop-presets' {
  const presets: Record<string, object>;
  export default presets;
}
