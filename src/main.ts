import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Evita que la rueda del mouse cambie el valor de un input numérico enfocado
document.addEventListener(
  'wheel',
  () => {
    const el = document.activeElement as HTMLInputElement | null;
    if (el?.type === 'number') el.blur();
  },
  { passive: true },
);

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
