import '../ui/game.css';
import '../ui/theme.css';
import { initLang, t } from '../ui/i18n';
import { startFreeDrive } from './freeDrive';

initLang();

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const splash = document.getElementById('splash') as HTMLElement;
splash.textContent = t('loading');

startFreeDrive(app, canvas)
  .then((game) => {
    splash.remove();
    // For the browser console and automated page checks.
    Object.assign(window, { __game: game });
  })
  .catch((err: unknown) => {
    console.error(err);
    splash.textContent = t('loadFailed');
  });
