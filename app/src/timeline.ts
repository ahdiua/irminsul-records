// The edit: one timeline entry per chapter (data/chapters.json, made by pipeline/assemble.py). Every entry is
// drawn by the same scene (scenes/chronicle.ts), which follows the shots inside the chapter itself; the entries
// exist for navigation ([ ] in the player) and for warm-up.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';
import { FILM } from './scenes/_film';

const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`] ?? modules['./scenes/todo.ts'];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

export function makeTimeline(_ly: Lyrics, au: AudioData): TimelineEntry[] {
  const cs = FILM.chapters;
  return cs.map((c, i) => ({
    id: c.id,
    load: scene('chronicle'),
    start: c.start,
    end: i + 1 < cs.length ? cs[i + 1]!.start : au.duration,
  }));
}
