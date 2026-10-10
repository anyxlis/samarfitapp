import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ToastsComponent } from '../shared/toasts.component';
import { PdfVisorComponent } from '../shared/pdf-visor.component';

interface Item { ruta: string; texto: string; icono: string }
interface Grupo { titulo: string; items: Item[] }

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastsComponent, PdfVisorComponent],
  template: `
    <aside class="sf-sidebar" [class.open]="abierto()">
      <div class="sf-brand"><img src="logo.png" alt="SamarFit by Sandra Cochet" /></div>
      <nav class="sf-nav">
        @for (g of grupos; track g.titulo) {
          <div class="sf-nav-title">{{ g.titulo }}</div>
          @for (i of g.items; track i.ruta) {
            <a class="sf-link" [routerLink]="i.ruta" routerLinkActive="active" (click)="abierto.set(false)">
              <i class="bi" [class]="'bi-' + i.icono"></i>{{ i.texto }}
            </a>
          }
        }
      </nav>
    </aside>
    <div class="sf-backdrop" [class.open]="abierto()" (click)="abierto.set(false)"></div>

    <div class="sf-main">
      <header class="sf-topbar">
        <button class="btn btn-outline-secondary d-lg-none" (click)="abierto.set(true)" aria-label="Menú">
          <i class="bi bi-list"></i>
        </button>
        <span class="ms-auto small text-muted d-none d-sm-inline">{{ auth.user()?.email }}</span>
        <button class="btn btn-sm btn-outline-dark" (click)="salir()"><i class="bi bi-box-arrow-right me-1"></i>Salir</button>
      </header>
      <main class="sf-content"><router-outlet /></main>
    </div>
    <app-toasts />
    <app-pdf-visor />
  `,
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly abierto = signal(false);

  readonly grupos: Grupo[] = [
    { titulo: 'Principal', items: [{ ruta: '/dashboard', texto: 'Dashboard', icono: 'grid-1x2' }] },
    { titulo: 'Ventas', items: [
      { ruta: '/clientes', texto: 'Clientes', icono: 'people' },
      { ruta: '/facturas-venta', texto: 'Facturas de venta', icono: 'receipt' },
      { ruta: '/cartera-cobrar', texto: 'Cartera por cobrar', icono: 'cash-coin' } ] },
    { titulo: 'Compras', items: [
      { ruta: '/proveedores', texto: 'Proveedores', icono: 'truck' },
      { ruta: '/facturas-compra', texto: 'Facturas de compra', icono: 'bag-check' },
      { ruta: '/cartera-pagar', texto: 'Cartera por pagar', icono: 'wallet2' } ] },
    { titulo: 'Inventario', items: [{ ruta: '/inventario', texto: 'Inventario', icono: 'box-seam' }] },
    { titulo: 'Negocio', items: [
      { ruta: '/gastos', texto: 'Gastos del negocio', icono: 'credit-card-2-front' },
      { ruta: '/informes', texto: 'Informes', icono: 'graph-up-arrow' },
      { ruta: '/configuracion', texto: 'Configuración', icono: 'gear' } ] },
  ];

  async salir() {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
