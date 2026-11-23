// Icons come from Phosphor Icons (MIT, https://phosphoricons.com): bold weight for
// controls, fill weight where a solid glyph reads better from across the room.

import playSvg from '@phosphor-icons/core/assets/fill/play-fill.svg?raw';
import pauseSvg from '@phosphor-icons/core/assets/fill/pause-fill.svg?raw';
import plusSvg from '@phosphor-icons/core/assets/bold/plus-bold.svg?raw';
import checkSvg from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import searchSvg from '@phosphor-icons/core/assets/bold/magnifying-glass-bold.svg?raw';
import infoSvg from '@phosphor-icons/core/assets/bold/info-bold.svg?raw';
import captionsSvg from '@phosphor-icons/core/assets/bold/subtitles-bold.svg?raw';
import audioSvg from '@phosphor-icons/core/assets/bold/speaker-high-bold.svg?raw';
import speedSvg from '@phosphor-icons/core/assets/bold/gauge-bold.svg?raw';
import listSvg from '@phosphor-icons/core/assets/bold/list-bullets-bold.svg?raw';
import nextSvg from '@phosphor-icons/core/assets/fill/skip-forward-fill.svg?raw';
import restartSvg from '@phosphor-icons/core/assets/bold/arrow-counter-clockwise-bold.svg?raw';
import starSvg from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import eyeSvg from '@phosphor-icons/core/assets/bold/eye-bold.svg?raw';
import trashSvg from '@phosphor-icons/core/assets/bold/trash-bold.svg?raw';
import chevronRightSvg from '@phosphor-icons/core/assets/bold/caret-right-bold.svg?raw';
import chevronLeftSvg from '@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw';
import chevronDownSvg from '@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw';
import chevronUpSvg from '@phosphor-icons/core/assets/bold/caret-up-bold.svg?raw';
import backspaceSvg from '@phosphor-icons/core/assets/bold/backspace-bold.svg?raw';
import globeSvg from '@phosphor-icons/core/assets/bold/globe-bold.svg?raw';
import refreshSvg from '@phosphor-icons/core/assets/bold/arrows-clockwise-bold.svg?raw';
import boltSvg from '@phosphor-icons/core/assets/fill/lightning-fill.svg?raw';
import warnSvg from '@phosphor-icons/core/assets/fill/warning-fill.svg?raw';
import puzzleSvg from '@phosphor-icons/core/assets/bold/puzzle-piece-bold.svg?raw';
import gearSvg from '@phosphor-icons/core/assets/bold/gear-bold.svg?raw';
import micSvg from '@phosphor-icons/core/assets/fill/microphone-fill.svg?raw';
import keyboardSvg from '@phosphor-icons/core/assets/bold/keyboard-bold.svg?raw';
import qrSvg from '@phosphor-icons/core/assets/bold/qr-code-bold.svg?raw';

const SOURCES: Record<string, string> = {
  play: playSvg,
  pause: pauseSvg,
  plus: plusSvg,
  check: checkSvg,
  search: searchSvg,
  info: infoSvg,
  captions: captionsSvg,
  audio: audioSvg,
  speed: speedSvg,
  list: listSvg,
  next: nextSvg,
  restart: restartSvg,
  star: starSvg,
  eye: eyeSvg,
  trash: trashSvg,
  chevronRight: chevronRightSvg,
  chevronLeft: chevronLeftSvg,
  chevronDown: chevronDownSvg,
  chevronUp: chevronUpSvg,
  backspace: backspaceSvg,
  globe: globeSvg,
  refresh: refreshSvg,
  bolt: boltSvg,
  warn: warnSvg,
  puzzle: puzzleSvg,
  gear: gearSvg,
  mic: micSvg,
  keyboard: keyboardSvg,
  qr: qrSvg,
};

/** Path data only: the wrapper <svg> is ours so the icon inherits size and colour. */
const INNER: Record<string, string> = {};
for (const name of Object.keys(SOURCES)) {
  INNER[name] = SOURCES[name].replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

export function Icon({ name, class: cls }: { name: string; class?: string }) {
  return (
    <svg
      class={'icon ' + (cls ?? '')}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: INNER[name] ?? '' }}
    />
  );
}
