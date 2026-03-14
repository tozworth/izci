declare module 'howler' {
  export class Howl {
    constructor(options: {
      src: string[];
      html5?: boolean;
      format?: string[];
      onload?: () => void;
      onplay?: () => void;
      onpause?: () => void;
      onstop?: () => void;
      onend?: () => void;
      onloaderror?: (id: number, message: unknown) => void;
      onplayerror?: (id: number, message: unknown) => void;
    });

    duration(): number;
    play(): number;
    pause(id?: number): Howl;
    stop(id?: number): Howl;
    seek(seek?: number, id?: number): number | Howl;
    volume(volume?: number, id?: number): number | Howl;
    unload(): void;
    playing(id?: number): boolean;
  }
}
