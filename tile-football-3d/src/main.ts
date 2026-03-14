import './style.css';
import { Game } from './core/Game';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root element not found.');
}

const game = new Game(app);
game.start();
