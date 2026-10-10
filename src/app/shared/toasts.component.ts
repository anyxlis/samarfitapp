import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toasts',
  standalone: true,
  template: `
    <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 2000">
      @for (t of svc.toasts(); track t.id) {
        <div class="toast show align-items-center border-0 text-bg-{{ t.tipo }}">
          <div class="d-flex">
            <div class="toast-body">{{ t.texto }}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" (click)="svc.cerrar(t.id)"></button>
          </div>
        </div>
      }
    </div>
  `,
})
export class ToastsComponent {
  readonly svc = inject(ToastService);
}
