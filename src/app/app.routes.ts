import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

const terceros = () => import('./pages/terceros/terceros.component').then((m) => m.TercerosComponent);
const lista = () => import('./pages/facturas/facturas-lista.component').then((m) => m.FacturasListaComponent);
const form = () => import('./pages/facturas/factura-form.component').then((m) => m.FacturaFormComponent);
const detalle = () => import('./pages/facturas/factura-detalle.component').then((m) => m.FacturaDetalleComponent);
const cartera = () => import('./pages/cartera/cartera.component').then((m) => m.CarteraComponent);

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent) },
      { path: 'clientes', loadComponent: terceros, data: { tipo: 'clientes' } },
      { path: 'proveedores', loadComponent: terceros, data: { tipo: 'proveedores' } },
      { path: 'inventario', loadComponent: () => import('./pages/inventario/inventario.component').then((m) => m.InventarioComponent) },
      { path: 'facturas-venta', loadComponent: lista, data: { tipo: 'venta' } },
      { path: 'facturas-venta/nueva', loadComponent: form, data: { tipo: 'venta' } },
      { path: 'facturas-venta/:id', loadComponent: detalle, data: { tipo: 'venta' } },
      { path: 'facturas-compra', loadComponent: lista, data: { tipo: 'compra' } },
      { path: 'facturas-compra/nueva', loadComponent: form, data: { tipo: 'compra' } },
      { path: 'facturas-compra/:id', loadComponent: detalle, data: { tipo: 'compra' } },
      { path: 'gastos', loadComponent: () => import('./pages/gastos/gastos.component').then((m) => m.GastosComponent) },
      { path: 'cartera-cobrar', loadComponent: cartera, data: { tipo: 'cobrar' } },
      { path: 'cartera-pagar', loadComponent: cartera, data: { tipo: 'pagar' } },
      { path: 'informes', loadComponent: () => import('./pages/informes/informes.component').then((m) => m.InformesComponent) },
      { path: 'configuracion', loadComponent: () => import('./pages/configuracion/configuracion.component').then((m) => m.ConfiguracionComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
