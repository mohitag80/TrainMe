// pino-roll ships no types; only the options TrainMe uses are declared.
declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';
  interface PinoRollOptions {
    file: string | (() => string);
    size?: string | number;
    frequency?: 'daily' | 'hourly' | number;
    extension?: string;
    dateFormat?: string;
    limit?: { count?: number; removeOtherLogFiles?: boolean };
    mkdir?: boolean;
    symlink?: boolean;
  }
  export default function roll(options: PinoRollOptions): Promise<DestinationStream>;
}
