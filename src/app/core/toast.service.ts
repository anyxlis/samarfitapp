import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; texto: string; tipo: 'success' | 'danger' | 'warning' }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private n = 0;

  ok(texto: string) { this.push(texto, 'success'); }
  error(texto: string) { this.push(texto, 'danger', 6000); }
  aviso(texto: string) { this.push(texto, 'warning'); }

  cerrar(id: number) { this.toasts.update((l) => l.filter((t) => t.id !== id)); }

  private push(texto: string, tipo: Toast['tipo'], ms = 3500) {
    const id = ++this.n;
    this.toasts.update((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => this.cerrar(id), ms);
  }
}
