/**
 * Loads a folder of recorded sounds from `public/sounds/<dir>/`: its
 * meta.json first (never from the browser's cache), then the WAV files it
 * lists, fetched with the bank's fingerprint so a browser never plays old
 * copies. Downloading needs no audio context, so it starts as the page
 * loads; decoding waits for the context.
 */
export interface BankMeta {
  /** Fingerprint of the files, written by `npm run sounds`. */
  version: string;
}

export interface Fetched<M extends BankMeta> {
  meta: M;
  files: Map<string, ArrayBuffer>;
}

const banks = new Map<string, Promise<Fetched<BankMeta>>>();

/** Start (or join) the download of a bank; `names` lists its files (without .wav) from its meta. */
export function fetchBank<M extends BankMeta>(dir: string, names: (meta: M) => string[]): Promise<Fetched<M>> {
  let p = banks.get(dir);
  if (!p) {
    p = (async () => {
      const url = (name: string) => new URL(`sounds/${dir}/${name}`, document.baseURI).href;
      const res = await fetch(url('meta.json'), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${dir}/meta.json: ${res.status}`);
      const meta = (await res.json()) as M;
      const files = new Map<string, ArrayBuffer>();
      await Promise.all(
        names(meta).map(async (name) => {
          const r = await fetch(url(`${name}.wav?v=${meta.version}`));
          if (!r.ok) throw new Error(`${dir}/${name}: ${r.status}`);
          files.set(name, await r.arrayBuffer());
        }),
      );
      return { meta, files };
    })();
    banks.set(dir, p);
  }
  return p as Promise<Fetched<M>>;
}

/** Decode every file of a fetched bank (copies, so the download can be decoded again). */
export async function decodeBank(ctx: BaseAudioContext, bank: Fetched<BankMeta>): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all([...bank.files].map(async ([name, data]) => out.set(name, await ctx.decodeAudioData(data.slice(0)))));
  return out;
}
